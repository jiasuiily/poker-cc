import { describe, expect, it } from 'vitest';
import { seededRandomInt } from '@poker/core';
import { BOT_STYLES, getBot, makeAdvancedBot, makeBeginnerBot, simulate } from '../src/index.js';
import { C, R, X, play, startTable, viewNow } from '../../strategy/test/helpers.js';

const rngOf = (seed: number) => {
  const r = seededRandomInt(seed);
  return () => r(1_000_000) / 1_000_000;
};

describe('advanced bot', () => {
  it('is returned by getBot', () => {
    expect(getBot('advanced', 'lag').level).toBe('advanced');
    expect(getBot('advanced', 'lag').style).toBe('lag');
  });

  it('only takes legal actions over 1000 mixed hands', () => {
    const r = seededRandomInt(21);
    const adv = makeAdvancedBot(BOT_STYLES.tag);
    const beg = makeBeginnerBot(BOT_STYLES.lag);
    // simulate() applies every action through the engine, which throws on anything illegal.
    const res = simulate({
      bots: [adv, beg, adv, beg, adv, beg],
      hands: 1000,
      startingStack: 1000,
      smallBlind: 5,
      bigBlind: 10,
      randomInt: r,
      rng: () => r(1_000_000) / 1_000_000,
    });
    expect(res.net.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('raises AA and folds 72o under the gun (TAG)', () => {
    const bot = makeAdvancedBot(BOT_STYLES.tag);
    for (let i = 0; i < 20; i++) {
      expect(bot.decide(viewNow(startTable(6, 0, { seat: 3, cards: 'Ah Ad' })), rngOf(i)).kind).toBe('raise');
      expect(bot.decide(viewNow(startTable(6, 0, { seat: 3, cards: '7c 2d' })), rngOf(i)).kind).toBe('fold');
    }
  });

  it('does not fold the nut flush draw getting 3:1', () => {
    // heads-up: SB limps, BB (hero) checks; flop BB checks, SB bets the minimum 10 into 20 (call 10 to win 40)
    const bot = makeAdvancedBot(BOT_STYLES.tag);
    for (let i = 0; i < 10; i++) {
      const g = play(startTable(2, 0, { seat: 1, cards: 'Ah 5h' }, 'Kh 9h 2c 3d 8s'), C, X, X, R(10));
      expect(bot.decide(viewNow(g), rngOf(i)).kind).not.toBe('fold');
    }
  });

  it('decides a flop spot in < 30 ms (median)', () => {
    const bot = makeAdvancedBot(BOT_STYLES.tag);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const g = play(startTable(6, 0, { seat: 2, cards: 'Qc Jc' }, 'Qd 8h 3c 2s 5d'), R(25), C, F(), F(), F(), C);
      const t = performance.now();
      bot.decide(viewNow(g), rngOf(i));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[5]).toBeLessThan(process.env.CI ? 60 : 30);
  });
});

function F() {
  return { kind: 'fold' as const };
}
