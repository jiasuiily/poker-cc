import { Fragment, useEffect, useState } from 'react';
import { api, type AdminPlayerRow, type AdminPlayers, type CoachReport, type Session } from '../net/api';
import { pct } from './me/labels';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function fmtDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}

/** Admin: per-player activity and review numbers; a row expands to that player's overall reports (text and numbers only). */
export function AdminPlayersSection({ session }: { session: Session }) {
  const [data, setData] = useState<AdminPlayers | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.admin
      .players(session.token)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [session.token]);

  return (
    <section className="mb-8 rounded-xl bg-felt-dark p-4 ring-1 ring-white/10">
      <h2 className="mb-3 font-semibold">玩家</h2>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {!data && !err && <p className="text-sm text-white/50">加载中…</p>}
      {data && (
        <>
          <p className="mb-3 text-sm text-white/70">
            玩家 {data.total} · 在线 {data.onlineNow} · 7 天活跃 {data.active7d}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="text-white/50">
                <tr>
                  {['名字', '在线', '最近活跃', '最近登录', '登录次数', '手数', '时长', '已分析', '好', '可', '错', '平均 EV 损失', '评估数'].map((h) => (
                    <th key={h} className="py-1 pr-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <PlayerRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} session={session} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function PlayerRow({ p, open, onToggle, session }: { p: AdminPlayerRow; open: boolean; onToggle: () => void; session: Session }) {
  const total = p.good + p.ok + p.mistake;
  return (
    <Fragment>
      <tr className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={onToggle}>
        <td className="py-1.5 pr-3">
          <button aria-expanded={open} className="text-left font-medium">
            {p.displayName} <span className="text-white/40">@{p.username}</span>
          </button>
        </td>
        <td className="py-1.5 pr-3">
          <span className={p.online ? 'text-emerald-400' : 'text-white/25'} title={p.online ? '在线' : '离线'}>
            ●
          </span>
        </td>
        <td className="py-1.5 pr-3">{fmt(p.lastSeenAt)}</td>
        <td className="py-1.5 pr-3">{fmt(p.lastLoginAt)}</td>
        <td className="py-1.5 pr-3">{p.loginCount}</td>
        <td className="py-1.5 pr-3">{p.hands}</td>
        <td className="py-1.5 pr-3">{fmtDuration(p.playSeconds)}</td>
        <td className="py-1.5 pr-3">{p.analyzedHands}</td>
        <td className="py-1.5 pr-3 text-emerald-300">{pct(p.good, total)}</td>
        <td className="py-1.5 pr-3 text-amber-300">{pct(p.ok, total)}</td>
        <td className="py-1.5 pr-3 text-red-300">{pct(p.mistake, total)}</td>
        <td className="py-1.5 pr-3">{total > 0 ? p.evLossPerHand.toFixed(2) : '—'}</td>
        <td className="py-1.5 pr-3">{p.reports}</td>
      </tr>
      {open && (
        <tr className="border-t border-white/5 bg-black/20">
          <td colSpan={13} className="whitespace-normal p-3">
            <PlayerReports id={p.id} session={session} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function PlayerReports({ id, session }: { id: string; session: Session }) {
  const [reports, setReports] = useState<CoachReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.admin
      .playerReports(session.token, id)
      .then((r) => alive && setReports(r))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [id, session.token]);

  if (err) return <p className="text-sm text-red-300">{err}</p>;
  if (!reports) return <p className="text-sm text-white/50">加载中…</p>;
  if (reports.length === 0) return <p className="text-sm text-white/50">还没有整体评估。</p>;
  return (
    <div className="space-y-3">
      {reports.map((r) => (
        <div key={r.id} className="rounded-lg bg-black/20 p-3 ring-1 ring-white/10">
          <p className="mb-1 text-xs text-white/50">
            {fmt(r.createdAt)} · {r.stats.hands} 手 / {r.stats.decisions} 个决策点 · 好 {pct(r.stats.good, r.stats.decisions)} 可{' '}
            {pct(r.stats.ok, r.stats.decisions)} 错 {pct(r.stats.mistake, r.stats.decisions)} · EV 损失 {r.stats.evLossPerHand.toFixed(2)} bb/手
          </p>
          {r.status === 'pending' ? (
            <p className="text-sm text-white/60">正在生成…</p>
          ) : r.status === 'failed' ? (
            <p className="text-sm text-red-300">生成失败</p>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{r.text ?? ''}</p>
          )}
        </div>
      ))}
    </div>
  );
}
