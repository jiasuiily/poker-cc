import type { Card } from './cards.js';
import { settle } from './pots.js';
import type {
  HandEvent,
  HandState,
  LegalActions,
  PlayerAction,
  PlayerState,
  SeatInit,
  HandConfig,
} from './types.js';

export class IllegalActionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'IllegalActionError';
  }
}

// ---------------------------------------------------------------------------
// Event sourcing entry points
// ---------------------------------------------------------------------------

export function reduce(events: readonly HandEvent[]): HandState {
  const [first, ...rest] = events;
  if (!first || first.type !== 'HandStarted') throw new Error('First event must be HandStarted');
  let s = startHand(first);
  for (const ev of rest) s = applyEvent(s, ev);
  return s;
}

export function applyEvent(state: HandState, ev: HandEvent): HandState {
  if (ev.type !== 'Action') throw new Error(`Unexpected event ${ev.type}`);
  if (ev.seq !== state.actionSeq) throw new IllegalActionError(`Stale action seq ${ev.seq}, expected ${state.actionSeq}`);
  return applyAction(state, ev.seat, ev.action);
}

export function startHand(ev: Extract<HandEvent, { type: 'HandStarted' }>): HandState {
  validateStart(ev.seats, ev.deck, ev.config);
  const seats = [...ev.seats].sort((a, b) => a.seat - b.seat);
  const n = seats.length;
  const players: PlayerState[] = seats.map((p) => ({
    seat: p.seat,
    playerId: p.playerId,
    startStack: p.stack,
    stack: p.stack,
    committed: 0,
    totalCommitted: 0,
    hole: [-1, -1] as [Card, Card],
    folded: false,
    allIn: false,
    acted: false,
    raiseLocked: false,
  }));

  let sbIdx: number;
  if (n === 2) {
    const b = players.findIndex((p) => p.seat === ev.button);
    sbIdx = b >= 0 ? b : idxAfterSeat(players, ev.button);
  } else {
    sbIdx = idxAfterSeat(players, ev.button);
  }
  const bbIdx = (sbIdx + 1) % n;

  // Deal two rounds starting from the small blind.
  for (let k = 0; k < n; k++) {
    const p = players[(sbIdx + k) % n]!;
    p.hole = [ev.deck[k]!, ev.deck[n + k]!];
  }

  const s: HandState = {
    handId: ev.handId,
    config: { ...ev.config },
    button: ev.button,
    sbSeat: players[sbIdx]!.seat,
    bbSeat: players[bbIdx]!.seat,
    players,
    deck: [...ev.deck],
    deckPos: 2 * n,
    board: [],
    street: 'preflop',
    currentBet: ev.config.bigBlind,
    minRaise: ev.config.bigBlind,
    lastAggressor: null,
    toAct: null,
    actionSeq: 0,
    runout: false,
    result: null,
  };

  commit(players[sbIdx]!, ev.config.smallBlind);
  commit(players[bbIdx]!, ev.config.bigBlind);

  const firstIdx = n === 2 ? sbIdx : (bbIdx + 1) % n;
  advance(s, firstIdx);
  return s;
}

function validateStart(seats: SeatInit[], deck: Card[], config: HandConfig) {
  if (seats.length < 2) throw new Error('Need at least 2 players');
  if (new Set(seats.map((s) => s.seat)).size !== seats.length) throw new Error('Duplicate seat');
  if (seats.some((s) => !Number.isInteger(s.stack) || s.stack <= 0)) throw new Error('Stacks must be positive integers');
  if (deck.length !== 52 || new Set(deck).size !== 52 || deck.some((c) => c < 0 || c > 51)) throw new Error('Bad deck');
  if (!(config.smallBlind > 0 && config.bigBlind >= config.smallBlind)) throw new Error('Bad blinds');
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

export function legalActions(state: HandState): LegalActions | null {
  if (state.toAct === null || state.street === 'complete') return null;
  const p = playerAt(state, state.toAct);
  const toCall = Math.min(state.currentBet - p.committed, p.stack);
  const othersCanAct = state.players.some((o) => o.seat !== p.seat && !o.folded && !o.allIn);
  let raise: LegalActions['raise'] = null;
  const maxTo = p.committed + p.stack;
  if (!p.raiseLocked && p.stack > toCall && othersCanAct && maxTo > state.currentBet) {
    const minTo = Math.min(state.currentBet + state.minRaise, maxTo);
    raise = { min: minTo, max: maxTo };
  }
  return {
    seat: p.seat,
    toCall,
    canFold: toCall > 0,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    raise,
  };
}

/** The action taken when a player's clock runs out: check if free, otherwise fold. */
export function timeoutAction(state: HandState): PlayerAction {
  const la = legalActions(state);
  return la?.canCheck ? { kind: 'check' } : { kind: 'fold' };
}

// ---------------------------------------------------------------------------
// Applying actions
// ---------------------------------------------------------------------------

export function applyAction(prev: HandState, seat: number, action: PlayerAction): HandState {
  const la = legalActions(prev);
  if (!la) throw new IllegalActionError('No action expected');
  if (la.seat !== seat) throw new IllegalActionError(`Not seat ${seat}'s turn (seat ${la.seat} to act)`);

  const s = structuredClone(prev);
  const p = playerAt(s, seat);
  switch (action.kind) {
    case 'fold':
      if (!la.canFold) throw new IllegalActionError('Cannot fold when check is available');
      p.folded = true;
      break;
    case 'check':
      if (!la.canCheck) throw new IllegalActionError('Cannot check facing a bet');
      break;
    case 'call':
      if (!la.canCall) throw new IllegalActionError('Nothing to call');
      commit(p, la.toCall);
      break;
    case 'raise': {
      const r = la.raise;
      const to = action.to;
      if (!r) throw new IllegalActionError('Raising not allowed');
      if (!Number.isInteger(to) || to < r.min || to > r.max) {
        throw new IllegalActionError(`Raise to ${to} outside [${r.min}, ${r.max}]`);
      }
      const increment = to - s.currentBet;
      commit(p, to - p.committed);
      if (increment >= s.minRaise) {
        s.minRaise = increment;
        for (const o of s.players) if (o !== p) o.raiseLocked = false;
      }
      s.currentBet = to;
      s.lastAggressor = seat;
      break;
    }
    default:
      throw new IllegalActionError('Unknown action');
  }
  p.acted = true;
  p.raiseLocked = true;
  s.actionSeq++;
  const idx = s.players.indexOf(p);
  advance(s, (idx + 1) % s.players.length);
  return s;
}

/**
 * After a state change: end the hand, close the street, or find the next actor
 * starting at index `fromIdx` (inclusive).
 */
function advance(s: HandState, fromIdx: number): void {
  const live = s.players.filter((p) => !p.folded);
  if (live.length === 1) {
    finish(s);
    return;
  }
  const next = findActor(s, fromIdx);
  if (next !== null) {
    s.toAct = s.players[next]!.seat;
    return;
  }
  // Street closed: deal on until somebody can act, or to showdown.
  for (;;) {
    if (s.street === 'river') {
      finish(s);
      return;
    }
    nextStreet(s);
    const able = s.players.filter((p) => !p.folded && !p.allIn);
    if (able.length <= 1) {
      s.runout = true;
      continue;
    }
    const first = findActor(s, idxAfterSeat(s.players, s.button));
    if (first !== null) {
      s.toAct = s.players[first]!.seat;
      return;
    }
  }
}

function findActor(s: HandState, fromIdx: number): number | null {
  const able = s.players.filter((p) => !p.folded && !p.allIn);
  if (able.length === 0) return null;
  if (able.length === 1 && able[0]!.committed >= s.currentBet) return null;
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const i = (fromIdx + k) % n;
    const p = s.players[i]!;
    if (!p.folded && !p.allIn && (!p.acted || p.committed < s.currentBet)) return i;
  }
  return null;
}

function nextStreet(s: HandState) {
  for (const p of s.players) {
    p.committed = 0;
    p.acted = false;
    p.raiseLocked = false;
  }
  s.currentBet = 0;
  s.minRaise = s.config.bigBlind;
  s.lastAggressor = null;
  s.deckPos++; // burn
  const count = s.street === 'preflop' ? 3 : 1;
  for (let i = 0; i < count; i++) s.board.push(s.deck[s.deckPos++]!);
  s.street = s.street === 'preflop' ? 'flop' : s.street === 'flop' ? 'turn' : 'river';
}

function finish(s: HandState) {
  s.toAct = null;
  s.result = settle(s);
  s.street = 'complete';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function commit(p: PlayerState, amount: number) {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.committed += a;
  p.totalCommitted += a;
  if (p.stack === 0) p.allIn = true;
}

export function playerAt(s: HandState, seat: number): PlayerState {
  const p = s.players.find((x) => x.seat === seat);
  if (!p) throw new Error(`No player at seat ${seat}`);
  return p;
}

/** Index of the first player clockwise strictly after seat number `seat`. */
export function idxAfterSeat(players: readonly PlayerState[], seat: number): number {
  const i = players.findIndex((p) => p.seat > seat);
  return i >= 0 ? i : 0;
}

export function totalPot(s: HandState): number {
  return s.players.reduce((a, p) => a + p.totalCommitted, 0);
}
