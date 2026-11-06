import { describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { getHandForPlayer, listHands, saveHand, type HandRecordInput } from '../src/history/repo.js';
import { C, F, X, play, startTable } from '../../../packages/strategy/test/helpers.js';

/** A finished 3-handed hand between p0, p1, p2 (button 0). Variant changes the action line. */
function record(handNo: number, endedAt: number, variant: 'fold' | 'showdown' = 'showdown'): HandRecordInput {
  const g = startTable(3, 0, undefined, undefined, handNo);
  if (variant === 'fold') play(g, F, F);
  else play(g, C, C, X, X, X, X, X, X, X, X, X, X);
  const state = g.state;
  if (state.street !== 'complete') throw new Error('test hand did not finish');
  const handId = `t1-${handNo}`;
  (g.events[0] as { handId: string }).handId = handId;
  return {
    tableId: 't1',
    tableName: '测试桌',
    maxSeats: 6,
    handNo,
    events: g.events,
    state: { ...state, handId },
    seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, name: `玩家${seat}`, isBot: false, startStack: 1000 })),
    startedAt: endedAt - 1000,
    endedAt,
  };
}

async function seeded(): Promise<Db> {
  const db = await createDb({ memory: true });
  await saveHand(db, record(1, Date.UTC(2026, 10, 6, 10, 0, 0)));
  await saveHand(db, record(2, Date.UTC(2026, 10, 6, 10, 5, 0)));
  await saveHand(db, record(3, Date.UTC(2026, 10, 6, 10, 5, 0), 'fold')); // same end time as #2
  return db;
}

describe('history repo', () => {
  it('lists my hands newest first with stable cursor pagination', async () => {
    const db = await seeded();
    const all = await listHands(db, 'p0', { limit: 50 });
    expect(all.items.map((h) => h.handId)).toEqual(['t1-3', 't1-2', 't1-1']);
    expect(all.next).toBeNull();
    const page1 = await listHands(db, 'p0', { limit: 2 });
    expect(page1.items.map((h) => h.handId)).toEqual(['t1-3', 't1-2']);
    expect(page1.next).not.toBeNull();
    const page2 = await listHands(db, 'p0', { limit: 2, before: page1.next! });
    expect(page2.items.map((h) => h.handId)).toEqual(['t1-1']);
    expect(page2.next).toBeNull();
  });

  it('list items carry my own hole cards, the board and my net result', async () => {
    const db = await seeded();
    const rec = record(2, 0);
    const [item] = (await listHands(db, 'p1', { limit: 50 })).items.filter((h) => h.handId === 't1-2');
    const me = rec.state.players.find((p) => p.seat === 1)!;
    expect(item!.holeCards).toEqual(me.hole);
    expect(item!.board).toEqual(rec.state.board);
    expect(item!.net).toBe(rec.state.result!.finalStacks.find((f) => f.seat === 1)!.stack - 1000);
    expect(item!.tableName).toBe('测试桌');
    expect(item!.analyzed).toBe(false);
  });

  it('only participants can open a replay', async () => {
    const db = await seeded();
    expect((await getHandForPlayer(db, 't1-2', 'stranger')).status).toBe('forbidden');
    expect((await getHandForPlayer(db, 'nope', 'p0')).status).toBe('not_found');
    const r = await getHandForPlayer(db, 't1-2', 'p0');
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.hand.heroSeat).toBe(0);
    expect(r.hand.maxSeats).toBe(6);
    expect(r.hand.seats.map((s) => s.name)).toEqual(['玩家0', '玩家1', '玩家2']);
    const endIdx = r.frames.map((f) => f.kind).lastIndexOf('action');
    r.frames.forEach((f, i) => {
      for (const s of f.view.seats) if (s.seat !== 0 && i < endIdx) expect(s.hole).toBeNull();
    });
    expect(JSON.stringify(r)).not.toContain('"deck"');
  });

});
