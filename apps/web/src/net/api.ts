import type { Card, PlayerView, ReplayFrame } from '@poker/core';
import type { DecisionReport } from '@poker/strategy';

/**
 * Dev: the API runs on :2567 next to the Vite dev server. Production: the server serves the
 * page itself, so API and WebSocket share the page's origin (behind Caddy / HTTPS).
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);

export const PROTOCOL_VERSION = 1;

export interface Session {
  token: string;
  playerId: string;
  /** Display name. */
  name: string;
  username: string;
  isAdmin: boolean;
}

/** Fired when any authenticated request gets 401; App logs the user out. */
export const AUTH_EXPIRED_EVENT = 'poker:auth-expired';

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
  if (res.status === 401 && init?.token) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  if (!res.ok) throw new HttpError(res.status, body.error ?? `请求失败 (${res.status})`);
  return body as T;
}

export const api = {
  login: (username: string, password: string) =>
    call<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (input: { username: string; displayName: string; password: string; inviteCode: string }) =>
    call<Session>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }),
  changePassword: (token: string, oldPassword: string, newPassword: string) =>
    call<Session>('/api/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }), token }),
  admin: {
    invites: (token: string) => call<InviteRow[]>('/api/admin/invites', { token }),
    createInvites: (token: string, count: number, expiresInDays: number | null) =>
      call<{ codes: string[] }>('/api/admin/invites', { method: 'POST', body: JSON.stringify({ count, expiresInDays }), token }),
    users: (token: string) => call<UserRow[]>('/api/admin/users', { token }),
    resetPassword: (token: string, id: string) =>
      call<{ password: string }>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', token }),
  },
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

export interface InviteRow {
  code: string;
  createdAt: string;
  expiresAt: string | null;
  usedBy: string | null;
  usedAt: string | null;
  reusable: boolean;
  uses: number;
}

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}

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
  status: 'waiting' | 'running' | 'paused';
  hostName: string | null;
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
  control: {
    hostId: string | null;
    hostName: string | null;
    youAreHost: boolean;
    running: boolean;
    started: boolean;
    closingSeats: number[];
  };
}

export const MAX_SEATS = 9;
export const MIN_SEATS = 2;
