import { describe, expect, it } from 'vitest';
import { parseCards, seededRandomInt, type Card } from '@poker/core';
import { evaluateDecision, inferRanges, scoreOptions } from '../src/index.js';
import { C, F, R, X, play, startTable, viewNow } from './helpers.js';

describe('checkpoint review fixes', () => {
  it('AA facing an all-in it can only call: calling is good, folding is a mistake', () => {
    // heads-up, equal stacks: SB shoves, BB (hero) holds AA and cannot re-raise
    const g = play(startTable(2, 0, { seat: 1, cards: 'Ah Ad' }), R(1000));
    const v = viewNow(g);
    expect(v.legal!.raise).toBeNull();
    const call = evaluateDecision(v, C);
    expect(call.verdict).toBe('good');
    expect(call.recommended.kind).toBe('call');
    expect(evaluateDecision(v, F).verdict).toBe('mistake');
  });

  it('a 3-bettor who calls a 4-bet gets a strong range, not the limp range', () => {
    // 6-max, button 0: UTG(3) opens, BTN(0) 3-bets, UTG 4-bets, BTN calls; hero = UTG on the flop
    const g = play(startTable(6, 0, { seat: 3, cards: 'Ks Kd' }, '7h 6c 2d'), R(25), F, F, R(80), F, F, R(200), C);
    const v = viewNow(g);
    expect(v.street).toBe('flop');
    const btn = inferRanges(v, 3).get(0)!;
    const weight = btn.reduce((a, c) => a + c.w, 0);
    expect(weight).toBeLessThan(100);
    const has54s = btn.some((c) => {
      const s = c.cards.map((x) => x >> 2).sort();
      return s[0] === 2 && s[1] === 3 && (c.cards[0] & 3) === (c.cards[1] & 3);
    });
    expect(has54s).toBe(false);
  });

  it('raise EV facing a bet adds only the villain’s extra chips to the final pot', () => {
    // river: hero BB holds the royal flush; SB bets 20 into 20. Villain range: one hopeless combo.
    const g = play(startTable(2, 0, { seat: 1, cards: 'Ah Kh' }, 'Qh Jh Th 2c 3d'), C, X, X, X, X, X, X, R(20));
    const v = viewNow(g);
    expect(v.pot).toBe(40);
    const ranges = new Map([[0, [{ cards: parseCards('2s 3s') as [Card, Card], w: 1 }]]]);
    const { options, equity } = scoreOptions(v, ranges, { iterations: 500, randomInt: seededRandomInt(1) }, 100);
    expect(equity).toBe(1);
    const r100 = options.find((o) => o.action.kind === 'raise' && o.action.to === 100)!;
    // villain (pct = 1) always calls: EV = pot + to - currentBet = 40 + 100 - 20 = 120 chips = 12bb
    expect(r100.ev).toBeCloseTo(12);
  });
});
