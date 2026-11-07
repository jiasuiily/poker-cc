import { describe, expect, it } from 'vitest';
import type { PlayerAction } from '@poker/core';
import { classifyLeak, summarizeDecisions, type DecisionInput, type DecisionReport } from '../src/index.js';

const fold: PlayerAction = { kind: 'fold' };
const check: PlayerAction = { kind: 'check' };
const call: PlayerAction = { kind: 'call' };
const raise = (to: number): PlayerAction => ({ kind: 'raise', to });

let seq = 0;
function dec(
  street: DecisionReport['street'],
  hero: PlayerAction,
  rec: PlayerAction,
  verdict: DecisionReport['verdict'],
  loss: number,
): DecisionReport {
  return { street, actionSeq: ++seq, heroAction: hero, recommended: rec, options: [], evLossBb: loss, verdict, reasons: [`r${seq}`], method: 'ev' };
}

describe('classifyLeak', () => {
  it('returns null for good decisions', () => {
    expect(classifyLeak(dec('flop', fold, call, 'good', 0))).toBeNull();
  });
  it('classifies preflop', () => {
    expect(classifyLeak(dec('preflop', call, fold, 'mistake', 3))).toBe('preflopLoose');
    expect(classifyLeak(dec('preflop', raise(30), fold, 'mistake', 3))).toBe('preflopLoose');
    expect(classifyLeak(dec('preflop', fold, call, 'mistake', 3))).toBe('preflopTight');
    expect(classifyLeak(dec('preflop', fold, raise(60), 'mistake', 3))).toBe('preflopTight');
  });
  it('classifies postflop', () => {
    expect(classifyLeak(dec('flop', call, fold, 'mistake', 3))).toBe('callTooWide');
    expect(classifyLeak(dec('turn', fold, raise(50), 'mistake', 3))).toBe('foldTooMuch');
    expect(classifyLeak(dec('flop', check, raise(50), 'mistake', 3))).toBe('passive');
    expect(classifyLeak(dec('river', call, raise(50), 'mistake', 3))).toBe('passive');
    expect(classifyLeak(dec('flop', raise(50), check, 'mistake', 3))).toBe('aggressive');
    expect(classifyLeak(dec('flop', raise(60), raise(30), 'ok', 1))).toBe('sizing');
  });
});

describe('summarizeDecisions', () => {
  const hands: DecisionInput[] = [
    { handId: 'a', endedAt: '2026-01-01T00:00:00Z', bigBlind: 20, decisions: [
      dec('preflop', call, fold, 'mistake', 4),
      dec('flop', check, raise(50), 'ok', 1),
      dec('flop', call, call, 'good', 0),
    ] },
    { handId: 'b', endedAt: '2026-01-02T00:00:00Z', bigBlind: 20, decisions: [] },
    { handId: 'c', endedAt: '2026-01-03T00:00:00Z', bigBlind: 20, decisions: [
      dec('flop', call, fold, 'mistake', 3),
      dec('river', raise(10), check, 'ok', 1.5),
    ] },
  ];
  it('aggregates', () => {
    const s = summarizeDecisions(hands);
    expect(s.hands).toBe(3);
    expect(s.decisions).toBe(5);
    expect([s.good, s.ok, s.mistake]).toEqual([1, 2, 2]);
    expect(s.evLossPerHand).toBeCloseTo(9.5 / 3);
    expect(s.byStreet.flop).toEqual({ decisions: 3, mistakes: 1 });
    expect(s.byStreet.preflop).toEqual({ decisions: 1, mistakes: 1 });
    expect(s.leaks.map((l) => l.kind)).toEqual(['preflopLoose', 'callTooWide', 'aggressive', 'passive']);
    expect(s.leaks.every((l) => l.count > 0)).toBe(true);
    expect(s.examples).toHaveLength(4);
    expect(s.examples.every((e) => e.recommended && e.reasons.length === 1)).toBe(true);
    expect(s.examples[0]).toMatchObject({ handId: 'a', street: 'preflop', evLossBb: 4 });
  });
  it('caps examples at 5', () => {
    const many: DecisionInput = { handId: 'm', endedAt: 'x', bigBlind: 20, decisions: Array.from({ length: 8 }, (_, i) => dec('flop', call, fold, 'mistake', i + 1)) };
    expect(summarizeDecisions([many]).examples.map((e) => e.evLossBb)).toEqual([8, 7, 6, 5, 4]);
  });
  it('handles empty input', () => {
    const s = summarizeDecisions([]);
    expect(s).toMatchObject({ hands: 0, decisions: 0, good: 0, ok: 0, mistake: 0, evLossPerHand: 0, leaks: [], examples: [] });
    expect(s.byStreet.river).toEqual({ decisions: 0, mistakes: 0 });
  });
});
