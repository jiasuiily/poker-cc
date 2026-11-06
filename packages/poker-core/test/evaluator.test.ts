import { describe, expect, it } from 'vitest';
import { bestFive, categoryOf, Category, evaluate, parseCards, rankOf, seededRandomInt, shuffleDeck, suitOf, type Card } from '../src/index.js';

const ev = (s: string) => evaluate(parseCards(s));

/** Independent, slow reference for exactly 5 cards (sort-based). */
function naive5(cards: Card[]): number[] {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = new Set(cards.map(suitOf)).size === 1;
  const uniq = [...new Set(ranks)];
  let straightTop = -1;
  if (uniq.length === 5) {
    if (ranks[0]! - ranks[4]! === 4) straightTop = ranks[0]!;
    else if (ranks.join() === '12,3,2,1,0') straightTop = 3;
  }
  const groups = uniq
    .map((r) => [ranks.filter((x) => x === r).length, r] as const)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map((g) => g[0]).join('');
  const byGroup = groups.map((g) => g[1]);
  if (straightTop >= 0 && flush) return [8, straightTop];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightTop >= 0) return [4, straightTop];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...ranks];
}
const cmpArr = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return Math.sign(d);
  }
  return 0;
};
function naiveBest7(cards: Card[]): number[] {
  let best: number[] = [-1];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const v = naive5(five);
      if (cmpArr(v, best) > 0) best = v;
    }
  return best;
}

describe('evaluator', () => {
  it('ranks categories', () => {
    expect(categoryOf(ev('As Ks Qs Js Ts 2d 3c'))).toBe(Category.StraightFlush);
    expect(categoryOf(ev('9h 9d 9s 9c Ah 2d 3c'))).toBe(Category.Quads);
    expect(categoryOf(ev('9h 9d 9s Ac Ah 2d 3c'))).toBe(Category.FullHouse);
    expect(categoryOf(ev('2h 7h 9h Jh Kh 2d 3c'))).toBe(Category.Flush);
    expect(categoryOf(ev('Ah 2d 3s 4c 5h Kd Qc'))).toBe(Category.Straight);
    expect(categoryOf(ev('9h 9d 9s Ac Kh 2d 3c'))).toBe(Category.Trips);
    expect(categoryOf(ev('9h 9d 8s 8c Kh 2d 3c'))).toBe(Category.TwoPair);
    expect(categoryOf(ev('9h 9d 8s 7c Kh 2d 3c'))).toBe(Category.Pair);
    expect(categoryOf(ev('9h Td 8s 7c Kh 2d 3c'))).toBe(Category.HighCard);
  });

  it('handles tricky comparisons', () => {
    // wheel < six-high straight
    expect(ev('Ah 2d 3s 4c 5h Kd Qc')).toBeLessThan(ev('6h 2d 3s 4c 5h Kd Qc'));
    // steel wheel is a straight flush
    expect(categoryOf(ev('Ah 2h 3h 4h 5h Kd Qc'))).toBe(Category.StraightFlush);
    // two trips => full house using the higher trips
    expect(ev('9h 9d 9s 8c 8h 8d 3c')).toBe(ev('9h 9d 9s 8c 8h 2d 3c'));
    // three pairs: best two pairs + best kicker
    expect(ev('Ah Ad Ks Kc 2h 2d Qc')).toBeGreaterThan(ev('Ah Ad Ks Kc 2h 2d Jc'));
    // flush beats straight even when both present
    expect(categoryOf(ev('5h 6h 7h 8d 9h Th 2c'))).toBe(Category.Flush);
    // board plays: split
    expect(ev('2c 3d As Ks Qs Js Ts')).toBe(ev('4c 5d As Ks Qs Js Ts'));
    // kicker matters
    expect(ev('Ah Kd 9s 9c 5h 4d 2c')).toBeGreaterThan(ev('Ah Qd 9s 9c 5h 4d 2c'));
  });

  it('bestFive returns a 5-card hand with the same value', () => {
    const cards = parseCards('As Ks Qs Js Ts 2d 3c');
    const b = bestFive(cards);
    expect(b.cards).toHaveLength(5);
    expect(b.value).toBe(evaluate(cards));
  });

  it('agrees with an independent brute-force reference on 100k random 7-card hands', () => {
    const rnd = seededRandomInt(12345);
    const hands: Card[][] = [];
    for (let i = 0; i < 100_000; i++) hands.push(shuffleDeck(rnd).slice(0, 7));
    // Compare ordering pairwise on consecutive hands + category equality.
    let prev: Card[] | null = null;
    for (const h of hands) {
      const fast = evaluate(h);
      const ref = naiveBest7(h);
      expect(categoryOf(fast)).toBe(ref[0]);
      if (prev) {
        const f = Math.sign(fast - evaluate(prev));
        const r = cmpArr(ref, naiveBest7(prev));
        if (f !== r) throw new Error(`Mismatch ${h} vs ${prev}`);
      }
      prev = h;
    }
  });
});
