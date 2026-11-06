import type { PlayerView } from '@poker/core';
import type { HandClass } from './handClass.js';
import { positionsOf, tableFormat, type Position, type TableFormat } from './positions.js';
import { mergeRanges, parseRange, type Range } from './range.js';

/**
 * Approximate GTO preflop charts. Written from widely published heuristics (widths per
 * position), NOT copied from any commercial solver output. Labelled "approximate" in the UI.
 */

export type PreflopSituation =
  | { kind: 'rfi'; pos: Position }
  | { kind: 'vsOpen'; pos: Position; opener: Position }
  | { kind: 'vs3bet'; pos: Position }
  | { kind: 'other' };

/** fold = 1 − raise − call. */
export interface ChartEntry {
  raise: Range;
  call: Range;
}

/** Full-weight classes plus optional half-weight (mixed) classes. */
const R = (full: string, half = ''): Range => mergeRanges(parseRange(full), half ? parseRange(half, 0.5) : new Map());
const E = (raise: Range, call: Range = new Map()): ChartEntry => ({ raise, call });

const RFI_SHARED = {
  CO: R('33+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, KTo+, QTo+, JTo'),
  BTN: R('22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T8o+, 98o, 87o'),
  SB: R('22+, A2s+, K3s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A3o+, K9o+, Q9o+, J9o+, T9o'),
};

const RFI: Record<TableFormat, Partial<Record<Position, Range>>> = {
  '6max': {
    UTG: R('66+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, 65s, AJo+, KQo', '55, ATo, KJo'),
    HJ: R('55+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, 54s, ATo+, KJo+, QJo'),
    ...RFI_SHARED,
  },
  '9max': {
    UTG: R('77+, A9s+, KTs+, QTs+, JTs, T9s, AJo+, KQo'),
    UTG1: R('77+, A8s+, A5s, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo', '66, A4s'),
    MP: R('66+, A7s+, A5s-A4s, K9s+, QTs+, J9s+, T9s, 98s, 87s, ATo+, KQo'),
    LJ: R('55+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+'),
    HJ: R('55+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, 54s, ATo+, KJo+, QJo, A9o'),
    ...RFI_SHARED,
  },
  hu: {
    SB: R(
      '22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 73s+, 63s+, 52s+, 42s+, A2o+, K2o+, Q2o+, J4o+, T6o+, 96o+, 86o+, 75o+, 65o',
      'J2o-J3o, T4o-T5o, 94o-95o, 84o-85o, 74o, 64o, 54o',
    ),
  },
};

type OpenerGroup = 'early' | 'middle' | 'late' | 'sb';
type HeroKind = 'IP' | 'SB' | 'BB';

const VS_OPEN: Record<OpenerGroup, Partial<Record<HeroKind, ChartEntry>>> = {
  early: {
    IP: E(R('QQ+, AKs, AKo', 'A5s, JJ'), R('JJ-77, AQs-ATs, KQs, KJs, QJs, JTs, T9s, AQo')),
    SB: E(R('QQ+, AKs, AKo, A5s', 'JJ, AQs')),
    BB: E(
      R('QQ+, AKs, AKo', 'A5s, JJ'),
      R('JJ-22, A2s-AQs, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, AJo-AQo, KQo, KJo'),
    ),
  },
  middle: {
    IP: E(R('JJ+, AQs+, AKo, A5s-A4s', 'TT, KQs, AQo'), R('TT-66, AJs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo')),
    SB: E(R('JJ+, AQs+, AKo, A5s-A4s, KQs', 'TT, AJs, AQo')),
    BB: E(
      R('JJ+, AQs+, AKo, A5s-A4s', 'TT, KQs'),
      R('TT-22, A2s-AJs, K8s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, ATo-AQo, KJo+, QJo'),
    ),
  },
  late: {
    IP: E(R('TT+, AJs+, KQs, A5s-A4s, AQo+', '99, ATs, KJs, AJo'), R('99-22, ATs-A6s, KTs-KJs, QTs+, J9s+, T9s, 98s, 87s, AJo, KQo')),
    SB: E(R('TT+, ATs+, KTs+, QTs+, JTs, A5s-A4s, AJo+, KQo', '99-88, A9s, K9s')),
    BB: E(
      R('TT+, AJs+, KQs, A5s-A4s, AQo+', '99, K9s, 76s'),
      R(
        '99-22, A2s-ATs, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o-AJo, K8o+, Q9o+, J9o+, T9o, 98o',
      ),
    ),
  },
  sb: {
    BB: E(
      R('99+, ATs+, KTs+, A5s-A2s, AJo+, KQo', '88, QJs, 76s, 65s'),
      R('88-22, A2s-A9s, K2s-K9s, Q2s+, J5s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o-ATo, K5o+, Q8o+, J8o+, T8o+, 98o'),
    ),
  },
};

const HU_BB_VS_OPEN = E(
  R('88+, A8s+, KTs+, QJs, A5s-A2s, ATo+, KJo+', '77, K9s, QTs, JTs'),
  R(
    '77-22, A2s-A7s, K2s-K9s, Q2s-QTs, J2s+, T2s+, 92s+, 82s+, 73s+, 62s+, 52s+, 42s+, 32s, A2o-A9o, K2o-KTo, Q2o+, J5o+, T6o+, 96o+, 86o+, 75o+, 65o, 54o',
  ),
);

const VS_3BET: Record<'ring' | 'hu', ChartEntry> = {
  ring: E(R('KK+, AKs', 'QQ, AKo, A5s'), R('QQ-99, AKo, AQs, AJs, KQs', 'JTs, AQo')),
  hu: E(R('QQ+, AKs, AKo', 'JJ, A5s-A2s'), R('JJ-55, A9s+, KTs+, QTs+, JTs, T9s, 98s, AJo-AQo, KQo, KJo')),
};

function openerGroup(p: Position): OpenerGroup {
  if (p === 'UTG' || p === 'UTG1' || p === 'MP') return 'early';
  if (p === 'LJ' || p === 'HJ') return 'middle';
  if (p === 'SB') return 'sb';
  return 'late';
}

export function chartFor(format: TableFormat, s: PreflopSituation): ChartEntry | null {
  switch (s.kind) {
    case 'rfi': {
      const raise = RFI[format][s.pos];
      return raise ? E(raise) : null;
    }
    case 'vsOpen': {
      if (format === 'hu') return s.pos === 'BB' ? HU_BB_VS_OPEN : null;
      const kind: HeroKind = s.pos === 'BB' ? 'BB' : s.pos === 'SB' ? 'SB' : 'IP';
      return VS_OPEN[openerGroup(s.opener)][kind] ?? null;
    }
    case 'vs3bet':
      return VS_3BET[format === 'hu' ? 'hu' : 'ring'];
    default:
      return null;
  }
}

/** Call weight is capped so raise + call never exceeds 1. */
export function chartFreq(e: ChartEntry, cls: HandClass): { raise: number; call: number; fold: number } {
  const raise = e.raise.get(cls) ?? 0;
  const call = Math.min(e.call.get(cls) ?? 0, 1 - raise);
  return { raise, call, fold: 1 - raise - call };
}

/** Every chart, for validation and tooling. */
export function allCharts(): { format: TableFormat; situation: PreflopSituation; entry: ChartEntry }[] {
  const out: { format: TableFormat; situation: PreflopSituation; entry: ChartEntry }[] = [];
  for (const format of ['6max', '9max', 'hu'] as TableFormat[]) {
    for (const [pos, raise] of Object.entries(RFI[format])) out.push({ format, situation: { kind: 'rfi', pos: pos as Position }, entry: E(raise!) });
    out.push({ format, situation: { kind: 'vs3bet', pos: 'UTG' }, entry: VS_3BET[format === 'hu' ? 'hu' : 'ring'] });
  }
  for (const [group, kinds] of Object.entries(VS_OPEN)) {
    for (const [kind, entry] of Object.entries(kinds)) {
      out.push({ format: '6max', situation: { kind: 'vsOpen', pos: kind === 'IP' ? 'BTN' : (kind as Position), opener: group === 'sb' ? 'SB' : group === 'early' ? 'UTG' : group === 'middle' ? 'HJ' : 'CO' }, entry: entry! });
    }
  }
  out.push({ format: 'hu', situation: { kind: 'vsOpen', pos: 'BB', opener: 'SB' }, entry: HU_BB_VS_OPEN });
  return out;
}

/** Classify the preflop spot for `seat` from the public action history. */
export function preflopSituation(view: PlayerView, seat: number): PreflopSituation {
  const pos = positionsOf(view);
  const me = pos.get(seat);
  if (!me) return { kind: 'other' };
  const pre = view.history.filter((e) => e.street === 'preflop');
  const raises = pre.filter((e) => e.kind === 'raise');
  if (raises.length === 0) {
    return pre.some((e) => e.kind === 'call') ? { kind: 'other' } : { kind: 'rfi', pos: me };
  }
  if (raises.length === 1) {
    const opener = raises[0]!;
    if (opener.seat === seat) return { kind: 'other' };
    if (pre.indexOf(opener) > 0 && pre.slice(0, pre.indexOf(opener)).some((e) => e.kind === 'call')) return { kind: 'other' };
    return { kind: 'vsOpen', pos: me, opener: pos.get(opener.seat)! };
  }
  if (raises.length === 2 && raises[0]!.seat === seat) return { kind: 'vs3bet', pos: me };
  return { kind: 'other' };
}

