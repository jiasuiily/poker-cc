import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sanitizeName } from './auth.js';
import type { Db } from './db/client.js';
import { players } from './db/schema.js';

/** Nickname is the identity (spec 4.4): same trimmed nickname → same player id. */
export async function findOrCreatePlayer(db: Db, nickname: unknown): Promise<{ id: string; nickname: string }> {
  const name = sanitizeName(nickname);
  await db.insert(players).values({ id: `p_${randomUUID()}`, nickname: name }).onConflictDoNothing({ target: players.nickname });
  const [row] = await db.select({ id: players.id, nickname: players.nickname }).from(players).where(eq(players.nickname, name));
  if (!row) throw new Error('player not found after insert');
  return row;
}
