import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { buildReplayFrames, reduce, type Card, type HandEvent, type HandResult, type ReplayFrame } from '@poker/core';
import type { Db } from '../db/client.js';
import { handAnalyses, handPlayers, hands } from '../db/schema.js';
import type { HandCompleteRecord, SeatSnapshot } from '../table/TableActor.js';

export type HandRecordInput = HandCompleteRecord;

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
  heroSeat: number;
  seats: Omit<SeatSnapshot, 'startStack'>[];
}

/** Persist one finished hand and one hand_players row per seat dealt in. */
export async function saveHand(db: Db, rec: HandRecordInput): Promise<void> {
  const s = rec.state;
  const start = rec.events[0];
  if (!start || start.type !== 'HandStarted' || !s.result) throw new Error('saveHand needs a finished hand');
  const endedAt = new Date(rec.endedAt);
  const final = new Map(s.result.finalStacks.map((f) => [f.seat, f.stack]));
  await db.transaction(async (tx) => {
    await tx.insert(hands).values({
      id: s.handId,
      tableId: rec.tableId,
      tableName: rec.tableName,
      handNo: rec.handNo,
      smallBlind: start.config.smallBlind,
      bigBlind: start.config.bigBlind,
      maxSeats: rec.maxSeats,
      button: start.button,
      seats: rec.seats,
      events: rec.events,
      result: s.result,
      startedAt: new Date(rec.startedAt),
      endedAt,
    });
    await tx.insert(handPlayers).values(
      rec.seats.map((seat) => ({
        handId: s.handId,
        playerId: seat.playerId,
        seat: seat.seat,
        net: (final.get(seat.seat) ?? seat.startStack) - seat.startStack,
        endedAt,
      })),
    );
  });
}

/** Cursor = "<endedAt ISO>|<handId>" of the last item on the previous page. */
export async function listHands(
  db: Db,
  playerId: string,
  q: { before?: string; limit?: number } = {},
): Promise<{ items: HandListItem[]; next: string | null }> {
  const limit = Math.max(1, Math.min(50, Math.floor(q.limit ?? 20)));
  let cursor = undefined;
  if (q.before) {
    const i = q.before.lastIndexOf('|');
    const at = new Date(q.before.slice(0, i));
    const id = q.before.slice(i + 1);
    if (i > 0 && !Number.isNaN(at.getTime())) {
      cursor = or(lt(handPlayers.endedAt, at), and(eq(handPlayers.endedAt, at), lt(handPlayers.handId, id)));
    }
  }
  const rows = await db
    .select({
      handId: hands.id,
      tableName: hands.tableName,
      endedAt: handPlayers.endedAt,
      bigBlind: hands.bigBlind,
      seat: handPlayers.seat,
      net: handPlayers.net,
      events: hands.events,
      analyzed: sql<boolean>`${handAnalyses.handId} is not null`,
    })
    .from(handPlayers)
    .innerJoin(hands, eq(hands.id, handPlayers.handId))
    .leftJoin(handAnalyses, and(eq(handAnalyses.handId, handPlayers.handId), eq(handAnalyses.playerId, handPlayers.playerId)))
    .where(cursor ? and(eq(handPlayers.playerId, playerId), cursor) : eq(handPlayers.playerId, playerId))
    .orderBy(desc(handPlayers.endedAt), desc(handPlayers.handId))
    .limit(limit + 1);

  const items = rows.slice(0, limit).map((r) => {
    const state = reduce(r.events as HandEvent[]);
    const me = state.players.find((p) => p.seat === r.seat);
    return {
      handId: r.handId,
      tableName: r.tableName,
      endedAt: r.endedAt.toISOString(),
      bigBlind: r.bigBlind,
      seat: r.seat,
      holeCards: me ? [...me.hole] : [],
      board: [...state.board],
      net: r.net,
      analyzed: !!r.analyzed,
    };
  });
  const last = items[items.length - 1];
  return { items, next: rows.length > limit && last ? `${last.endedAt}|${last.handId}` : null };
}

/** Load the raw hand for a participant (server-side use only: contains the deck). */
export async function loadHandForPlayer(
  db: Db,
  handId: string,
  playerId: string,
): Promise<
  | { status: 'ok'; meta: HandMeta; events: HandEvent[]; result: HandResult }
  | { status: 'forbidden' }
  | { status: 'not_found' }
> {
  const [h] = await db.select().from(hands).where(eq(hands.id, handId));
  if (!h) return { status: 'not_found' };
  const [me] = await db
    .select({ seat: handPlayers.seat })
    .from(handPlayers)
    .where(and(eq(handPlayers.handId, handId), eq(handPlayers.playerId, playerId)));
  if (!me) return { status: 'forbidden' };
  const seats = (h.seats as SeatSnapshot[]).map(({ startStack: _s, ...rest }) => rest);
  return {
    status: 'ok',
    meta: { handId: h.id, tableName: h.tableName, bigBlind: h.bigBlind, heroSeat: me.seat, seats },
    events: h.events as HandEvent[],
    result: h.result as HandResult,
  };
}

/** Replay for a participant: every frame projected for their seat. */
export async function getHandForPlayer(
  db: Db,
  handId: string,
  playerId: string,
): Promise<{ status: 'ok'; hand: HandMeta; frames: ReplayFrame[] } | { status: 'forbidden' } | { status: 'not_found' }> {
  const r = await loadHandForPlayer(db, handId, playerId);
  if (r.status !== 'ok') return r;
  return { status: 'ok', hand: r.meta, frames: buildReplayFrames(r.events, r.meta.heroSeat) };
}
