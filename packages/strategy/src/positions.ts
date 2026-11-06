import type { PlayerView } from '@poker/core';

export type Position = 'UTG' | 'UTG1' | 'MP' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type TableFormat = 'hu' | '6max' | '9max';

export function tableFormat(players: number): TableFormat {
  return players <= 2 ? 'hu' : players <= 6 ? '6max' : '9max';
}

/** Labels for the non-blind seats (in action order ending at the button), by how many there are. */
const NON_BLIND: Record<number, Position[]> = {
  1: ['BTN'],
  2: ['CO', 'BTN'],
  3: ['HJ', 'CO', 'BTN'],
  4: ['UTG', 'HJ', 'CO', 'BTN'],
  5: ['UTG', 'LJ', 'HJ', 'CO', 'BTN'],
  6: ['UTG', 'MP', 'LJ', 'HJ', 'CO', 'BTN'],
  7: ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN'],
};

export function positionsOf(view: Pick<PlayerView, 'seats' | 'button' | 'sbSeat' | 'bbSeat'>): Map<number, Position> {
  const seats = view.seats.map((s) => s.seat).sort((a, b) => a - b);
  const out = new Map<number, Position>();
  out.set(view.sbSeat, 'SB');
  out.set(view.bbSeat, 'BB');
  if (seats.length === 2) return out;
  // Seats clockwise after the big blind, up to and including the button.
  const bbIdx = seats.indexOf(view.bbSeat);
  const rest: number[] = [];
  for (let k = 1; k < seats.length; k++) {
    const seat = seats[(bbIdx + k) % seats.length]!;
    if (seat === view.sbSeat) break;
    rest.push(seat);
  }
  const labels = NON_BLIND[rest.length];
  if (!labels) throw new Error(`Unsupported table size ${seats.length}`);
  rest.forEach((seat, i) => out.set(seat, labels[i]!));
  return out;
}
