import { cardToString, type Card, type PlayerAction, type ReplayFrame } from '@poker/core';
import type { DecisionReport } from '@poker/strategy';
import type { HandMeta } from '../history/repo.js';

export const SYSTEM_PROMPT =
  '你是德州扑克教练。只依据给出的数据点评，不要编造胜率、范围或牌面。用中文，不超过 600 字，先总评再逐个决策点说明。';

const STREET = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌', complete: '结束' } as const;
const KIND = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注到' } as const;
const VERDICT = { good: '合理', ok: '可以更好', mistake: '失误' } as const;
const cards = (cs: Card[]) => cs.map(cardToString).join(' ');
const act = (a: PlayerAction) => (a.kind === 'raise' ? `加注到 ${a.to}` : KIND[a.kind]);

/**
 * Build the LLM prompt from the hero's replay frames only. Frames are already projected for
 * the hero, so unshown opponent cards cannot appear here.
 */
export function buildPrompt(meta: HandMeta, frames: ReplayFrame[], decisions: DecisionReport[]): { system: string; user: string } {
  const last = frames[frames.length - 1]!.view;
  const name = (seat: number) => meta.seats.find((s) => s.seat === seat)?.name ?? `座位${seat + 1}`;
  const me = last.seats.find((s) => s.seat === meta.heroSeat);
  const lines: string[] = [];
  lines.push(`牌桌：${meta.tableName}，盲注 ${last.smallBlind}/${last.bigBlind}，${last.seats.length} 人参与。`);
  lines.push(`我是 ${name(meta.heroSeat)}，底牌 ${me?.hole ? cards(me.hole) : '未知'}。`);
  lines.push('', '动作记录：');
  for (const f of frames) {
    if (f.kind === 'street') lines.push(`${STREET[f.street]}：${cards(f.cards)}`);
    if (f.kind === 'action') {
      const e = f.entry;
      lines.push(`- ${STREET[e.street]} ${name(e.seat)} ${KIND[e.kind]}${e.kind === 'bet' || e.kind === 'raise' || e.kind === 'call' ? ` ${e.to}` : ''}${e.allIn ? '（全下）' : ''}`);
    }
  }
  if (last.result) {
    for (const s of last.result.shown) lines.push(`亮牌：${name(s.seat)} ${cards(s.hole)}`);
    for (const p of last.result.pots) for (const w of p.winners) lines.push(`${name(w.seat)} 赢得 ${w.amount}`);
  }
  lines.push('', '本地近似 GTO 分析（只针对我的决策）：');
  if (decisions.length === 0) lines.push('这手没有需要我决策的地方。');
  decisions.forEach((d, i) => {
    const nums = [
      d.equity !== undefined ? `胜率 ${Math.round(d.equity * 100)}%` : '',
      d.potOdds !== undefined ? `底池赔率 ${Math.round(d.potOdds * 100)}%` : '',
      `估计亏损 ${d.evLossBb.toFixed(1)}bb`,
    ].filter(Boolean);
    lines.push(`${i + 1}. ${STREET[d.street]}：我选择${act(d.heroAction)}，建议${act(d.recommended)}，判定「${VERDICT[d.verdict]}」，${nums.join('，')}。理由：${d.reasons.join('；')}`);
  });
  return { system: SYSTEM_PROMPT, user: lines.join('\n') };
}
