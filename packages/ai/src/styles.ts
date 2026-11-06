import type { Rng } from './types.js';

export type StyleId = 'tag' | 'lag' | 'nit' | 'station' | 'maniac';

export interface BotStyle {
  id: StyleId;
  /** Preflop range width multiplier (1 = standard). */
  looseness: number;
  /** Tendency to bet/raise rather than call. */
  aggression: number;
  /** Bluff frequency multiplier. */
  bluff: number;
  /** Tendency to keep calling when facing bets. */
  stickiness: number;
  /** Bet size multiplier. */
  sizing: number;
}

/** Initial values from the spec (section 8.1); tuned against simulated VPIP/PFR. */
export const BOT_STYLES: Record<StyleId, BotStyle> = {
  tag: { id: 'tag', looseness: 0.9, aggression: 1.3, bluff: 1.0, stickiness: 0.9, sizing: 1.0 },
  lag: { id: 'lag', looseness: 1.4, aggression: 1.5, bluff: 1.4, stickiness: 1.0, sizing: 1.1 },
  nit: { id: 'nit', looseness: 0.6, aggression: 0.7, bluff: 0.3, stickiness: 0.7, sizing: 0.9 },
  station: { id: 'station', looseness: 1.5, aggression: 0.5, bluff: 0.4, stickiness: 1.8, sizing: 0.8 },
  maniac: { id: 'maniac', looseness: 2.0, aggression: 2.2, bluff: 2.5, stickiness: 1.2, sizing: 1.4 },
};

export const STYLE_IDS = Object.keys(BOT_STYLES) as StyleId[];

export const STYLE_NAMES: Record<StyleId, string> = {
  tag: '紧凶',
  lag: '松凶',
  nit: '岩石',
  station: '跟注站',
  maniac: '疯子',
};

export function randomStyle(rng: Rng): StyleId {
  return STYLE_IDS[Math.min(STYLE_IDS.length - 1, Math.floor(rng() * STYLE_IDS.length))]!;
}

export function isStyleId(x: unknown): x is StyleId {
  return typeof x === 'string' && x in BOT_STYLES;
}
