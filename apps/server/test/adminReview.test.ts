import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { cardToString } from '@poker/core';
import { createDb, type Db } from '../src/db/client.js';
import { saveHand } from '../src/history/repo.js';
import { usedToday } from '../src/analysis/quota.js';
import { mountApi, type ApiDeps } from '../src/api/index.js';
import { LoginLimiter } from '../src/accounts/rateLimit.js';
import { createAdmin, createInvites } from '../src/accounts/service.js';
import type { LlmClient } from '../src/llm.js';
import { C, X, play, startTable } from '../../../packages/strategy/test/helpers.js';

/** A 3-handed hand that goes to showdown; `ids[seat]` sits in each seat. */
function hand(handNo: number, ids: [string, string, string]) {
  const g = startTable(3, 0, undefined, undefined, handNo);
  play(g, C, C, X, X, X, X, X, X, X, X, X, X);
  const handId = `rev-${handNo}`;
  (g.events[0] as { handId: string }).handId = handId;
  return {
    tableId: 'rev',
    tableName: '测试桌',
    maxSeats: 6,
    handNo,
    events: g.events,
    state: { ...g.state, handId },
    seats: ids.map((playerId, seat) => ({ seat, playerId, name: `n${seat}`, isBot: false, startStack: 1000 })),
    startedAt: 1000,
    endedAt: 2000 + handNo,
  };
}

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(llm: LlmClient | null = null) {
  const db = await createDb({ memory: true });
  const deps: ApiDeps = {
    db: async () => db,
    llm,
    llmDailyLimit: 30,
    llmBatchDailyLimit: 200,
    limiter: new LoginLimiter(),
    listTables: async () => [],
    createTable: async () => 'room1',
  };
  const app = express();
  mountApi(app, deps);
  const server = app.listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const register = async (username: string) => {
    const [code] = await createInvites(db, null, 1);
    const r = await call('POST', '/api/auth/register', { username, displayName: username.toUpperCase(), password: 'password1', inviteCode: code });
    return r.body as { token: string; playerId: string };
  };
  const admin = async () => {
    await createAdmin(db, 'boss', '站长', 'adminpass1');
    return (await call('POST', '/api/auth/login', { username: 'boss', password: 'adminpass1' })).body as { token: string; playerId: string };
  };
  return { db, call, register, admin };
}

async function waitIdle(call: Awaited<ReturnType<typeof start>>['call'], path: string, token: string) {
  for (let i = 0; i < 200; i++) {
    const p = await call('GET', path, undefined, token);
    if (!p.body.running) return p.body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('batch did not finish');
}

describe('admin review of a player', () => {
  it('is admin-only: other users get 403, anonymous 401', async () => {
    const { call, register } = await start();
    const alice = await register('alice');
    const bob = await register('bob');
    const base = `/api/admin/players/${alice.playerId}`;
    for (const [method, path, body] of [
      ['GET', base],
      ['GET', `${base}/review/stats`],
      ['GET', `${base}/review/trend`],
      ['GET', `${base}/review/analyze-all`],
      ['POST', `${base}/review/analyze-all`],
      ['GET', `${base}/review/reports`],
      ['POST', `${base}/review/reports`],
      ['GET', `${base}/review/hands/rev-1`],
      ['POST', `${base}/review/hands/rev-1/analysis`],
      ['POST', `/api/admin/users/${alice.playerId}/password`, { password: 'abcdef' }],
    ] as const) {
      expect((await call(method, path, body, bob.token)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, body)).status, `${method} ${path}`).toBe(401);
    }
  });

  it('shows the player, runs one-click analysis on their data and quota', async () => {
    const { db, call, register, admin } = await start();
    const alice = await register('alice');
    const boss = await admin();
    await saveHand(db, hand(1, [alice.playerId, 'p1', 'p2']));
    await saveHand(db, hand(2, [alice.playerId, 'p1', 'p2']));
    const base = `/api/admin/players/${alice.playerId}`;

    expect((await call('GET', base, undefined, boss.token)).body).toMatchObject({ id: alice.playerId, displayName: 'ALICE', username: 'alice' });
    expect((await call('GET', '/api/admin/players/p_nobody', undefined, boss.token)).status).toBe(404);

    const before = await call('GET', `${base}/review/stats`, undefined, boss.token);
    expect(before.body).toMatchObject({ hands: 0, unanalyzed: 2 });
    expect((await call('POST', `${base}/review/analyze-all`, undefined, boss.token)).status).toBe(200);
    const done = await waitIdle(call, `${base}/review/analyze-all`, boss.token);
    expect(done).toMatchObject({ hands: 2, localDone: 2, reason: 'disabled' });

    // The work landed on Alice's own data: her page shows it, the admin's own page does not.
    expect((await call('GET', '/api/me/stats', undefined, alice.token)).body).toMatchObject({ hands: 2, unanalyzed: 0 });
    expect((await call('GET', '/api/me/stats', undefined, boss.token)).body).toMatchObject({ hands: 0 });
    // Reports with no LLM configured: same rule as for the player.
    expect((await call('POST', `${base}/review/reports`, undefined, boss.token)).status).toBe(503);
    expect((await call('GET', `${base}/review/reports`, undefined, boss.token)).body).toEqual({ reports: [], remainingToday: 3 });
  });

  it("opens the player's replay from their seat, and single-hand commentary uses their quota", async () => {
    const calls: string[] = [];
    const llm: LlmClient = {
      async explain(_s, user) {
        calls.push(user);
        return '点评';
      },
    };
    const { db, call, register, admin } = await start(llm);
    const alice = await register('alice');
    const boss = await admin();
    const rec = hand(1, ['p0', alice.playerId, 'p2']);
    await saveHand(db, rec);
    const base = `/api/admin/players/${alice.playerId}/review`;

    // The admin did not play this hand: the plain replay route still refuses.
    expect((await call('GET', '/api/hands/rev-1', undefined, boss.token)).status).toBe(403);
    const r = await call('GET', `${base}/hands/rev-1`, undefined, boss.token);
    expect(r.status).toBe(200);
    expect(r.body.hand.heroSeat).toBe(1);
    // The deck order is never sent; the projected frames show only what Alice could see.
    expect(JSON.stringify(r.body)).not.toMatch(/"deck"/);
    // A hand Alice did not play is refused even for the admin.
    await saveHand(db, { ...hand(2, ['p0', 'p1', 'p2']) });
    expect((await call('GET', `${base}/hands/rev-2`, undefined, boss.token)).status).toBe(403);

    const a = await call('POST', `${base}/hands/rev-1/analysis`, undefined, boss.token);
    expect(a.status).toBe(200);
    for (let i = 0; i < 100 && calls.length === 0; i++) await new Promise((res) => setTimeout(res, 10));
    expect(calls).toHaveLength(1);
    expect(await usedToday(db, alice.playerId, 'hand')).toBe(1);
    expect(await usedToday(db, boss.playerId, 'hand')).toBe(0);
    // Alice sees the same analysis on her own replay.
    const mine = await call('GET', '/api/hands/rev-1/analysis', undefined, alice.token);
    expect(mine.status).toBe(200);
    expect(mine.body.decisions.length).toBeGreaterThan(0);
    // Opponents' unshown cards stay out of the prompt (hand went to showdown, so check seat 1's own cards are there).
    const holes = rec.state.players.find((p) => p.seat === 1)!.hole.map(cardToString);
    expect(holes.every((c) => calls[0]!.includes(c))).toBe(true);
  });
});

describe('admin sets a password', () => {
  it('sets a new password, signs out old sessions, and validates input', async () => {
    const { call, register, admin } = await start();
    const alice = await register('alice');
    const boss = await admin();
    const path = `/api/admin/users/${alice.playerId}/password`;
    expect((await call('POST', path, { password: '12345' }, boss.token)).status).toBe(400);
    expect((await call('POST', '/api/admin/users/p_nobody/password', { password: 'abcdef' }, boss.token)).status).toBe(404);
    expect((await call('POST', path, { password: 'abcdef' }, boss.token)).status).toBe(200);
    expect((await call('GET', '/api/me', undefined, alice.token)).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { username: 'alice', password: 'password1' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { username: 'alice', password: 'abcdef' })).status).toBe(200);
  });
});

void (null as unknown as Db);
