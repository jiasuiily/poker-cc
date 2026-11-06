import { evaluate, seededRandomInt, type Card, type RandomInt } from '@poker/core';
import type { WeightedCombo } from './range.js';

const SCALE = 1 << 30;

/** Cumulative-weight sampler over one villain's combos. */
class Sampler {
  private cum: number[] = [];
  private total = 0;
  constructor(readonly combos: WeightedCombo[]) {
    for (const c of combos) {
      this.total += c.w;
      this.cum.push(this.total);
    }
  }
  get empty() {
    return this.total <= 0;
  }
  pick(randomInt: RandomInt): WeightedCombo {
    const x = (randomInt(SCALE) / SCALE) * this.total;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! > x) hi = mid;
      else lo = mid + 1;
    }
    return this.combos[lo]!;
  }
}

/**
 * Monte Carlo equity of `hero` against one weighted range per opponent.
 * Ties are split between the tied players. Iterations whose villain cards cannot be
 * drawn without conflicts (after 20 retries) are skipped.
 */
export function equityVsRanges(
  hero: [Card, Card],
  board: Card[],
  villains: WeightedCombo[][],
  opts: { iterations?: number; randomInt?: RandomInt } = {},
): number {
  const iterations = opts.iterations ?? 4000;
  const randomInt = opts.randomInt ?? seededRandomInt(1);
  const samplers = villains.map((v) => new Sampler(v));
  if (samplers.length === 0 || samplers.some((s) => s.empty)) return 1;

  const baseDead = new Uint8Array(52);
  for (const c of [...hero, ...board]) baseDead[c] = 1;
  const need = 5 - board.length;
  const dead = new Uint8Array(52);
  const deck: Card[] = new Array(52);
  const full = [0, 0, 0, 0, 0, 0, 0];
  const vCards: Card[][] = samplers.map(() => [0, 0]);

  let score = 0;
  let done = 0;
  for (let it = 0; it < iterations; it++) {
    dead.set(baseDead);
    let ok = true;
    for (let v = 0; v < samplers.length && ok; v++) {
      let tries = 0;
      for (;;) {
        const c = samplers[v]!.pick(randomInt).cards;
        if (!dead[c[0]] && !dead[c[1]]) {
          dead[c[0]] = 1;
          dead[c[1]] = 1;
          vCards[v]![0] = c[0];
          vCards[v]![1] = c[1];
          break;
        }
        if (++tries >= 20) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;

    // Deal the rest of the board with a partial Fisher-Yates over the live cards.
    let n = 0;
    for (let c = 0; c < 52; c++) if (!dead[c]) deck[n++] = c;
    for (let i = 0; i < need; i++) {
      const j = i + randomInt(n - i);
      const t = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = t;
    }
    for (let i = 0; i < board.length; i++) full[2 + i] = board[i]!;
    for (let i = 0; i < need; i++) full[2 + board.length + i] = deck[i]!;

    full[0] = hero[0];
    full[1] = hero[1];
    const mine = evaluate(full);
    let best = mine;
    let tied = 1;
    let heroBest = true;
    for (const vc of vCards) {
      full[0] = vc[0]!;
      full[1] = vc[1]!;
      const val = evaluate(full);
      if (val > best) {
        best = val;
        heroBest = false;
        tied = 1;
      } else if (val === best) {
        tied++;
      }
    }
    if (heroBest && best === mine) score += 1 / tied;
    done++;
  }
  return done === 0 ? 0 : score / done;
}
