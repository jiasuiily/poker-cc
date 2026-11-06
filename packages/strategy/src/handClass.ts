import { makeCard, rankOf, suitOf, type Card } from '@poker/core';

/** Starting-hand class: 'AA', 'AKs', 'AKo', ... (169 total). */
export type HandClass = string;

/** Rank characters from high to low; index 0 = Ace. */
export const RANK_CHARS = 'AKQJT98765432';
/** Engine rank (0=2 .. 12=A) for a rank character. */
export const rankFromChar = (ch: string): number => {
  const i = RANK_CHARS.indexOf(ch.toUpperCase());
  if (i < 0) throw new Error(`Bad rank: ${ch}`);
  return 12 - i;
};
export const charFromRank = (r: number): string => RANK_CHARS[12 - r]!;

export function classOf(hi: number, lo: number, suited: boolean): HandClass {
  if (hi === lo) return charFromRank(hi) + charFromRank(lo);
  const [a, b] = hi > lo ? [hi, lo] : [lo, hi];
  return charFromRank(a) + charFromRank(b) + (suited ? 's' : 'o');
}

export function handClassOf(a: Card, b: Card): HandClass {
  return classOf(rankOf(a), rankOf(b), suitOf(a) === suitOf(b));
}

export const ALL_CLASSES: HandClass[] = (() => {
  const out: HandClass[] = [];
  for (let hi = 12; hi >= 0; hi--) {
    out.push(classOf(hi, hi, false));
    for (let lo = hi - 1; lo >= 0; lo--) out.push(classOf(hi, lo, true), classOf(hi, lo, false));
  }
  return out;
})();

const comboCache = new Map<HandClass, [Card, Card][]>();

export function combosOfClass(c: HandClass): [Card, Card][] {
  const cached = comboCache.get(c);
  if (cached) return cached;
  const hi = rankFromChar(c[0]!);
  const lo = rankFromChar(c[1]!);
  const out: [Card, Card][] = [];
  if (hi === lo) {
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = s1 + 1; s2 < 4; s2++) out.push([makeCard(hi, s1), makeCard(lo, s2)]);
  } else if (c[2] === 's') {
    for (let s = 0; s < 4; s++) out.push([makeCard(hi, s), makeCard(lo, s)]);
  } else {
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([makeCard(hi, s1), makeCard(lo, s2)]);
  }
  comboCache.set(c, out);
  return out;
}
