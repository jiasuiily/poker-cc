import { useEffect, useState } from 'react';
import { loadSession, saveSession, type Session } from './net/api';
import { Login } from './components/Login';
import { Lobby } from './components/Lobby';
import { TablePage } from './components/TablePage';

function parseHash(): string | null {
  const m = location.hash.match(/^#\/table\/([\w-]+)/);
  return m ? m[1]! : null;
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [roomId, setRoomId] = useState<string | null>(parseHash);

  useEffect(() => {
    const onHash = () => setRoomId(parseHash());
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
  if (roomId)
    return <TablePage key={roomId} roomId={roomId} session={session} onExit={() => (location.hash = '')} onAuthExpired={logout} />;
  return <Lobby session={session} onJoin={(id) => (location.hash = `/table/${id}`)} onLogout={logout} />;
}
