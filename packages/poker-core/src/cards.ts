/**
 * Card encoding: id = rank * 4 + suit
 *   rank 0..12 => 2,3,4,5,6,7,8,9,T,J,Q,K,A
 *   suit 0..3  => c,d,h,s
 */
export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;
export const makeCard = (rank: number, suit: number): Card => rank * 4 + suit;

export function cardToString(c: Card): string {
  return RANKS[rankOf(c)] + SUITS[suitOf(c)];
}

export function parseCard(s: string): Card {
  const r = RANKS.indexOf(s[0]!.toUpperCase());
  const su = SUITS.indexOf(s[1]!.toLowerCase());
  if (s.length !== 2 || r < 0 || su < 0) throw new Error(`Bad card: ${s}`);
  return makeCard(r, su);
}

/** Parse "As Kd 7h" or "AsKd7h". */
export function parseCards(s: string): Card[] {
  const t = s.replace(/\s+/g, '');
  if (t.length % 2) throw new Error(`Bad cards: ${s}`);
  const out: Card[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(parseCard(t.slice(i, i + 2)));
  return out;
}

export function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}
