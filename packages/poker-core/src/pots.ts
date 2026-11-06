import { bestFive, evaluate } from './evaluator.js';
import type { HandResult, HandState, PotResult, ShownHand } from './types.js';

/**
 * Settle a finished hand:
 *  1. Return the uncalled part of the largest commitment.
 *  2. Split remaining chips into main/side pots by all-in levels.
 *  3. Award each pot; odd chips go one at a time to winners in clockwise order from the button.
 *  4. Decide which hands are shown.
 */
export function settle(s: HandState): HandResult {
  const players = s.players;
  const contrib = new Map(players.map((p) => [p.seat, p.totalCommitted]));
  const live = players.filter((p) => !p.folded);
  const uncontested = live.length === 1;

  // 1. Uncalled bet refund
  const refunds: HandResult['refunds'] = [];
  const sorted = [...players].sort((a, b) => b.totalCommitted - a.totalCommitted);
  const top = sorted[0]!;
  const second = sorted[1]?.totalCommitted ?? 0;
  if (top.totalCommitted > second) {
    const amt = top.totalCommitted - second;
    refunds.push({ seat: top.seat, amount: amt });
    contrib.set(top.seat, second);
  }

  // 2. Pots by levels of live contributions
  const levels = [...new Set(live.map((p) => contrib.get(p.seat)!))].filter((l) => l > 0).sort((a, b) => a - b);
  const pots: PotResult[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) {
      const c = contrib.get(p.seat)!;
      amount += Math.min(c, level) - Math.min(c, prev);
    }
    const eligible = live.filter((p) => contrib.get(p.seat)! >= level).map((p) => p.seat);
    if (amount > 0) pots.push({ amount, eligible, winners: [] });
    prev = level;
  }
  const totalIn = [...contrib.values()].reduce((a, b) => a + b, 0);
  const inPots = pots.reduce((a, p) => a + p.amount, 0);
  if (totalIn > inPots) {
    // Dead chips above the highest live level (folded players) join the last pot.
    if (pots.length) pots[pots.length - 1]!.amount += totalIn - inPots;
    else pots.push({ amount: totalIn - inPots, eligible: live.map((p) => p.seat), winners: [] });
  }

  // 3. Award
  const values = new Map<number, number>();
  if (!uncontested) for (const p of live) values.set(p.seat, evaluate([...p.hole, ...s.board]));
  const order = clockwiseFromButton(s);
  const winnings = new Map<number, number>();
  for (const pot of pots) {
    let winners: number[];
    if (pot.eligible.length === 1) winners = pot.eligible;
    else {
      const best = Math.max(...pot.eligible.map((seat) => values.get(seat)!));
      winners = pot.eligible.filter((seat) => values.get(seat) === best);
    }
    winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    pot.winners = winners.map((seat) => {
      const amount = share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      winnings.set(seat, (winnings.get(seat) ?? 0) + amount);
      return { seat, amount };
    });
  }

  // 4. Shown hands
  const shown: ShownHand[] = [];
  if (!uncontested) {
    const showAll = s.runout || live.some((p) => p.allIn);
    const showSet = new Set<number>();
    if (showAll) live.forEach((p) => showSet.add(p.seat));
    else {
      // First to show: last aggressor on the river, else first live player left of the button.
      const first = s.lastAggressor !== null && live.some((p) => p.seat === s.lastAggressor)
        ? s.lastAggressor
        : order.find((seat) => live.some((p) => p.seat === seat))!;
      showSet.add(first);
      for (const pot of pots) for (const w of pot.winners) showSet.add(w.seat);
    }
    for (const seat of order) {
      if (!showSet.has(seat)) continue;
      const p = live.find((x) => x.seat === seat)!;
      const b = bestFive([...p.hole, ...s.board]);
      shown.push({ seat, hole: p.hole, value: b.value, best5: b.cards });
    }
  }

  const refundMap = new Map(refunds.map((r) => [r.seat, r.amount]));
  const payouts = players
    .map((p) => ({ seat: p.seat, amount: (refundMap.get(p.seat) ?? 0) + (winnings.get(p.seat) ?? 0) }))
    .filter((x) => x.amount > 0);
  const finalStacks = players.map((p) => ({
    seat: p.seat,
    playerId: p.playerId,
    stack: p.stack + (refundMap.get(p.seat) ?? 0) + (winnings.get(p.seat) ?? 0),
  }));

  return { uncontested, refunds, pots, shown, payouts, finalStacks };
}

/** Seats in clockwise order starting with the first player after the button. */
export function clockwiseFromButton(s: HandState): number[] {
  const seats = s.players.map((p) => p.seat);
  const start = seats.findIndex((seat) => seat > s.button);
  const i = start >= 0 ? start : 0;
  return [...seats.slice(i), ...seats.slice(0, i)];
}
