import {
  applyAction,
  projectView,
  shuffleDeck,
  startHand,
  type HandEvent,
  type HandState,
  type RandomInt,
} from '@poker/core';
import type { Bot } from './types.js';

export interface SimOptions {
  bots: Bot[];
  hands: number;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  randomInt: RandomInt;
  rng: () => number;
  /** Called after every completed hand. */
  onHand?: (state: HandState, events: HandEvent[]) => void;
}

export interface SimResult {
  hands: number;
  /** Net chips won per bot index. */
  net: number[];
  /** big blinds won per 100 hands per bot index. */
  bbPer100: number[];
  /** Net chips per seat per hand: perHandNet[seat][hand]. */
  perHandNet: number[][];
}

/**
 * Zero-delay batch simulation. Every hand starts with equal stacks (startingStack) so that
 * bb/100 measures strategy, not accumulated stack depth. Used for AI acceptance and soak tests.
 */
export function simulate(o: SimOptions): SimResult {
  const n = o.bots.length;
  const net = new Array(n).fill(0) as number[];
  const perHandNet: number[][] = Array.from({ length: n }, () => []);
  let button = 0;
  for (let h = 0; h < o.hands; h++) {
    const start: HandEvent = {
      type: 'HandStarted',
      handId: `sim-${h}`,
      config: { smallBlind: o.smallBlind, bigBlind: o.bigBlind },
      seats: o.bots.map((_, seat) => ({ seat, playerId: `bot${seat}`, stack: o.startingStack })),
      button,
      deck: shuffleDeck(o.randomInt),
    };
    const events: HandEvent[] = [start];
    let s = startHand(start);
    while (s.street !== 'complete') {
      const seat = s.toAct!;
      const view = projectView(s, seat);
      const action = o.bots[seat]!.decide(view, o.rng);
      events.push({ type: 'Action', seat, seq: s.actionSeq, action });
      s = applyAction(s, seat, action);
    }
    for (const f of s.result!.finalStacks) {
      net[f.seat]! += f.stack - o.startingStack;
      perHandNet[f.seat]!.push(f.stack - o.startingStack);
    }
    o.onHand?.(s, events);
    button = (button + 1) % n;
  }
  return { hands: o.hands, net, bbPer100: net.map((x) => (x / o.bigBlind / o.hands) * 100), perHandNet };
}
