import type { Card } from './cards.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';

export interface HandConfig {
  smallBlind: number;
  bigBlind: number;
}

export interface SeatInit {
  seat: number;
  playerId: string;
  stack: number;
}

export type PlayerAction =
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  /** Bet or raise: `to` is the player's total commitment on this street after the action. */
  | { kind: 'raise'; to: number };

/**
 * A hand is fully described by its start event (seats, button, deck order)
 * plus the ordered list of player actions. Blinds, dealing, street changes,
 * showdown and settlement are derived deterministically by the reducer.
 */
export type HandEvent =
  | {
      type: 'HandStarted';
      handId: string;
      config: HandConfig;
      seats: SeatInit[];
      /** Seat number of the button (may be an empty seat for dead-button rules). */
      button: number;
      deck: Card[];
    }
  | { type: 'Action'; seat: number; seq: number; action: PlayerAction };

/** Public record of one player action (visible to everyone, used for replays and range inference). */
export interface ActionLogEntry {
  seq: number;
  seat: number;
  street: Exclude<Street, 'complete'>;
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** The player's total commitment on this street after the action. */
  to: number;
  allIn: boolean;
}

export interface PlayerState {
  seat: number;
  playerId: string;
  startStack: number;
  /** Chips behind (not yet committed). */
  stack: number;
  /** Committed on the current street. */
  committed: number;
  /** Committed over the whole hand. */
  totalCommitted: number;
  hole: [Card, Card];
  folded: boolean;
  allIn: boolean;
  /** Has voluntarily acted on this street. */
  acted: boolean;
  /** Acted and no full raise since: may only call or fold (incomplete-raise rule). */
  raiseLocked: boolean;
}

export interface PotResult {
  amount: number;
  eligible: number[];
  winners: { seat: number; amount: number }[];
}

export interface ShownHand {
  seat: number;
  hole: [Card, Card];
  value: number;
  best5: Card[];
}

export interface HandResult {
  uncontested: boolean;
  refunds: { seat: number; amount: number }[];
  pots: PotResult[];
  shown: ShownHand[];
  /** Total chips each seat receives back at settlement (refund + winnings). */
  payouts: { seat: number; amount: number }[];
  finalStacks: { seat: number; playerId: string; stack: number }[];
}

export interface HandState {
  handId: string;
  config: HandConfig;
  button: number;
  sbSeat: number;
  bbSeat: number;
  /** Sorted by seat number ascending; seat order = clockwise. */
  players: PlayerState[];
  deck: Card[];
  deckPos: number;
  board: Card[];
  street: Street;
  currentBet: number;
  /** Minimum raise increment on this street. */
  minRaise: number;
  /** Last player to bet/raise on the current street. */
  lastAggressor: number | null;
  toAct: number | null;
  /** Number of actions applied; next Action event must carry seq === actionSeq. */
  actionSeq: number;
  /** Remaining streets were dealt with no betting possible. */
  runout: boolean;
  /** Public action log. */
  log: ActionLogEntry[];
  result: HandResult | null;
}

export interface LegalActions {
  seat: number;
  toCall: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Allowed raise-to range (total street commitment), or null if raising is not allowed. */
  raise: { min: number; max: number } | null;
}
