import { describe, expect, it } from 'vitest';
import { parseCards, type Card } from '@poker/core';
import { ALL_CLASSES, combosOfClass, handClassOf, mergeRanges, parseRange, rangeCombos, rangeWidth } from '../src/index.js';

const two = (s: string) => parseCards(s) as [Card, Card];

describe('hand classes', () => {
  it('has 169 classes covering 1326 combos', () => {
    expect(ALL_CLASSES).toHaveLength(169);
    expect(new Set(ALL_CLASSES).size).toBe(169);
    expect(ALL_CLASSES.reduce((a, c) => a + combosOfClass(c).length, 0)).toBe(1326);
  });

  it('classifies two cards', () => {
    expect(handClassOf(...two('As Ks'))).toBe('AKs');
    expect(handClassOf(...two('Kd As'))).toBe('AKo');
    expect(handClassOf(...two('7h 7c'))).toBe('77');
    expect(handClassOf(...two('2c Td'))).toBe('T2o');
  });

  it('expands combos per class', () => {
    expect(combosOfClass('QQ')).toHaveLength(6);
    expect(combosOfClass('AKs')).toHaveLength(4);
    expect(combosOfClass('AKo')).toHaveLength(12);
    for (const [a, b] of combosOfClass('AKo')) expect(handClassOf(a, b)).toBe('AKo');
  });
});

describe('range parsing', () => {
  it('pair plus', () => {
    const r = parseRange('TT+');
    expect([...r.keys()].sort()).toEqual(['AA', 'JJ', 'KK', 'QQ', 'TT']);
    expect(r.get('99')).toBeUndefined();
  });

  it('suited dash range, single offsuit, kicker plus', () => {
    expect([...parseRange('A5s-A2s').keys()].sort()).toEqual(['A2s', 'A3s', 'A4s', 'A5s']);
    expect([...parseRange('KJo').keys()]).toEqual(['KJo']);
    expect([...parseRange('AQs+').keys()].sort()).toEqual(['AKs', 'AQs']);
    expect([...parseRange('K9o+').keys()].sort()).toEqual(['K9o', 'KJo', 'KQo', 'KTo']);
    expect([...parseRange('77-55').keys()].sort()).toEqual(['55', '66', '77']);
  });

  it('weights and merge', () => {
    const r = mergeRanges(parseRange('AA', 0.5), parseRange('AA, KK'));
    expect(r.get('AA')).toBe(1);
    expect(r.get('KK')).toBe(1);
    expect(parseRange('76s', 0.25).get('76s')).toBe(0.25);
  });

  it('rejects garbage', () => {
    expect(() => parseRange('ZZ')).toThrow();
    expect(() => parseRange('AKx')).toThrow();
  });

  it('removes dead cards from combos', () => {
    expect(rangeCombos(parseRange('AA'), parseCards('As'))).toHaveLength(3);
    expect(rangeCombos(parseRange('AA'), [])).toHaveLength(6);
  });

  it('width is weighted combos / 1326', () => {
    expect(rangeWidth(parseRange('AA'))).toBeCloseTo(6 / 1326);
    expect(rangeWidth(parseRange(ALL_CLASSES.join(',')))).toBeCloseTo(1);
  });
});
