import { rankOf, suitOf, type Card } from '@poker/core';

const RANK_TEXT = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_TEXT = ['♣', '♦', '♥', '♠'];

export function CardView({ card, size = 'md', dim = false }: { card: Card | null; size?: 'sm' | 'md' | 'lg'; dim?: boolean }) {
  const dims = size === 'sm' ? 'h-9 w-6.5 text-[11px]' : size === 'lg' ? 'h-16 w-11 text-base' : 'h-12 w-8.5 text-sm';
  if (card === null) {
    return (
      <div
        className={`${dims} rounded-md bg-gradient-to-br from-sky-700 to-sky-900 shadow ring-1 ring-white/30`}
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.08) 0 3px, transparent 3px 6px)' }}
        aria-label="牌背"
      />
    );
  }
  const suit = suitOf(card);
  const red = suit === 1 || suit === 2;
  return (
    <div
      className={`${dims} animate-deal flex flex-col items-center justify-center rounded-md bg-white font-bold leading-none shadow ring-1 ring-black/10 ${
        red ? 'text-red-600' : 'text-slate-900'
      } ${dim ? 'opacity-40' : ''}`}
      aria-label={`${SUIT_TEXT[suit]}${RANK_TEXT[rankOf(card)]}`}
    >
      <span>{RANK_TEXT[rankOf(card)]}</span>
      <span>{SUIT_TEXT[suit]}</span>
    </div>
  );
}
