import type { PlayerAction } from '@poker/core';
import type { DecisionReport } from './evaluate.js';

export type LeakKind = 'preflopLoose' | 'preflopTight' | 'callTooWide' | 'foldTooMuch' | 'passive' | 'aggressive' | 'sizing';

export const LEAK_NAMES: Record<LeakKind, string> = {
  preflopLoose: '翻前入池过松',
  preflopTight: '翻前过紧',
  callTooWide: '跟注过宽',
  foldTooMuch: '弃牌过多',
  passive: '过于被动',
  aggressive: '过度激进',
  sizing: '下注尺度',
};

export type DecisionStreet = 'preflop' | 'flop' | 'turn' | 'river';

export interface DecisionInput {
  handId: string;
  endedAt: string;
  bigBlind: number;
  decisions: DecisionReport[];
}

export interface StatsExample {
  handId: string;
  street: DecisionStreet;
  actionSeq: number;
  heroAction: PlayerAction;
  recommended: PlayerAction;
  evLossBb: number;
  reasons: string[];
}

export interface PlayerStats {
  hands: number;
  decisions: number;
  good: number;
  ok: number;
  mistake: number;
  evLossPerHand: number;
  byStreet: Record<DecisionStreet, { decisions: number; mistakes: number }>;
  /** Only kinds with count > 0, sorted by evLossBb descending. */
  leaks: { kind: LeakKind; count: number; evLossBb: number }[];
  /** Non-good decisions, top 5 by evLossBb descending. */
  examples: StatsExample[];
}

const MAX_EXAMPLES = 5;

export function classifyLeak(d: DecisionReport): LeakKind | null {
  if (d.verdict === 'good') return null;
  const h = d.heroAction;
  const r = d.recommended;
  if (d.street === 'preflop') {
    if ((h.kind === 'call' || h.kind === 'raise') && r.kind === 'fold') return 'preflopLoose';
    if (h.kind === 'fold' && r.kind === 'call') return 'preflopTight';
  }
  if (h.kind === 'raise' && r.kind === 'raise' && h.to !== r.to) return 'sizing';
  if (h.kind === 'raise') return 'aggressive';
  if (r.kind === 'raise' && (h.kind === 'check' || h.kind === 'call')) return 'passive';
  if (d.street !== 'preflop' && h.kind === 'call' && r.kind === 'fold') return 'callTooWide';
  if (h.kind === 'fold' && r.kind !== 'fold') return 'foldTooMuch';
  return null;
}

const STREETS: DecisionStreet[] = ['preflop', 'flop', 'turn', 'river'];

export function summarizeDecisions(hands: DecisionInput[]): PlayerStats {
  const byStreet = Object.fromEntries(STREETS.map((s) => [s, { decisions: 0, mistakes: 0 }])) as PlayerStats['byStreet'];
  const leakMap = new Map<LeakKind, { count: number; evLossBb: number }>();
  const examples: StatsExample[] = [];
  let decisions = 0, good = 0, ok = 0, mistake = 0, totalLoss = 0;

  for (const h of hands) {
    for (const d of h.decisions) {
      decisions++;
      totalLoss += d.evLossBb;
      if (d.verdict === 'good') good++;
      else if (d.verdict === 'ok') ok++;
      else mistake++;
      const st = byStreet[d.street as DecisionStreet];
      if (st) {
        st.decisions++;
        if (d.verdict === 'mistake') st.mistakes++;
      }
      const kind = classifyLeak(d);
      if (kind) {
        const e = leakMap.get(kind) ?? { count: 0, evLossBb: 0 };
        e.count++;
        e.evLossBb += d.evLossBb;
        leakMap.set(kind, e);
      }
      if (d.verdict !== 'good') {
        examples.push({
          handId: h.handId,
          street: d.street as DecisionStreet,
          actionSeq: d.actionSeq,
          heroAction: d.heroAction,
          recommended: d.recommended,
          evLossBb: d.evLossBb,
          reasons: [...d.reasons],
        });
      }
    }
  }

  return {
    hands: hands.length,
    decisions,
    good,
    ok,
    mistake,
    evLossPerHand: hands.length ? totalLoss / hands.length : 0,
    byStreet,
    leaks: [...leakMap].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.evLossBb - a.evLossBb),
    examples: examples.sort((a, b) => b.evLossBb - a.evLossBb).slice(0, MAX_EXAMPLES),
  };
}
