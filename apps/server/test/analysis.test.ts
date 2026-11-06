import { describe, expect, it } from 'vitest';
import { cardToString } from '@poker/core';
import { createDb } from '../src/db/client.js';
import { saveHand } from '../src/history/repo.js';
import { getHandForPlayer } from '../src/history/repo.js';
import { getAnalysis, requestAnalysis } from '../src/analysis/service.js';
import { buildPrompt } from '../src/analysis/prompt.js';
import type { LlmClient } from '../src/llm.js';
import { C, F, X, play, startTable } from '../../../packages/strategy/test/helpers.js';

function hand(handNo: number, variant: 'showdown' | 'fold') {
  const g = startTable(3, 0, undefined, undefined, handNo);
  if (variant === 'fold') play(g, F, F);
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

function fakeLlm(behaviour: 'ok' | 'fail' = 'ok') {
  const calls: { system: string; user: string }[] = [];
  const llm: LlmClient = {
    async explain(system, user) {
      calls.push({ system, user });
      if (behaviour === 'fail') throw new Error('boom');
      return '这手牌的翻前决策合理。';
    },
  };
  return { llm, calls };
}

async function setup() {
  const db = await createDb({ memory: true });
  await saveHand(db, hand(1, 'showdown'));
  await saveHand(db, hand(2, 'showdown'));
  await saveHand(db, hand(3, 'fold'));
  return db;
}

describe('analysis service', () => {
  it('computes local analysis now, adds LLM text in the background, and caches', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const r = await requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 30 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.analysis.decisions.length).toBeGreaterThan(0);
    expect(r.analysis.llmStatus).toBe('pending');
    await r.job;
    expect(await getAnalysis(db, 't1-1', 'p0')).toMatchObject({ llmStatus: 'ok', llmText: '这手牌的翻前决策合理。' });
    const again = await requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 30 });
    if (again.status !== 'ok') throw new Error(again.status);
    expect(again.analysis.llmStatus).toBe('ok');
    expect(calls).toHaveLength(1);
  });

  it('is disabled without an LLM and keeps the local analysis', async () => {
    const db = await setup();
    const r = await requestAnalysis(db, null, 't1-1', 'p0', { dailyLimit: 30 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.analysis.llmStatus).toBe('disabled');
    expect(r.analysis.decisions.length).toBeGreaterThan(0);
  });

  it('enforces the daily limit', async () => {
    const db = await setup();
    const { llm, calls } = fakeLlm();
    const a = await requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 1 });
    const b = await requestAnalysis(db, llm, 't1-2', 'p0', { dailyLimit: 1 });
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('status');
    await a.job;
    expect(b.analysis.llmStatus).toBe('limited');
    expect(calls).toHaveLength(1);
  });

  it('marks LLM failures as failed and keeps the decisions', async () => {
    const db = await setup();
    const { llm } = fakeLlm('fail');
    const r = await requestAnalysis(db, llm, 't1-1', 'p0', { dailyLimit: 30 });
    if (r.status !== 'ok') throw new Error(r.status);
    await r.job;
    const got = await getAnalysis(db, 't1-1', 'p0');
    expect(got!.llmStatus).toBe('failed');
    expect(got!.decisions.length).toBe(r.analysis.decisions.length);
  });

  it('returns an empty decision list when the hero had nothing to decide', async () => {
    const db = await setup();
    // hand 3: button and SB fold; BB (p2) never acts
    const r = await requestAnalysis(db, null, 't1-3', 'p2', { dailyLimit: 30 });
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.analysis.decisions).toEqual([]);
  });

  it('refuses non-participants', async () => {
    const db = await setup();
    expect((await requestAnalysis(db, null, 't1-1', 'stranger', { dailyLimit: 30 })).status).toBe('forbidden');
    expect((await requestAnalysis(db, null, 'missing', 'p0', { dailyLimit: 30 })).status).toBe('not_found');
  });

  it('the prompt never contains unshown opponent hole cards', async () => {
    const db = await setup();
    const rec = hand(3, 'fold');
    const replay = await getHandForPlayer(db, 't1-3', 'p0');
    if (replay.status !== 'ok') throw new Error(replay.status);
    const { system, user } = buildPrompt(replay.hand, replay.frames, []);
    expect(system).toContain('不要编造');
    for (const p of rec.state.players.filter((x) => x.seat !== 0)) {
      for (const c of p.hole) expect(user).not.toContain(cardToString(c));
    }
    expect(user).toContain(cardToString(rec.state.players.find((x) => x.seat === 0)!.hole[0]));
  });
});
