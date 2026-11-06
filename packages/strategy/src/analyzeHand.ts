import { applyAction, projectView, seededRandomInt, startHand, type HandEvent } from '@poker/core';
import { evaluateDecision, type DecisionReport } from './evaluate.js';

/**
 * Replay a hand and evaluate every decision the hero made. Each decision uses its own
 * seeded RNG (seed + actionSeq), so results are reproducible.
 */
export function analyzeHand(events: readonly HandEvent[], heroSeat: number, opts: { iterations?: number; seed?: number } = {}): DecisionReport[] {
  const [first, ...rest] = events;
  if (!first || first.type !== 'HandStarted') throw new Error('First event must be HandStarted');
  const seed = opts.seed ?? 1;
  let s = startHand(first);
  const out: DecisionReport[] = [];
  for (const ev of rest) {
    if (ev.type !== 'Action') continue;
    if (ev.seat === heroSeat) {
      const view = projectView(s, heroSeat);
      if (view.legal) {
        out.push(evaluateDecision(view, ev.action, { iterations: opts.iterations, randomInt: seededRandomInt(seed + s.actionSeq) }));
      }
    }
    s = applyAction(s, ev.seat, ev.action);
  }
  return out;
}
