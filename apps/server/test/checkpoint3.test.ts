import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { handAnalyses, llmUsage } from '../src/db/schema.js';
import { saveHand } from '../src/history/repo.js';
import { getAnalysis, requestAnalysis } from '../src/analysis/service.js';
import { issueToken, verifyToken } from '../src/auth.js';
import type { LlmClient } from '../src/llm.js';
import { C, X, play, startTable } from '../../../packages/strategy/test/helpers.js';

async function setup() {
  const db = await createDb({ memory: true });
  const g = play(startTable(3, 0, undefined, undefined, 1), C, C, X, X, X, X, X, X, X, X, X, X);
  (g.events[0] as { handId: string }).handId = 't1-1';
  await saveHand(db, {
    tableId: 't1', tableName: 'x', maxSeats: 6, handNo: 1, events: g.events, state: { ...g.state, handId: 't1-1' },
    seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, name: `n${seat}`, isBot: false, startStack: 1000 })),
    startedAt: 1, endedAt: 2,
  });
  return db;
}

function counting(fail = false) {
  let calls = 0;
  const llm: LlmClient = {
    async explain() {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      if (fail) throw new Error('down');
      return '解说';
    },
  };
  return { llm, calls: () => calls };
}

const usage = async (db: Awaited<ReturnType<typeof setup>>) =>
  (await db.select({ n: sql<number>`coalesce(sum(${llmUsage.count}), 0)::int` }).from(llmUsage))[0]!.n;

describe('checkpoint review 3 fixes', () => {
  it('two simultaneous requests call the LLM once and use one quota', async () => {
    const db = await setup();
    const { llm, calls } = counting();
    const [a, b] = await Promise.all([
      requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 30 }),
      requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 30 }),
    ]);
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('status');
    await Promise.all([a.job, b.job]);
    expect(calls()).toBe(1);
    expect(await usage(db)).toBe(1);
    expect((await getAnalysis(db, 't1-1', 'p0'))!.llmStatus).toBe('ok');
  });

  it('a failed explanation is retried on the next request', async () => {
    const db = await setup();
    const first = await requestAnalysis(db, counting(true).llm, 't1-1', 'p0', { dailyLimit: 30 });
    if (first.status !== 'ok') throw new Error('status');
    await first.job;
    expect((await getAnalysis(db, 't1-1', 'p0'))!.llmStatus).toBe('failed');
    const ok = counting();
    const again = await requestAnalysis(db, ok.llm, 't1-1', 'p0', { dailyLimit: 30 });
    if (again.status !== 'ok') throw new Error('status');
    expect(again.analysis.llmStatus).toBe('pending');
    await again.job;
    expect(ok.calls()).toBe(1);
    expect((await getAnalysis(db, 't1-1', 'p0'))!.llmStatus).toBe('ok');
  });

  it('a limited explanation is retried once quota allows', async () => {
    const db = await setup();
    const { llm, calls } = counting();
    const r = await requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 0 });
    if (r.status !== 'ok') throw new Error('status');
    expect(r.analysis.llmStatus).toBe('limited');
    const r2 = await requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 30 });
    if (r2.status !== 'ok') throw new Error('status');
    await r2.job;
    expect(calls()).toBe(1);
    expect((await getAnalysis(db, 't1-1', 'p0'))!.llmStatus).toBe('ok');
  });

  it('a stale pending explanation (e.g. after a restart) is restarted', async () => {
    const db = await setup();
    const r = await requestAnalysis(db, null, 't1-1', 'p0', { dailyLimit: 30 });
    if (r.status !== 'ok') throw new Error('status');
    await db
      .update(handAnalyses)
      .set({ llmStatus: 'pending', createdAt: new Date(Date.now() - 5 * 60_000) })
      .where(and(eq(handAnalyses.handId, 't1-1'), eq(handAnalyses.playerId, 'p0')));
    const { llm, calls } = counting();
    const r2 = await requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 30 });
    if (r2.status !== 'ok') throw new Error('status');
    await r2.job;
    expect(calls()).toBe(1);
    expect((await getAnalysis(db, 't1-1', 'p0'))!.llmStatus).toBe('ok');
  });

  it('rejects tokens from the old anonymous login', async () => {
    const old = await issueToken({ playerId: 'anon-1234', name: 'Bob' });
    await expect(verifyToken(old)).rejects.toThrow();
    const cur = await issueToken({ playerId: 'p_1234', name: 'Bob' });
    expect((await verifyToken(cur)).playerId).toBe('p_1234');
  });
});
