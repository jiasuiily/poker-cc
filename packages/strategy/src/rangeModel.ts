import { Category, categoryOf, evaluate, rankOf, suitOf, type ActionLogEntry, type Card, type PlayerView } from '@poker/core';
import { chartFor, preflopSituation, type PreflopSituation } from './charts.js';
import { ALL_CLASSES } from './handClass.js';
import { positionsOf, tableFormat } from './positions.js';
import { parseRange, rangeCombos, type Range, type WeightedCombo } from './range.js';

export interface StrengthBucket {
  combo: WeightedCombo;
  /** Percentile of made-hand strength within the given combos: 0 = weakest, 1 = strongest. */
  pct: number;
  /** Flush draw or open-ended straight draw that uses a hole card (only before the river). */
  draw: boolean;
}

/** Default range for limps / calls without a matching chart. */
export const LIMP_RANGE = parseRange(
  '22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, A9o+, KTo+, QTo+, JTo',
);
/** Raises in spots without a chart (iso-raises, 4-bets+). */
const STRONG_RANGE = parseRange('TT+, AJs+, KQs, AQo+');
const ANY_RANGE = parseRange(ALL_CLASSES.join(','));

export function bucketize(combos: WeightedCombo[], board: Card[]): StrengthBucket[] {
  if (combos.length === 0) return [];
  const values = combos.map((c) => evaluate([...c.cards, ...board]));
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const pct = new Array<number>(combos.length);
  const n = combos.length;
  // Ties share the average rank.
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && order[j + 1]![0] === order[i]![0]) j++;
    const p = n === 1 ? 1 : (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) pct[order[k]![1]] = p;
    i = j + 1;
  }
  return combos.map((combo, i) => ({
    combo,
    pct: pct[i]!,
    draw: board.length < 5 && categoryOf(values[i]!) < Category.Straight && hasDraw(combo.cards, board),
  }));
}

function hasDraw(hole: [Card, Card], board: Card[]): boolean {
  const all = [...hole, ...board];
  for (let s = 0; s < 4; s++) {
    if (all.filter((c) => suitOf(c) === s).length === 4 && hole.some((c) => suitOf(c) === s)) return true;
  }
  let mask = 0;
  for (const c of all) mask |= 1 << rankOf(c);
  const holeMask = (1 << rankOf(hole[0])) | (1 << rankOf(hole[1]));
  // Four in a row with both ends open (ranks 2..A; A-high/A-low ends are not open).
  for (let lo = 1; lo + 3 <= 11; lo++) {
    const run = 0b1111 << lo;
    if ((mask & run) === run && (holeMask & run) !== 0 && !(mask & (1 << (lo - 1))) && !(mask & (1 << (lo + 4)))) return true;
  }
  return false;
}

/** Pot at the start of each street, reconstructed from blinds + the public log. */
function streetStartPots(view: PlayerView): Record<ActionLogEntry['street'], number> {
  const pots = { preflop: 0, flop: 0, turn: 0, river: 0 };
  const committed = new Map<number, number>();
  committed.set(view.sbSeat, view.smallBlind);
  committed.set(view.bbSeat, view.bigBlind);
  let pot = 0;
  let street: ActionLogEntry['street'] = 'preflop';
  const flush = () => {
    for (const v of committed.values()) pot += v;
    committed.clear();
  };
  for (const e of view.history) {
    if (e.street !== street) {
      flush();
      street = e.street;
      pots[street] = pot;
    }
    if (e.kind !== 'fold' && e.kind !== 'check') committed.set(e.seat, Math.max(committed.get(e.seat) ?? 0, e.to));
  }
  return pots;
}

function preflopRange(view: PlayerView, seat: number): Range {
  const pre = view.history.filter((e) => e.street === 'preflop');
  let last: ActionLogEntry | null = null;
  let sit: PreflopSituation = { kind: 'other' };
  for (let i = 0; i < pre.length; i++) {
    if (pre[i]!.seat !== seat) continue;
    last = pre[i]!;
    sit = preflopSituation({ ...view, history: pre.slice(0, i) }, seat);
  }
  if (!last || last.kind === 'check') return ANY_RANGE; // BB option / no voluntary action
  const chart = chartFor(tableFormat(view.seats.length), sit);
  if (last.kind === 'raise' || last.kind === 'bet') return chart?.raise.size ? chart.raise : STRONG_RANGE;
  if (last.kind === 'call') return chart?.call.size ? chart.call : LIMP_RANGE;
  return ANY_RANGE;
}

const BOARD_LEN = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;

/**
 * Estimate each live opponent's range from position, preflop charts and postflop actions.
 * Heuristic (spec §6.2): bets/raises keep the top X% + draws and down-weight the rest by Y;
 * calls favour the middle; checks down-weight the strongest 20%.
 */
export function inferRanges(view: PlayerView, heroSeat: number): Map<number, WeightedCombo[]> {
  const hero = view.seats.find((s) => s.seat === heroSeat);
  const dead = [...(hero?.hole ?? []), ...view.board];
  const pots = streetStartPots(view);
  positionsOf(view); // validates table shape
  const out = new Map<number, WeightedCombo[]>();
  for (const s of view.seats) {
    if (s.seat === heroSeat || s.folded) continue;
    let combos = rangeCombos(preflopRange(view, s.seat), dead).map((c) => ({ ...c }));
    for (const e of view.history) {
      if (e.seat !== s.seat || e.street === 'preflop') continue;
      const board = view.board.slice(0, BOARD_LEN[e.street]);
      const buckets = bucketize(combos, board);
      let mult: (b: StrengthBucket) => number;
      if (e.kind === 'bet' || e.kind === 'raise') {
        const ratio = e.to / Math.max(1, pots[e.street]);
        const [x, y] = ratio <= 0.5 ? [0.45, 0.25] : ratio <= 1 ? [0.35, 0.2] : [0.25, 0.15];
        mult = (b) => (b.pct >= 1 - x || b.draw ? 1 : y);
      } else if (e.kind === 'call') {
        mult = (b) => (b.pct >= 0.3 && b.pct <= 0.85 ? 1 : 0.4);
      } else if (e.kind === 'check') {
        mult = (b) => (b.pct > 0.8 ? 0.3 : 1);
      } else continue;
      combos = buckets.map((b) => ({ cards: b.combo.cards, w: b.combo.w * mult(b) })).filter((c) => c.w > 0);
    }
    out.set(s.seat, combos);
  }
  return out;
}
