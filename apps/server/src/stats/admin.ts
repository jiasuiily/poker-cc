import { and, eq, isNotNull } from 'drizzle-orm';
import { summarizeDecisions } from '@poker/strategy';
import type { Db } from '../db/client.js';
import { coachReports, handPlayers, hands, players } from '../db/schema.js';
import { ONLINE_WINDOW_MS, isAtTable } from '../accounts/activity.js';
import { loadDecisionInputs } from './player.js';
import { playSessions } from './sessions.js';

export interface AdminPlayerRow {
  id: string;
  displayName: string;
  username: string;
  online: boolean;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  loginCount: number;
  hands: number;
  playSeconds: number;
  analyzedHands: number;
  good: number;
  ok: number;
  mistake: number;
  evLossPerHand: number;
  reports: number;
}

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Activity and review statistics for every account with a username (family scale, no paging). */
export async function adminPlayers(
  db: Db,
  now: number = Date.now(),
): Promise<{ total: number; onlineNow: number; active7d: number; players: AdminPlayerRow[] }> {
  const accounts = await db.select().from(players).where(isNotNull(players.username));

  const handRows = await db
    .select({ playerId: handPlayers.playerId, startedAt: hands.startedAt, endedAt: hands.endedAt })
    .from(handPlayers)
    .innerJoin(hands, eq(hands.id, handPlayers.handId));
  const handsBy = new Map<string, { startedAt: Date; endedAt: Date }[]>();
  for (const h of handRows) {
    const list = handsBy.get(h.playerId) ?? [];
    list.push({ startedAt: h.startedAt, endedAt: h.endedAt });
    handsBy.set(h.playerId, list);
  }

  const okReports = await db.select({ playerId: coachReports.playerId }).from(coachReports).where(eq(coachReports.status, 'ok'));
  const reportsBy = new Map<string, number>();
  for (const r of okReports) reportsBy.set(r.playerId, (reportsBy.get(r.playerId) ?? 0) + 1);

  const rows: AdminPlayerRow[] = [];
  for (const p of accounts) {
    const mine = handsBy.get(p.id) ?? [];
    const stats = summarizeDecisions(await loadDecisionInputs(db, p.id));
    const seen = p.lastSeenAt?.getTime() ?? null;
    rows.push({
      id: p.id,
      displayName: p.nickname,
      username: p.username!,
      online: isAtTable(p.id) || (seen !== null && now - seen < ONLINE_WINDOW_MS),
      lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
      lastLoginAt: p.lastLoginAt?.toISOString() ?? null,
      loginCount: p.loginCount,
      hands: mine.length,
      playSeconds: playSessions(mine).seconds,
      analyzedHands: stats.hands,
      good: stats.good,
      ok: stats.ok,
      mistake: stats.mistake,
      evLossPerHand: stats.evLossPerHand,
      reports: reportsBy.get(p.id) ?? 0,
    });
  }

  const created = new Map(accounts.map((p) => [p.id, p.createdAt.getTime()]));
  rows.sort((a, b) => {
    const sa = a.lastSeenAt === null ? null : Date.parse(a.lastSeenAt);
    const sb = b.lastSeenAt === null ? null : Date.parse(b.lastSeenAt);
    if (sa !== sb) {
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa;
    }
    return created.get(a.id)! - created.get(b.id)!;
  });

  return {
    total: rows.length,
    onlineNow: rows.filter((r) => r.online).length,
    active7d: rows.filter((r) => r.lastSeenAt !== null && now - Date.parse(r.lastSeenAt) < ACTIVE_WINDOW_MS).length,
    players: rows,
  };
}
