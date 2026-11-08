import { useEffect, useState } from 'react';
import { api, HttpError, type Session } from '../net/api';
import { Me } from './me/Me';

/** Admin: a player's 「我的」 page, run on their data and quotas. */
export function AdminPlayerView({ playerId, session, onBack, onAuthExpired }: { playerId: string; session: Session; onBack: () => void; onAuthExpired: () => void }) {
  const [name, setName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.admin
      .player(session.token, playerId)
      .then((p) => alive && setName(`${p.displayName} @${p.username}`))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof HttpError && e.status === 401) onAuthExpired();
        setErr(e instanceof Error ? e.message : '加载失败');
      });
    return () => {
      alive = false;
    };
  }, [session.token, playerId, onAuthExpired]);

  return (
    <div className="mx-auto max-w-3xl p-4 pb-16">
      <header className="mb-5 flex items-center justify-between gap-2">
        <button onClick={onBack} className="rounded-md px-2 py-1 text-sm text-white/70 ring-1 ring-white/15">
          ← 返回管理
        </button>
        <div className="min-w-0 truncate text-right text-sm">
          <span className="text-white/50">正在查看：</span>
          <span className="font-medium">{name ?? '…'}</span>
        </div>
      </header>
      {err ? <p className="text-red-300">{err}</p> : <Me session={session} onAuthExpired={onAuthExpired} asPlayer={playerId} />}
    </div>
  );
}
