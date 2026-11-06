import { fullDeck, type Card } from './cards.js';

/** Returns a uniform integer in [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

/**
 * Unbiased Fisher-Yates shuffle. Production callers inject a CSPRNG
 * (node:crypto randomInt); tests inject a seeded PRNG. poker-core itself
 * stays free of node-only imports so the browser can import it.
 */
export function shuffleDeck(randomInt: RandomInt): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  return deck;
}

/** Deterministic PRNG (mulberry32) for tests and simulations. Not for real games. */
export function seededRandomInt(seed: number): RandomInt {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (max) => Math.floor(next() * max);
}
