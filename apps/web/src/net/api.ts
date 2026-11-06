import type { Card, PlayerView, ReplayFrame } from '@poker/core';
import type { DecisionReport } from '@poker/strategy';

export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`;

export const PROTOCOL_VERSION = 1;

export interface Session {
  token: string;
  playerId: string;
  name: string;
}

const KEY = 'poker.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session lasts for this page only */
  }
}

async function call<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, body.error ?? `请求失败 (${res.status})`);
  return body as T;
}

export const api = {
  loginNickname: (nickname: string) =>
    call<Session>('/api/auth/nickname', { method: 'POST', body: JSON.stringify({ nickname }) }),
  listTables: () => call<TableListing[]>('/api/tables'),
  createTable: (token: string, opts: CreateTableOptions) =>
    call<{ roomId: string }>('/api/tables', { method: 'POST', body: JSON.stringify(opts), token }),
  listHands: (token: string, before?: string) =>
    call<{ items: HandListItem[]; next: string | null }>(`/api/hands?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`, { token }),
  getHand: (token: string, id: string) => call<{ hand: HandMeta; frames: ReplayFrame[] }>(`/api/hands/${encodeURIComponent(id)}`, { token }),
  requestAnalysis: (token: string, id: string) =>
    call<AnalysisResponse>(`/api/hands/${encodeURIComponent(id)}/analysis`, { method: 'POST', token }),
  getAnalysis: (token: string, id: string) => call<AnalysisResponse>(`/api/hands/${encodeURIComponent(id)}/analysis`, { token }),
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface HandListItem {
  handId: string;
  tableName: string;
  endedAt: string;
  bigBlind: number;
  seat: number;
  holeCards: Card[];
  board: Card[];
  net: number;
  analyzed: boolean;
}

export interface HandMeta {
  handId: string;
  tableName: string;
  bigBlind: number;
  maxSeats: number;
  heroSeat: number;
  seats: { seat: number; playerId: string; name: string; isBot: boolean; botLevel?: string; botStyle?: string }[];
}

export type LlmStatus = 'pending' | 'ok' | 'failed' | 'disabled' | 'limited';

export interface AnalysisResponse {
  decisions: DecisionReport[];
  llmStatus: LlmStatus;
  llmText: string | null;
}

export interface TableListing {
  roomId: string;
  clients: number;
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  seated: number;
  humans: number;
}

export interface CreateTableOptions {
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  bots: number;
  botLevel: 'beginner' | 'advanced';
  botStyle: string;
}

/** Mirror of the server's TableView (apps/server/src/table/TableActor.ts). */
export interface SeatView {
  seat: number;
  playerId: string;
  name: string;
  isBot: boolean;
  botLevel?: string;
  botStyle?: string;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  inHand: boolean;
}

export interface TableView {
  version: number;
  table: { tableId: string; name: string; maxSeats: number; smallBlind: number; bigBlind: number; buyIn: number; actionTimeoutMs: number };
  seats: (SeatView | null)[];
  you: { playerId: string | null; seat: number | null };
  hand: PlayerView | null;
  deadline: number | null;
  serverTime: number;
  handNo: number;
}
