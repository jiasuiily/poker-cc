import {
  Category,
  categoryOf,
  evaluate,
  rankOf,
  suitOf,
  type Card,
  type PlayerAction,
  type PlayerView,
} from '@poker/core';
import type { Bot, Rng } from './types.js';

/**
 * Chen-formula style preflop score, normalised to roughly 0..1.
 * AA ≈ 1, 72o ≈ 0.
 */
export function preflopStrength(hole: [Card, Card]): number {
  const [a, b] = hole;
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  const value = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let score = value(hi);
  if (hi === lo) score = Math.max(5, score * 2);
  if (suitOf(a) === suitOf(b)) score += 2;
  const gap = hi - lo - 1;
  if (hi !== lo) {
    score -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 10) score += 1;
  }
  return Math.max(0, Math.min(1, (score + 1) / 21));
}

function raiseTo(view: PlayerView, target: number): PlayerAction | null {
  const r = view.legal?.raise;
  if (!r) return null;
  return { kind: 'raise', to: Math.max(r.min, Math.min(r.max, Math.round(target))) };
}

/**
 * Beginner bot: hand-strength table + simple rules + noise.
 * Keeps typical beginner leaks: calls too often, ignores position and board texture.
 */
export const beginnerBot: Bot = {
  level: 'beginner',
  decide(view: PlayerView, rng: Rng): PlayerAction {
    const la = view.legal;
    if (!la) throw new Error('decide() called when it is not our turn');
    const me = view.seats.find((s) => s.seat === view.viewerSeat)!;
    const hole = me.hole!;
    const passive: PlayerAction = la.canCheck ? { kind: 'check' } : { kind: 'fold' };
    const call: PlayerAction = la.canCall ? { kind: 'call' } : { kind: 'check' };
    const potAfterCall = view.pot + la.toCall;
    const r = rng();

    if (view.street === 'preflop') {
      const s = preflopStrength(hole);
      if (s >= 0.6) {
        if (r < 0.7) return raiseTo(view, view.currentBet * 3) ?? call;
        return call;
      }
      if (s >= 0.4) {
        if (la.toCall <= view.bigBlind * 4) return r < 0.15 ? raiseTo(view, view.currentBet * 2.5) ?? call : call;
        return r < 0.4 ? call : passive;
      }
      // Weak: beginner leak — limps/calls small bets too often.
      if (la.canCheck) return { kind: 'check' };
      if (la.toCall <= view.bigBlind && r < 0.45) return call;
      if (r < 0.08) return call;
      return passive;
    }

    const cat = categoryOf(evaluate([...hole, ...view.board]));
    if (cat >= Category.TwoPair) {
      if (r < 0.65) return raiseTo(view, view.currentBet + potAfterCall * (0.5 + rng() * 0.5)) ?? call;
      return call;
    }
    if (cat === Category.Pair) {
      if (la.canCheck) return r < 0.3 ? raiseTo(view, potAfterCall * 0.5) ?? passive : passive;
      if (la.toCall <= potAfterCall * 0.5 || r < 0.35) return call;
      return passive;
    }
    // Nothing: occasional bluff, occasional hopeless call.
    if (la.canCheck) return r < 0.08 ? raiseTo(view, potAfterCall * 0.6) ?? passive : passive;
    if (la.toCall <= view.bigBlind * 2 && r < 0.3) return call;
    return passive;
  },
};
