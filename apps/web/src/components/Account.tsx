import { useState } from 'react';
import { api, type Session } from '../net/api';

const input = 'mb-3 w-full rounded-lg bg-black/30 px-3 py-2.5 outline-none ring-1 ring-white/15 focus:ring-emerald-400';

/** Account page: change password (other devices are logged out; this one gets a new token). */
export function Account({ session, onBack, onSession }: { session: Session; onBack: () => void; onSession: (s: Session) => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== again) return setMsg({ ok: false, text: '两次输入的新密码不一致' });
    setBusy(true);
    try {
      onSession(await api.changePassword(session.token, oldPw, newPw));
      setMsg({ ok: true, text: '密码已修改，其他设备需要重新登录' });
      setOldPw('');
      setNewPw('');
      setAgain('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '修改失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md p-4">
      <header className="mb-6 flex items-center gap-3">
        <button onClick={onBack} className="rounded-md px-2 py-1 text-sm text-white/70 ring-1 ring-white/15">
          ← 大厅
        </button>
        <h1 className="text-xl font-bold">账号</h1>
      </header>
      <p className="mb-4 text-sm text-white/70">
        用户名 <span className="font-medium text-white">{session.username}</span> · 显示名 <span className="font-medium text-white">{session.name}</span>
      </p>
      <form onSubmit={submit} className="rounded-xl bg-felt-dark p-4 ring-1 ring-white/10">
        <h2 className="mb-3 font-semibold">修改密码</h2>
        <input type="password" autoComplete="current-password" aria-label="原密码" placeholder="原密码" value={oldPw} onChange={(e) => setOldPw(e.target.value)} className={input} />
        <input type="password" autoComplete="new-password" aria-label="新密码" placeholder="新密码（至少 6 位）" value={newPw} onChange={(e) => setNewPw(e.target.value)} className={input} />
        <input type="password" autoComplete="new-password" aria-label="再输入一次新密码" placeholder="再输入一次新密码" value={again} onChange={(e) => setAgain(e.target.value)} className={input} />
        {msg && (
          <p className={`mb-3 text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`} role="status">
            {msg.text}
          </p>
        )}
        <button disabled={busy || !oldPw || !newPw} className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-emerald-950 disabled:opacity-40">
          {busy ? '请稍候…' : '修改密码'}
        </button>
      </form>
    </div>
  );
}
