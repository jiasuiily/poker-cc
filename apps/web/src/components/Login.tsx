import { useState } from 'react';
import { api, type Session } from '../net/api';

const input =
  'mb-3 w-full rounded-lg bg-black/30 px-3 py-2.5 text-base outline-none ring-1 ring-white/15 focus:ring-emerald-400';

/** Log in, or register with an invite code. */
export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onLogin(
        mode === 'login'
          ? await api.login(username, password)
          : await api.register({ username, displayName, password, inviteCode }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const tab = (m: 'login' | 'register', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setMode(m);
        setErr(null);
      }}
      className={`flex-1 rounded-lg py-2 text-sm ring-1 ${mode === m ? 'bg-emerald-500/20 ring-emerald-400' : 'ring-white/15'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-felt-dark p-6 shadow-xl ring-1 ring-white/10">
        <h1 className="mb-1 text-2xl font-bold">德州扑克</h1>
        <p className="mb-4 text-sm text-white/60">家人朋友练习局</p>
        <div className="mb-4 flex gap-2" role="tablist">
          {tab('login', '登录')}
          {tab('register', '注册')}
        </div>
        <label className="mb-1 block text-sm text-white/70" htmlFor="username">
          用户名
        </label>
        <input id="username" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className={input} placeholder="字母、数字或下划线" />
        {mode === 'register' && (
          <>
            <label className="mb-1 block text-sm text-white/70" htmlFor="display">
              显示名（牌桌上别人看到的名字）
            </label>
            <input id="display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={input} placeholder="例如：老王" />
          </>
        )}
        <label className="mb-1 block text-sm text-white/70" htmlFor="password">
          密码{mode === 'register' ? '（至少 8 位）' : ''}
        </label>
        <input
          id="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
        {mode === 'register' && (
          <>
            <label className="mb-1 block text-sm text-white/70" htmlFor="invite">
              邀请码
            </label>
            <input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} className={input} placeholder="向管理员索取" />
          </>
        )}
        {err && (
          <p className="mb-3 text-sm text-red-300" role="alert">
            {err}
          </p>
        )}
        <button disabled={busy || !username.trim() || !password} className="w-full rounded-lg bg-emerald-500 py-2.5 font-semibold text-emerald-950 disabled:opacity-40">
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}
        </button>
      </form>
    </div>
  );
}
