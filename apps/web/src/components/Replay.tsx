import { useEffect, useMemo, useState } from 'react';
import type { ReplayFrame } from '@poker/core';
import { api, HttpError, type HandMeta, type Session } from '../net/api';
import { frameLabel, verdictMark } from '../format';
import { AnalysisPanel, useAnalysis } from './AnalysisPanel';
import { botBadge } from './BotPicker';
import { Felt, type FeltSeat } from './Felt';

const STEP_MS = 1200;

export function Replay({
  handId,
  session,
  onBack,
  onAuthExpired,
  asPlayer,
}: {
  handId: string;
  session: Session;
  onBack: () => void;
  onAuthExpired: () => void;
  /** Admin: replay this hand from that player's seat. */
  asPlayer?: string;
}) {
  const [data, setData] = useState<{ hand: HandMeta; frames: ReplayFrame[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const analysis = useAnalysis(session, handId, asPlayer);

  useEffect(() => {
    let alive = true;
    // A hand that just ended may still be saving: retry a 404 a couple of times.
    const load = async (attempt: number) => {
      try {
        const d = await api.getHand(session.token, handId, asPlayer);
        if (!alive) return;
        setData(d);
        setIdx(0);
      } catch (e) {
        if (!alive) return;
        if (e instanceof HttpError && e.status === 404 && attempt < 3) return void setTimeout(() => load(attempt + 1), 1000);
        if (e instanceof HttpError && e.status === 401) onAuthExpired();
        setErr(e instanceof Error ? e.message : '加载失败');
      }
    };
    void load(0);
    return () => {
      alive = false;
    };
  }, [session.token, handId, onAuthExpired, asPlayer]);

  const last = (data?.frames.length ?? 1) - 1;

  useEffect(() => {
    if (!playing) return;
    if (idx >= last) return setPlaying(false);
    const t = setTimeout(() => setIdx((i) => Math.min(last, i + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, idx, last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(last, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  const names = useMemo(() => new Map(data?.hand.seats.map((s) => [s.seat, s.name]) ?? []), [data]);
  const verdictBySeq = useMemo(() => new Map(analysis.analysis?.decisions.map((d) => [d.actionSeq, d.verdict]) ?? []), [analysis.analysis]);

  if (err) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-4">
        <p className="text-white/80">{err}</p>
        <button onClick={onBack} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-emerald-950">
          {asPlayer ? '返回' : '返回大厅'}
        </button>
      </div>
    );
  }
  if (!data) return <div className="flex min-h-full items-center justify-center text-white/60">正在加载牌谱…</div>;

  const { hand, frames } = data;
  const frame = frames[idx]!;
  const seats: (FeltSeat | null)[] = Array.from({ length: hand.maxSeats }, (_, seat) => {
    const meta = hand.seats.find((s) => s.seat === seat);
    const v = frame.view.seats.find((s) => s.seat === seat);
    if (!meta || !v) return null;
    return { seat, name: meta.name, isBot: meta.isBot, badge: meta.isBot ? botBadge(meta.botLevel, meta.botStyle) : undefined, stack: v.stack, inHand: true };
  });
  const jumpToSeq = (seq: number) => {
    const i = frames.findIndex((f) => f.kind === 'action' && f.entry.seq === seq);
    // Show the decision point: the frame before the hero's action.
    if (i > 0) setIdx(i - 1);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-2 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] sm:px-4">
      <header className="mb-2 flex items-center justify-between gap-2 text-sm">
        <button onClick={onBack} className="rounded-md px-2 py-1 text-white/70 ring-1 ring-white/15">
          {asPlayer ? '← 返回' : '← 大厅'}
        </button>
        <div className="truncate text-center">
          <div className="truncate font-medium">{hand.tableName}</div>
          <div className="text-xs text-white/50">牌谱回放 · 大盲 {hand.bigBlind}</div>
        </div>
        <span className="w-12" />
      </header>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <Felt maxSeats={hand.maxSeats} anchorSeat={hand.heroSeat} seats={seats} hand={frame.view} />
          <div className="mt-2 text-center text-sm text-amber-100">{frameLabel(frame, names)}</div>
          <div className="mt-2 flex items-center justify-center gap-2" role="toolbar" aria-label="回放控制">
            <Ctl label="开头" onClick={() => setIdx(0)}>⏮</Ctl>
            <Ctl label="上一步" onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀</Ctl>
            <Ctl label={playing ? '暂停' : '播放'} onClick={() => (idx >= last ? (setIdx(0), setPlaying(true)) : setPlaying((p) => !p))}>
              {playing ? '⏸' : '▶'}
            </Ctl>
            <Ctl label="下一步" onClick={() => setIdx((i) => Math.min(last, i + 1))}>▶|</Ctl>
            <Ctl label="结尾" onClick={() => setIdx(last)}>⏭</Ctl>
            <span className="ml-2 text-xs text-white/50">
              {idx + 1}/{frames.length}
            </span>
          </div>
        </div>

        <aside className="flex w-full flex-col gap-3 lg:w-80">
          <ol className="max-h-72 overflow-y-auto rounded-xl bg-felt-dark p-2 text-sm ring-1 ring-white/10 lg:max-h-[50vh]" aria-label="动作列表">
            {frames.map((f, i) => {
              const v = f.kind === 'action' && f.entry.seat === hand.heroSeat ? verdictBySeq.get(f.entry.seq) : undefined;
              return (
                <li key={i}>
                  <button
                    onClick={() => setIdx(i)}
                    className={`flex w-full gap-2 rounded px-2 py-1 text-left ${i === idx ? 'bg-emerald-500/20 text-white' : 'text-white/75 hover:bg-white/5'} ${f.kind === 'street' ? 'font-medium text-amber-100' : ''}`}
                  >
                    <span className="w-4 shrink-0">{v ? verdictMark(v) : ''}</span>
                    <span>{frameLabel(f, names)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <AnalysisPanel state={analysis} onSelect={jumpToSeq} />
        </aside>
      </div>
    </div>
  );
}

function Ctl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="h-10 w-11 rounded-lg bg-white/10 text-sm ring-1 ring-white/15 active:bg-white/20">
      {children}
    </button>
  );
}
