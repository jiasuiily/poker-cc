import { useEffect, useState } from 'react';
import { AUTH_EXPIRED_EVENT, loadSession, saveSession, type Session } from './net/api';
import { Login } from './components/Login';
import { Lobby } from './components/Lobby';
import { TablePage } from './components/TablePage';
import { Replay } from './components/Replay';
import { Account } from './components/Account';
import { Admin } from './components/Admin';
import { AdminPlayerView } from './components/AdminPlayerView';

type Route =
  | { kind: 'lobby'; tab: 'tables' | 'history' | 'me' }
  | { kind: 'table'; id: string }
  | { kind: 'hand'; id: string }
  | { kind: 'account' }
  | { kind: 'admin' }
  | { kind: 'adminPlayer'; playerId: string }
  | { kind: 'adminHand'; playerId: string; id: string };

function parseHash(): Route {
  const ah = location.hash.match(/^#\/admin\/player\/([\w-]+)\/hand\/([\w-]+)/);
  if (ah) return { kind: 'adminHand', playerId: ah[1]!, id: ah[2]! };
  const ap = location.hash.match(/^#\/admin\/player\/([\w-]+)/);
  if (ap) return { kind: 'adminPlayer', playerId: ap[1]! };
  const t = location.hash.match(/^#\/table\/([\w-]+)/);
  if (t) return { kind: 'table', id: t[1]! };
  const h = location.hash.match(/^#\/hand\/([\w-]+)/);
  if (h) return { kind: 'hand', id: h[1]! };
  if (location.hash === '#/account') return { kind: 'account' };
  if (location.hash === '#/admin') return { kind: 'admin' };
  return { kind: 'lobby', tab: location.hash === '#/history' ? 'history' : location.hash === '#/me' ? 'me' : 'tables' };
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    // Any 401 on an authenticated request: back to the login page.
    const onExpired = () => {
      saveSession(null);
      setSession(null);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
    };
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
  if (route.kind === 'account') return <Account session={session} onBack={() => (location.hash = '')} onSession={login} />;
  if (route.kind === 'admin' && session.isAdmin) return <Admin session={session} onBack={() => (location.hash = '')} />;
  if (route.kind === 'adminPlayer' && session.isAdmin)
    return (
      <AdminPlayerView key={route.playerId} playerId={route.playerId} session={session} onBack={() => (location.hash = '/admin')} onAuthExpired={logout} />
    );
  if (route.kind === 'adminHand' && session.isAdmin)
    return (
      <Replay
        key={`${route.playerId}-${route.id}`}
        handId={route.id}
        asPlayer={route.playerId}
        session={session}
        onBack={() => (location.hash = `/admin/player/${route.playerId}`)}
        onAuthExpired={logout}
      />
    );
  if (route.kind === 'table')
    return <TablePage key={route.id} roomId={route.id} session={session} onExit={() => (location.hash = '')} onAuthExpired={logout} />;
  if (route.kind === 'hand')
    return <Replay key={route.id} handId={route.id} session={session} onBack={() => (location.hash = '/history')} onAuthExpired={logout} />;
  return (
    <Lobby
      session={session}
      tab={route.kind === 'lobby' ? route.tab : 'tables'}
      onTab={(t) => (location.hash = t === 'history' ? '/history' : t === 'me' ? '/me' : '')}
      onJoin={(id) => (location.hash = `/table/${id}`)}
      onOpenHand={(id) => (location.hash = `/hand/${id}`)}
      onLogout={logout}
    />
  );
}
