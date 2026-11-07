import { useCallback, useEffect, useRef, useState } from 'react';
import { api, HttpError, type BatchProgress, type Session } from '../../net/api';

const REASON_TEXT = { limit: '今日解说额度已用完，明天继续', disabled: '未配置大模型，只做了本地分析' } as const;

/** One-click "analyse all my hands" with progress; polls every 2 s while the server job runs. */
export function BatchPanel({
  session,
  unanalyzed,
  onAuthExpired,
  onFinished,
}: {
  session: Session;
  unanalyzed: number;
  onAuthExpired: () => void;
  onFinished: () => void;
}) {
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const wasRunning = useRef(false);
  const alive = useRef(true);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const handle = useCallback(
    (e: unknown) => {
      if (e instanceof HttpError && e.status === 401) onAuthExpired();
      setErr(e instanceof Error ? e.message : '请求失败');
    },
    [onAuthExpired],
  );

  const apply = useCallback((p: BatchProgress) => {
    if (!alive.current) return;
    setProgress(p);
    setErr(null);
    if (wasRunning.current && !p.running) finished.current();
    wasRunning.current = p.running;
  }, []);

  useEffect(() => {
    alive.current = true;
    api.me
      .analyzeProgress(session.token)
      .then(apply)
      .catch((e) => alive.current && handle(e));
    return () => {
      alive.current = false;
    };
  }, [session.token, apply, handle]);

  const running = progress?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      api.me
        .analyzeProgress(session.token)
        .then(apply)
        .catch((e) => alive.current && handle(e));
    }, 2000);
    return () => clearInterval(id);
  }, [running, session.token, apply, handle]);

  const start = async () => {
    setStarting(true);
    try {
      apply(await api.me.analyzeAll(session.token));
    } catch (e) {
      if (alive.current) handle(e);
    } finally {
      if (alive.current) setStarting(false);
    }
  };

  const p = progress;
  return (
    <section className="rounded-xl bg-felt-dark p-4 ring-1 ring-white/10">
      <h2 className="mb-3 text-sm font-semibold text-white/60">一键分析</h2>
      <button
        onClick={() => void start()}
        disabled={running || starting || unanalyzed === 0}
        className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-emerald-950 disabled:opacity-40"
      >
        {running ? '分析中…' : `一键分析（${unanalyzed} 手待分析）`}
      </button>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {p && (running || p.localDone > 0 || p.llmDone > 0 || p.reason) && (
        <div className="mt-3 space-y-1 text-sm text-white/70">
          <p>
            本地分析 {p.localDone} / {p.hands} 手 · 已有解说 {p.llmDone} 手
            {running && p.llmQueued > 0 && ` · 排队解说 ${p.llmQueued} 手`}
          </p>
          {!running && p.reason && <p className="text-amber-200/90">{REASON_TEXT[p.reason]}</p>}
        </div>
      )}
    </section>
  );
}
