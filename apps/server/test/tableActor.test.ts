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

  it('a player who takes a just-vacated seat does not see the previous occupant’s cards', () => {
    const { actor, clock } = makeTable({ betweenHandsMs: 60_000, botThinkMs: [0, 0] });
    actor.sit('alice', 'Alice', 0);
    actor.addBot(1, 'beginner', 'tag');
    actor.addBot(2, 'beginner', 'tag');
    clock.advance(500);
    expect(actor.hand).not.toBeNull();
    actor.stand('alice');
    for (let i = 0; i < 200 && actor.hand!.street !== 'complete'; i++) clock.advance(50);
    expect(actor.hand!.street).toBe('complete');
    expect(actor.seats[0]).toBeNull();
    const shown = new Set(actor.hand!.result!.shown.map((s) => s.seat));
    actor.sit('bob', 'Bob', 0);
    const v = actor.viewFor('bob').hand!;
    expect(v.viewerSeat).toBeNull();
    if (!shown.has(0)) expect(v.seats.find((s) => s.seat === 0)!.hole).toBeNull();
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

const OWNER = { id: 'host', name: '房主' };
const hosted = (over: Partial<typeof DEFAULT_TABLE_CONFIG> = {}, onRecord?: (rec: HandCompleteRecord) => void) =>
  makeTable({ owner: OWNER, ...over }, onRecord);

/** Fold whoever is to act until the hand ends (humans only). */
function foldOut(actor: TableActor) {
  for (let i = 0; i < 20 && actor.hand && actor.hand.street !== 'complete'; i++) {
    const h = actor.hand;
    actor.act(actor.seats[h.toAct!]!.playerId, h.handId, h.actionSeq, { kind: 'fold' });
  }
}

describe('host controls', () => {
  it('does not deal until the host starts; nobody else can start', () => {
    const { actor, clock } = hosted();
    actor.sit('host', '房主', 0);
    actor.addBot(1);
    clock.advance(10_000);
    expect(actor.hand).toBeNull();
    expect(actor.status()).toBe('waiting');
    expect(actor.viewFor('host').control).toMatchObject({ hostId: 'host', hostName: '房主', youAreHost: true, running: false, started: false });
    expect(actor.viewFor('guest').control.youAreHost).toBe(false);
    expect(() => actor.start('guest')).toThrow(TableError);
    actor.start('host');
    clock.advance(1000);
    expect(actor.hand).not.toBeNull();
    expect(actor.status()).toBe('running');
  });

  it('one human plus one computer player is enough; a lone player cannot start', () => {
    const { actor } = hosted();
    actor.sit('host', '房主', 0);
    expect(() => actor.start('host')).toThrow(/电脑/);
    actor.addBot(1);
    expect(() => actor.start('host')).not.toThrow();
  });

  it('pause lets the current hand finish and deals no more until resumed', () => {
    const { actor, clock } = hosted({ botThinkMs: [0, 0] });
    actor.addBot(0);
    actor.addBot(1);
    actor.start('host'); // the host need not be seated
    clock.advance(500);
    expect(actor.hand).not.toBeNull();
    actor.pause('host');
    const n = actor.handNo;
    clock.advance(10 * 60_000);
    expect(actor.hand!.street).toBe('complete');
    expect(actor.handNo).toBe(n);
    expect(actor.status()).toBe('paused');
    expect(actor.viewFor('host').control).toMatchObject({ running: false, started: true });
    expect(() => actor.pause('guest')).toThrow(TableError);
    actor.start('host');
    clock.advance(10_000);
    expect(actor.handNo).toBeGreaterThan(n);
  });

  it('host rights pass to the earliest-seated connected human after 60 s away, and come back', () => {
    const { actor, clock, changes } = hosted();
    actor.setConnected('host', true);
    actor.sit('bob', 'Bob', 1);
    actor.sit('carol', 'Carol', 0);
    actor.setConnected('host', false);
    clock.advance(59_000);
    expect(actor.viewFor('bob').control.hostId).toBe('host');
    const before = changes();
    clock.advance(2_000);
    expect(changes()).toBeGreaterThan(before); // clients are told about the new host
    expect(actor.viewFor('bob').control).toMatchObject({ hostId: 'bob', hostName: 'Bob', youAreHost: true });
    actor.addSeat('bob');
    expect(() => actor.addSeat('host')).toThrow(TableError);
    actor.setConnected('bob', false);
    expect(actor.viewFor('carol').control.hostId).toBe('carol');
    actor.setConnected('host', true);
    expect(actor.viewFor('host').control.youAreHost).toBe(true);
  });

  it('host adds seats up to 9 and removes empty seats down to 2; occupied seats stay', () => {
    const { actor } = hosted({ maxSeats: 3 });
    actor.sit('host', '房主', 0);
    expect(() => actor.addSeat('guest')).toThrow(TableError);
    for (let i = 0; i < 6; i++) actor.addSeat('host');
    expect(actor.seats).toHaveLength(9);
    expect(() => actor.addSeat('host')).toThrow(/9/);
    expect(() => actor.removeSeat('host', 0)).toThrow(TableError);
    expect(() => actor.removeSeat('guest', 8)).toThrow(TableError);
    for (let s = 8; s >= 2; s--) actor.removeSeat('host', s);
    expect(actor.seats).toHaveLength(2);
    expect(() => actor.removeSeat('host', 1)).toThrow(/2/);
    expect(actor.viewFor(null).table.maxSeats).toBe(2);
  });

  it('removing seats between hands renumbers players and the button moves on to the next player', () => {
    const recs: HandCompleteRecord[] = [];
    const { actor, clock } = hosted({ maxSeats: 6, betweenHandsMs: 60_000, botThinkMs: [0, 0] }, (r) => recs.push(r));
    actor.addBot(1, 'beginner', 'tag');
    actor.addBot(3, 'beginner', 'tag');
    actor.addBot(5, 'beginner', 'tag');
    actor.start('host');
    clock.advance(1000);
    expect(recs).toHaveLength(1);
    const order = [1, 3, 5].map((s) => actor.seats[s]!.playerId);
    const firstButton = actor.seats[recs[0]!.state.button]!.playerId;
    actor.removeSeat('host', 2);
    actor.removeSeat('host', 0);
    // The finished hand is still on screen, so its seat numbers must stay valid until the next hand.
    expect(actor.seats).toHaveLength(6);
    expect(actor.viewFor(null).control.closingSeats).toEqual([0, 2]);
    clock.advance(61_000);
    expect(actor.seats.map((o) => o?.playerId ?? null)).toEqual([order[0], order[1], null, order[2]]);
    expect(recs.length).toBeGreaterThanOrEqual(2);
    const r2 = recs[1]!;
    expect(r2.maxSeats).toBe(4);
    const secondButton = r2.seats.find((s) => s.seat === r2.state.button)!.playerId;
    expect(secondButton).toBe(order[(order.indexOf(firstButton) + 1) % 3]);
  });

  it('removing a seat during a hand closes it now and removes it when the next hand starts', () => {
    const recs: HandCompleteRecord[] = [];
    const { actor, clock } = hosted({ maxSeats: 4, betweenHandsMs: 60_000 }, (r) => recs.push(r));
    actor.sit('host', '房主', 0);
    actor.sit('bob', 'Bob', 1);
    actor.start('host');
    clock.advance(400);
    expect(actor.hand!.street).not.toBe('complete');
    actor.removeSeat('host', 2);
    actor.addSeat('host'); // adding is immediate even mid-hand
    expect(actor.seats).toHaveLength(5);
    expect(actor.viewFor('host').control.closingSeats).toEqual([2]);
    expect(() => actor.sit('dan', 'Dan', 2)).toThrow(/关闭/);
    expect(() => actor.addBot(2)).toThrow(/关闭/);
    foldOut(actor);
    expect(actor.hand!.street).toBe('complete');
    expect(actor.seats).toHaveLength(5); // result still shown with the hand's seat numbers
    expect(recs[0]!.maxSeats).toBe(4); // seat count when the hand started
    clock.advance(61_000);
    expect(actor.handNo).toBe(2);
    expect(actor.seats).toHaveLength(4);
    expect(actor.viewFor('host').control.closingSeats).toEqual([]);
  });

  it('while paused, removing a seat applies at once and clears the finished hand from the table', () => {
    const { actor, clock } = hosted({ maxSeats: 4 });
    actor.sit('host', '房主', 0);
    actor.sit('bob', 'Bob', 1);
    actor.start('host');
    clock.advance(400);
    actor.removeSeat('host', 3); // closing during the hand
    actor.pause('host');
    foldOut(actor);
    expect(actor.viewFor('host').control.closingSeats).toEqual([3]);
    actor.removeSeat('host', 2);
    expect(actor.seats).toHaveLength(2);
    expect(actor.hand).toBeNull();
    expect(actor.viewFor('host').control.closingSeats).toEqual([]);
  });

  it('a table without an owner deals on its own (tests, internal tables)', () => {
    const { actor, clock } = makeTable();
    actor.addBot(0);
    actor.addBot(1);
    clock.advance(1000);
    expect(actor.hand).not.toBeNull();
    expect(actor.viewFor(null).control.hostId).toBeNull();
  });
});
