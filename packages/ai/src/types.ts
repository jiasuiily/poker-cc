import type { PlayerAction, PlayerView } from '@poker/core';
import type { StyleId } from './styles.js';

/** Uniform float in [0, 1). */
export type Rng = () => number;

export type BotLevel = 'beginner' | 'advanced' | 'expert';

/**
 * Every bot sees exactly what a human in its seat would see (the same projectView),
 * and must return one of the legal actions in view.legal.
 */
export interface Bot {
  level: BotLevel;
  style: StyleId;
  decide(view: PlayerView, rng: Rng): PlayerAction;
}
