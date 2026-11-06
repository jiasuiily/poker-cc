/**
 * AI acceptance: pnpm sim:ai [hands=20000] [styleHands=5000]
 *  1. 6-max: seats 0-2 advanced TAG, seats 3-5 beginner TAG. Prints each group's bb/100 per seat
 *     with a 95% confidence interval (mean ± 1.96·sd/√n over per-hand group results).
 *  2. Each style: 6 advanced bots of that style self-play; prints VPIP / PFR.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';
import { BOT_STYLES, STYLE_IDS, collectStats, makeAdvancedBot, makeBeginnerBot, simulate, type SeatStats } from '../src/index.js';

const hands = Number(process.argv[2] ?? 20_000);
const styleHands = Number(process.argv[3] ?? 5_000);
const bb = 10;
const common = { startingStack: 1000, smallBlind: 5, bigBlind: bb, randomInt: (m: number) => cryptoRandomInt(m), rng: Math.random };

function ci(perHand: number[]): { mean: number; lo: number; hi: number } {
  const n = perHand.length;
  const mean = perHand.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(perHand.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const half = (1.96 * sd) / Math.sqrt(n);
  const k = 100 / bb / 3; // per seat, per 100 hands, in bb
  return { mean: mean * k, lo: (mean - half) * k, hi: (mean + half) * k };
}

let t = performance.now();
const adv = makeAdvancedBot(BOT_STYLES.tag);
const beg = makeBeginnerBot(BOT_STYLES.tag);
// Alternate seats so both groups see every position equally as the button rotates.
const res = simulate({ ...common, bots: [adv, beg, adv, beg, adv, beg], hands });
const group = (seats: number[]) => Array.from({ length: hands }, (_, h) => seats.reduce((a, s) => a + res.perHandNet[s]![h]!, 0));
const a = ci(group([0, 2, 4]));
const b = ci(group([1, 3, 5]));
const f = (x: number) => x.toFixed(1);
console.log(`${hands} hands in ${((performance.now() - t) / 1000).toFixed(0)}s`);
console.log(`advanced TAG: ${f(a.mean)} bb/100  95% CI [${f(a.lo)}, ${f(a.hi)}]`);
console.log(`beginner TAG: ${f(b.mean)} bb/100  95% CI [${f(b.lo)}, ${f(b.hi)}]`);
console.log(a.lo > 0 ? 'PASS: advanced beats beginner' : 'FAIL: CI lower bound not above 0');

for (const id of STYLE_IDS) {
  t = performance.now();
  const stats = new Map<number, SeatStats>();
  const bot = makeAdvancedBot(BOT_STYLES[id]);
  simulate({ ...common, bots: new Array(6).fill(bot), hands: styleHands, onHand: (_s, ev) => collectStats(ev, stats) });
  const all = [...stats.values()].reduce((x, s) => ({ hands: x.hands + s.hands, vpip: x.vpip + s.vpip, pfr: x.pfr + s.pfr }));
  console.log(`${id.padEnd(8)} VPIP ${((all.vpip / all.hands) * 100).toFixed(1)}%  PFR ${((all.pfr / all.hands) * 100).toFixed(1)}%  (${((performance.now() - t) / 1000).toFixed(0)}s)`);
}
