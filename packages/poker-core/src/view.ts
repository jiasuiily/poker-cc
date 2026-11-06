import type { Card } from './cards.js';
import { legalActions, totalPot } from './hand.js';
import type { ActionLogEntry, HandResult, HandState, LegalActions, Street } from './types.js';

export interface PlayerViewSeat {
  seat: number;
  playerId: string;
  stack: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Only the viewer's own cards, or cards shown at showdown. Never anyone else's. */
  hole: [Card, Card] | null;
}

export interface PlayerView {
  handId: string;
  viewerSeat: number | null;
  street: Street;
  button: number;
  sbSeat: number;
  bbSeat: number;
  smallBlind: number;
  bigBlind: number;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  toAct: number | null;
  actionSeq: number;
  seats: PlayerViewSeat[];
  /** Public action history of this hand. */
  history: ActionLogEntry[];
  /** Present only when it is the viewer's turn. */
  legal: LegalActions | null;
  result: HandResult | null;
}

/**
 * The single projection used for every client, spectators and AI alike.
 * Hidden information (deck, other players' unshown hole cards) is stripped here.
 */
export function projectView(s: HandState, viewerSeat: number | null): PlayerView {
  const shown = new Map(s.result?.shown.map((h) => [h.seat, h.hole]) ?? []);
  const legal = viewerSeat !== null && s.toAct === viewerSeat ? legalActions(s) : null;
  return {
    handId: s.handId,
    viewerSeat,
    street: s.street,
    button: s.button,
    sbSeat: s.sbSeat,
    bbSeat: s.bbSeat,
    smallBlind: s.config.smallBlind,
    bigBlind: s.config.bigBlind,
    board: [...s.board],
    pot: totalPot(s),
    currentBet: s.currentBet,
    minRaise: s.minRaise,
    toAct: s.toAct,
    actionSeq: s.actionSeq,
    seats: s.players.map((p) => ({
      seat: p.seat,
      playerId: p.playerId,
      stack: p.stack,
      committed: p.committed,
      folded: p.folded,
      allIn: p.allIn,
      hole:
        p.seat === viewerSeat ? ([...p.hole] as [Card, Card]) : shown.has(p.seat) ? ([...shown.get(p.seat)!] as [Card, Card]) : null,
    })),
    history: s.log.map((e) => ({ ...e })),
    legal,
    result: s.result ? structuredClone(s.result) : null,
  };
}
