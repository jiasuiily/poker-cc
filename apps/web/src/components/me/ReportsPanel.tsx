import { useCallback, useEffect, useRef, useState } from 'react';
import { api, HttpError, type CoachReport, type PlayerStats, type Session } from '../../net/api';
import { LEAK_NAMES, pct } from './labels';

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Overall coaching reports: generate, poll while pending, show the newest in full and fold the rest. */
export function ReportsPanel({ session, onAuthExpired, asPlayer }: { session: Session; onAuthExpired: () => void; asPlayer?: string }) {
  const [reports, setReports] = useState<CoachReport[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const alive = useRef(true);

  const handle = useCallback(
    (e: unknown, set: (m: string) => void, fallback: string) => {
      if (e instanceof HttpError && e.status === 401) onAuthExpired();
      set(e instanceof Error ? e.message : fallback);
    },
    [onAuthExpired],
  );

  const load = useCallback(async () => {
    try {
      const list = await api.me.reports(session.token, asPlayer);
      if (!alive.current) return;
      setReports(list.reports);
      setRemaining(list.remainingToday);
      setLoadErr(null);
    } catch (e) {
      if (alive.current) handle(e, setLoadErr, '加载失败');
    }
  }, [session.token, handle, asPlayer]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const pending = reports?.some((r) => r.status === 'pending') ?? false;
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [pending, load]);

  const create = async () => {
    setCreating(true);
    setActionErr(null);
    try {
      const r = await api.me.createReport(session.token, asPlayer);
      if (alive.current) setReports((prev) => [r, ...(prev ?? []).filter((x) => x.id !== r.id)]);
    } catch (e) {
      if (alive.current) handle(e, setActionErr, '生成失败');
    } finally {
      if (alive.current) setCreating(false);
      void load(); // refresh the remaining count (a refused attempt still counts)
    }
  };

  // The main report is the newest pending or ok one; failed attempts never replace a good report.
  const mainIdx = reports?.findIndex((r) => r.status !== 'failed') ?? -1;
  const latest = mainIdx >= 0 ? reports![mainIdx] : undefined;
  const previous = latest?.status === 'ok' ? reports!.slice(mainIdx + 1).find((r) => r.status === 'ok') : undefined;
  const lastFailed = reports?.[0]?.status === 'failed' && mainIdx !== 0;
  const folded = reports && latest ? reports.filter((r) => r !== latest) : (reports ?? []);

  return (
    <section className="rounded-xl bg-felt-dark p-4 ring-1 ring-white/10">
      <h2 className="mb-3 text-sm font-semibold text-white/60">整体分析</h2>
      <button
        onClick={() => void create()}
        disabled={creating || pending || reports === null || remaining === 0}
        className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-emerald-950 disabled:opacity-40"
      >
        {creating || pending ? '生成中…' : remaining === null ? '生成整体分析' : `生成整体分析（今日还剩 ${remaining} 次）`}
      </button>
      {actionErr && <p className="mt-2 text-sm text-red-300">{actionErr}</p>}

      {reports === null ? (
        loadErr ? (
          <p className="mt-3 text-sm text-red-300">
            {loadErr}
            <button onClick={() => void load()} className="ml-2 rounded px-2 py-0.5 text-white ring-1 ring-white/25">
              重试
            </button>
          </p>
        ) : (
          <p className="mt-3 text-sm text-white/50">加载中…</p>
        )
      ) : (
        <>
          {loadErr && <p className="mt-3 text-sm text-red-300">{loadErr}</p>}
          {reports.length === 0 ? (
            <p className="mt-3 text-sm text-white/50">还没有整体分析。打满 30 个决策点后可以生成一份。</p>
          ) : (
            <div className="mt-4 space-y-3">
              {lastFailed && <p className="text-xs text-red-300/80">上一次生成失败</p>}
              {latest && <ReportCard report={latest} previous={previous} />}
              {folded.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-white/40">更早的报告</p>
                  {folded.map((r) => (
                    <details key={r.id} className="rounded-lg bg-black/20 ring-1 ring-white/10">
                      <summary className="cursor-pointer px-3 py-2 text-sm text-white/70">
                        {fmtTime(r.createdAt)}
                        {r.status === 'pending' ? ' · 生成中' : r.status === 'failed' ? ' · 生成失败' : ''}
                      </summary>
                      <div className="px-3 pb-3">
                        <ReportBody report={r} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReportBody({ report }: { report: CoachReport }) {
  if (report.status === 'pending') return <p className="text-sm text-white/60">正在生成，请稍候…</p>;
  if (report.status === 'failed') return <p className="text-sm text-red-300">生成失败，可以重新生成。</p>;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{report.text ?? ''}</p>;
}

function ReportCard({ report, previous }: { report: CoachReport; previous?: CoachReport }) {
  return (
    <div>
      <p className="mb-2 text-xs text-white/50">
        {fmtTime(report.createdAt)} · {report.stats.hands} 手 / {report.stats.decisions} 个决策点
      </p>
      <ReportBody report={report} />
      {previous && <Comparison cur={report.stats} prev={previous.stats} prevAt={previous.createdAt} />}
    </div>
  );
}

function Comparison({ cur, prev, prevAt }: { cur: PlayerStats; prev: PlayerStats; prevAt: string }) {
  const leakCount = (s: PlayerStats, k: string) => s.leaks.find((l) => l.kind === k)?.count ?? 0;
  const rows: { label: string; now: string; before: string }[] = [
    { label: '失误率', now: pct(cur.mistake, cur.decisions), before: pct(prev.mistake, prev.decisions) },
    { label: '平均 EV 损失（bb/手）', now: cur.evLossPerHand.toFixed(2), before: prev.evLossPerHand.toFixed(2) },
    ...cur.leaks.slice(0, 3).map((l) => ({
      label: `${LEAK_NAMES[l.kind]}（次）`,
      now: String(l.count),
      before: String(leakCount(prev, l.kind)),
    })),
  ];
  return (
    <div className="mt-4 rounded-lg bg-black/20 p-3 text-sm ring-1 ring-white/10">
      <p className="mb-2 text-xs text-white/50">与上一份（{fmtTime(prevAt)}）对照</p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs text-white/40">
            <th className="font-normal">指标</th>
            <th className="text-right font-normal">上一份</th>
            <th className="text-right font-normal">这一份</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-white/5">
              <td className="py-1 pr-2">{r.label}</td>
              <td className="py-1 text-right text-white/60">{r.before}</td>
              <td className="py-1 text-right font-medium">{r.now}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
