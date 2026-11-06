/**
 * Batch simulation: pnpm sim [hands] [players]
 * Zero think-time self-play, checks chip conservation each hand and prints bb/100.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';
import { beginnerBot, simulate } from '../src/index.js';

const hands = Number(process.argv[2] ?? 10_000);
const players = Number(process.argv[3] ?? 6);
const t0 = performance.now();
const res = simulate({
  bots: new Array(players).fill(beginnerBot),
  hands,
  startingStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
  randomInt: (max) => cryptoRandomInt(max),
  rng: Math.random,
  onHand: (s) => {
    const start = s.players.reduce((a, p) => a + p.startStack, 0);
    const end = s.result!.finalStacks.reduce((a, f) => a + f.stack, 0);
    if (start !== end) throw new Error(`Hand ${s.handId}: chips not conserved`);
  },
});
const ms = performance.now() - t0;
console.log(`${hands} hands x ${players} players in ${(ms / 1000).toFixed(1)}s (${((hands / ms) * 1000).toFixed(0)} hands/s)`);
console.log('bb/100 per seat:', res.bbPer100.map((x) => x.toFixed(1)).join('  '));
console.log('chip conservation: OK');
