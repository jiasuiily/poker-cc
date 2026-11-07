import { cardToString, buildReplayFrames, type Card, type HandEvent, type PlayerAction } from '@poker/core';
import { LEAK_NAMES, type DecisionStreet, type PlayerStats, type StatsExample } from '@poker/strategy';

export interface ExampleView {
  handId: string;
  street: DecisionStreet;
  heroCards: string[];
  board: string[];
  heroAction: string;
  recommended: string;
  evLossBb: number;
  reasons: string[];
}

const KIND = { fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注到' } as const;
const STREET = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌' } as const;
const BOARD_LEN = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;
const act = (a: PlayerAction) => (a.kind === 'raise' ? `加注到 ${a.to}` : KIND[a.kind]);
const cards = (cs: readonly Card[]) => cs.map(cardToString);

/**
 * Describe one example decision from the hero's projected replay frames only (never raw
 * events/state, which contain the deck). The board is cut at the street of the decision.
 */
export function describeExample(events: HandEvent[], heroSeat: number, d: StatsExample): ExampleView {
  const frames = buildReplayFrames(events, heroSeat);
  const last = frames[frames.length - 1]!.view;
  const me = last.seats.find((s) => s.seat === heroSeat);
  return {
    handId: d.handId,
    street: d.street,
    heroCards: me?.hole ? cards(me.hole) : [],
    board: cards(last.board.slice(0, BOARD_LEN[d.street])),
    heroAction: act(d.heroAction),
    recommended: act(d.recommended),
    evLossBb: d.evLossBb,
    reasons: [...d.reasons],
  };
}

export const COACH_SYSTEM_PROMPT =
  '你是德州扑克教练。只依据给出的统计数据和例子手点评，不要编造胜率、范围或牌面。用中文，不超过 800 字。' +
  '先用一段话概括整体水平；然后给出 3 点最该改进的地方，每一点都要引用一个例子手的编号（如「手 xxx」）；' +
  '如果提供了上次的评估，最后单独写一段「与上次相比」，对比数字和上次的建议是否改善。';

const pct = (n: number, d: number) => (d === 0 ? '0%' : `${Math.round((n / d) * 100)}%`);

function statsLines(s: PlayerStats): string[] {
  const lines = [
    `手数 ${s.hands}，决策点 ${s.decisions}：合理 ${s.good}（${pct(s.good, s.decisions)}），可以更好 ${s.ok}，失误 ${s.mistake}（${pct(s.mistake, s.decisions)}）。`,
    `平均每手估计亏损 ${s.evLossPerHand.toFixed(2)}bb。`,
    `分街失误：${(['preflop', 'flop', 'turn', 'river'] as const).map((k) => `${STREET[k]} ${s.byStreet[k].mistakes}/${s.byStreet[k].decisions}`).join('，')}。`,
  ];
  lines.push(s.leaks.length ? `主要漏洞：${s.leaks.map((l) => `${LEAK_NAMES[l.kind]} ${l.count} 次（亏 ${l.evLossBb.toFixed(1)}bb）`).join('；')}。` : '没有明显漏洞。');
  return lines;
}

export function buildCoachPrompt(
  stats: PlayerStats,
  examples: ExampleView[],
  previous: { stats: PlayerStats; text: string; createdAt: string } | null,
): { system: string; user: string } {
  const lines: string[] = ['我的整体统计：', ...statsLines(stats), '', '例子手（我的失误，按亏损从大到小）：'];
  if (examples.length === 0) lines.push('暂无。');
  examples.forEach((e, i) => {
    lines.push(
      `${i + 1}. 手 ${e.handId}，${STREET[e.street]}，我的底牌 ${e.heroCards.join(' ') || '未知'}，公共牌 ${e.board.join(' ') || '无'}：我选择${e.heroAction}，建议${e.recommended}，估计亏损 ${e.evLossBb.toFixed(1)}bb。理由：${e.reasons.join('；')}`,
    );
  });
  if (previous) {
    lines.push('', `上次评估（${previous.createdAt}）的统计：`, ...statsLines(previous.stats), '上次的评估原文：', previous.text);
  }
  return { system: COACH_SYSTEM_PROMPT, user: lines.join('\n') };
}
