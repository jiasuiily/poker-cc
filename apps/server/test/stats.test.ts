import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { saveHand } from '../src/history/repo.js';
import { ensureLocalAnalysis } from '../src/analysis/service.js';
import { playSessions } from '../src/stats/sessions.js';
import { playerStats, playerTrend } from '../src/stats/player.js';
import { mountApi, type ApiDeps } from '../src/api/index.js';
import { LoginLimiter } from '../src/accounts/rateLimit.js';
import { createInvites } from '../src/accounts/service.js';
import { play, startTable, F } from '../../../packages/strategy/test/helpers.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function hand(handNo: number, endedAt: number, durMs = 60_000) {
  const g = startTable(3, 0, undefined, undefined, handNo);
  play(g, F, F);
  const handId = `s1-${handNo}`;
  (g.events[0] as { handId: string }).handId = handId;
  return {
    tableId: 's1',
    tableName: '测试桌',
    maxSeats: 6,
    handNo,
    events: g.events,
    state: { ...g.state, handId },
    seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, name: `玩家${seat}`, isBot: false, startStack: 1000 })),
    startedAt: endedAt - durMs,
    endedAt,
  };
}

const d = (a: number, b: number) => ({ startedAt: new Date(a), endedAt: new Date(b) });

describe('playSessions', () => {
  it('splits on gaps of 15 minutes or more', () => {
    expect(playSessions([d(0, 60_000), d(60_000 + 14 * MIN, 60_000 + 14 * MIN + 60_000)])).toEqual({ sessions: 1, seconds: 14 * 60 + 120 });
    expect(playSessions([d(0, 60_000), d(60_000 + 16 * MIN, 60_000 + 16 * MIN + 60_000)])).toEqual({ sessions: 2, seconds: 120 });
  });
  it('single hand = its duration; empty = zero', () => {
    expect(playSessions([d(0, 90_000)])).toEqual({ sessions: 1, seconds: 90 });
    expect(playSessions([])).toEqual({ sessions: 0, seconds: 0 });
  });
  it('sorts unordered input', () => {
    expect(playSessions([d(10 * MIN, 11 * MIN), d(0, MIN)])).toEqual({ sessions: 1, seconds: 11 * 60 });
  });
});

describe('playerStats / playerTrend', () => {
  const NOW = Date.parse('2026-11-10T00:00:00Z');

  it('counts analysed vs unanalysed hands and filters by range', async () => {
    const db = await createDb({ memory: true });
    await saveHand(db, hand(1, NOW - 1 * DAY));
    await saveHand(db, hand(2, NOW - 2 * DAY));
    await saveHand(db, hand(3, NOW - 3 * DAY));
    await saveHand(db, hand(4, NOW - 8 * DAY));
    await ensureLocalAnalysis(db, 's1-1', 'p0');
    await ensureLocalAnalysis(db, 's1-2', 'p0');
    await ensureLocalAnalysis(db, 's1-4', 'p0');
    expect(await playerStats(db, 'p0', 'all', NOW)).toMatchObject({ hands: 3, unanalyzed: 1 });
    expect(await playerStats(db, 'p0', '7d', NOW)).toMatchObject({ hands: 2, unanalyzed: 1 });
    expect(await playerStats(db, 'p0', '30d', NOW)).toMatchObject({ hands: 3, unanalyzed: 1 });
  });

  it('groups the trend by Shanghai date', async () => {
    const db = await createDb({ memory: true });
    await saveHand(db, hand(1, Date.parse('2026-11-07T15:30:00Z')));
    await saveHand(db, hand(2, Date.parse('2026-11-07T16:30:00Z')));
    await ensureLocalAnalysis(db, 's1-1', 'p0');
    await ensureLocalAnalysis(db, 's1-2', 'p0');
    const now = Date.parse('2026-11-09T00:00:00Z');
    const t = await playerTrend(db, 'p0', 30, now);
    expect(t.map((x) => [x.day, x.hands])).toEqual([
      ['2026-11-07', 1],
      ['2026-11-08', 1],
    ]);
    expect(await playerTrend(db, 'p0', 1, now)).toEqual([]);
  });

  it('a player with no hands gets zeros and an empty trend', async () => {
    const db = await createDb({ memory: true });
    expect(await playerStats(db, 'nobody', 'all', NOW)).toMatchObject({ hands: 0, unanalyzed: 0, decisions: 0 });
    expect(await playerTrend(db, 'nobody', 30, NOW)).toEqual([]);
  });
});

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

describe('stats routes', () => {
  it('validates range/days and requires login', async () => {
    const db = await createDb({ memory: true });
    const deps: ApiDeps = { db: async () => db, llm: null, llmDailyLimit: 30, llmBatchDailyLimit: 200, limiter: new LoginLimiter(), listTables: async () => [], createTable: async () => 'r' };
    const app = express();
    mountApi(app, deps);
    const server = app.listen(0);
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/api/me/stats`)).status).toBe(401);
    expect((await fetch(`${base}/api/me/trend`)).status).toBe(401);
    const [code] = await createInvites(db, null, 1);
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', displayName: 'ALICE', password: 'password1', inviteCode: code }),
    });
    const { token } = (await reg.json()) as { token: string };
    const get = (p: string) => fetch(base + p, { headers: { Authorization: `Bearer ${token}` } });
    expect((await get('/api/me/stats?range=1y')).status).toBe(400);
    expect((await get('/api/me/stats')).status).toBe(200);
    expect((await get('/api/me/stats?range=7d')).status).toBe(200);
    expect((await get('/api/me/trend?days=0')).status).toBe(400);
    expect((await get('/api/me/trend?days=366')).status).toBe(400);
    expect((await get('/api/me/trend?days=1.5')).status).toBe(400);
    const ok = await get('/api/me/trend');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
  });
});
