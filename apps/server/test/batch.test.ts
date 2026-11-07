import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { saveHand } from '../src/history/repo.js';
import { requestAnalysis } from '../src/analysis/service.js';
import { BatchRunner } from '../src/analysis/batch.js';
import type { LlmClient } from '../src/llm.js';
import { play, startTable, C, F, X } from '../../../packages/strategy/test/helpers.js';

function hand(handNo: number) {
  const g = startTable(3, 0, undefined, undefined, handNo);
  if (handNo % 2) play(g, F, F);
  else play(g, C, C, X, X, X, X, X, X, X, X, X, X);
  const handId = `t1-${handNo}`;
  (g.events[0] as { handId: string }).handId = handId;
  return {
    tableId: 't1',
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

function fakeLlm() {
  const calls: string[] = [];
  const llm: LlmClient = {
    async explain(_s, user) {
      calls.push(user);
      await new Promise((r) => setTimeout(r, 5));
      return '解说';
    },
  };
  return { llm, calls };
}

async function setup(n = 4) {
  const db = await createDb({ memory: true });
  for (let i = 1; i <= n; i++) await saveHand(db, hand(i));
  return db;
}

const runner = (db: Awaited<ReturnType<typeof setup>>, llm: LlmClient | null, dailyLimit = 200) =>
  new BatchRunner({ db: async () => db, llm, dailyLimit });

describe('BatchRunner', () => {
  it('analyses and explains every hand once', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const r = runner(db, llm);
    const first = await r.start('p0');
    expect(first.running).toBe(true);
    await r.idle('p0');
    expect(await r.progress('p0')).toMatchObject({ running: false, hands: 4, localDone: 4, llmDone: 4, llmQueued: 0, llmSkipped: 0, reason: null });
    expect(calls).toHaveLength(4);
    await r.start('p0');
    await r.idle('p0');
    expect(calls).toHaveLength(4);
  });

  it('stops at the daily limit and reports skipped hands', async () => {
    const db = await setup();
    const { llm } = fakeLlm();
    const r = runner(db, llm, 2);
    await r.start('p0');
    await r.idle('p0');
    expect(await r.progress('p0')).toMatchObject({ running: false, localDone: 4, llmDone: 2, llmSkipped: 2, reason: 'limit' });
  });

  it('still does local analysis without an LLM', async () => {
    const db = await setup();
    const r = runner(db, null);
    await r.start('p0');
    await r.idle('p0');
    expect(await r.progress('p0')).toMatchObject({ localDone: 4, llmDone: 0, llmSkipped: 4, reason: 'disabled', running: false });
  });

  it('runs one job per player', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const r = runner(db, llm);
    const [a, b] = await Promise.all([r.start('p0'), r.start('p0')]);
    expect(a.running && b.running).toBe(true);
    await r.idle('p0');
    expect(calls).toHaveLength(4);
  });

  it('does not double-call a hand requested at the same time', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const r = runner(db, llm);
    await r.start('p0');
    const res = await requestAnalysis(db, llm, 't1-4', 'p0', { dailyLimit: 30 });
    if (res.status === 'ok') await res.job;
    await r.idle('p0');
    expect(calls).toHaveLength(4);
    expect(await r.progress('p0')).toMatchObject({ llmDone: 4 });
  });

  it('resumes where an earlier runner stopped', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const r1 = runner(db, llm, 2);
    await r1.start('p0');
    await r1.idle('p0');
    expect(calls).toHaveLength(2);
    const r2 = runner(db, llm, 200);
    await r2.start('p0');
    await r2.idle('p0');
    expect(calls).toHaveLength(4);
  });

  it('reports zero hands for a player with none', async () => {
    const db = await setup();
    const r = runner(db, null);
    expect(await r.progress('nobody')).toMatchObject({ running: false, hands: 0, localDone: 0, llmDone: 0 });
    await r.start('nobody');
    await r.idle('nobody');
    expect(await r.progress('nobody')).toMatchObject({ running: false, hands: 0 });
  });
});
