import { describe, expect, it } from 'vitest';
import { parseCards, seededRandomInt, type Card } from '@poker/core';
import { equityVsRanges, parseRange, rangeCombos, type WeightedCombo } from '../src/index.js';

const two = (s: string) => parseCards(s) as [Card, Card];
const one = (s: string): WeightedCombo[] => [{ cards: two(s), w: 1 }];

describe('equity', () => {
  it('AA vs KK preflop ≈ 82%', () => {
    const eq = equityVsRanges(two('Ah Ad'), [], [one('Kc Ks')], { iterations: 20000 });
    expect(Math.abs(eq - 0.82)).toBeLessThanOrEqual(0.015);
  });

  it('AKs vs QQ preflop ≈ 46%', () => {
    const eq = equityVsRanges(two('As Ks'), [], [one('Qh Qd')], { iterations: 20000 });
    expect(Math.abs(eq - 0.46)).toBeLessThanOrEqual(0.015);
  });

  it('royal flush on the flop has 100%', () => {
    expect(equityVsRanges(two('Ah Kh'), parseCards('Qh Jh Th'), [rangeCombos(parseRange('22+, AKo'), parseCards('Ah Kh Qh Jh Th'))])).toBe(1);
  });

  it('same seed gives the same result', () => {
    const v = [rangeCombos(parseRange('TT+, AQs+'), parseCards('As Kd'))];
    const a = equityVsRanges(two('As Kd'), [], v, { randomInt: seededRandomInt(7) });
    const b = equityVsRanges(two('As Kd'), [], v, { randomInt: seededRandomInt(7) });
    expect(a).toBe(b);
  });

  it('respects card removal: AA vs the only remaining AA splits', () => {
    const v = rangeCombos(parseRange('AA'), parseCards('As Ad'));
    expect(v).toHaveLength(1);
    expect(Math.abs(equityVsRanges(two('As Ad'), [], [v], { iterations: 5000 }) - 0.5)).toBeLessThan(0.03);
  });

  it('one flop spot vs two 30% ranges takes < 10 ms', () => {
    const board = parseCards('Kd 8h 3c');
    const hero = two('Ac Ks');
    const wide = parseRange('22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, A9o+, KTo+, QJo');
    const v = [rangeCombos(wide, [...hero, ...board]), rangeCombos(wide, [...hero, ...board])];
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      equityVsRanges(hero, board, v, { iterations: 4000, randomInt: seededRandomInt(i + 1) });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(process.env.CI ? 25 : 10);
  });
});
