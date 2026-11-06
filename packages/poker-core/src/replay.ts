import type { Card } from './cards.js';
import { applyAction, startHand } from './hand.js';
import type { ActionLogEntry, HandEvent } from './types.js';
import { projectView, type PlayerView } from './view.js';

export type ReplayFrame =
  | { kind: 'start'; view: PlayerView }
  | { kind: 'action'; entry: ActionLogEntry; view: PlayerView }
  | { kind: 'street'; street: 'flop' | 'turn' | 'river'; cards: Card[]; view: PlayerView };

/**
 * Rebuild a hand step by step from its event log, projecting every frame for
 * `viewerSeat` (null = spectator). Frames never contain more than that viewer saw live.
 */
export function buildReplayFrames(events: readonly HandEvent[], viewerSeat: number | null): ReplayFrame[] {
  const [first, ...rest] = events;
  if (!first || first.type !== 'HandStarted') throw new Error('First event must be HandStarted');
  let s = startHand(first);
  const frames: ReplayFrame[] = [{ kind: 'start', view: projectView(s, viewerSeat) }];
  for (const ev of rest) {
    if (ev.type !== 'Action') continue;
    const boardBefore = s.board.length;
    s = applyAction(s, ev.seat, ev.action);
    const view = projectView(s, viewerSeat);
    const entry = s.log[s.log.length - 1]!;
    const sizes = [3, 4, 5].filter((n) => n > boardBefore && n <= s.board.length);
    if (sizes.length === 0) {
      frames.push({ kind: 'action', entry, view });
      continue;
    }
    // New cards were dealt: show the action against the old board, then one frame per street.
    // Intermediate frames carry no result yet; the last one is the real state.
    const partial = (n: number): PlayerView => ({ ...view, board: view.board.slice(0, n), result: null });
    frames.push({ kind: 'action', entry, view: partial(boardBefore) });
    sizes.forEach((n, i) => {
      const cards = s.board.slice(n === 3 ? 0 : n - 1, n);
      const street = n === 3 ? 'flop' : n === 4 ? 'turn' : 'river';
      frames.push({ kind: 'street', street, cards, view: i === sizes.length - 1 ? view : partial(n) });
    });
  }
  return frames;
}
