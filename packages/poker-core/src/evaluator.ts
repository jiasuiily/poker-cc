import { rankOf, suitOf, type Card } from './cards.js';

/**
 * Hand categories, higher is better.
 */
export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

/**
 * Evaluate the best 5-card hand among 5..7 cards. Returns a comparable integer:
 * category << 20 | five 4-bit rank slots (most significant first).
 * Pure bit/count logic, no 21-combination enumeration.
 */
export function evaluate(cards: readonly Card[]): number {
  const rankCount = new Uint8Array(13);
  const suitMask = [0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankCount[r]!++;
    suitMask[s]! |= 1 << r;
    suitCount[s]!++;
    rankMask |= 1 << r;
  }

  // Flush / straight flush
  for (let s = 0; s < 4; s++) {
    if (suitCount[s]! >= 5) {
      const sf = straightHigh(suitMask[s]!);
      if (sf >= 0) return encode(Category.StraightFlush, [sf]);
      return encode(Category.Flush, topBits(suitMask[s]!, 5));
    }
  }

  let quad = -1;
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const n = rankCount[r]!;
    if (n === 4) quad = r;
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }

  if (quad >= 0) {
    const kicker = highestExcept(rankCount, [quad]);
    return encode(Category.Quads, [quad, kicker]);
  }
  if (trips.length >= 2 || (trips.length === 1 && pairs.length >= 1)) {
    const t = trips[0]!;
    const p = trips.length >= 2 ? Math.max(trips[1]!, pairs[0] ?? -1) : pairs[0]!;
    return encode(Category.FullHouse, [t, p]);
  }
  const st = straightHigh(rankMask);
  if (st >= 0) return encode(Category.Straight, [st]);
  if (trips.length === 1) {
    const t = trips[0]!;
    const k = topRanksExcept(rankCount, [t], 2);
    return encode(Category.Trips, [t, ...k]);
  }
  if (pairs.length >= 2) {
    const [p1, p2] = pairs as [number, number];
    const k = highestExcept(rankCount, [p1, p2]);
    return encode(Category.TwoPair, [p1, p2, k]);
  }
  if (pairs.length === 1) {
    const p = pairs[0]!;
    return encode(Category.Pair, [p, ...topRanksExcept(rankCount, [p], 3)]);
  }
  return encode(Category.HighCard, singles.slice(0, 5));
}

export const categoryOf = (value: number): Category => (value >> 20) as Category;

function encode(cat: Category, ranks: number[]): number {
  let v: number = cat;
  for (let i = 0; i < 5; i++) v = (v << 4) | ((ranks[i] ?? -1) + 1);
  return v;
}

/** Highest straight top rank in a 13-bit mask, or -1. Wheel (A-5) returns 3 (the 5). */
function straightHigh(mask: number): number {
  const m = (mask << 1) | (mask & (1 << 12) ? 1 : 0); // bit0 = ace-low
  for (let top = 13; top >= 4; top--) {
    const run = 0b11111 << (top - 4);
    if ((m & run) === run) return top - 1;
  }
  return -1;
}

function topBits(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

function highestExcept(counts: Uint8Array, except: number[]): number {
  for (let r = 12; r >= 0; r--) if (counts[r]! > 0 && !except.includes(r)) return r;
  return -1;
}

function topRanksExcept(counts: Uint8Array, except: number[], n: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (counts[r]! > 0 && !except.includes(r)) out.push(r);
  return out;
}

/** Choose the 5 cards that make the best hand (for display). Enumerates 21 combos; only used at showdown. */
export function bestFive(cards: readonly Card[]): { value: number; cards: Card[] } {
  if (cards.length <= 5) return { value: evaluate(cards), cards: [...cards] };
  let best = { value: -1, cards: [] as Card[] };
  const n = cards.length;
  const rec = (start: number, depth: number, pick: Card[]) => {
    if (depth === 5) {
      const v = evaluate(pick);
      if (v > best.value) best = { value: v, cards: [...pick] };
      return;
    }
    for (let i = start; i <= n - (5 - depth); i++) {
      pick.push(cards[i]!);
      rec(i + 1, depth + 1, pick);
      pick.pop();
    }
  };
  rec(0, 0, []);
  return best;
}
