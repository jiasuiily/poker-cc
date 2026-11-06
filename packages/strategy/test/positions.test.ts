import { describe, expect, it } from 'vitest';
import { positionsOf, tableFormat } from '../src/index.js';

/** Minimal view: seats in seat order, button and blinds as the engine would set them. */
function view(n: number, button: number) {
  const seats = Array.from({ length: n }, (_, seat) => ({ seat }));
  const idx = (k: number) => (button + k) % n;
  const sb = n === 2 ? button : idx(1);
  const bb = n === 2 ? idx(1) : idx(2);
  return { seats, button, sbSeat: sb, bbSeat: bb } as never;
}

describe('positions', () => {
  it('table format by player count', () => {
    expect(tableFormat(2)).toBe('hu');
    expect(tableFormat(3)).toBe('6max');
    expect(tableFormat(6)).toBe('6max');
    expect(tableFormat(7)).toBe('9max');
    expect(tableFormat(9)).toBe('9max');
  });

  it('6-handed', () => {
    const p = positionsOf(view(6, 0));
    expect([0, 1, 2, 3, 4, 5].map((s) => p.get(s))).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
  });

  it('9-handed', () => {
    const p = positionsOf(view(9, 4));
    expect([4, 5, 6, 7, 8, 0, 1, 2, 3].map((s) => p.get(s))).toEqual([
      'BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO',
    ]);
  });

  it('3-handed: button, blinds only', () => {
    const p = positionsOf(view(3, 1));
    expect([1, 2, 0].map((s) => p.get(s))).toEqual(['BTN', 'SB', 'BB']);
  });

  it('heads-up: button is the SB', () => {
    const p = positionsOf(view(2, 0));
    expect(p.get(0)).toBe('SB');
    expect(p.get(1)).toBe('BB');
  });
});
