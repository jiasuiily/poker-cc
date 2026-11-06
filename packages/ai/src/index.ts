export * from './types.js';
export * from './beginner.js';
export * from './simulate.js';

import { beginnerBot } from './beginner.js';
import type { Bot, BotLevel, Rng } from './types.js';

export function getBot(level: BotLevel): Bot {
  // Advanced / expert arrive in phase 4; until then everyone plays the beginner strategy.
  void level;
  return beginnerBot;
}

/** Human-like think time so instant folds do not leak hand strength. */
export function thinkTimeMs(rng: Rng, min = 700, max = 2600): number {
  return Math.round(min + rng() * (max - min));
}
