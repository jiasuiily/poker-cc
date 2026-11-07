import { useEffect, useState } from 'react';
import { api, MAX_SEATS, MIN_SEATS, type Session, type TableListing } from '../net/api';
import { History } from './History';
import { Me } from './me/Me';
import { LevelStyleFields, type BotLevelChoice, type BotStyleChoice } from './BotPicker';

const STATUS_TEXT: Record<string, string> = { waiting: '等待开始', running: '进行中', paused: '已暂停' };

const STAKES = [
  [5, 10],
  [10, 20],
  [25, 50],
] as const;

interface LobbyProps {
  session: Session;
  tab: 'tables' | 'history' | 'me';
  onTab: (t: 'tables' | 'history' | 'me') => void;
  onJoin: (roomId: string) => void;
  onOpenHand: (handId: string) => void;
  onLogout: () => void;
}

export function Lobby({ session, tab, onTab, onJoin, onOpenHand, onLogout }: LobbyProps) {
  const [tables, setTables] = useState<TableListing[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(`${session.name}的牌桌`);
  const [maxSeats, setMaxSeats] = useState(6);
  const [stake, setStake] = useState(0);
  const [bots, setBots] = useState(3);
  const [botLevel, setBotLevel] = useState<BotLevelChoice>('advanced');
  const [botStyle, setBotStyle] = useState<BotStyleChoice>('random');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .listTables()
        .then((t) => alive && (setTables(t), setErr(null)))
        .catch((e) => alive && setErr(e instanceof Error ? e.message : '无法连接服务器'));
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const [smallBlind, bigBlind] = STAKES[stake]!;
      const { roomId } = await api.createTable(session.token, {
        name,
        maxSeats,
        smallBlind,
        bigBlind,
        bots: Math.min(bots, maxSeats - 1),
        botLevel,
        botStyle,
      });
      onJoin(roomId);
    } catch (e) {
      if (e instanceof Error && /登录/.test(e.message)) onLogout();
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 pb-16">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">大厅</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-white/70">{session.name}</span>
          <a href="#/account" className="rounded-md px-2 py-1 text-white/60 ring-1 ring-white/15 hover:text-white">
            账号
          </a>
          {session.isAdmin && (
            <a href="#/admin" className="rounded-md px-2 py-1 text-white/60 ring-1 ring-white/15 hover:text-white">
              管理
            </a>
          )}
          <button onClick={onLogout} className="rounded-md px-2 py-1 text-white/60 ring-1 ring-white/15 hover:text-white">
            退出
          </button>
        </div>
      </header>

      <div className="mb-5 flex gap-2" role="tablist">
        {(
          [
            ['tables', '牌桌'],
            ['history', '我的牌谱'],
            ['me', '我的'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTab(t)}
            className={`rounded-lg px-4 py-2 text-sm ring-1 ${tab === t ? 'bg-emerald-500/20 ring-emerald-400' : 'ring-white/15'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <History session={session} onOpen={onOpenHand} onAuthExpired={onLogout} />
      ) : tab === 'me' ? (
        <Me session={session} onAuthExpired={onLogout} />
      ) : (
      <>
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">牌桌</h2>
        {err && <p className="mb-3 text-sm text-red-300">{err}</p>}
        {tables === null ? (
          <p className="text-white/50">加载中…</p>
        ) : tables.length === 0 ? (
          <p className="text-white/50">还没有牌桌，在下面创建一个吧。</p>
        ) : (
          <ul className="space-y-2">
            {tables.map((t) => (
              <li key={t.roomId}>
                <button
                  onClick={() => onJoin(t.roomId)}
                  className="flex w-full items-center justify-between rounded-xl bg-felt-dark px-4 py-3 text-left ring-1 ring-white/10 hover:ring-emerald-400"
                >
                  <span>
                    <span className="block font-medium">{t.name}</span>
                    <span className="text-sm text-white/60">
                      盲注 {t.smallBlind}/{t.bigBlind} · {t.maxSeats} 人桌{t.hostName ? ` · 房主 ${t.hostName}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col items-end text-sm text-white/70">
                    <span className={t.status === 'running' ? 'text-emerald-300' : 'text-amber-200/80'}>{STATUS_TEXT[t.status] ?? ''}</span>
                    <span>
                      {t.seated}/{t.maxSeats} 已入座
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">创建牌桌</h2>
        <form onSubmit={create} className="grid gap-4 rounded-xl bg-felt-dark p-4 ring-1 ring-white/10 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-white/70">名称</span>
            <input
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg bg-black/30 px-3 py-2 outline-none ring-1 ring-white/15 focus:ring-emerald-400"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-white/70">座位数：{maxSeats} 个（开桌后房主还能增减）</span>
            <input
              type="range"
              min={MIN_SEATS}
              max={MAX_SEATS}
              value={maxSeats}
              onChange={(e) => setMaxSeats(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
          </label>
          <Choice label="盲注" value={stake} options={STAKES.map((s, i) => [i, `${s[0]}/${s[1]}`])} onChange={setStake} />
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-white/70">
              电脑玩家：{Math.min(bots, maxSeats - 1)} 个
            </span>
            <input
              type="range"
              min={0}
              max={maxSeats - 1}
              value={Math.min(bots, maxSeats - 1)}
              onChange={(e) => setBots(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
          </label>
          {bots > 0 && (
            <div className="sm:col-span-2">
              <LevelStyleFields level={botLevel} style={botStyle} onLevel={setBotLevel} onStyle={setBotStyle} />
            </div>
          )}
          <button
            disabled={busy || !name.trim()}
            className="rounded-lg bg-emerald-500 py-2.5 font-semibold text-emerald-950 disabled:opacity-40 sm:col-span-2"
          >
            {busy ? '创建中…' : '创建并进入'}
          </button>
        </form>
      </section>
      </>
      )}
    </div>
  );
}

function Choice<T extends number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="text-sm">
      <span className="mb-1 block text-white/70">{label}</span>
      <div className="flex gap-2">
        {options.map(([v, text]) => (
          <button
            type="button"
            key={v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded-lg py-2 ring-1 ${v === value ? 'bg-emerald-500/20 ring-emerald-400' : 'ring-white/15'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
