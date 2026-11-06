import { useEffect, useState } from 'react';
import { loadSession, saveSession, type Session } from './net/api';
import { Login } from './components/Login';
import { Lobby } from './components/Lobby';
import { TablePage } from './components/TablePage';
import { Replay } from './components/Replay';

type Route = { kind: 'lobby'; tab: 'tables' | 'history' } | { kind: 'table'; id: string } | { kind: 'hand'; id: string };

function parseHash(): Route {
  const t = location.hash.match(/^#\/table\/([\w-]+)/);
  if (t) return { kind: 'table', id: t[1]! };
  const h = location.hash.match(/^#\/hand\/([\w-]+)/);
  if (h) return { kind: 'hand', id: h[1]! };
  return { kind: 'lobby', tab: location.hash === '#/history' ? 'history' : 'tables' };
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const login = (s: Session) => {
    saveSession(s);
    setSession(s);
  };
  const logout = () => {
    saveSession(null);
    setSession(null);
  };

  if (!session) return <Login onLogin={login} />;
  if (route.kind === 'table')
    return <TablePage key={route.id} roomId={route.id} session={session} onExit={() => (location.hash = '')} onAuthExpired={logout} />;
  if (route.kind === 'hand')
    return <Replay key={route.id} handId={route.id} session={session} onBack={() => (location.hash = '/history')} onAuthExpired={logout} />;
  return (
    <Lobby
      session={session}
      tab={route.tab}
      onTab={(t) => (location.hash = t === 'history' ? '/history' : '')}
      onJoin={(id) => (location.hash = `/table/${id}`)}
      onOpenHand={(id) => (location.hash = `/hand/${id}`)}
      onLogout={logout}
    />
  );
}
