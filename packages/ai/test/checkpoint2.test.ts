import { describe, expect, it } from 'vitest';
import { seededRandomInt } from '@poker/core';
import { BOT_STYLES, makeAdvancedBot, scaleRaiseTo } from '../src/index.js';
import { F, R, play, startTable, viewNow } from '../../strategy/test/helpers.js';

const rngOf = (seed: number) => {
  const r = seededRandomInt(seed);
  return () => r(1_000_000) / 1_000_000;
};

describe('checkpoint review 2 fixes', () => {
  it('TAG and nit never fold KK facing a 4-bet', () => {
    for (const style of ['tag', 'nit'] as const) {
      const bot = makeAdvancedBot(BOT_STYLES[style]);
      for (let i = 0; i < 20; i++) {
        // 6-max, button 0: UTG(3) opens, BTN(0, hero) 3-bets, UTG 4-bets
        const g = play(startTable(6, 0, { seat: 0, cards: 'Kh Kd' }), R(25), F, F, R(75), F, F, R(180));
        expect(viewNow(g).viewerSeat).toBe(0);
        expect(bot.decide(viewNow(g), rngOf(i)).kind).not.toBe('fold');
      }
    }
  });

  it('TAG keeps QQ facing a cold 3-bet', () => {
    const bot = makeAdvancedBot(BOT_STYLES.tag);
    for (let i = 0; i < 20; i++) {
      // UTG(3) opens, HJ(4) 3-bets, CO(5, hero) to act
      const g = play(startTable(6, 0, { seat: 5, cards: 'Qh Qd' }), R(25), R(75));
      expect(bot.decide(viewNow(g), rngOf(i)).kind).not.toBe('fold');
    }
  });

  it('passive styles do not open-limp premium hands', () => {
    for (const style of ['nit', 'station'] as const) {
      const bot = makeAdvancedBot(BOT_STYLES[style]);
      for (let i = 0; i < 20; i++) {
        expect(bot.decide(viewNow(startTable(6, 0, { seat: 3, cards: 'Ah Ad' })), rngOf(i)).kind).toBe('raise');
      }
    }
  });

  it('size scaling keeps all-ins as all-ins and never leaves crumbs behind', () => {
    // flop, pot 55, hero BB with 975 behind
    const g = play(startTable(6, 0, { seat: 2, cards: 'Ah Ad' }, 'Kd 8h 3c'), R(25), F, F, F, F, { kind: 'call' });
    const v = viewNow(g);
    const max = v.legal!.raise!.max;
    expect(scaleRaiseTo(v, max, 0.8)).toBe(max);
    expect(scaleRaiseTo(v, 900, 0.9)).toBe(max); // 810 would leave 165 behind vs a ~1675 pot
    const half = scaleRaiseTo(v, 28, 1.1);
    expect(half).toBeGreaterThanOrEqual(v.legal!.raise!.min);
    expect(half).toBeLessThan(max);
  });
});
