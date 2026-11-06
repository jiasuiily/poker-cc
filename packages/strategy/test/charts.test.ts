import { describe, expect, it } from 'vitest';
import { ALL_CLASSES, allCharts, chartFor, chartFreq, mergeRanges, preflopSituation, rangeWidth, type Position, type TableFormat } from '../src/index.js';
import { C, F, R, play, startTable, viewNow } from './helpers.js';

const RFI: [TableFormat, Position, number][] = [
  ['6max', 'UTG', 0.17], ['6max', 'HJ', 0.21], ['6max', 'CO', 0.28], ['6max', 'BTN', 0.45], ['6max', 'SB', 0.4],
  ['9max', 'UTG', 0.11], ['9max', 'UTG1', 0.13], ['9max', 'MP', 0.15], ['9max', 'LJ', 0.18], ['9max', 'HJ', 0.22],
  ['9max', 'CO', 0.28], ['9max', 'BTN', 0.45], ['9max', 'SB', 0.4],
  ['hu', 'SB', 0.8],
];

describe('preflop charts', () => {
  it.each(RFI)('%s %s open width ≈ %d', (format, pos, width) => {
    const e = chartFor(format, { kind: 'rfi', pos })!;
    expect(Math.abs(rangeWidth(e.raise) - width)).toBeLessThanOrEqual(0.04);
  });

  it('heads-up BB defends about 75% vs a button open', () => {
    const e = chartFor('hu', { kind: 'vsOpen', pos: 'BB', opener: 'SB' })!;
    const total = ALL_CLASSES.reduce((a, c) => a + (1 - chartFreq(e, c).fold) * (c.length === 2 ? 6 : c.endsWith('s') ? 4 : 12), 0) / 1326;
    expect(Math.abs(total - 0.75)).toBeLessThanOrEqual(0.05);
  });

  it('every chart has valid frequencies', () => {
    const charts = allCharts();
    expect(charts.length).toBeGreaterThan(20);
    for (const { entry } of charts) {
      for (const c of ALL_CLASSES) {
        const f = chartFreq(entry, c);
        for (const v of [f.raise, f.call, f.fold]) expect(v).toBeGreaterThanOrEqual(0);
        expect(f.raise + f.call + f.fold).toBeCloseTo(1);
      }
      for (const w of mergeRanges(entry.raise, entry.call).values()) expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('AA always opens, 72o never opens UTG', () => {
    for (const [format, pos] of RFI) expect(chartFreq(chartFor(format, { kind: 'rfi', pos })!, 'AA').raise).toBe(1);
    expect(chartFreq(chartFor('6max', { kind: 'rfi', pos: 'UTG' })!, '72o').fold).toBe(1);
  });
});

describe('preflop situation', () => {
  it('unopened pot is RFI for the player to act', () => {
    // 6 players, button 0: UTG = seat 3 acts first; folds to CO (seat 5).
    const g = play(startTable(6, 0), F, F);
    expect(preflopSituation(viewNow(g), 5)).toEqual({ kind: 'rfi', pos: 'CO' });
  });

  it('facing a single open is vsOpen with the opener position', () => {
    const g = play(startTable(6, 0), R(25), F, F);
    expect(preflopSituation(viewNow(g), 0)).toEqual({ kind: 'vsOpen', pos: 'BTN', opener: 'UTG' });
  });

  it('opener facing a 3-bet is vs3bet', () => {
    const g = play(startTable(6, 0), R(25), F, F, R(80), F, F);
    expect(g.state.toAct).toBe(3);
    expect(preflopSituation(viewNow(g), 3)).toEqual({ kind: 'vs3bet', pos: 'UTG' });
  });

  it('limped pot is other', () => {
    const g = play(startTable(6, 0), C);
    expect(preflopSituation(viewNow(g), 4)).toEqual({ kind: 'other' });
  });
});
