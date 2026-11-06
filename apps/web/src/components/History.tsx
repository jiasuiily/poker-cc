import { useCallback, useEffect, useRef, useState } from 'react';
import { api, HttpError, type HandListItem, type Session } from '../net/api';
import { shouldAutoLoad } from '../paging';
import { CardView } from './CardView';

/** "我的牌谱": newest first, 20 at a time, loads more when the end comes into view. */
export function History({ session, onOpen, onAuthExpired }: { session: Session; onOpen: (handId: string) => void; onAuthExpired: () => void }) {
  const [items, setItems] = useState<HandListItem[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined); // undefined = not loaded yet
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      try {
        const page = await api.listHands(session.token, before);
        setItems((prev) => (before ? [...prev, ...page.items] : page.items));
        setNext(page.next);
        setErr(null);
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) onAuthExpired();
        setErr(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [session.token, onAuthExpired],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !shouldAutoLoad({ next, loading, err })) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(next!);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loading, err, load]);

  if (next === undefined && loading) return <p className="text-white/50">加载中…</p>;
  return (
    <div>
      {err && (
        <p className="mb-3 text-sm text-red-300">
          {err}
          <button onClick={() => void load(next ?? undefined)} className="ml-2 rounded px-2 py-0.5 text-white ring-1 ring-white/25">
            重试
          </button>
        </p>
      )}
      {items.length === 0 && !loading ? (
        <p className="text-white/50">还没有牌谱。坐下打几手，结束后就会出现在这里。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((h) => (
            <li key={h.handId}>
              <button
                onClick={() => onOpen(h.handId)}
                className="flex w-full items-center gap-3 rounded-xl bg-felt-dark px-3 py-2.5 text-left ring-1 ring-white/10 hover:ring-emerald-400"
              >
                <div className="flex shrink-0 gap-0.5">
                  {h.holeCards.map((c, i) => (
                    <CardView key={i} card={c} size="sm" />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{h.tableName}</div>
                  <div className="text-xs text-white/50">
                    {new Date(h.endedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {h.board.length > 0 && <span className="ml-2 hidden sm:inline">公共牌 {h.board.length} 张</span>}
                    {h.analyzed && <span className="ml-2 rounded bg-sky-500/20 px-1 text-sky-200">已分析</span>}
                  </div>
                </div>
                <div className="hidden gap-0.5 sm:flex">
                  {h.board.map((c, i) => (
                    <CardView key={i} card={c} size="sm" />
                  ))}
                </div>
                <div className={`w-16 shrink-0 text-right text-sm font-semibold ${h.net > 0 ? 'text-emerald-300' : h.net < 0 ? 'text-red-300' : 'text-white/60'}`}>
                  {h.net > 0 ? `+${h.net}` : h.net}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={sentinel} className="h-8" />
      {loading && items.length > 0 && <p className="text-center text-sm text-white/50">加载中…</p>}
    </div>
  );
}
