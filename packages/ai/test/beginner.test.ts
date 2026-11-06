import { describe, expect, it } from 'vitest';
import { parseCards, seededRandomInt, type Card } from '@poker/core';
import { beginnerBot, preflopStrength, simulate } from '../src/index.js';

const hole = (s: string) => parseCards(s) as [Card, Card];

describe('beginner bot', () => {
  it('orders preflop hands sensibly', () => {
    expect(preflopStrength(hole('Ah As'))).toBeGreaterThan(preflopStrength(hole('Kh Ks')));
    expect(preflopStrength(hole('Ah Ks'))).toBeGreaterThan(preflopStrength(hole('9h 8s')));
    expect(preflopStrength(hole('7h 2s'))).toBeLessThan(0.2);
  });

  it('plays 5,000 six-handed hands with only legal actions and conserved chips', () => {
    const randomInt = seededRandomInt(42);
    const rng = () => randomInt(1_000_000) / 1_000_000;
    let handsSeen = 0;
    const res = simulate({
      bots: new Array(6).fill(beginnerBot),
      hands: 5000,
      startingStack: 1000,
      smallBlind: 5,
      bigBlind: 10,
      randomInt,
      rng,
      onHand: (s) => {
        handsSeen++;
        const start = s.players.reduce((a, p) => a + p.startStack, 0);
        const end = s.result!.finalStacks.reduce((a, f) => a + f.stack, 0);
        if (start !== end) throw new Error('chips not conserved');
      },
    });
    expect(handsSeen).toBe(5000);
    // Symmetric bots: total net is zero.
    expect(res.net.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
