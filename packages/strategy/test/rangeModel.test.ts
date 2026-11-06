import { describe, expect, it } from 'vitest';
import { parseCards } from '@poker/core';
import { bucketize, chartFor, inferRanges, rangeCombos, rangeWidth } from '../src/index.js';
import { C, F, R, X, play, startTable, viewNow } from './helpers.js';

const weightShare = (buckets: ReturnType<typeof bucketize>, pred: (pct: number) => boolean) => {
  const total = buckets.reduce((a, b) => a + b.combo.w, 0);
  return buckets.filter((b) => pred(b.pct)).reduce((a, b) => a + b.combo.w, 0) / total;
};

describe('bucketize', () => {
  it('ranks made hands and flags draws', () => {
    const board = parseCards('Kh 9h 4c');
    const combos = [
      { cards: parseCards('Ks Kd') as [number, number], w: 1 }, // set
      { cards: parseCards('Ah 2h') as [number, number], w: 1 }, // nut flush draw
      { cards: parseCards('7c 2d') as [number, number], w: 1 }, // nothing
    ];
    const b = bucketize(combos, board);
    expect(b[0]!.pct).toBe(1);
    expect(b[1]!.draw).toBe(true);
    expect(b[2]!.pct).toBe(0);
    expect(b[2]!.draw).toBe(false);
  });
});

describe('inferRanges', () => {
  it('a UTG opener gets the UTG opening range', () => {
    // 6-max, button 0: UTG(3) opens, everyone folds to BB(2) who is to act.
    const g = play(startTable(6, 0, { seat: 2, cards: '7c 7d' }), R(25), F, F, F, F);
    const view = viewNow(g);
    expect(view.viewerSeat).toBe(2);
    const ranges = inferRanges(view, 2);
    expect([...ranges.keys()]).toEqual([3]);
    const width = ranges.get(3)!.reduce((a, c) => a + c.w, 0) / 1326;
    const chart = rangeWidth(chartFor('6max', { kind: 'rfi', pos: 'UTG' })!.raise);
    expect(Math.abs(width - chart)).toBeLessThan(0.02); // card removal only
  });

  it('a pot-sized flop bet shifts the range towards strong hands', () => {
    const g = play(startTable(6, 0, { seat: 2, cards: '7c 7d' }, 'Kd 8h 3c 2s 5d'), R(25), F, F, F, F, C);
    const before = inferRanges(viewNow(g), 2).get(3)!;
    play(g, X, R(55)); // BB checks, UTG bets pot (pot = 55)
    const view = viewNow(g);
    const after = inferRanges(view, 2).get(3)!;
    const board = view.board;
    const strongBefore = weightShare(bucketize(before, board), (p) => p >= 0.65);
    const strongAfter = weightShare(bucketize(after, board), (p) => p >= 0.65);
    expect(strongAfter).toBeGreaterThanOrEqual(0.55);
    expect(strongAfter).toBeGreaterThanOrEqual(2 * strongBefore);
  });

  it('never includes combos that clash with the hero or the board', () => {
    const g = play(startTable(6, 0, { seat: 2, cards: 'As Ad' }, 'Ah Kd 3c'), R(25), F, F, F, F, C);
    const dead = new Set([...parseCards('As Ad'), ...viewNow(g).board]);
    for (const c of inferRanges(viewNow(g), 2).get(3)!) {
      expect(dead.has(c.cards[0]) || dead.has(c.cards[1])).toBe(false);
    }
    void rangeCombos;
  });
});
