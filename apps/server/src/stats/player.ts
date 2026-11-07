import { and, eq, gte } from 'drizzle-orm';
import { ENGINE_VERSION, summarizeDecisions, type DecisionInput, type DecisionReport, type PlayerStats } from '@poker/strategy';
import type { Db } from '../db/client.js';
import { handAnalyses, handPlayers, hands } from '../db/schema.js';
import { dayOf } from '../analysis/quota.js';

export type StatsRange = '7d' | '30d' | 'all';

const DAY_MS = 24 * 60 * 60_000;

/** Analysed hands (current engine version) of a player, oldest first, optionally only those ended at/after `sinceMs`. */
export async function loadDecisionInputs(db: Db, playerId: string, sinceMs?: number): Promise<DecisionInput[]> {
  const rows = await db
    .select({ handId: handAnalyses.handId, decisions: handAnalyses.decisions, endedAt: hands.endedAt, bigBlind: hands.bigBlind })
    .from(handAnalyses)
    .innerJoin(handPlayers, and(eq(handPlayers.handId, handAnalyses.handId), eq(handPlayers.playerId, handAnalyses.playerId)))
    .innerJoin(hands, eq(hands.id, handAnalyses.handId))
    .where(
      and(
        eq(handAnalyses.playerId, playerId),
        eq(handAnalyses.engineVersion, ENGINE_VERSION),
        ...(sinceMs === undefined ? [] : [gte(hands.endedAt, new Date(sinceMs))]),
      ),
    );
  return rows
    .sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime() || (a.handId < b.handId ? -1 : 1))
    .map((r) => ({ handId: r.handId, endedAt: r.endedAt.toISOString(), bigBlind: r.bigBlind, decisions: r.decisions as DecisionReport[] }));
}

export async function playerStats(db: Db, playerId: string, range: StatsRange, now = Date.now()): Promise<PlayerStats & { unanalyzed: number }> {
  const sinceMs = range === 'all' ? undefined : now - (range === '7d' ? 7 : 30) * DAY_MS;
  const inputs = await loadDecisionInputs(db, playerId, sinceMs);
  const played = await db
    .select({ handId: handPlayers.handId })
    .from(handPlayers)
    .where(and(eq(handPlayers.playerId, playerId), ...(sinceMs === undefined ? [] : [gte(handPlayers.endedAt, new Date(sinceMs))])));
  return { ...summarizeDecisions(inputs), unanalyzed: Math.max(0, played.length - inputs.length) };
}

export interface TrendDay {
  /** YYYY-MM-DD, Asia/Shanghai */
  day: string;
  hands: number;
  good: number;
  ok: number;
  mistake: number;
}

/** Per-day verdict counts for the last `days` days (including today); only days with analysed hands, ascending. */
export async function playerTrend(db: Db, playerId: string, days: number, now = Date.now()): Promise<TrendDay[]> {
  const firstDay = dayOf(new Date(now - (days - 1) * DAY_MS));
  const inputs = await loadDecisionInputs(db, playerId, now - days * DAY_MS);
  const byDay = new Map<string, TrendDay>();
  for (const h of inputs) {
    const day = dayOf(new Date(h.endedAt));
    if (day < firstDay) continue;
    const t = byDay.get(day) ?? { day, hands: 0, good: 0, ok: 0, mistake: 0 };
    t.hands++;
    for (const d of h.decisions) t[d.verdict]++;
    byDay.set(day, t);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}
