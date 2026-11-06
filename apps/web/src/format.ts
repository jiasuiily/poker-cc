import { rankOf, suitOf, type ActionLogEntry, type Card, type PlayerAction, type ReplayFrame } from '@poker/core';
import type { DecisionReport } from '@poker/strategy';

const RANK = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT = ['♣', '♦', '♥', '♠'];
export const STREET_NAMES = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌', complete: '结束' } as const;

/** 'K♠' */
export const cardText = (c: Card) => `${RANK[rankOf(c)]}${SUIT[suitOf(c)]}`;
export const cardsText = (cs: Card[]) => cs.map(cardText).join(' ');

/** '电脑2号 加注到 60' / '小明 全下 300' */
export function actionText(e: ActionLogEntry, name: string): string {
  if (e.allIn && e.kind !== 'fold' && e.kind !== 'check') return `${name} 全下 ${e.to}`;
  switch (e.kind) {
    case 'fold':
      return `${name} 弃牌`;
    case 'check':
      return `${name} 过牌`;
    case 'call':
      return `${name} 跟注到 ${e.to}`;
    case 'bet':
      return `${name} 下注 ${e.to}`;
    case 'raise':
      return `${name} 加注到 ${e.to}`;
  }
}

export function frameLabel(f: ReplayFrame, names: Map<number, string>): string {
  if (f.kind === 'start') return '发牌，下盲注';
  if (f.kind === 'street') return `${STREET_NAMES[f.street]}：${cardsText(f.cards)}`;
  return actionText(f.entry, names.get(f.entry.seat) ?? `座位${f.entry.seat + 1}`);
}

export const verdictMark = (v: DecisionReport['verdict']) => (v === 'good' ? '🟢' : v === 'ok' ? '🟡' : '🔴');
export const verdictText = (v: DecisionReport['verdict']) => (v === 'good' ? '合理' : v === 'ok' ? '可以更好' : '失误');

export function playerActionText(a: PlayerAction): string {
  return a.kind === 'raise' ? `加注到 ${a.to}` : { fold: '弃牌', check: '过牌', call: '跟注' }[a.kind];
}
