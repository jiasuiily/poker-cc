import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { llmUsage } from '../db/schema.js';

export type UsageKind = 'hand' | 'batch' | 'report';

/** YYYY-MM-DD in Asia/Shanghai. */
export const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);

/** Count one LLM use for today under `kind`; false when that kind's daily limit is already reached. */
export async function takeQuota(db: Db, playerId: string, kind: UsageKind, limit: number): Promise<boolean> {
  const day = dayOf(new Date());
  const [row] = await db
    .insert(llmUsage)
    .values({ playerId, day, kind, count: 1 })
    .onConflictDoUpdate({ target: [llmUsage.playerId, llmUsage.day, llmUsage.kind], set: { count: sql`${llmUsage.count} + 1` } })
    .returning({ count: llmUsage.count });
  return (row?.count ?? 1) <= limit;
}

/** How many uses of `kind` were counted today (including refused attempts). */
export async function usedToday(db: Db, playerId: string, kind: UsageKind): Promise<number> {
  const [row] = await db
    .select({ count: llmUsage.count })
    .from(llmUsage)
    .where(and(eq(llmUsage.playerId, playerId), eq(llmUsage.day, dayOf(new Date())), eq(llmUsage.kind, kind)));
  return row?.count ?? 0;
}
