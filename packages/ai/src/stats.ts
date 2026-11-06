import { reduce, type HandEvent } from '@poker/core';

/** Counts per seat: hands dealt, voluntarily put money in preflop, raised preflop. */
export interface SeatStats {
  hands: number;
  vpip: number;
  pfr: number;
}

export function collectStats(events: HandEvent[], into: Map<number, SeatStats>): void {
  const s = reduce(events);
  for (const p of s.players) {
    const st = into.get(p.seat) ?? { hands: 0, vpip: 0, pfr: 0 };
    const pre = s.log.filter((e) => e.seat === p.seat && e.street === 'preflop');
    st.hands++;
    if (pre.some((e) => e.kind === 'call' || e.kind === 'raise' || e.kind === 'bet')) st.vpip++;
    if (pre.some((e) => e.kind === 'raise' || e.kind === 'bet')) st.pfr++;
    into.set(p.seat, st);
  }
}
