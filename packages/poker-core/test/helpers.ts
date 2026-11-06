import { fullDeck, parseCards, startHand, applyAction, type Card, type HandEvent, type HandState, type PlayerAction } from '../src/index.js';

/**
 * Build a deck: `holes` are hole-card strings in deal order starting from the small blind
 * (heads-up: the button). Board is 5 cards; burns are filled with leftovers.
 */
export function stackDeck(holes: string[], board: string): Card[] {
  const n = holes.length;
  const h = holes.map((x) => parseCards(x));
  const b = parseCards(board);
  const deck: (Card | null)[] = new Array(52).fill(null);
  h.forEach((cards, k) => {
    deck[k] = cards[0]!;
    deck[n + k] = cards[1]!;
  });
  const bpos = [2 * n + 1, 2 * n + 2, 2 * n + 3, 2 * n + 5, 2 * n + 7];
  bpos.forEach((pos, i) => (deck[pos] = b[i]!));
  const used = new Set(deck.filter((c): c is Card => c !== null));
  const rest = fullDeck().filter((c) => !used.has(c));
  return deck.map((c) => (c === null ? rest.shift()! : c));
}

export function start(opts: {
  stacks: number[];
  holes: string[];
  board?: string;
  button?: number;
  sb?: number;
  bb?: number;
}): { state: HandState; events: HandEvent[] } {
  const ev: HandEvent = {
    type: 'HandStarted',
    handId: 'h1',
    config: { smallBlind: opts.sb ?? 5, bigBlind: opts.bb ?? 10 },
    seats: opts.stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack })),
    button: opts.button ?? 0,
    deck: stackDeck(opts.holes, opts.board ?? '8d 9d Tc 3h 4h'),
  };
  return { state: startHand(ev), events: [ev] };
}

export function act(g: { state: HandState; events: HandEvent[] }, seat: number, action: PlayerAction) {
  const ev: HandEvent = { type: 'Action', seat, seq: g.state.actionSeq, action };
  g.state = applyAction(g.state, seat, action);
  g.events.push(ev);
  return g;
}

export const chipsInPlay = (s: HandState) => s.players.reduce((a, p) => a + p.stack + p.totalCommitted, 0);
export const startTotal = (s: HandState) => s.players.reduce((a, p) => a + p.startStack, 0);
export const finalOf = (s: HandState, seat: number) => s.result!.finalStacks.find((f) => f.seat === seat)!.stack;
