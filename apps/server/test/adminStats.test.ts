import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { summarizeDecisions } from '@poker/strategy';
import { createDb, type Db } from '../src/db/client.js';
import { players, coachReports } from '../src/db/schema.js';
import { saveHand } from '../src/history/repo.js';
import { ensureLocalAnalysis } from '../src/analysis/service.js';
import { adminPlayers } from '../src/stats/admin.js';
import { tableJoined, tableLeft } from '../src/accounts/activity.js';
import { mountApi, type ApiDeps } from '../src/api/index.js';
import { LoginLimiter } from '../src/accounts/rateLimit.js';
import { createInvites } from '../src/accounts/service.js';
import { play, startTable, F } from '../../../packages/strategy/test/helpers.js';

const MIN = 60_000;
const NOW = Date.parse('2026-11-10T12:00:00Z');

function hand(handNo: number, endedAt: number, ids: [string, string, string], durMs = MIN) {
  const g = startTable(3, 0, undefined, undefined, handNo);
  play(g, F, F);
  const handId = `adm-${ids[0]}-${handNo}`;
  (g.events[0] as { handId: string }).handId = handId;
  return {
    tableId: 'adm',
    tableName: '测试桌',
    maxSeats: 6,
    handNo,
    events: g.events,
    state: { ...g.state, handId },
    seats: ids.map((playerId, seat) => ({ seat, playerId, name: `n${seat}`, isBot: false, startStack: 1000 })),
    startedAt: endedAt - durMs,
    endedAt,
  };
}

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start() {
  const db = await createDb({ memory: true });
  const deps: ApiDeps = {
    db: async () => db,
    llm: null,
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
  const call = async (path: string, token?: string) => {
    const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const register = async (username: string) => {
    const [code] = await createInvites(db, null, 1);
    const r = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName: username.toUpperCase(), password: 'password1', inviteCode: code }),
    });
    return (await r.json()) as { token: string; playerId: string };
  };
  return { db, call, register };
}

const setSeen = (db: Db, id: string, at: number | null) =>
  db.update(players).set({ lastSeenAt: at === null ? null : new Date(at) }).where(eq(players.id, id));

describe('adminPlayers', () => {
  it('counts hands, play time, analysis, logins and reports per player', async () => {
    const { db, register } = await start();
    const a = await register('alice');
    const b = await register('bob');
    await db.update(players).set({ loginCount: 4 }).where(eq(players.id, a.playerId));
    const ids = (me: string): [string, string, string] => [me, 'botx', 'boty'];
    // alice: two hands in one session (2 min span incl. 1 min gap), one an hour later
    await saveHand(db, hand(1, NOW - 120 * MIN, ids(a.playerId)));
    await saveHand(db, hand(2, NOW - 118 * MIN, ids(a.playerId)));
    await saveHand(db, hand(3, NOW - 30 * MIN, ids(a.playerId)));
    await saveHand(db, hand(1, NOW - 10 * MIN, ids(b.playerId)));
    await ensureLocalAnalysis(db, `adm-${a.playerId}-1`, a.playerId);
    await ensureLocalAnalysis(db, `adm-${a.playerId}-3`, a.playerId);
    for (const [id, status] of [['r1', 'ok'], ['r2', 'failed'], ['r3', 'ok']] as const) {
      await db.insert(coachReports).values({ id, playerId: a.playerId, status, stats: summarizeDecisions([]), text: 't' });
    }

    const res = await adminPlayers(db, NOW);
    expect(res.total).toBe(2);
    const alice = res.players.find((p) => p.id === a.playerId)!;
    const bob = res.players.find((p) => p.id === b.playerId)!;
    expect(alice).toMatchObject({ displayName: 'ALICE', username: 'alice', loginCount: 4, hands: 3, analyzedHands: 2, reports: 2 });
    // session 1: (NOW-121m .. NOW-118m) = 3 min; session 2: 1 min
    expect(alice.playSeconds).toBe(3 * 60 + 60);
    expect(alice.good + alice.ok + alice.mistake).toBeGreaterThan(0);
    expect(bob).toMatchObject({ hands: 1, analyzedHands: 0, playSeconds: 60, reports: 0, good: 0, mistake: 0 });
  });

  it('online by last seen window or table presence; sorted by last seen, nulls last', async () => {
    const { db, register } = await start();
    const a = await register('alice');
    const b = await register('bob');
    const c = await register('carol');
    await setSeen(db, a.playerId, NOW - 4 * MIN);
    await setSeen(db, b.playerId, NOW - 6 * MIN);
    await setSeen(db, c.playerId, null); // registering stamps a real-time last seen; clear it
    let res = await adminPlayers(db, NOW);
    expect(res.players.map((p) => p.username)).toEqual(['alice', 'bob', 'carol']);
    expect(res.players.map((p) => p.online)).toEqual([true, false, false]);
    expect(res.onlineNow).toBe(1);
    expect(res.active7d).toBe(2);
    expect(res.players[2].lastSeenAt).toBeNull();

    tableJoined(b.playerId);
    try {
      res = await adminPlayers(db, NOW);
      expect(res.players.find((p) => p.id === b.playerId)!.online).toBe(true);
      expect(res.onlineNow).toBe(2);
    } finally {
      tableLeft(b.playerId);
    }
    await setSeen(db, c.playerId, NOW - 8 * 24 * 60 * MIN);
    expect((await adminPlayers(db, NOW)).active7d).toBe(2);
  });

  it('omits legacy accounts without a username', async () => {
    const { db, register } = await start();
    await register('alice');
    await db.insert(players).values({ id: 'legacy', nickname: 'old' });
    const res = await adminPlayers(db, NOW);
    expect(res.total).toBe(1);
  });
});

describe('admin player endpoints', () => {
  it('rejects non-admins and unauthenticated callers', async () => {
    const { call, register } = await start();
    const u = await register('alice');
    expect((await call('/api/admin/players', u.token)).status).toBe(403);
    expect((await call('/api/admin/players')).status).toBe(401);
    expect((await call(`/api/admin/players/${u.playerId}/reports`, u.token)).status).toBe(403);
  });

  it('admin lists players and a player\'s reports; unknown id gives []', async () => {
    const { db, call, register } = await start();
    const admin = await register('boss');
    await db.update(players).set({ isAdmin: true }).where(eq(players.id, admin.playerId));
    const u = await register('alice');
    await db.insert(coachReports).values({ id: 'r1', playerId: u.playerId, status: 'ok', stats: summarizeDecisions([]), text: '评估' });
    const list = await call('/api/admin/players', admin.token);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 2 });
    expect(list.body.players).toHaveLength(2);
    const reports = await call(`/api/admin/players/${u.playerId}/reports`, admin.token);
    expect(reports.status).toBe(200);
    expect(reports.body).toHaveLength(1);
    expect(reports.body[0]).toMatchObject({ id: 'r1', text: '评估', status: 'ok' });
    expect((await call('/api/admin/players/nobody/reports', admin.token)).body).toEqual([]);
  });
});
