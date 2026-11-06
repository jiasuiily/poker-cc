import { useEffect, useState } from 'react';
import { CATEGORY_NAMES, categoryOf, type PlayerView } from '@poker/core';
import type { Session, SeatView } from '../net/api';
import { useTable } from '../net/useTable';
import { ActionBar } from './ActionBar';
import { BotPicker, botBadge } from './BotPicker';
import { Felt, type FeltSeat } from './Felt';

interface Props {
  roomId: string;
  session: Session;
  onExit: () => void;
  onAuthExpired: () => void;
}

export function TablePage({ roomId, session, onExit, onAuthExpired }: Props) {
  const { view, conn, error, clearError, send, act, clockOffset } = useTable(roomId, session);
  const [pickerSeat, setPickerSeat] = useState<number | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  if (conn === 'failed') {
    const expired = /登录/.test(error ?? '');
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-4">
        <p className="text-white/80">{error ?? '连接失败'}</p>
        <button onClick={expired ? onAuthExpired : onExit} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-emerald-950">
          {expired ? '重新登录' : '返回大厅'}
        </button>
      </div>
    );
  }
  if (!view) return <div className="flex min-h-full items-center justify-center text-white/60">正在进入牌桌…</div>;

  const mySeat = view.you.seat;
  const me = mySeat !== null ? view.seats[mySeat] : null;
  const hand = view.hand;
  const myTurn = !!hand?.legal;

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] sm:px-4">
      <header className="mb-2 flex items-center justify-between gap-2 text-sm">
        <button onClick={onExit} className="rounded-md px-2 py-1 text-white/70 ring-1 ring-white/15">
          ← 大厅
        </button>
        <div className="truncate text-center">
          <div className="truncate font-medium">{view.table.name}</div>
          <div className="text-xs text-white/50">
            盲注 {view.table.smallBlind}/{view.table.bigBlind} · 第 {view.handNo} 手
          </div>
        </div>
        <ConnBadge conn={conn} />
      </header>

      <Felt
        maxSeats={view.table.maxSeats}
        anchorSeat={view.you.seat}
        seats={view.seats.map((s): FeltSeat | null => (s ? { ...s, badge: s.isBot ? botBadge(s.botLevel, s.botStyle) : undefined } : null))}
        hand={hand}
        deadline={view.deadline}
        timeoutMs={view.table.actionTimeoutMs}
        clockOffset={clockOffset}
        canSit={mySeat === null}
        onSit={(seat) => send('sit', { seat })}
        onAddBot={(seat) => setPickerSeat(seat)}
        onRemoveBot={(seat) => send('removeBot', { seat })}
      />
      {pickerSeat !== null && (
        <BotPicker
          onClose={() => setPickerSeat(null)}
          onPick={(level, style) => {
            send('addBot', { seat: pickerSeat, level, style });
            setPickerSeat(null);
          }}
        />
      )}

      {error && <div className="mx-auto mt-2 rounded-lg bg-red-900/80 px-3 py-1.5 text-sm">{error}</div>}

      <div className="mt-auto pt-3">
        {hand?.street === 'complete' && <ResultBanner hand={hand} seats={view.seats} />}
        {myTurn && hand ? (
          <ActionBar hand={hand} onAct={act} />
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            {me ? (
              <>
                {me.stack < view.table.buyIn && !me.inHand && (
                  <SmallBtn onClick={() => send('rebuy')}>补码到 {view.table.buyIn}</SmallBtn>
                )}
                {me.sittingOut ? (
                  me.stack > 0 && <SmallBtn onClick={() => send('sitOut', { value: false })}>回到牌局</SmallBtn>
                ) : (
                  <SmallBtn onClick={() => send('sitOut', { value: true })}>暂离</SmallBtn>
                )}
                <SmallBtn onClick={() => send('stand')}>离座</SmallBtn>
                {hand && hand.street !== 'complete' && hand.toAct !== mySeat && <span className="text-white/50">等待其他玩家…</span>}
              </>
            ) : (
              <span className="text-white/60">点击空座位入座（买入 {view.table.buyIn}）</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnBadge({ conn }: { conn: string }) {
  const map: Record<string, [string, string]> = {
    online: ['在线', 'bg-emerald-400'],
    connecting: ['连接中', 'bg-amber-400'],
    reconnecting: ['重连中', 'bg-amber-400'],
  };
  const [text, dot] = map[conn] ?? ['离线', 'bg-red-400'];
  return (
    <span className="flex items-center gap-1.5 text-xs text-white/60">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function SmallBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="rounded-lg bg-white/10 px-3 py-2 ring-1 ring-white/15 active:bg-white/20" />;
}

function ResultBanner({ hand, seats }: { hand: PlayerView; seats: (SeatView | null)[] }) {
  const r = hand.result!;
  const nameOf = (seat: number) => seats[seat]?.name ?? `座位${seat + 1}`;
  const lines = r.pots.flatMap((p, i) =>
    p.winners.map((w) => {
      const shown = r.shown.find((s) => s.seat === w.seat);
      const what = shown ? `（${CATEGORY_NAMES[categoryOf(shown.value)]}）` : '';
      const potName = r.pots.length > 1 ? (i === 0 ? '主池' : `边池${i}`) : '';
      return `${nameOf(w.seat)} 赢得${potName} ${w.amount}${what}`;
    }),
  );
  return <div className="mb-2 rounded-lg bg-black/40 px-3 py-2 text-center text-sm text-amber-100">{lines.join(' · ')}</div>;
}
