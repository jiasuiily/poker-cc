import { useState } from 'react';
import { api, type Session } from '../net/api';

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onLogin(await api.loginAnon(name));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-felt-dark p-6 shadow-xl ring-1 ring-white/10">
        <h1 className="mb-1 text-2xl font-bold">德州扑克</h1>
        <p className="mb-6 text-sm text-white/60">家人朋友局 · 输入昵称开始</p>
        <label className="mb-1 block text-sm text-white/70" htmlFor="nick">
          昵称
        </label>
        <input
          id="nick"
          autoFocus
          maxLength={16}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded-lg bg-black/30 px-3 py-2.5 text-base outline-none ring-1 ring-white/15 focus:ring-emerald-400"
          placeholder="例如：老王"
        />
        {err && <p className="mb-3 text-sm text-red-300">{err}</p>}
        <button
          disabled={busy || !name.trim()}
          className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-emerald-950 disabled:opacity-40"
        >
          {busy ? '登录中…' : '进入大厅'}
        </button>
      </form>
    </div>
  );
}
