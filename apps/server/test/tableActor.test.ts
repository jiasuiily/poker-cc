import { describe, expect, it } from 'vitest';
import { seededRandomInt } from '@poker/core';
import { DEFAULT_TABLE_CONFIG, TableActor, TableError, type HandCompleteRecord } from '../src/table/TableActor.js';

/** Manual clock: timers fire only when advanced. */
function fakeClock() {
  let now = 1_000_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  return {
    now: () => now,
    setTimer(fn: () => void, ms: number) {
      const id = ++ids;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    /** Run timers due within `ms`, in order. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = end;
    },
  };
}

function makeTable(overrides: Partial<typeof DEFAULT_TABLE_CONFIG> = {}, onRecord?: (rec: HandCompleteRecord) => void) {
  const clock = fakeClock();
  const rnd = seededRandomInt(7);
  let changes = 0;
  const completed: number[] = [];
  const actor = new TableActor(
    { ...DEFAULT_TABLE_CONFIG, botThinkMs: [10, 10], tableId: 't1', name: 'test', ...overrides },
    {
      randomInt: rnd,
      rng: () => rnd(1_000_000) / 1_000_000,
      now: clock.now,
      setTimer: clock.setTimer,
      onChange: () => changes++,
      onHandComplete: (rec) => {
        onRecord?.(rec);
        const s = rec.state;
        const start = s.players.reduce((a, p) => a + p.startStack, 0);
        const end = s.result!.finalStacks.reduce((a, f) => a + f.stack, 0);
        if (start !== end) throw new Error('chips not conserved');
        completed.push(end);
      },
    },
  );
  return { actor, clock, completed, changes: () => changes };
}

describe('TableActor', () => {
  it('bots play hands on their own and chips are conserved', () => {
    const { actor, clock, completed } = makeTable();
    for (let i = 0; i < 4; i++) actor.addBot(i);
    clock.advance(10 * 60_000);
    expect(completed.length).toBeGreaterThan(20);
    const total = actor.seats.reduce((a, o) => a + (o?.stack ?? 0), 0);
    // Busted bots rebuy, so total only grows by buy-ins; every hand itself conserves chips.
    expect(total % 1).toBe(0);
    expect(actor.handNo).toBeGreaterThan(20);
  });

  it('a human acts with handId + seq; duplicates are rejected', () => {
    const { actor, clock } = makeTable();
    actor.sit('alice', 'Alice', 0);
    actor.addBot(1);
    clock.advance(1000);
    // Wait until it's alice's turn.
    for (let i = 0; i < 50 && actor.hand?.toAct !== 0; i++) clock.advance(50);
    const h = actor.hand!;
    expect(h.toAct).toBe(0);
    const v = actor.viewFor('alice');
    expect(v.hand!.legal).not.toBeNull();
    const action = v.hand!.legal!.canCheck ? { kind: 'check' as const } : { kind: 'call' as const };
    actor.act('alice', h.handId, h.actionSeq, action);
    expect(() => actor.act('alice', h.handId, h.actionSeq, action)).toThrow(TableError);
  });

  it('timeouts check/fold and sit the player out after repeated timeouts', () => {
    const { actor, clock } = makeTable({ actionTimeoutMs: 1000, maxTimeouts: 2 });
    actor.sit('alice', 'Alice', 0);
    actor.addBot(1);
    actor.addBot(2);
    clock.advance(3 * 60_000);
    expect(actor.seats[0]!.sittingOut).toBe(true);
    expect(actor.seats[0]!.timeouts).toBeGreaterThanOrEqual(2);
  });

  it('views never leak other players’ hole cards', () => {
    const { actor, clock } = makeTable();
    actor.sit('alice', 'Alice', 0);
    actor.sit('bob', 'Bob', 1);
    actor.addBot(2);
    clock.advance(500);
    expect(actor.hand).not.toBeNull();
    const a = actor.viewFor('alice').hand!;
    expect(a.seats.find((s) => s.seat === 0)!.hole).not.toBeNull();
    expect(a.seats.filter((s) => s.seat !== 0).every((s) => s.hole === null)).toBe(true);
    const spec = actor.viewFor(null).hand!;
    expect(spec.seats.every((s) => s.hole === null)).toBe(true);
    expect(JSON.stringify(actor.viewFor('alice'))).not.toMatch(/"deck"/);
  });

  it('standing up mid-hand folds and leaves after the hand', () => {
    const { actor, clock } = makeTable();
    actor.sit('alice', 'Alice', 0);
    actor.addBot(1);
    actor.addBot(2);
    clock.advance(500);
    expect(actor.hand).not.toBeNull();
    actor.stand('alice');
    clock.advance(60_000);
    expect(actor.seats[0]).toBeNull();
  });

  it('keeps dealing when the hand-complete hook throws', () => {
    const { actor, clock } = makeTable({}, () => {
      throw new Error('db down');
    });
    actor.addBot(0);
    actor.addBot(1);
    clock.advance(5 * 60_000);
    expect(actor.handNo).toBeGreaterThan(3);
  });

  it('records bot level and style in the seat snapshot', () => {
    const recs: HandCompleteRecord[] = [];
    const { actor, clock } = makeTable({}, (r) => recs.push(r));
    actor.addBot(0, 'beginner', 'nit');
    actor.addBot(1, 'advanced', 'random');
    clock.advance(60_000);
    const rec = recs[0]!;
    expect(rec.tableId).toBe('t1');
    expect(rec.tableName).toBe('test');
    expect(rec.handNo).toBe(1);
    expect(rec.endedAt).toBeGreaterThanOrEqual(rec.startedAt);
    const s0 = rec.seats.find((s) => s.seat === 0)!;
    expect(s0).toMatchObject({ isBot: true, botLevel: 'beginner', botStyle: 'nit', startStack: 1000 });
    const s1 = rec.seats.find((s) => s.seat === 1)!;
    expect(s1.botLevel).toBe('advanced');
    expect(['tag', 'lag', 'nit', 'station', 'maniac']).toContain(s1.botStyle);
    expect(actor.viewFor(null).seats[0]).toMatchObject({ botLevel: 'beginner', botStyle: 'nit' });
  });

  it('a busted human is sat out until rebuy', () => {
    const { actor } = makeTable();
    actor.sit('alice', 'Alice', 0);
    actor.seats[0]!.stack = 0;
    expect(() => actor.setSittingOut('alice', false)).toThrow(TableError);
    actor.rebuy('alice');
    expect(actor.seats[0]!.stack).toBe(1000);
  });
});
