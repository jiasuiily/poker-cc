export * from './types.js';
export * from './styles.js';
export * from './stats.js';
export * from './beginner.js';
export * from './simulate.js';

import { makeBeginnerBot } from './beginner.js';
import { BOT_STYLES, type StyleId } from './styles.js';
import type { Bot, BotLevel, Rng } from './types.js';

const cache = new Map<string, Bot>();

/** Bot instance for a level + style (cached). Advanced arrives with Task 7; expert in phase 4. */
export function getBot(level: BotLevel, style: StyleId = 'tag'): Bot {
  const key = `${level}:${style}`;
  let bot = cache.get(key);
  if (!bot) {
    bot = makeBeginnerBot(BOT_STYLES[style]);
    cache.set(key, bot);
  }
  return bot;
}

/** Human-like think time so instant folds do not leak hand strength. */
export function thinkTimeMs(rng: Rng, min = 700, max = 2600): number {
  return Math.round(min + rng() * (max - min));
}
