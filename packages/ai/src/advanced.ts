import type { PlayerAction, PlayerView } from '@poker/core';
import {
  ALL_CLASSES,
  chartFor,
  chartFreq,
  combosOfClass,
  handClassOf,
  parseRange,
  type ChartEntry,
  type HandClass,
  inferRanges,
  preflopSituation,
  scoreOptions,
  tableFormat,
  type OptionScore,
} from '@poker/strategy';
import { preflopStrength } from './beginner.js';
import type { BotStyle } from './styles.js';
import type { Bot, Rng } from './types.js';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Range width multiplier = looseness ^ WIDTH_EXP; raise share scales by (aggression/1.3) ^ AGGR_EXP. */
const WIDTH_EXP = 1.5;
const AGGR_EXP = 1.0;

/** All 169 classes, strongest first by preflopStrength, with combo counts. */
const BY_STRENGTH = ALL_CLASSES.map((c) => ({ c, s: preflopStrength(combosOfClass(c)[0]!), n: combosOfClass(c).length })).sort((a, b) => b.s - a.s);

/** Tighter styles keep only the strongest M fraction of the chart's hands (never drop AA). */
function withinShrunk(chart: ChartEntry, cls: HandClass, M: number): boolean {
  const inChart = BY_STRENGTH.filter((x) => chartFreq(chart, x.c).fold < 1);
  let budget = inChart.reduce((a, x) => a + x.n, 0) * M;
  for (const x of inChart) {
    if (x.c === cls) return true;
    budget -= x.n;
    if (budget <= 0) return false;
  }
  return false;
}

/**
 * For a hand outside the chart: is it within the extra width a looser style adds?
 * Extra combos = chartWidth × (M − 1), taken from the strongest hands not in the chart.
 */
function extendsRange(chart: ChartEntry, cls: HandClass, M: number): boolean {
  const inChart = (c: HandClass) => chartFreq(chart, c).fold < 1;
  let chartCombos = 0;
  for (const x of BY_STRENGTH) if (inChart(x.c)) chartCombos += x.n;
  let budget = Math.min(1326 * 0.95 - chartCombos, chartCombos * (M - 1));
  for (const x of BY_STRENGTH) {
    if (inChart(x.c)) continue;
    if (budget <= 0) return false;
    if (x.c === cls) return true;
    budget -= x.n;
  }
  return false;
}

function clampRaise(view: PlayerView, to: number): PlayerAction | null {
  const r = view.legal?.raise;
  if (!r) return null;
  return { kind: 'raise', to: Math.max(r.min, Math.min(r.max, Math.round(to))) };
}

/**
 * Scale a raise target by the style's sizing, without turning an all-in into a near-all-in:
 * all-ins stay all-ins, and a raise that would leave less than 30% of the resulting pot
 * behind becomes an all-in.
 */
export function scaleRaiseTo(view: PlayerView, to: number, sizing: number): number {
  const r = view.legal!.raise!;
  const me = view.seats.find((s) => s.seat === view.viewerSeat)!;
  if (to >= r.max) return r.max;
  let t = Math.max(r.min, Math.min(r.max, Math.round(me.committed + (to - me.committed) * sizing)));
  const potIfCalled = view.pot + 2 * (t - me.committed);
  if (r.max - t < 0.3 * potIfCalled) t = r.max;
  return t;
}

/** Continue ranges facing a 3-bet (depth 2) and a 4-bet or more (depth 3), by style width. */
const CONTINUE = {
  2: { tight: parseRange('QQ+, AKs, AKo'), base: parseRange('TT+, AQs+, AKo'), loose: parseRange('88+, AJs+, KQs, AQo+') },
  3: { tight: parseRange('KK+, AKs'), base: parseRange('QQ+, AKs, AKo'), loose: parseRange('JJ+, AQs+, AKo') },
} as const;
/** Hands that re-raise (rather than flat) at each depth. */
const PREMIUM = { 2: parseRange('QQ+, AKs, AKo'), 3: parseRange('KK+, AKs') } as const;
const RFI_PREMIUM = parseRange('QQ+, AKs, AKo');

/**
 * Advanced bot: approximate-GTO preflop charts adjusted by style, and postflop
 * EV comparison using equity against inferred opponent ranges. Sees only its PlayerView.
 */
export function makeAdvancedBot(st: BotStyle): Bot {
  const { looseness: L, aggression: A, bluff: B, stickiness: S, sizing: Z } = st;

  function preflop(view: PlayerView, rng: Rng): PlayerAction | null {
    const la = view.legal!;
    const me = view.seats.find((s) => s.seat === view.viewerSeat)!;
    const sit = preflopSituation(view, me.seat);
    const chart = chartFor(tableFormat(view.seats.length), sit);
    if (!chart || sit.kind === 'other') return otherSpot(view, rng);
    const cls = handClassOf(me.hole![0], me.hole![1]);
    const f = chartFreq(chart, cls);
    // 1) How often to play: width multiplier from looseness.
    const M = Math.pow(L, WIDTH_EXP);
    let play = f.raise + f.call;
    if (M < 1 && play > 0 && !withinShrunk(chart, cls, M)) play = 0;
    else if (play === 0 && M > 1) play = extendsRange(chart, cls, M) ? 1 : 0;
    // 2) Raise vs call split. First-in: open-raise (only very passive styles limp some
    //    non-premium hands). Facing a raise: chart split shifted by aggression (TAG = 1.3 keeps it).
    const baseRaise = f.raise + f.call > 0 ? f.raise / (f.raise + f.call) : 0.5;
    const raiseShare =
      sit.kind === 'rfi'
        ? A < 0.6 && !RFI_PREMIUM.has(cls)
          ? 0.35
          : 1
        : clamp01(baseRaise * Math.pow(A / 1.3, AGGR_EXP));
    const raise = play * raiseShare;
    const call = play - raise;
    const r = rng();
    if (r < raise) {
      const size = sit.kind === 'rfi' ? 2.5 * view.bigBlind : sit.kind === 'vsOpen' ? 3 * view.currentBet : 2.2 * view.currentBet;
      const a = clampRaise(view, size * Z);
      if (a) return a;
    }
    if (r < raise + call) return la.canCall ? { kind: 'call' } : { kind: 'check' };
    return la.canCheck ? { kind: 'check' } : { kind: 'fold' };
  }

  /**
   * Preflop spots without a chart (limped pots, 4-bets+): a cheap strength rule instead of
   * Monte Carlo. The bar rises with each raise and drops for looser styles.
   */
  function otherSpot(view: PlayerView, rng: Rng): PlayerAction {
    const la = view.legal!;
    const me = view.seats.find((s) => s.seat === view.viewerSeat)!;
    const raises = view.history.filter((e) => e.street === 'preflop' && e.kind === 'raise').length;
    if (raises >= 2) {
      // Facing a 3-bet / 4-bet+: class-based continue ranges (a strength cliff folded KK).
      const depth = raises >= 3 ? 3 : 2;
      const cls = handClassOf(me.hole![0], me.hole![1]);
      const ranges = CONTINUE[depth];
      const cont = L < 0.8 ? ranges.tight : L >= 1.3 ? ranges.loose : ranges.base;
      // Loose styles also continue on raw strength (never tighter than the class range).
      const byStrength = L >= 1.3 && preflopStrength(me.hole!) >= [0.7, 0.8][depth - 2]! * Math.pow(1 / L, 1.2);
      if (!cont.has(cls) && !byStrength) return la.canCheck ? { kind: 'check' } : { kind: 'fold' };
      // Premiums re-raise; very aggressive styles also re-raise some strength-only hands.
      const reraise = PREMIUM[depth].has(cls) ? clamp01(0.4 + 0.3 * (A - 1)) : A >= 2 ? 0.3 : 0;
      if (rng() < reraise) {
        const a = clampRaise(view, raises >= 4 ? Infinity : 2.3 * view.currentBet * Z);
        if (a) return a;
      }
      return la.canCall ? { kind: 'call' } : { kind: 'check' };
    }
    const need = [0.4, 0.55][raises]! * Math.pow(1 / L, 1.2);
    const s = preflopStrength(me.hole!);
    if (s < need) return la.canCheck ? { kind: 'check' } : { kind: 'fold' };
    if (s >= need + (A >= 2 ? 0.05 : 0.2) && rng() < clamp01(0.5 * Math.pow(A / 1.3, AGGR_EXP))) {
      const a = clampRaise(view, (raises === 0 ? 4 * view.bigBlind : 2.5 * view.currentBet) * Z);
      if (a) return a;
    }
    return la.canCall ? { kind: 'call' } : { kind: 'check' };
  }

  function postflop(view: PlayerView, rng: Rng): PlayerAction {
    const la = view.legal!;
    const me = view.seats.find((s) => s.seat === view.viewerSeat)!;
    const randomInt = (max: number) => Math.min(max - 1, Math.floor(rng() * max));
    const ranges = inferRanges(view, me.seat);
    const { options } = scoreOptions(view, ranges, { iterations: 1500, randomInt });
    const bestEv = Math.max(...options.map((o) => o.ev ?? -Infinity));
    // Among near-equal options, lean towards the style's preference.
    const bias = (o: OptionScore) =>
      o.action.kind === 'raise' ? 0.15 * (A - 1) : o.action.kind === 'call' ? 0.15 * (S - 1) : o.action.kind === 'fold' ? -0.15 * (S - 1) : 0;
    const near = options.filter((o) => (o.ev ?? -Infinity) >= bestEv - 0.3);
    let pick = near.reduce((a, b) => ((b.ev ?? 0) + bias(b) > (a.ev ?? 0) + bias(a) ? b : a)).action;
    if (pick.kind === 'check' && la.raise && rng() < 0.1 * B) {
      pick = clampRaise(view, me.committed + view.pot * 0.5 * Z) ?? pick;
    } else if (pick.kind === 'raise') {
      pick = { kind: 'raise', to: scaleRaiseTo(view, pick.to, Z) };
    }
    return pick;
  }

  return {
    level: 'advanced',
    style: st.id,
    decide(view: PlayerView, rng: Rng): PlayerAction {
      if (!view.legal) throw new Error('decide() called when it is not our turn');
      if (view.street === 'preflop') {
        const a = preflop(view, rng);
        if (a) return a;
      }
      return postflop(view, rng);
    },
  };
}
