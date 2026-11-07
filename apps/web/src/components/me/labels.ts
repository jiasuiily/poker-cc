import type { PlayerAction } from '@poker/core';
import type { LeakKind } from '../../net/api';

/** Chinese leak names; same keys as LEAK_NAMES in packages/strategy (kept separate so the web bundle skips that package). */
export const LEAK_NAMES: Record<LeakKind, string> = {
  preflopLoose: '翻前入池过松',
  preflopTight: '翻前过紧',
  callTooWide: '跟注过宽',
  foldTooMuch: '弃牌过多',
  passive: '过于被动',
  aggressive: '过度激进',
  sizing: '下注尺度',
};

export const STREET_NAMES = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌' } as const;

export function actionText(a: PlayerAction): string {
  switch (a.kind) {
    case 'fold':
      return '弃牌';
    case 'check':
      return '过牌';
    case 'call':
      return '跟注';
    case 'raise':
      return `加注到 ${a.to}`;
  }
}

export const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—');
