import { useCallback, useEffect, useRef, useState } from 'react';
import { Client, type Room } from '@colyseus/sdk';
import type { PlayerAction } from '@poker/core';
import { PROTOCOL_VERSION, SERVER_URL, type Session, type TableView } from './api';

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'failed';

const client = new Client(SERVER_URL);

/**
 * Joins a table room and keeps the latest per-player view.
 * Reconnects with backoff on drops and resyncs when the tab becomes visible again (iOS).
 */
export function useTable(roomId: string, session: Session) {
  const [view, setView] = useState<TableView | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const lastVersion = useRef(-1);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        const room = await client.joinById(roomId, { token: session.token, protocol: PROTOCOL_VERSION });
        if (disposed) {
          void room.leave();
          return;
        }
        roomRef.current = room;
        attempt = 0;
        setConn('online');
        room.onMessage('state', (v: TableView) => {
          lastVersion.current = v.version;
          setClockOffset(v.serverTime - Date.now());
          setView(v);
        });
        room.onMessage('error', (e: { message: string }) => setError(e.message));
        room.onLeave((code) => {
          roomRef.current = null;
          if (disposed || code === 1000 || code === 4000) return;
          scheduleRetry();
        });
      } catch (e) {
        if (disposed) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (/token|jwt|exp|signature/i.test(msg)) {
          setConn('failed');
          setError('登录已过期，请重新登录');
          return;
        }
        if (/版本/.test(msg)) {
          setConn('failed');
          setError(msg);
          return;
        }
        if (/not found|找不到|invalid/i.test(msg) && attempt > 2) {
          setConn('failed');
          setError('牌桌不存在或已关闭');
          return;
        }
        scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      setConn('reconnecting');
      attempt++;
      retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt));
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (roomRef.current) roomRef.current.send('sync');
      else {
        clearTimeout(retryTimer);
        void connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      void roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [roomId, session.token]);

  const send = useCallback((type: string, payload?: unknown) => {
    const room = roomRef.current;
    if (!room) {
      setError('连接中，请稍候');
      return;
    }
    room.send(type, payload);
  }, []);

  const act = useCallback(
    (action: PlayerAction) => {
      const h = view?.hand;
      if (!h) return;
      send('act', { handId: h.handId, seq: h.actionSeq, action });
    },
    [view, send],
  );

  return { view, conn, error, clearError: () => setError(null), send, act, clockOffset };
}
