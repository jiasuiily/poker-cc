import { useCallback, useEffect, useState } from 'react';
import { AdminPlayersSection } from './AdminPlayers';
import { api, type InviteRow, type Session, type UserRow } from '../net/api';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** Admin page: invite codes, users, password resets. */
export function Admin({ session, onBack }: { session: Session; onBack: () => void }) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [count, setCount] = useState(3);
  const [days, setDays] = useState<number | null>(7);
  const [fresh, setFresh] = useState<string[]>([]);
  const [reset, setReset] = useState<{ name: string; password: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [i, u] = await Promise.all([api.admin.invites(session.token), api.admin.users(session.token)]);
      setInvites(i);
      setUsers(u);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      setFresh((await api.admin.createInvites(session.token, count, days)).codes);
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败');
    }
  };

  const doReset = async (u: UserRow) => {
    if (!confirm(`重置 ${u.displayName}（${u.username}）的密码？对方在所有设备上都会被退出登录。`)) return;
    try {
      setReset({ name: u.displayName, password: (await api.admin.resetPassword(session.token, u.id)).password });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '重置失败');
    }
  };

  const doSetPassword = async (u: UserRow) => {
    const pw = prompt(`给 ${u.displayName}（${u.username}）设置新密码（至少 6 位）。对方在所有设备上都会被退出登录。`);
    if (pw === null) return;
    if (pw.length < 6) return setErr('密码至少 6 位');
    try {
      await api.admin.setPassword(session.token, u.id, pw);
      setErr(null);
      setReset({ name: u.displayName, password: pw });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '设置失败');
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 pb-16">
      <header className="mb-6 flex items-center gap-3">
        <button onClick={onBack} className="rounded-md px-2 py-1 text-sm text-white/70 ring-1 ring-white/15">
          ← 大厅
        </button>
        <h1 className="text-xl font-bold">管理</h1>
      </header>
      {err && <p className="mb-3 text-sm text-red-300">{err}</p>}

      <AdminPlayersSection session={session} />

      <section className="mb-8 rounded-xl bg-felt-dark p-4 ring-1 ring-white/10">
        <h2 className="mb-3 font-semibold">邀请码</h2>
        <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
          <label>
            <span className="mb-1 block text-white/70">数量</span>
            <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} className="w-20 rounded-lg bg-black/30 px-2 py-1.5 ring-1 ring-white/15" />
          </label>
          <label>
            <span className="mb-1 block text-white/70">有效期</span>
            <select value={days ?? ''} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} className="rounded-lg bg-black/30 px-2 py-1.5 ring-1 ring-white/15">
              <option value="1">1 天</option>
              <option value="7">7 天</option>
              <option value="30">30 天</option>
              <option value="">不过期</option>
            </select>
          </label>
          <button onClick={create} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-emerald-950">
            生成
          </button>
        </div>
        {fresh.length > 0 && (
          <div className="mb-3 rounded-lg bg-black/30 p-3 font-mono text-sm" aria-live="polite">
            新生成：{fresh.join('  ')}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-white/50">
              <tr>
                <th className="py-1 pr-3">邀请码</th>
                <th className="py-1 pr-3">创建</th>
                <th className="py-1 pr-3">过期</th>
                <th className="py-1">使用者</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.code} className="border-t border-white/5">
                  <td className="py-1 pr-3 font-mono">{i.code}</td>
                  <td className="py-1 pr-3">{fmt(i.createdAt)}</td>
                  <td className="py-1 pr-3">{fmt(i.expiresAt)}</td>
                  <td className="py-1">
                    {i.reusable ? (
                      <span className="text-emerald-300">可重复使用 · 已注册 {i.uses} 人</span>
                    ) : (
                      (i.usedBy ?? <span className="text-white/40">未使用</span>)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-felt-dark p-4 ring-1 ring-white/10">
        <h2 className="mb-3 font-semibold">用户</h2>
        {reset && (
          <p className="mb-3 rounded-lg bg-amber-500/15 p-3 text-sm" role="status">
            {reset.name} 的新密码：<span className="font-mono font-semibold">{reset.password}</span>（请转告对方，登录后可在「账号」里修改）
          </p>
        )}
        <ul className="divide-y divide-white/5 text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{u.displayName}</span> <span className="text-white/50">@{u.username}</span>
                {u.isAdmin && <span className="ml-2 rounded bg-sky-500/20 px-1 text-xs text-sky-200">管理员</span>}
              </span>
              {u.id !== session.playerId && (
                <span className="flex shrink-0 gap-2">
                  <button onClick={() => doSetPassword(u)} className="rounded-md px-2 py-1 text-white/70 ring-1 ring-white/15 hover:text-white">
                    设置密码
                  </button>
                  <button onClick={() => doReset(u)} className="rounded-md px-2 py-1 text-white/70 ring-1 ring-white/15 hover:text-white">
                    重置密码
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
