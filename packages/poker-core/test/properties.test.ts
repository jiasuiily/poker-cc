import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  buildReplayFrames,
  legalActions,
  projectView,
  reduce,
  seededRandomInt,
  shuffleDeck,
  startHand,
  applyAction,
  type HandEvent,
  type HandState,
  type PlayerAction,
} from '../src/index.js';

/** Play one random hand with random legal actions. Checks invariants after each step. */
function playRandomHand(seed: number, stacks: number[], button: number, bb: number): { state: HandState; events: HandEvent[] } {
  const rnd = seededRandomInt(seed);
  const start: HandEvent = {
    type: 'HandStarted',
    handId: `h${seed}`,
    config: { smallBlind: Math.max(1, Math.floor(bb / 2)), bigBlind: bb },
    seats: stacks.map((stack, i) => ({ seat: i * 1 + (i >= 3 ? 1 : 0), playerId: `p${i}`, stack })), // includes a gap at seat 3
    button,
    deck: shuffleDeck(rnd),
  };
  const events: HandEvent[] = [start];
  let s = startHand(start);
  const total = stacks.reduce((a, b) => a + b, 0);
  check(s, total);
  let guard = 0;
  while (s.street !== 'complete') {
    if (++guard > 500) throw new Error('hand did not terminate');
    const la = legalActions(s);
    if (!la) throw new Error('non-terminal state without legal actions');
    const options: PlayerAction[] = [];
    if (la.canFold) options.push({ kind: 'fold' });
    if (la.canCheck) options.push({ kind: 'check' });
    if (la.canCall) options.push({ kind: 'call' }, { kind: 'call' });
    if (la.raise) {
      const { min, max } = la.raise;
      options.push({ kind: 'raise', to: min }, { kind: 'raise', to: max }, { kind: 'raise', to: min + rnd(max - min + 1) });
    }
    if (options.length === 0) throw new Error('empty legal action set');
    const action = options[rnd(options.length)]!;
    const ev: HandEvent = { type: 'Action', seat: la.seat, seq: s.actionSeq, action };
    s = applyAction(s, la.seat, action);
    events.push(ev);
    check(s, total);
  }
  return { state: s, events };
}

function check(s: HandState, total: number) {
  let sum = 0;
  for (const p of s.players) {
    if (p.stack < 0 || p.committed < 0 || p.totalCommitted < 0) throw new Error('negative chips');
    sum += p.stack + p.totalCommitted;
  }
  if (sum !== total) throw new Error(`chips not conserved: ${sum} != ${total}`);
  if (s.result) {
    const fin = s.result.finalStacks.reduce((a, f) => a + f.stack, 0);
    if (fin !== total) throw new Error(`settlement not conserved: ${fin} != ${total}`);
    if (s.result.finalStacks.some((f) => f.stack < 0)) throw new Error('negative final stack');
    const potSum = s.result.pots.reduce((a, p) => a + p.amount, 0);
    const winSum = s.result.pots.reduce((a, p) => a + p.winners.reduce((x, w) => x + w.amount, 0), 0);
    if (potSum !== winSum) throw new Error('pot not fully awarded');
  }
  // Views: nobody sees someone else's unshown cards.
  const shown = new Set(s.result?.shown.map((h) => h.seat) ?? []);
  for (const viewer of [null, ...s.players.map((p) => p.seat)]) {
    const v = projectView(s, viewer);
    for (const seat of v.seats) {
      if (seat.hole && seat.seat !== viewer && !shown.has(seat.seat)) throw new Error('hole card leak');
    }
    if (v.legal && viewer !== s.toAct) throw new Error('legal actions leaked to wrong seat');
  }
}

const arbHand = fc.record({
  seed: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
  stacks: fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 2, maxLength: 9 }),
  button: fc.integer({ min: 0, max: 9 }),
  bb: fc.integer({ min: 2, max: 40 }),
});

describe('property: random hands', () => {
  it('conserve chips, never go negative, always offer a legal action, never leak cards', () => {
    fc.assert(
      fc.property(arbHand, ({ seed, stacks, button, bb }) => {
        playRandomHand(seed, stacks, button, bb);
      }),
      { numRuns: 2000 },
    );
  });

  it('replaying the event log reproduces the final state', () => {
    fc.assert(
      fc.property(arbHand, ({ seed, stacks, button, bb }) => {
        const { state, events } = playRandomHand(seed, stacks, button, bb);
        const replayed = reduce(events);
        if (JSON.stringify(replayed) !== JSON.stringify(state)) throw new Error('replay mismatch');
      }),
      { numRuns: 1000 },
    );
  });

  it('replay frames never leak unshown hole cards', () => {
    fc.assert(
      fc.property(arbHand, ({ seed, stacks, button, bb }) => {
        const { state, events } = playRandomHand(seed, stacks, button, bb);
        const shown = new Set(state.result!.shown.map((h) => h.seat));
        for (const viewer of [null, ...state.players.map((p) => p.seat)]) {
          const frames = buildReplayFrames(events, viewer);
          // Shown cards may appear from the hand-ending action onwards; unshown cards never.
          const endIdx = frames.map((f) => f.kind).lastIndexOf('action');
          frames.forEach((f, i) => {
            for (const s of f.view.seats) {
              if (s.hole === null || s.seat === viewer) continue;
              if (i < endIdx || !shown.has(s.seat)) throw new Error(`leak: seat ${s.seat} visible to ${viewer} in frame ${i}`);
            }
          });
        }
      }),
      { numRuns: 500 },
    );
  });
});
