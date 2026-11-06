import { useEffect, useState } from 'react';
import type { PlayerView, PlayerViewSeat } from '@poker/core';
import { CardView } from './CardView';

/** What the felt needs to draw one occupied seat (live table or replay). */
export interface FeltSeat {
  seat: number;
  name: string;
  isBot: boolean;
  /** e.g. "高级·松凶" */
  badge?: string;
  stack: number;
  sittingOut?: boolean;
  connected?: boolean;
  inHand?: boolean;
}

interface Props {
  maxSeats: number;
  /** Seat drawn at the bottom (the viewer), or null for seat 0. */
  anchorSeat: number | null;
  seats: (FeltSeat | null)[];
  hand: PlayerView | null;
  deadline?: number | null;
  timeoutMs?: number;
  clockOffset?: number;
  /** Interactive callbacks; omit them all for a read-only felt (replay). */
  canSit?: boolean;
  onSit?: (seat: number) => void;
  onAddBot?: (seat: number) => void;
  onRemoveBot?: (seat: number) => void;
}

export function Felt({ maxSeats: n, anchorSeat, seats, hand, deadline = null, timeoutMs = 20_000, clockOffset = 0, canSit = false, onSit, onAddBot, onRemoveBot }: Props) {
  const anchor = anchorSeat ?? 0;
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
        const sv = seats[seat];
        const hp = hand?.seats.find((s) => s.seat === seat);
        return (
          <div key={seat}>
            <div className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={pos(seat, 44, 43)}>
              {sv ? (
                <SeatBox
                  sv={sv}
                  hp={hp}
                  hand={hand}
                  isYou={seat === anchorSeat}
                  deadline={hand?.toAct === seat ? deadline : null}
                  timeoutMs={timeoutMs}
                  clockOffset={clockOffset}
                  onRemoveBot={onRemoveBot ? () => onRemoveBot(seat) : undefined}
                />
              ) : onSit || onAddBot ? (
                <EmptySeat canSit={canSit} onSit={() => onSit?.(seat)} onAddBot={onAddBot ? () => onAddBot(seat) : undefined} />
              ) : null}
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

function EmptySeat({ canSit, onSit, onAddBot }: { canSit: boolean; onSit: () => void; onAddBot?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {canSit && (
        <button onClick={onSit} className="rounded-full bg-black/40 px-3 py-1.5 text-xs ring-1 ring-white/25 hover:ring-emerald-400">
          坐下
        </button>
      )}
      {onAddBot && (
        <button onClick={onAddBot} className="rounded-full bg-black/30 px-2 py-1 text-[11px] text-white/60 ring-1 ring-white/15 hover:text-white">
          + 电脑
        </button>
      )}
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
  sv: FeltSeat;
  hp: PlayerViewSeat | undefined;
  hand: PlayerView | null;
  isYou: boolean;
  deadline: number | null;
  timeoutMs: number;
  clockOffset: number;
  onRemoveBot?: () => void;
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
        {sv.badge && <div className="truncate text-[10px] leading-tight text-sky-200/80">{sv.badge}</div>}
        <div className="text-sm font-semibold leading-tight">{hp?.allIn && hand?.street !== 'complete' ? '全下' : sv.stack}</div>
        {(sv.sittingOut || sv.connected === false) && <div className="text-[10px] text-white/50">{sv.connected === false ? '离线' : '暂离'}</div>}
        {acting && deadline && <Countdown deadline={deadline} timeoutMs={timeoutMs} clockOffset={clockOffset} />}
      </div>
      {onRemoveBot && sv.isBot && !sv.inHand && (
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
