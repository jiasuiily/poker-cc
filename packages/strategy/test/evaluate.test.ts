import { describe, expect, it } from 'vitest';
import { analyzeHand, evaluateDecision } from '../src/index.js';
import { C, F, R, X, play, startTable, viewNow } from './helpers.js';

/** Heads-up: seat 0 = button/SB, seat 1 = BB (hero). Checks down to the river, then SB acts. */
function riverSpot(heroCards: string, board: string) {
  const g = play(startTable(2, 0, { seat: 1, cards: heroCards }, board), C, X, X, X, X, X);
  return g; // river: BB (seat 1) to act first
}

describe('evaluateDecision (postflop EV)', () => {
  it('folding the nuts to a bet is a mistake', () => {
    const g = play(riverSpot('Ah Kh', 'Qh Jh Th 2c 3d'), X, R(20));
    const r = evaluateDecision(viewNow(g), F);
    expect(r.verdict).toBe('mistake');
    expect(r.recommended.kind).not.toBe('fold');
    expect(r.method).toBe('ev');
  });

  it('calling an overbet with ~0% equity is a mistake', () => {
    const g = play(riverSpot('7c 2d', 'As Ks Qs Jd 9h'), X, R(40));
    const r = evaluateDecision(viewNow(g), C);
    expect(r.equity!).toBeLessThan(0.05);
    expect(r.verdict).toBe('mistake');
    expect(r.recommended.kind).toBe('fold');
    expect(r.evLossBb).toBeGreaterThan(2);
  });

  it('calling a half-pot bet with equity above pot odds is good', () => {
    // flop: BB checks with middle pair, SB bets 10 into 20
    const g = play(startTable(2, 0, { seat: 1, cards: 'Kd 7c' }, 'As 7d 2c 4h 8s'), C, X, X, R(10));
    const r = evaluateDecision(viewNow(g), C);
    expect(r.potOdds).toBeCloseTo(10 / 40); // call / pot after calling
    expect(r.mdf).toBeCloseTo(20 / 30);
    expect(r.equity!).toBeGreaterThan(r.potOdds!);
    expect(r.verdict).toBe('good');
    expect(r.evLossBb).toBeGreaterThanOrEqual(0);
    expect(r.options.some((o) => o.action.kind === 'call')).toBe(true);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe('evaluateDecision (preflop chart)', () => {
  it('folding AA under the gun is a mistake', () => {
    const g = startTable(6, 0, { seat: 3, cards: 'Ah Ad' });
    const r = evaluateDecision(viewNow(g), F);
    expect(r.method).toBe('chart');
    expect(r.verdict).toBe('mistake');
    expect(r.recommended.kind).toBe('raise');
  });

  it('folding 72o under the gun is good', () => {
    const g = startTable(6, 0, { seat: 3, cards: '7c 2d' });
    const r = evaluateDecision(viewNow(g), F);
    expect(r.verdict).toBe('good');
    expect(r.evLossBb).toBe(0);
  });
});

describe('analyzeHand', () => {
  it('returns no decisions when the hero only posted a blind', () => {
    const g = play(startTable(3, 0), F, F); // button and SB fold; BB (seat 2) wins
    expect(analyzeHand(g.events, 2)).toEqual([]);
  });

  it('only the preflop decision after an all-in', () => {
    const g = play(startTable(2, 0, { seat: 0, cards: 'Ah Ad' }), R(1000), C);
    const r = analyzeHand(g.events, 0);
    expect(r).toHaveLength(1);
    expect(r[0]!.street).toBe('preflop');
  });

  it('is deterministic', () => {
    const g = play(startTable(2, 0, { seat: 1, cards: 'Ah 9c' }, 'As 7d 2c 4h 8s'), C, X, X, R(10), C, X, X, X, X);
    expect(analyzeHand(g.events, 1)).toEqual(analyzeHand(g.events, 1));
    expect(analyzeHand(g.events, 1).length).toBeGreaterThanOrEqual(3);
  });
});
