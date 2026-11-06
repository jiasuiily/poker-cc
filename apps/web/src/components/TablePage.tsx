import { useEffect, useState } from 'react';
import { CATEGORY_NAMES, categoryOf, type PlayerView, type PlayerViewSeat } from '@poker/core';
import type { Session, SeatView, TableView } from '../net/api';
import { useTable } from '../net/useTable';
import { CardView } from './CardView';
import { ActionBar } from './ActionBar';

interface Props {
  roomId: string;
  session: Session;
  onExit: () => void;
  onAuthExpired: () => void;
}

export function TablePage({ roomId, session, onExit, onAuthExpired }: Props) {
  const { view, conn, error, clearError, send, act, clockOffset } = useTable(roomId, session);

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

      <Felt view={view} clockOffset={clockOffset} onSit={(seat) => send('sit', { seat })} onAddBot={(seat) => send('addBot', { seat })} onRemoveBot={(seat) => send('removeBot', { seat })} />

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

// ---------------------------------------------------------------------------

function Felt({
  view,
  clockOffset,
  onSit,
  onAddBot,
  onRemoveBot,
}: {
  view: TableView;
  clockOffset: number;
  onSit: (seat: number) => void;
  onAddBot: (seat: number) => void;
  onRemoveBot: (seat: number) => void;
}) {
  const n = view.table.maxSeats;
  const anchor = view.you.seat ?? 0;
  const hand = view.hand;
  const seated = view.you.seat !== null;

  const pos = (seat: number, rx: number, ry: number) => {
    const k = (seat - anchor + n) % n;
    const angle = Math.PI / 2 + (k * 2 * Math.PI) / n;
    return { left: `${50 + rx * Math.cos(angle)}%`, top: `${50 + ry * Math.sin(angle)}%` };
  };

  return (
    <div className="relative mx-auto aspect-[3/4] max-h-[66vh] w-full sm:aspect-[16/9] sm:max-h-[70vh]">
      <div className="absolute inset-[9%_6%] rounded-[45%] border-[10px] border-rail bg-[radial-gradient(ellipse_at_center,#17805a_0%,#0f5a3f_60%,#0b3d2e_100%)] shadow-[inset_0_0_40px_rgba(0,0,0,.5)] sm:inset-[11%_8%]" />

      {/* Board + pot */}
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        {hand && hand.pot > 0 && (
          <div className="rounded-full bg-black/40 px-3 py-0.5 text-sm font-semibold text-amber-200">底池 {hand.pot}</div>
        )}
        <div className="flex gap-1">
          {hand?.board.map((c, i) => <CardView key={`${hand.handId}-${i}`} card={c} size="md" />)}
        </div>
      </div>

      {Array.from({ length: n }, (_, seat) => {
        const sv = view.seats[seat];
        const hp = hand?.seats.find((s) => s.seat === seat);
        return (
          <div key={seat}>
            <div className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={pos(seat, 44, 43)}>
              {sv ? (
                <SeatBox
                  sv={sv}
                  hp={hp}
                  hand={hand}
                  isYou={seat === view.you.seat}
                  deadline={hand?.toAct === seat ? view.deadline : null}
                  timeoutMs={view.table.actionTimeoutMs}
                  clockOffset={clockOffset}
                  onRemoveBot={() => onRemoveBot(seat)}
                />
              ) : (
                <EmptySeat canSit={!seated} onSit={() => onSit(seat)} onAddBot={() => onAddBot(seat)} />
              )}
            </div>
            {hp && hp.committed > 0 && hand?.street !== 'complete' && (
              <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold text-amber-200" style={pos(seat, 27, 25)}>
                {hp.committed}
              </div>
            )}
            {hand && hand.button === seat && (
              <div className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-900 shadow" style={pos(seat + 0.3, 33, 31)}>
                D
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptySeat({ canSit, onSit, onAddBot }: { canSit: boolean; onSit: () => void; onAddBot: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {canSit && (
        <button onClick={onSit} className="rounded-full bg-black/40 px-3 py-1.5 text-xs ring-1 ring-white/25 hover:ring-emerald-400">
          坐下
        </button>
      )}
      <button onClick={onAddBot} className="rounded-full bg-black/30 px-2 py-1 text-[11px] text-white/60 ring-1 ring-white/15 hover:text-white">
        + 电脑
      </button>
    </div>
  );
}

function SeatBox({
  sv,
  hp,
  hand,
  isYou,
  deadline,
  timeoutMs,
  clockOffset,
  onRemoveBot,
}: {
  sv: SeatView;
  hp: PlayerViewSeat | undefined;
  hand: PlayerView | null;
  isYou: boolean;
  deadline: number | null;
  timeoutMs: number;
  clockOffset: number;
  onRemoveBot: () => void;
}) {
  const acting = hand?.toAct === sv.seat && hand.street !== 'complete';
  const folded = hp?.folded;
  const winner = hand?.result?.pots.some((p) => p.winners.some((w) => w.seat === sv.seat));
  const shown = hand?.result?.shown.find((s) => s.seat === sv.seat);
  const showCards = hp && !folded;
  return (
    <div className={`flex w-[84px] flex-col items-center sm:w-24 ${folded ? 'opacity-45' : ''}`}>
      <div className="flex h-12 items-end gap-0.5">
        {showCards &&
          (hp.hole ? (
            hp.hole.map((c, i) => <CardView key={i} card={c} size={isYou ? 'md' : 'sm'} dim={!!shown && !shown.best5.includes(c)} />)
          ) : (
            <>
              <CardView card={null} size="sm" />
              <CardView card={null} size="sm" />
            </>
          ))}
      </div>
      <div
        className={`relative -mt-1 w-full overflow-hidden rounded-lg px-1.5 py-1 text-center shadow ring-2 ${
          winner ? 'bg-amber-900/90 ring-amber-300' : acting ? 'bg-slate-900/90 ring-emerald-400' : 'bg-slate-900/85 ring-white/10'
        }`}
      >
        <div className="truncate text-[11px] leading-tight text-white/80">
          {sv.isBot ? '🤖 ' : ''}
          {sv.name}
          {isYou ? '（你）' : ''}
        </div>
        <div className="text-sm font-semibold leading-tight">{hp?.allIn && hand?.street !== 'complete' ? '全下' : sv.stack}</div>
        {(sv.sittingOut || !sv.connected) && <div className="text-[10px] text-white/50">{!sv.connected ? '离线' : '暂离'}</div>}
        {acting && deadline && <Countdown deadline={deadline} timeoutMs={timeoutMs} clockOffset={clockOffset} />}
      </div>
      {sv.isBot && !sv.inHand && (
        <button onClick={onRemoveBot} className="mt-0.5 text-[10px] text-white/40 hover:text-white/80">
          移除
        </button>
      )}
    </div>
  );
}

function Countdown({ deadline, timeoutMs, clockOffset }: { deadline: number; timeoutMs: number; clockOffset: number }) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + clockOffset), 200);
    return () => clearInterval(id);
  }, [clockOffset]);
  const left = Math.max(0, deadline - now);
  const pct = Math.min(100, (left / timeoutMs) * 100);
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
      <div className={`h-full ${left < 5000 ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
    </div>
  );
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
