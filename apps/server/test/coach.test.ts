import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { sql } from 'drizzle-orm';
import { cardToString } from '@poker/core';
import { summarizeDecisions } from '@poker/strategy';
import { createDb } from '../src/db/client.js';
import { coachReports } from '../src/db/schema.js';
import { saveHand } from '../src/history/repo.js';
import { ensureLocalAnalysis } from '../src/analysis/service.js';
import { usedToday } from '../src/analysis/quota.js';
import { buildCoachPrompt, describeExample } from '../src/coach/prompt.js';
import { createReport, listReports } from '../src/coach/service.js';
import { HttpError } from '../src/http.js';
import type { LlmClient } from '../src/llm.js';
import { C, F, X, play, startTable } from '../../../packages/strategy/test/helpers.js';

function hand(handNo: number) {
  const g = startTable(3, 0, undefined, undefined, handNo);
  play(g, C, C, X, X, X, X, X, X, X, X, X, X);
  const handId = `c1-${handNo}`;
  (g.events[0] as { handId: string }).handId = handId;
  return {
    tableId: 'c1',
    tableName: '测试桌',
    maxSeats: 6,
    handNo,
    events: g.events,
    state: { ...g.state, handId },
    seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, name: `玩家${seat}`, isBot: false, startStack: 1000 })),
    startedAt: 1000,
    endedAt: 2000 + handNo,
  };
}

async function setup(n = 12) {
  const db = await createDb({ memory: true });
  for (let i = 1; i <= n; i++) await saveHand(db, hand(i));
  return db;
}

function fakeLlm(delayMs = 0) {
  const calls: { system: string; user: string; max?: number }[] = [];
  const llm: LlmClient = {
    async explain(system, user, _signal, opts) {
      calls.push({ system, user, max: opts?.maxTokens });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return `评估${calls.length}`;
    },
  };
  return { llm, calls };
}

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

describe('createReport', () => {
  it('rejects with 400 when there are too few decisions, without calling the model', async () => {
    const db = await setup(2);
    const { llm, calls } = fakeLlm();
    expect(await status(() => createReport(db, llm, 'p0'))).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await listReports(db, 'p0')).toEqual([]);
  });

  it('503 without a model and inserts nothing (checked before computing)', async () => {
    const db = await setup();
    expect(await status(() => createReport(db, null, 'p0'))).toBe(503);
    expect(await listReports(db, 'p0')).toEqual([]);
    expect(await usedToday(db, 'p0', 'report')).toBe(0);
  });

  it('returns pending, then the job stores an ok report', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const { report, job } = await createReport(db, llm, 'p0');
    expect(report.status).toBe('pending');
    await job;
    const [r] = await listReports(db, 'p0');
    expect(r).toMatchObject({ status: 'ok', text: '评估1' });
    expect(r!.stats.decisions).toBeGreaterThanOrEqual(30);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.max).toBe(2000);
  });

  it('marks the report failed when the model errors', async () => {
    const db = await setup();
    const llm: LlmClient = { explain: async () => { throw new Error('boom'); } };
    const { job } = await createReport(db, llm, 'p0');
    await job;
    expect((await listReports(db, 'p0'))[0]).toMatchObject({ status: 'failed', text: null });
  });

  it('the second report is compared with the first', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const first = await createReport(db, llm, 'p0');
    await first.job;
    const second = await createReport(db, llm, 'p0');
    await second.job;
    const user = calls[1]!.user;
    expect(user).toContain('上次');
    expect(user).toContain('评估1');
    expect(user).toContain(`决策点 ${first.report.stats.decisions}`);
    expect(calls[0]!.user).not.toContain('上次评估');
    const list = await listReports(db, 'p0');
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(second.report.id);
  });

  it('the 4th report of the day is refused with 429 and leaves a failed row', async () => {
    const db = await setup();
    const { llm } = fakeLlm();
    for (let i = 0; i < 3; i++) await (await createReport(db, llm, 'p0')).job;
    expect(await status(() => createReport(db, llm, 'p0'))).toBe(429);
    const list = await listReports(db, 'p0');
    expect(list).toHaveLength(4);
    expect(list[0]!.status).toBe('failed');
  });

  it('a double click yields one success and one 409; the model is called once', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm(20);
    const results = await Promise.allSettled([createReport(db, llm, 'p0'), createReport(db, llm, 'p0')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(((bad[0] as PromiseRejectedResult).reason as HttpError).status).toBe(409);
    await (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createReport>>>).value.job;
    expect(calls).toHaveLength(1);
  });

  it('a pending row older than 120s is replaced; a 30s-old one blocks', async () => {
    for (const [ageSec, expected] of [[121, 200], [30, 409]] as const) {
      const db = await setup();
      await db.insert(coachReports).values({
        id: 'old',
        playerId: 'p0',
        status: 'pending',
        stats: summarizeDecisions([]),
        text: null,
        createdAt: sql`now() - make_interval(secs => ${ageSec})` as unknown as Date,
      });
      const { llm } = fakeLlm();
      const code = await status(async () => (await createReport(db, llm, 'p0')).job);
      expect(code).toBe(expected);
      if (expected === 200) expect((await listReports(db, 'p0')).find((r) => r.id === 'old')!.status).toBe('failed');
    }
  });

  it('hands analysed lazily: no prior analysis rows needed', async () => {
    const db = await setup();
    await ensureLocalAnalysis(db, 'c1-1', 'p0');
    const { llm } = fakeLlm();
    const { report, job } = await createReport(db, llm, 'p0');
    await job;
    expect(report.stats.hands).toBe(12);
  });
});

describe('coach prompt privacy', () => {
  it('never contains unshown opponent hole cards', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), fc.integer({ min: 1, max: 500 }), fc.nat(5), fc.nat(5), fc.constantFrom<'preflop' | 'flop' | 'turn' | 'river'>('preflop', 'flop', 'turn', 'river'), (n, seed, h, b, street) => {
        const hero = h % n;
        const g = startTable(n, b % n, undefined, undefined, seed);
        const calls = Array.from({ length: n }, (_, i) => (i < n - 1 ? C : X));
        play(g, ...calls);
        // Flop: first to act bets, everyone else folds -> no showdown, opponents' cards stay hidden.
        play(g, { kind: 'raise', to: 20 }, ...Array.from({ length: n - 1 }, () => F));
        expect(g.state.result?.shown ?? []).toEqual([]);
        const ex = { handId: 'x-1', street, actionSeq: 3, heroAction: C, recommended: F, evLossBb: 1.2, reasons: ['测试'] };
        const view = describeExample(g.events, hero, ex);
        const stats = summarizeDecisions([]);
        const { user } = buildCoachPrompt(stats, [view], { stats, text: '上次建议', createdAt: '2026-11-01' });
        const mine = g.state.players.find((p) => p.seat === hero)!;
        for (const p of g.state.players.filter((x) => x.seat !== hero)) {
          for (const c of p.hole) expect(user).not.toContain(cardToString(c));
        }
        for (const c of mine.hole) expect(user).toContain(cardToString(c));
      }),
      { numRuns: 60 },
    );
  });
});
