import { randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import type { PlayerAction } from '@poker/core';
import type { BotLevel, StyleId } from '@poker/ai';
import { verifyToken, type AuthUser } from '../auth.js';
import { getDb } from '../db/client.js';
import { saveHand } from '../history/repo.js';
import { trackSave } from '../persistence.js';
import { DEFAULT_TABLE_CONFIG, MAX_SEATS, MIN_SEATS, TableActor, TableError, type TableStatus } from '../table/TableActor.js';

export const PROTOCOL_VERSION = 1;

export interface TableRoomOptions {
  name?: string;
  maxSeats?: number;
  smallBlind?: number;
  bigBlind?: number;
  bots?: number;
  botLevel?: BotLevel;
  botStyle?: StyleId | 'random';
  /** Set by the create-table API from the logged-in user. */
  owner?: { id: string; name: string };
  /** Must equal SERVER_CREATE_KEY for `owner` to be trusted (clients can create rooms directly). */
  serverKey?: string;
}

/** Per-process secret: only room creations from our own API may name an owner. */
export const SERVER_CREATE_KEY = randomUUID();

/** Save with up to 2 retries; failures are logged and never affect the table (spec 4.3). */
async function persistHand(rec: Parameters<typeof saveHand>[1], log: (m: string) => void) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await saveHand(await getDb(), rec);
      return;
    } catch (e) {
      if (attempt === 2) log(`failed to save hand ${rec.state.handId}: ${e instanceof Error ? e.message : String(e)}`);
      else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

export interface TableMetadata {
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  seated: number;
  humans: number;
  status: TableStatus;
  hostName: string | null;
}

type PokerClient = Client<{ auth: AuthUser }>;

const IDLE_DISPOSE_MS = 10 * 60_000;

/**
 * Colyseus is used only for rooms, matchmaking and transport. There is no shared Schema
 * state: after every change each client gets its own projected view ('state' message),
 * so hidden cards can never be broadcast by accident.
 */
export class TableRoom extends Room<{ metadata: TableMetadata; client: PokerClient }> {
  maxClients = 40;
  autoDispose = false;
  private actor!: TableActor;
  private idleTimer: (() => void) | null = null;

  onCreate(options: TableRoomOptions) {
    const maxSeats = clampInt(options.maxSeats, MIN_SEATS, MAX_SEATS, 6);
    const o = options.serverKey === SERVER_CREATE_KEY ? options.owner : undefined;
    const owner = o && typeof o.id === 'string' && typeof o.name === 'string' ? { id: o.id, name: o.name } : null;
    const bb = clampInt(options.bigBlind, 2, 10_000, 10);
    const sb = clampInt(options.smallBlind, 1, bb, Math.floor(bb / 2));
    this.actor = new TableActor(
      {
        ...DEFAULT_TABLE_CONFIG,
        tableId: this.roomId,
        name: String(options.name ?? '').slice(0, 24) || `牌桌 ${this.roomId.slice(0, 4)}`,
        maxSeats,
        smallBlind: sb,
        bigBlind: bb,
        buyIn: bb * 100,
        owner,
      },
      {
        randomInt: (max) => cryptoRandomInt(max),
        rng: () => cryptoRandomInt(1 << 30) / (1 << 30),
        now: Date.now,
        // Native timers: the Colyseus room clock only ticks with a patch/simulation interval,
        // which this state-less room does not have. The actor cancels its timers on dispose.
        setTimer: (fn, ms) => {
          const t = setTimeout(() => {
            try {
              fn();
            } catch (e) {
              console.error(`[table ${this.roomId}] timer task failed`, e);
            }
          }, ms);
          return () => clearTimeout(t);
        },
        onChange: () => this.broadcastViews(),
        log: (m) => console.log(`[table ${this.roomId}] ${m}`),
        onHandComplete: (rec) => void trackSave(persistHand(rec, (m) => console.error(`[table ${this.roomId}] ${m}`))),
      },
    );
    const bots = clampInt(options.bots, 0, maxSeats - 1, 0);
    const level = options.botLevel === 'beginner' ? 'beginner' : 'advanced';
    for (let i = 0; i < bots; i++) this.actor.addBot(maxSeats - 1 - i, level, options.botStyle ?? 'random');

    this.onMessage('sit', (c: PokerClient, m: { seat: number }) => this.run(c, () => this.actor.sit(c.auth!.playerId, c.auth!.name, Number(m?.seat))));
    this.onMessage('stand', (c: PokerClient) => this.run(c, () => this.actor.stand(c.auth!.playerId)));
    this.onMessage('rebuy', (c: PokerClient) => this.run(c, () => this.actor.rebuy(c.auth!.playerId)));
    this.onMessage('sitOut', (c: PokerClient, m: { value: boolean }) =>
      this.run(c, () => this.actor.setSittingOut(c.auth!.playerId, !!m?.value)),
    );
    this.onMessage('addBot', (c: PokerClient, m: { seat: number; level?: BotLevel; style?: StyleId | 'random' }) =>
      this.run(c, () => this.actor.addBot(Number(m?.seat), m?.level ?? 'advanced', m?.style ?? 'random')),
    );
    this.onMessage('removeBot', (c: PokerClient, m: { seat: number }) => this.run(c, () => this.actor.removeBot(Number(m?.seat))));
    this.onMessage('start', (c: PokerClient) => this.run(c, () => this.actor.start(c.auth!.playerId)));
    this.onMessage('pause', (c: PokerClient) => this.run(c, () => this.actor.pause(c.auth!.playerId)));
    this.onMessage('addSeat', (c: PokerClient) => this.run(c, () => this.actor.addSeat(c.auth!.playerId)));
    this.onMessage('removeSeat', (c: PokerClient, m: { seat: number }) =>
      this.run(c, () => this.actor.removeSeat(c.auth!.playerId, Number(m?.seat))),
    );
    this.onMessage('act', (c: PokerClient, m: { handId: string; seq: number; action: PlayerAction }) =>
      this.run(c, () => this.actor.act(c.auth!.playerId, String(m?.handId), Number(m?.seq), parseAction(m?.action))),
    );
    this.onMessage('sync', (c: PokerClient) => c.send('state', this.actor.viewFor(c.auth!.playerId)));
    this.updateMetadata();
  }

  async onAuth(_client: Client, options: { token?: string; protocol?: number }) {
    if (options?.protocol !== PROTOCOL_VERSION) throw new Error('客户端版本过旧，请刷新页面');
    return verifyToken(options.token, await getDb());
  }

  onJoin(client: PokerClient) {
    this.idleTimer?.();
    this.idleTimer = null;
    this.actor.setConnected(client.auth!.playerId, true);
    client.send('state', this.actor.viewFor(client.auth!.playerId));
  }

  onLeave(client: PokerClient) {
    const stillHere = this.clients.some((c) => c !== client && (c as PokerClient).auth?.playerId === client.auth!.playerId);
    if (!stillHere) this.actor.setConnected(client.auth!.playerId, false);
    if (this.clients.length === 0) {
      const t = setTimeout(() => void this.disconnect(), IDLE_DISPOSE_MS);
      this.idleTimer = () => clearTimeout(t);
    }
  }

  onDispose() {
    this.idleTimer?.();
    this.actor?.dispose();
  }

  private run(client: PokerClient, fn: () => void) {
    try {
      fn();
    } catch (e) {
      const code = e instanceof TableError ? e.code : 'error';
      const message = e instanceof Error ? e.message : String(e);
      if (!(e instanceof TableError)) console.error(e);
      client.send('error', { code, message });
      if (code === 'stale') client.send('state', this.actor.viewFor(client.auth!.playerId));
    }
  }

  private broadcastViews() {
    for (const c of this.clients as PokerClient[]) {
      if (c.auth) c.send('state', this.actor.viewFor(c.auth!.playerId));
    }
    this.updateMetadata();
  }

  private updateMetadata() {
    const cfg = this.actor.config;
    const seated = this.actor.seats.filter(Boolean).length;
    void this.setMetadata({
      name: cfg.name,
      maxSeats: this.actor.seats.length,
      smallBlind: cfg.smallBlind,
      bigBlind: cfg.bigBlind,
      seated,
      humans: this.actor.humanCount(),
      status: this.actor.status(),
      hostName: this.actor.viewFor(null).control.hostName,
    });
  }
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

function parseAction(a: unknown): PlayerAction {
  const o = (a ?? {}) as { kind?: string; to?: unknown };
  switch (o.kind) {
    case 'fold':
    case 'check':
    case 'call':
      return { kind: o.kind };
    case 'raise':
      return { kind: 'raise', to: Math.floor(Number(o.to)) };
    default:
      throw new TableError('illegal', '无效操作');
  }
}
