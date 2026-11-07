import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { players } from '../db/schema.js';

/** Online = connected to a table, or seen within this window. */
export const ONLINE_WINDOW_MS = 5 * 60_000;
const SEEN_THROTTLE_MS = 60_000;

export async function recordLogin(db: Db, playerId: string): Promise<void> {
  await db
    .update(players)
    .set({ loginCount: sql`${players.loginCount} + 1`, lastLoginAt: sql`now()`, lastSeenAt: sql`now()` })
    .where(eq(players.id, playerId));
}

const lastWritten = new Map<string, number>();

/** Records last activity, writing at most once per minute per player. */
export async function touchSeen(db: Db, playerId: string, now: number = Date.now()): Promise<void> {
  const prev = lastWritten.get(playerId);
  if (prev !== undefined && now - prev < SEEN_THROTTLE_MS) return;
  lastWritten.set(playerId, now);
  try {
    await db.update(players).set({ lastSeenAt: new Date(now) }).where(eq(players.id, playerId));
  } catch (e) {
    lastWritten.delete(playerId);
    throw e;
  }
}

const atTable = new Map<string, number>();

export function tableJoined(playerId: string): void {
  atTable.set(playerId, (atTable.get(playerId) ?? 0) + 1);
}

export function tableLeft(playerId: string): void {
  const n = (atTable.get(playerId) ?? 0) - 1;
  if (n > 0) atTable.set(playerId, n);
  else atTable.delete(playerId);
}

export function isAtTable(playerId: string): boolean {
  return (atTable.get(playerId) ?? 0) > 0;
}
