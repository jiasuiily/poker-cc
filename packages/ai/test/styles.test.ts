import { describe, expect, it } from 'vitest';
import { seededRandomInt } from '@poker/core';
import { BOT_STYLES, STYLE_NAMES, collectStats, getBot, makeBeginnerBot, randomStyle, simulate, type SeatStats, type StyleId } from '../src/index.js';

describe('bot styles', () => {
  // Spec 8.1 values tuned by simulation (lag aggression/looseness, nit aggression, station and maniac looseness, maniac aggression).
  it('presets hold the tuned values', () => {
    expect(BOT_STYLES.tag).toEqual({ id: 'tag', looseness: 0.9, aggression: 1.3, bluff: 1.0, stickiness: 0.9, sizing: 1.0 });
    expect(BOT_STYLES.lag).toEqual({ id: 'lag', looseness: 1.5, aggression: 2.4, bluff: 1.4, stickiness: 1.0, sizing: 1.1 });
    expect(BOT_STYLES.nit).toEqual({ id: 'nit', looseness: 0.6, aggression: 0.8, bluff: 0.3, stickiness: 0.7, sizing: 0.9 });
    expect(BOT_STYLES.station).toEqual({ id: 'station', looseness: 1.8, aggression: 0.5, bluff: 0.4, stickiness: 1.8, sizing: 0.8 });
    expect(BOT_STYLES.maniac).toEqual({ id: 'maniac', looseness: 2.6, aggression: 2.9, bluff: 2.5, stickiness: 1.2, sizing: 1.4 });
    expect(STYLE_NAMES).toEqual({ tag: '紧凶', lag: '松凶', nit: '岩石', station: '跟注站', maniac: '疯子' });
  });

  it('randomStyle picks one of the presets', () => {
    const r = seededRandomInt(3);
    const seen = new Set(Array.from({ length: 200 }, () => randomStyle(() => r(1000) / 1000)));
    expect([...seen].sort()).toEqual(['lag', 'maniac', 'nit', 'station', 'tag']);
  });

  it('getBot returns a bot of the requested level and style', () => {
    const b = getBot('beginner', 'station');
    expect(b.level).toBe('beginner');
    expect(b.style).toBe('station');
    expect(getBot('beginner', 'station')).toBe(b); // cached
  });

  it('beginner VPIP orders nit < tag < lag < maniac', () => {
    const vpip = (style: StyleId) => {
      const r = seededRandomInt(11);
      const stats = new Map<number, SeatStats>();
      simulate({
        bots: new Array(6).fill(makeBeginnerBot(BOT_STYLES[style])),
        hands: 3000,
        startingStack: 1000,
        smallBlind: 5,
        bigBlind: 10,
        randomInt: r,
        rng: () => r(1_000_000) / 1_000_000,
        onHand: (_s, events) => collectStats(events, stats),
      });
      const all = [...stats.values()].reduce((a, s) => ({ hands: a.hands + s.hands, vpip: a.vpip + s.vpip, pfr: a.pfr + s.pfr }));
      return all.vpip / all.hands;
    };
    const v = { nit: vpip('nit'), tag: vpip('tag'), lag: vpip('lag'), maniac: vpip('maniac') };
    expect(v.nit).toBeLessThan(v.tag);
    expect(v.tag).toBeLessThan(v.lag);
    expect(v.lag).toBeLessThan(v.maniac);
  });

  it('simulate reports per-hand net results', () => {
    const r = seededRandomInt(5);
    const res = simulate({
      bots: new Array(3).fill(makeBeginnerBot(BOT_STYLES.tag)),
      hands: 50,
      startingStack: 1000,
      smallBlind: 5,
      bigBlind: 10,
      randomInt: r,
      rng: () => r(1_000_000) / 1_000_000,
    });
    expect(res.perHandNet).toHaveLength(3);
    expect(res.perHandNet[0]).toHaveLength(50);
    for (let h = 0; h < 50; h++) expect(res.perHandNet.reduce((a, s) => a + s[h]!, 0)).toBe(0);
  });
});
