import { seededRandomInt, type PlayerAction, type PlayerView, type RandomInt, type Street } from '@poker/core';
import { chartFor, chartFreq, preflopSituation } from './charts.js';
import { equityVsRanges } from './equity.js';
import { handClassOf } from './handClass.js';
import { positionsOf, tableFormat } from './positions.js';
import type { WeightedCombo } from './range.js';
import { bucketize, inferRanges } from './rangeModel.js';

export const ENGINE_VERSION = 1;

export interface OptionScore {
  action: PlayerAction;
  /** Expected value in big blinds (EV method). */
  ev?: number;
  /** Chart frequency 0..1 (chart method). */
  freq?: number;
}

export interface DecisionReport {
  street: Street;
  actionSeq: number;
  heroAction: PlayerAction;
  recommended: PlayerAction;
  options: OptionScore[];
  equity?: number;
  potOdds?: number;
  mdf?: number;
  evLossBb: number;
  verdict: 'good' | 'ok' | 'mistake';
  reasons: string[];
  method: 'chart' | 'ev' | 'fallback';
}

const ACTION_NAME: Record<PlayerAction['kind'], string> = { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注' };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const sameAction = (a: PlayerAction, b: PlayerAction) => a.kind === b.kind && (a.kind !== 'raise' || (b.kind === 'raise' && a.to === b.to));

function verdictFromLoss(loss: number): DecisionReport['verdict'] {
  return loss < 0.5 ? 'good' : loss <= 2 ? 'ok' : 'mistake';
}

function heroOf(view: PlayerView) {
  const me = view.seats.find((s) => s.seat === view.viewerSeat);
  if (!me?.hole || !view.legal) throw new Error('evaluate needs the hero view at a decision point');
  return me as typeof me & { hole: [number, number] };
}

/**
 * EV (in bb) of each legal option at this decision, using equity against inferred ranges.
 * Formulas follow spec §6.4.
 */
export function scoreOptions(
  view: PlayerView,
  ranges: Map<number, WeightedCombo[]>,
  opts: { iterations: number; randomInt: RandomInt },
  extraRaise?: number,
): { options: OptionScore[]; equity: number } {
  const me = heroOf(view);
  const la = view.legal!;
  const villains = [...ranges.values()].filter((v) => v.length > 0);
  const equity = equityVsRanges(me.hole, view.board, villains, opts);
  const bb = view.bigBlind;
  const pot = view.pot;
  const options: OptionScore[] = [];
  if (la.canFold) options.push({ action: { kind: 'fold' }, ev: 0 });
  if (la.canCheck) options.push({ action: { kind: 'check' }, ev: (equity * pot * 0.9) / bb });
  if (la.canCall) options.push({ action: { kind: 'call' }, ev: (equity * (pot + la.toCall) - la.toCall) / bb });

  if (la.raise) {
    const { min, max } = la.raise;
    const targets = la.canCheck
      ? [0.5, 2 / 3, 1].map((k) => me.committed + Math.round(pot * k))
      : [view.currentBet * 2.5, view.currentBet + pot + la.toCall].map(Math.round);
    if (extraRaise !== undefined) targets.push(extraRaise);
    const uniq = [...new Set(targets.map((t) => Math.max(min, Math.min(max, t))))];
    for (const to of uniq) {
      const invest = to - me.committed;
      const threshold = 1 - 0.5 * (to / Math.max(1, pot));
      let fe = 1;
      const callRanges: WeightedCombo[][] = [];
      for (const v of villains) {
        const b = bucketize(v, view.board);
        const total = b.reduce((a, x) => a + x.combo.w, 0);
        const folds = b.filter((x) => x.pct < threshold).reduce((a, x) => a + x.combo.w, 0);
        fe *= total > 0 ? folds / total : 0;
        const callers = b.filter((x) => x.pct >= threshold).map((x) => x.combo);
        callRanges.push(callers.length ? callers : v);
      }
      const eqCall = equityVsRanges(me.hole, view.board, callRanges, { iterations: Math.max(500, opts.iterations >> 1), randomInt: opts.randomInt });
      // Called: the villain adds (to - currentBet) on top of what is already in the pot.
      // (Spec: pot + 2*invest, which double-counts an existing bet; equal when nobody has bet.)
      const ev = fe * pot + (1 - fe) * (eqCall * (pot + invest + (to - view.currentBet)) - invest);
      options.push({ action: { kind: 'raise', to }, ev: ev / bb });
    }
  }
  return { options, equity };
}

export function evaluateDecision(
  view: PlayerView,
  heroAction: PlayerAction,
  opts: { iterations?: number; randomInt?: RandomInt } = {},
): DecisionReport {
  const me = heroOf(view);
  const la = view.legal!;
  const iterations = opts.iterations ?? 4000;
  const randomInt = opts.randomInt ?? seededRandomInt(1);
  const base = { street: view.street, actionSeq: view.actionSeq, heroAction };

  if (view.street === 'preflop') {
    const sit = preflopSituation(view, me.seat);
    const chart = chartFor(tableFormat(view.seats.length), sit);
    if (chart && sit.kind !== 'other') {
      const cls = handClassOf(me.hole[0], me.hole[1]);
      const f = chartFreq(chart, cls);
      const raiseTo = la.raise
        ? Math.max(la.raise.min, Math.min(la.raise.max, Math.round(sit.kind === 'rfi' ? 2.5 * view.bigBlind : sit.kind === 'vsOpen' ? 3 * view.currentBet : 2.2 * view.currentBet)))
        : null;
      const options: OptionScore[] = [];
      if (la.canFold) options.push({ action: { kind: 'fold' }, freq: f.fold });
      else if (la.canCheck) options.push({ action: { kind: 'check' }, freq: f.fold + f.call });
      if (la.canCall) options.push({ action: { kind: 'call' }, freq: f.call });
      if (raiseTo !== null) options.push({ action: { kind: 'raise', to: raiseTo }, freq: f.raise });
      const heroFreq = options.find((o) => o.action.kind === heroAction.kind)?.freq ?? 0;
      const best = options.reduce((a, b) => ((b.freq ?? 0) > (a.freq ?? 0) ? b : a));
      const verdict = heroFreq >= 0.3 ? 'good' : heroFreq >= 0.05 ? 'ok' : 'mistake';
      const pos = positionsOf(view).get(me.seat);
      const spot = sit.kind === 'rfi' ? '无人入池' : sit.kind === 'vsOpen' ? `面对 ${sit.opener} 开池` : '面对再加注';
      return {
        ...base,
        recommended: best.action,
        options,
        evLossBb: verdict === 'good' ? 0 : verdict === 'ok' ? 0.5 : 1.5,
        verdict,
        reasons: [
          `${pos} 位置${spot}，${cls} 的参考频率：加注 ${pct(f.raise)}、跟注 ${pct(f.call)}、弃牌 ${pct(f.fold)}`,
          `你选择了${ACTION_NAME[heroAction.kind]}（参考频率 ${pct(heroFreq)}）${verdict === 'good' ? '，符合范围' : `，更常见的打法是${ACTION_NAME[best.action.kind]}`}`,
          '翻前亏损为估计值',
        ],
        method: 'chart',
      };
    }
  }

  const ranges = inferRanges(view, me.seat);
  const { options, equity } = scoreOptions(view, ranges, { iterations, randomInt }, heroAction.kind === 'raise' ? heroAction.to : undefined);
  const best = options.reduce((a, b) => ((b.ev ?? -Infinity) > (a.ev ?? -Infinity) ? b : a));
  const mine = options.find((o) => sameAction(o.action, heroAction)) ?? options.find((o) => o.action.kind === heroAction.kind)!;
  const evLossBb = Math.max(0, (best.ev ?? 0) - (mine.ev ?? 0));
  const potOdds = la.toCall > 0 ? la.toCall / (view.pot + la.toCall) : undefined;
  const before = view.pot - la.toCall;
  const mdf = la.toCall > 0 ? before / (before + la.toCall) : undefined;
  const reasons: string[] = [];
  if (potOdds !== undefined) {
    reasons.push(`胜率约 ${pct(equity)}，${equity >= potOdds ? '高于' : '低于'}底池赔率 ${pct(potOdds)}，${equity >= potOdds ? '跟注有利' : '单纯跟注不划算'}`);
  } else {
    reasons.push(`对对手推断范围的胜率约 ${pct(equity)}`);
  }
  reasons.push(`期望收益最高的选择：${describe(best.action)}（${fmt(best.ev)}bb）`);
  if (evLossBb >= 0.05) reasons.push(`你的选择约少赚 ${evLossBb.toFixed(1)}bb`);
  return {
    ...base,
    recommended: best.action,
    options,
    equity,
    potOdds,
    mdf,
    evLossBb,
    verdict: verdictFromLoss(evLossBb),
    reasons,
    method: view.street === 'preflop' ? 'fallback' : 'ev',
  };
}

function describe(a: PlayerAction): string {
  return a.kind === 'raise' ? `加注到 ${a.to}` : ACTION_NAME[a.kind];
}
const fmt = (x: number | undefined) => (x ?? 0).toFixed(1);
