import type { Card } from '@poker/core';
import { ALL_CLASSES, classOf, combosOfClass, rankFromChar, type HandClass } from './handClass.js';

/** Hand class -> weight in 0..1 (missing = 0). */
export type Range = Map<HandClass, number>;

export interface WeightedCombo {
  cards: [Card, Card];
  w: number;
}

const CLASS_SET = new Set(ALL_CLASSES);

/**
 * Parse common range notation: "TT+, 77-55, AQs+, A5s-A2s, KJo, K9o+, AK" (no suffix = suited + offsuit).
 * Every listed class gets `weight`.
 */
export function parseRange(s: string, weight = 1): Range {
  const r: Range = new Map();
  for (const raw of s.split(/[\s,]+/).filter(Boolean)) {
    for (const c of expandToken(raw)) r.set(c, Math.max(r.get(c) ?? 0, weight));
  }
  return r;
}

function expandToken(tok: string): HandClass[] {
  const m = /^([AKQJT2-9])([AKQJT2-9])([so]?)(\+?)(?:-([AKQJT2-9])([AKQJT2-9])([so]?))?$/i.exec(tok);
  if (!m) throw new Error(`Bad range token: ${tok}`);
  const [, a, b, suf, plus, a2, b2] = m;
  const hi = rankFromChar(a!);
  const lo = rankFromChar(b!);
  const suits = suf ? [suf.toLowerCase() === 's'] : [true, false];
  const out: HandClass[] = [];
  const add = (h: number, l: number) => {
    if (h === l) out.push(classOf(h, l, false));
    else for (const su of suits) out.push(classOf(h, l, su));
  };
  if (hi === lo) {
    if (suf) throw new Error(`Pairs take no suffix: ${tok}`);
    const end = plus ? 12 : a2 ? rankFromChar(a2) : hi;
    for (let r = Math.min(hi, end); r <= Math.max(hi, end); r++) add(r, r);
  } else {
    if (hi < lo) throw new Error(`High card first: ${tok}`);
    if (plus) for (let k = lo; k < hi; k++) add(hi, k);
    else if (a2 && b2) {
      if (rankFromChar(a2) !== hi) throw new Error(`Dash ranges must share the high card: ${tok}`);
      const k2 = rankFromChar(b2);
      for (let k = Math.min(lo, k2); k <= Math.max(lo, k2); k++) add(hi, k);
    } else add(hi, lo);
  }
  for (const c of out) if (!CLASS_SET.has(c)) throw new Error(`Bad class ${c} in ${tok}`);
  return out;
}

export function mergeRanges(...rs: Range[]): Range {
  const out: Range = new Map();
  for (const r of rs) for (const [c, w] of r) out.set(c, Math.max(out.get(c) ?? 0, w));
  return out;
}

/** Expand to concrete weighted combos, dropping any that use a dead card. */
export function rangeCombos(r: Range, dead: Iterable<Card>): WeightedCombo[] {
  const deadSet = new Set(dead);
  const out: WeightedCombo[] = [];
  for (const [c, w] of r) {
    if (w <= 0) continue;
    for (const cards of combosOfClass(c)) {
      if (!deadSet.has(cards[0]) && !deadSet.has(cards[1])) out.push({ cards, w });
    }
  }
  return out;
}

/** Weighted fraction of all 1326 starting combos. */
export function rangeWidth(r: Range): number {
  let n = 0;
  for (const [c, w] of r) n += combosOfClass(c).length * w;
  return n / 1326;
}
