import { describe, expect, it } from 'vitest';
import { applyEvent, legalActions, projectView, reduce, timeoutAction, IllegalActionError, parseCards } from '../src/index.js';
import { act, finalOf, start } from './helpers.js';

describe('positions & order', () => {
  it('heads-up: button is SB and acts first preflop, last postflop', () => {
    const g = start({ stacks: [100, 100], holes: ['Ah Ad', 'Kh Kd'] });
    expect(g.state.sbSeat).toBe(0);
    expect(g.state.bbSeat).toBe(1);
    expect(g.state.toAct).toBe(0);
    act(g, 0, { kind: 'call' });
    expect(g.state.toAct).toBe(1); // BB option
    act(g, 1, { kind: 'check' });
    expect(g.state.street).toBe('flop');
    expect(g.state.toAct).toBe(1); // BB first postflop
  });

  it('3-handed: button acts first preflop, SB first postflop', () => {
    const g = start({ stacks: [100, 100, 100], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    expect([g.state.sbSeat, g.state.bbSeat, g.state.toAct]).toEqual([1, 2, 0]);
    act(g, 0, { kind: 'call' });
    act(g, 1, { kind: 'call' });
    act(g, 2, { kind: 'check' });
    expect(g.state.street).toBe('flop');
    expect(g.state.toAct).toBe(1);
  });

  it('dealing gives the SB the first card', () => {
    const g = start({ stacks: [100, 100, 100], holes: ['As Ks', 'Qs Js', 'Ts 9s'] });
    expect(g.state.players[1]!.hole).toEqual(parseCards('As Ks'));
    expect(g.state.players[0]!.hole).toEqual(parseCards('Ts 9s'));
  });
});

describe('betting rules', () => {
  it('min raise = max(BB, last raise increment)', () => {
    const g = start({ stacks: [1000, 1000, 1000], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    expect(legalActions(g.state)!.raise).toEqual({ min: 20, max: 1000 });
    act(g, 0, { kind: 'raise', to: 35 }); // increment 25
    expect(legalActions(g.state)!.raise!.min).toBe(60);
    expect(() => act(g, 1, { kind: 'raise', to: 59 })).toThrow(IllegalActionError);
  });

  it('postflop min bet is the big blind', () => {
    const g = start({ stacks: [1000, 1000], holes: ['2c 3c', '4c 5c'] });
    act(g, 0, { kind: 'call' });
    act(g, 1, { kind: 'check' });
    expect(legalActions(g.state)!.raise).toEqual({ min: 10, max: 990 });
    expect(legalActions(g.state)!.canCheck).toBe(true);
    expect(legalActions(g.state)!.canFold).toBe(false);
  });

  it('incomplete all-in raise does not reopen betting for players who acted', () => {
    // button 0 (UTG 3-handed), SB 1, BB 2 with 40 chips
    const g = start({ stacks: [1000, 1000, 40], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    act(g, 0, { kind: 'raise', to: 30 }); // full raise, increment 20
    act(g, 1, { kind: 'call' });
    act(g, 2, { kind: 'raise', to: 40 }); // all-in, increment 10 < 20: incomplete
    expect(g.state.toAct).toBe(0);
    const la = legalActions(g.state)!;
    expect(la.raise).toBeNull();
    expect(la.toCall).toBe(10);
    act(g, 0, { kind: 'call' });
    expect(legalActions(g.state)!.raise).toBeNull();
  });

  it('full raise reopens betting', () => {
    const g = start({ stacks: [1000, 1000, 1000], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    act(g, 0, { kind: 'raise', to: 30 });
    act(g, 1, { kind: 'call' });
    act(g, 2, { kind: 'raise', to: 50 });
    expect(legalActions(g.state)!.raise!.min).toBe(70);
  });

  it('timeout: check when free, otherwise fold', () => {
    const g = start({ stacks: [100, 100], holes: ['2c 3c', '4c 5c'] });
    expect(timeoutAction(g.state)).toEqual({ kind: 'fold' });
    act(g, 0, { kind: 'call' });
    expect(timeoutAction(g.state)).toEqual({ kind: 'check' });
  });

  it('rejects stale or out-of-turn actions', () => {
    const g = start({ stacks: [100, 100], holes: ['2c 3c', '4c 5c'] });
    expect(() => applyEvent(g.state, { type: 'Action', seat: 0, seq: 5, action: { kind: 'call' } })).toThrow(/seq/);
    expect(() => act(g, 1, { kind: 'check' })).toThrow(/turn/);
  });

  it('short big blind all-in still makes others call the full big blind; excess refunded', () => {
    // heads-up: seat0 SB, seat1 BB has only 6
    const g = start({ stacks: [100, 6], holes: ['Ah Ad', 'Kh Kd'] });
    expect(g.state.players[1]!.allIn).toBe(true);
    act(g, 0, { kind: 'call' });
    expect(g.state.street).toBe('complete');
    expect(g.state.result!.refunds).toEqual([{ seat: 0, amount: 4 }]);
    expect(finalOf(g.state, 0) + finalOf(g.state, 1)).toBe(106);
  });
});

describe('settlement', () => {
  it('uncontested: blinds go to the remaining player', () => {
    const g = start({ stacks: [100, 100, 100], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    act(g, 0, { kind: 'fold' });
    act(g, 1, { kind: 'fold' });
    expect(g.state.street).toBe('complete');
    expect(g.state.result!.uncontested).toBe(true);
    expect(g.state.result!.shown).toEqual([]);
    expect(finalOf(g.state, 2)).toBe(105);
    expect(finalOf(g.state, 1)).toBe(95);
  });

  it('refunds the uncalled part of a bet', () => {
    const g = start({ stacks: [200, 50], holes: ['Ah Ad', 'Kh Kd'], board: '2c 7d 9h Js 4c' });
    act(g, 0, { kind: 'raise', to: 200 });
    act(g, 1, { kind: 'call' });
    const r = g.state.result!;
    expect(r.refunds).toEqual([{ seat: 0, amount: 150 }]);
    expect(r.pots.map((p) => p.amount)).toEqual([100]);
    expect(finalOf(g.state, 0)).toBe(250);
    expect(finalOf(g.state, 1)).toBe(0);
    expect(g.state.runout).toBe(true);
    expect(r.shown.map((s) => s.seat).sort()).toEqual([0, 1]);
  });

  it('builds side pots for multiple all-ins', () => {
    // button 0, SB 1, BB 2, UTG 3. Deal from SB: seat1, seat2, seat3, seat0
    const g = start({
      stacks: [100, 300, 300, 50],
      holes: ['Qh Qd', 'Jh Jd', 'Ah Ad', 'Kh Kd'],
      board: '2c 7d 9s 3h 4c',
    });
    act(g, 3, { kind: 'raise', to: 50 });
    act(g, 0, { kind: 'raise', to: 100 });
    act(g, 1, { kind: 'raise', to: 300 });
    act(g, 2, { kind: 'call' });
    const r = g.state.result!;
    expect(r.refunds).toEqual([]);
    expect(r.pots.map((p) => [p.amount, [...p.eligible].sort()])).toEqual([
      [200, [0, 1, 2, 3]],
      [150, [0, 1, 2]],
      [400, [1, 2]],
    ]);
    expect(finalOf(g.state, 3)).toBe(200);
    expect(finalOf(g.state, 0)).toBe(150);
    expect(finalOf(g.state, 1)).toBe(400);
    expect(finalOf(g.state, 2)).toBe(0);
  });

  it('splits a pot and gives the odd chip to the first winner left of the button', () => {
    const g = start({
      stacks: [100, 100, 100],
      holes: ['2c 3d', '4c 5d', '6c 7d'],
      board: 'As Ks Qs Js Ts',
    });
    act(g, 0, { kind: 'call' });
    act(g, 1, { kind: 'fold' });
    act(g, 2, { kind: 'check' });
    for (let i = 0; i < 3; i++) {
      act(g, 2, { kind: 'check' });
      act(g, 0, { kind: 'check' });
    }
    const r = g.state.result!;
    expect(r.pots).toHaveLength(1);
    expect(r.pots[0]!.winners).toEqual([
      { seat: 2, amount: 13 },
      { seat: 0, amount: 12 },
    ]);
  });

  it('when the river is checked through, the first player left of the button shows first', () => {
    const g = start({ stacks: [100, 100], holes: ['Ah Ad', '7c 2d'], board: 'Ks 9h 5c 4d 3s' });
    act(g, 0, { kind: 'call' });
    act(g, 1, { kind: 'check' });
    for (let i = 0; i < 3; i++) {
      act(g, 1, { kind: 'check' });
      act(g, 0, { kind: 'check' });
    }
    expect(g.state.result!.shown.map((s) => s.seat)).toEqual([1, 0]);
  });

  it('a losing caller who need not show stays hidden', () => {
    const g = start({ stacks: [100, 100], holes: ['7c 2d', 'Ah Ad'], board: 'Ks 9h 5c 4d Js' });
    act(g, 0, { kind: 'call' });
    act(g, 1, { kind: 'check' });
    for (let i = 0; i < 2; i++) {
      act(g, 1, { kind: 'check' });
      act(g, 0, { kind: 'check' });
    }
    act(g, 1, { kind: 'raise', to: 20 });
    act(g, 0, { kind: 'call' });
    expect(g.state.result!.shown.map((s) => s.seat)).toEqual([1]);
    const view = projectView(g.state, null);
    expect(view.seats.find((s) => s.seat === 0)!.hole).toBeNull();
  });
});

describe('event sourcing & views', () => {
  it('replaying the event log reproduces the state', () => {
    const g = start({ stacks: [100, 100, 100], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    act(g, 0, { kind: 'raise', to: 25 });
    act(g, 1, { kind: 'call' });
    act(g, 2, { kind: 'fold' });
    expect(reduce(g.events)).toEqual(g.state);
  });

  it('views never contain hidden hole cards before showdown', () => {
    const g = start({ stacks: [100, 100, 100], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    const spectator = projectView(g.state, null);
    expect(spectator.seats.every((s) => s.hole === null)).toBe(true);
    const v1 = projectView(g.state, 1);
    expect(v1.seats.filter((s) => s.hole !== null).map((s) => s.seat)).toEqual([1]);
    expect(JSON.stringify(spectator)).not.toContain('deck');
    expect(v1.legal).toBeNull();
    expect(projectView(g.state, 0).legal).not.toBeNull();
  });
});
