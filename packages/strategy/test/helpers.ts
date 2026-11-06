import { applyAction, parseCards, projectView, seededRandomInt, shuffleDeck, startHand, type Card, type HandEvent, type HandState, type PlayerAction, type PlayerView } from '@poker/core';

/**
 * Start a hand with `n` players (seats 0..n-1, 1000 chips, blinds 5/10), button at `button`.
 * Optional `hero` fixes the hole cards of seat `hero.seat` (other cards are shuffled around them).
 */
export function startTable(n: number, button: number, hero?: { seat: number; cards: string }, board?: string, seed = 1) {
  let deck = shuffleDeck(seededRandomInt(seed));
  const pinned: [number, Card][] = [];
  const sbIdx = n === 2 ? button : (button + 1) % n;
  if (hero) {
    const k = (hero.seat - sbIdx + n) % n;
    const [a, b] = parseCards(hero.cards);
    pinned.push([k, a!], [n + k, b!]);
  }
  if (board) {
    const cards = parseCards(board);
    [2 * n + 1, 2 * n + 2, 2 * n + 3, 2 * n + 5, 2 * n + 7].slice(0, cards.length).forEach((pos, i) => pinned.push([pos, cards[i]!]));
  }
  for (const [pos, card] of pinned) {
    const j = deck.indexOf(card);
    [deck[pos], deck[j]] = [deck[j]!, deck[pos]!];
  }
  // Re-pin in order so later swaps cannot displace earlier pins.
  deck = [...deck];
  for (const [pos, card] of pinned) {
    const j = deck.indexOf(card);
    [deck[pos], deck[j]] = [deck[j]!, deck[pos]!];
  }
  const ev: HandEvent = {
    type: 'HandStarted',
    handId: 't',
    config: { smallBlind: 5, bigBlind: 10 },
    seats: Array.from({ length: n }, (_, seat) => ({ seat, playerId: `p${seat}`, stack: 1000 })),
    button,
    deck,
  };
  return { state: startHand(ev), events: [ev] as HandEvent[] };
}

export function play(g: { state: HandState; events: HandEvent[] }, ...actions: PlayerAction[]) {
  for (const action of actions) {
    const seat = g.state.toAct!;
    g.events.push({ type: 'Action', seat, seq: g.state.actionSeq, action });
    g.state = applyAction(g.state, seat, action);
  }
  return g;
}

/** View for whoever is to act now. */
export const viewNow = (g: { state: HandState }): PlayerView => projectView(g.state, g.state.toAct);

export const F: PlayerAction = { kind: 'fold' };
export const C: PlayerAction = { kind: 'call' };
export const X: PlayerAction = { kind: 'check' };
export const R = (to: number): PlayerAction => ({ kind: 'raise', to });
