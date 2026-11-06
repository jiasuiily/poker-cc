import { describe, expect, it } from 'vitest';
import { buildReplayFrames } from '../src/index.js';
import { act, start } from './helpers.js';

describe('action log', () => {
  it('records bet vs raise with street and total commitment', () => {
    const g = start({ stacks: [1000, 1000, 1000], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    act(g, 0, { kind: 'raise', to: 30 });
    act(g, 1, { kind: 'call' });
    act(g, 2, { kind: 'call' });
    expect(g.state.log[0]).toEqual({ seq: 0, seat: 0, street: 'preflop', kind: 'raise', to: 30, allIn: false });
    expect(g.state.log[1]).toMatchObject({ seat: 1, kind: 'call', to: 30 });
    act(g, 1, { kind: 'raise', to: 10 });
    expect(g.state.log[3]).toMatchObject({ seat: 1, street: 'flop', kind: 'bet', to: 10 });
  });

  it('is exposed in every player view as history', () => {
    const g = start({ stacks: [1000, 1000], holes: ['2c 3c', '4c 5c'] });
    act(g, 0, { kind: 'call' });
    const frames = buildReplayFrames(g.events, null);
    expect(frames.at(-1)!.view.history).toEqual(g.state.log);
  });

  it('marks all-in actions', () => {
    const g = start({ stacks: [100, 1000], holes: ['2c 3c', '4c 5c'] });
    act(g, 0, { kind: 'raise', to: 100 });
    expect(g.state.log[0]).toMatchObject({ kind: 'raise', to: 100, allIn: true });
  });
});

describe('replay frames', () => {
  it('start + one per action + one per new street', () => {
    const g = start({ stacks: [1000, 1000], holes: ['2c 3c', '4c 5c'] });
    act(g, 0, { kind: 'call' });
    act(g, 1, { kind: 'check' });
    for (let i = 0; i < 3; i++) {
      act(g, 1, { kind: 'check' });
      act(g, 0, { kind: 'check' });
    }
    const frames = buildReplayFrames(g.events, 0);
    // The action that closes a street is shown before the new cards arrive.
    expect(frames[2]!.view.board).toHaveLength(0);
    expect(frames[3]!.view.board).toHaveLength(3);
    const kinds = frames.map((f) => f.kind);
    expect(kinds).toEqual([
      'start', 'action', 'action', 'street', 'action', 'action', 'street', 'action', 'action', 'street', 'action', 'action',
    ]);
    const streets = frames.filter((f) => f.kind === 'street');
    expect(streets.map((f) => (f.kind === 'street' ? [f.street, f.cards.length] : null))).toEqual([
      ['flop', 3],
      ['turn', 1],
      ['river', 1],
    ]);
    expect(frames[0]!.view.board).toEqual([]);
  });

  it('emits one street frame per street on an all-in runout', () => {
    const g = start({ stacks: [100, 100], holes: ['Ah Ad', 'Kh Kd'] });
    act(g, 0, { kind: 'raise', to: 100 });
    act(g, 1, { kind: 'call' });
    const frames = buildReplayFrames(g.events, 0);
    expect(frames.map((f) => f.kind)).toEqual(['start', 'action', 'action', 'street', 'street', 'street']);
    const cards = frames.flatMap((f) => (f.kind === 'street' ? f.cards : []));
    expect(cards).toEqual(frames.at(-1)!.view.board);
    // Each frame shows only the board dealt so far; the result appears on the last frame only.
    expect(frames.map((f) => f.view.board.length)).toEqual([0, 0, 0, 3, 4, 5]);
    expect(frames.map((f) => f.view.result !== null)).toEqual([false, false, false, false, false, true]);
  });

  it('hides other hole cards until they are shown', () => {
    const g = start({ stacks: [1000, 1000, 1000], holes: ['2c 3c', '4c 5c', '6c 7c'] });
    act(g, 0, { kind: 'fold' });
    act(g, 1, { kind: 'call' });
    act(g, 2, { kind: 'check' });
    for (let i = 0; i < 3; i++) {
      act(g, 1, { kind: 'check' });
      act(g, 2, { kind: 'check' });
    }
    const frames = buildReplayFrames(g.events, 0);
    for (const f of frames.slice(0, -1)) {
      for (const s of f.view.seats) if (s.seat !== 0) expect(s.hole).toBeNull();
    }
    const last = frames.at(-1)!.view;
    const shown = new Set(last.result!.shown.map((s) => s.seat));
    for (const s of last.seats) if (s.seat !== 0) expect(s.hole !== null).toBe(shown.has(s.seat));
  });

  it('spectator frames show no hole cards before showdown', () => {
    const g = start({ stacks: [1000, 1000], holes: ['2c 3c', '4c 5c'] });
    act(g, 0, { kind: 'raise', to: 30 });
    act(g, 1, { kind: 'fold' });
    for (const f of buildReplayFrames(g.events, null)) expect(f.view.seats.every((s) => s.hole === null)).toBe(true);
  });
});
