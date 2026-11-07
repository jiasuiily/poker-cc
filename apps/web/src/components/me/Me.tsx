import { useCallback, useEffect, useRef, useState } from 'react';
import { api, HttpError, type PlayerStats, type Session, type StatsRange, type TrendDay } from '../../net/api';
import { BatchPanel } from './BatchPanel';
import { ReportsPanel } from './ReportsPanel';
import { TrendChart } from './TrendChart';
import { actionText, LEAK_NAMES, pct, STREET_NAMES } from './labels';

const RANGES: [StatsRange, string][] = [
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
  ['all', '全部'],
];

type Stats = PlayerStats & { unanalyzed: number };

/** The 「我的」 tab: stats cards, daily trend, one-click analysis and overall reports. */
export function Me({ session, onAuthExpired }: { session: Session; onAuthExpired: () => void }) {
  const [range, setRange] = useState<StatsRange>('30d');
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendDay[] | null>(null);
  const [trendErr, setTrendErr] = useState<string | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);

  const fail = useCallback(
    (e: unknown, set: (m: string) => void, fallback: string) => {
      if (e instanceof HttpError && e.status === 401) onAuthExpired();
      set(e instanceof Error ? e.message : fallback);
    },
    [onAuthExpired],
  );

  const loadStats = useCallback(async () => {
    const mine = ++seq.current;
    setStatsErr(null);
    try {
      const s = await api.me.stats(session.token, range);
      if (alive.current && mine === seq.current) setStats(s);
    } catch (e) {
      if (alive.current && mine === seq.current) fail(e, setStatsErr, '加载失败');
    }
  }, [session.token, range, fail]);

  const loadTrend = useCallback(async () => {
    setTrendErr(null);
    try {
      const t = await api.me.trend(session.token, 30);
      if (alive.current) setTrend(t);
    } catch (e) {
      if (alive.current) fail(e, setTrendErr, '加载失败');
    }
  }, [session.token, fail]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setStats(null);
    void loadStats();
  }, [loadStats]);
  useEffect(() => {
    void loadTrend();
  }, [loadTrend]);

  const refresh = useCallback(() => {
    void loadStats();
    void loadTrend();
  }, [loadStats, loadTrend]);

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white/60">我的数据</h2>
          <div className="flex gap-1.5" role="group" aria-label="统计范围">
            {RANGES.map(([r, label]) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={`rounded-md px-2.5 py-1 text-xs ring-1 ${range === r ? 'bg-emerald-500/20 ring-emerald-400' : 'ring-white/15'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {statsErr && (
          <p className="mb-2 text-sm text-red-300">
            {statsErr}
            <button onClick={() => void loadStats()} className="ml-2 rounded px-2 py-0.5 text-white ring-1 ring-white/25">
              重试
            </button>
          </p>
        )}
        {stats === null ? (
          !statsErr && <p className="text-white/50">加载中…</p>
        ) : stats.decisions === 0 ? (
          <p className="text-white/50">
            {stats.unanalyzed > 0 ? `这个范围内还没有分析过的牌局（${stats.unanalyzed} 手待分析），点下面的一键分析。` : '这个范围内还没有牌局，先去打几手吧。'}
          </p>
        ) : (
          <StatsCards stats={stats} />
        )}
      </section>

      <section className="rounded-xl bg-felt-dark p-4 ring-1 ring-white/10">
        <h2 className="mb-3 text-sm font-semibold text-white/60">最近 30 天趋势</h2>
        {trend === null ? (
          trendErr ? (
            <p className="text-sm text-red-300">
              {trendErr}
              <button onClick={() => void loadTrend()} className="ml-2 rounded px-2 py-0.5 text-white ring-1 ring-white/25">
                重试
              </button>
            </p>
          ) : (
            <p className="text-white/50">加载中…</p>
          )
        ) : (
          <TrendChart days={trend} />
        )}
      </section>

      <BatchPanel session={session} onAuthExpired={onAuthExpired} onFinished={refresh} />
      <ReportsPanel session={session} onAuthExpired={onAuthExpired} />
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-felt-dark px-3 py-2.5 ring-1 ring-white/10">
      <div className="text-xs text-white/50">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

function StatsCards({ stats: s }: { stats: Stats }) {
  const streets = (Object.keys(STREET_NAMES) as (keyof typeof STREET_NAMES)[]).filter((k) => s.byStreet[k].decisions > 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="手数" value={String(s.hands)} />
        <Card label="决策点" value={String(s.decisions)} />
        <Card label="失误率" value={pct(s.mistake, s.decisions)} tone="text-red-300" />
        <Card label="平均 EV 损失（bb/手）" value={s.evLossPerHand.toFixed(2)} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg bg-emerald-500/10 py-2 ring-1 ring-emerald-400/30">
          <div className="text-xs text-white/50">好</div>
          <div className="font-semibold text-emerald-300">{s.good}</div>
        </div>
        <div className="rounded-lg bg-amber-500/10 py-2 ring-1 ring-amber-400/30">
          <div className="text-xs text-white/50">尚可</div>
          <div className="font-semibold text-amber-300">{s.ok}</div>
        </div>
        <div className="rounded-lg bg-red-500/10 py-2 ring-1 ring-red-400/30">
          <div className="text-xs text-white/50">失误</div>
          <div className="font-semibold text-red-300">{s.mistake}</div>
        </div>
      </div>

      {streets.length > 0 && (
        <div className="rounded-xl bg-felt-dark p-3 ring-1 ring-white/10">
          <p className="mb-1.5 text-xs text-white/50">各街失误率</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            {streets.map((k) => (
              <li key={k} className="flex justify-between">
                <span className="text-white/70">{STREET_NAMES[k]}</span>
                <span>
                  {pct(s.byStreet[k].mistakes, s.byStreet[k].decisions)}
                  <span className="ml-1 text-xs text-white/40">/{s.byStreet[k].decisions}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.leaks.length > 0 && (
        <div className="rounded-xl bg-felt-dark p-3 ring-1 ring-white/10">
          <p className="mb-1.5 text-xs text-white/50">常见漏洞</p>
          <ul className="space-y-1 text-sm">
            {s.leaks.map((l) => (
              <li key={l.kind} className="flex justify-between gap-2">
                <span>{LEAK_NAMES[l.kind]}</span>
                <span className="shrink-0 text-white/60">
                  {l.count} 次 · 损失 {l.evLossBb.toFixed(1)} bb
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.examples.length > 0 && (
        <div className="rounded-xl bg-felt-dark p-3 ring-1 ring-white/10">
          <p className="mb-1.5 text-xs text-white/50">损失最大的几手（点开看回放）</p>
          <ul className="space-y-1.5 text-sm">
            {s.examples.map((e) => (
              <li key={`${e.handId}-${e.actionSeq}`}>
                <a href={`#/hand/${e.handId}`} className="flex justify-between gap-2 hover:text-emerald-300">
                  <span className="min-w-0">
                    {STREET_NAMES[e.street]}：{actionText(e.heroAction)}
                    <span className="text-white/50">（建议{actionText(e.recommended)}）</span>
                  </span>
                  <span className="shrink-0 text-red-300">-{e.evLossBb.toFixed(1)} bb</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
