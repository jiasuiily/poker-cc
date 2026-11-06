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
import { BOT_STYLES, type BotStyle } from './styles.js';
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

const cap = (p: number) => Math.min(0.95, p);

/**
 * Beginner bot: hand-strength table + simple rules + noise, scaled by a style.
 * Keeps typical beginner leaks: calls too often, ignores position and board texture.
 *   looseness  divides the preflop entry thresholds and scales loose calls
 *   aggression scales raise/bet probabilities
 *   bluff      scales bluff probability
 *   stickiness scales calling probabilities facing bets
 *   sizing     scales bet sizes
 */
export function makeBeginnerBot(st: BotStyle): Bot {
  const { looseness: L, aggression: A, bluff: B, stickiness: S, sizing: Z } = st;
  return {
    level: 'beginner',
    style: st.id,
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
        if (s >= 0.6 / L) {
          if (r < cap(0.7 * A)) return raiseTo(view, view.currentBet * 3 * Z) ?? call;
          return call;
        }
        if (s >= 0.4 / L) {
          if (la.toCall <= view.bigBlind * 4) return r < cap(0.15 * A) ? raiseTo(view, view.currentBet * 2.5 * Z) ?? call : call;
          return r < cap(0.4 * S) ? call : passive;
        }
        // Weak: beginner leak — limps/calls small bets too often.
        if (la.canCheck) return { kind: 'check' };
        if (la.toCall <= view.bigBlind && r < cap(0.45 * L)) return call;
        if (r < cap(0.08 * L)) return call;
        return passive;
      }

      const cat = categoryOf(evaluate([...hole, ...view.board]));
      if (cat >= Category.TwoPair) {
        if (r < cap(0.65 * A)) return raiseTo(view, view.currentBet + potAfterCall * (0.5 + rng() * 0.5) * Z) ?? call;
        return call;
      }
      if (cat === Category.Pair) {
        if (la.canCheck) return r < cap(0.3 * A) ? raiseTo(view, potAfterCall * 0.5 * Z) ?? passive : passive;
        if (la.toCall <= potAfterCall * 0.5 * S || r < cap(0.35 * S)) return call;
        return passive;
      }
      // Nothing: occasional bluff, occasional hopeless call.
      if (la.canCheck) return r < cap(0.08 * B) ? raiseTo(view, potAfterCall * 0.6 * Z) ?? passive : passive;
      if (la.toCall <= view.bigBlind * 2 && r < cap(0.3 * S)) return call;
      return passive;
    },
  };
}

/** Backwards-compatible default (TAG). */
export const beginnerBot: Bot = makeBeginnerBot(BOT_STYLES.tag);
