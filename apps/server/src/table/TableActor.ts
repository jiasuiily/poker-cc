import {
  applyAction,
  IllegalActionError,
  projectView,
  shuffleDeck,
  startHand,
  timeoutAction,
  type HandEvent,
  type HandState,
  type PlayerAction,
  type PlayerView,
  type RandomInt,
} from '@poker/core';
import { getBot, isStyleId, randomStyle, thinkTimeMs, type BotLevel, type StyleId } from '@poker/ai';

export interface TableConfig {
  tableId: string;
  name: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  /** Fixed buy-in (phase 2; wallets/escrow arrive in phase 3). */
  buyIn: number;
  actionTimeoutMs: number;
  betweenHandsMs: number;
  /** Bot think-time range; [0, 0] for tests. */
  botThinkMs: [number, number];
  /** Consecutive timeouts before a player is sat out. */
  maxTimeouts: number;
}

export const DEFAULT_TABLE_CONFIG: Omit<TableConfig, 'tableId' | 'name'> = {
  maxSeats: 6,
  smallBlind: 5,
  bigBlind: 10,
  buyIn: 1000,
  actionTimeoutMs: 20_000,
  betweenHandsMs: 3_500,
  botThinkMs: [700, 2600],
  maxTimeouts: 2,
};

export interface Occupant {
  playerId: string;
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
  botStyle?: StyleId;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  timeouts: number;
  leaveAfterHand: boolean;
}

export interface SeatView {
  seat: number;
  playerId: string;
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
  botStyle?: StyleId;
  stack: number;
  sittingOut: boolean;
  connected: boolean;
  inHand: boolean;
}

/** Who sat where at the start of a hand (stored with the hand history). */
export interface SeatSnapshot {
  seat: number;
  playerId: string;
  name: string;
  isBot: boolean;
  botLevel?: BotLevel;
  botStyle?: StyleId;
  startStack: number;
}

export interface HandCompleteRecord {
  tableId: string;
  tableName: string;
  maxSeats: number;
  handNo: number;
  events: HandEvent[];
  state: HandState;
  seats: SeatSnapshot[];
  startedAt: number;
  endedAt: number;
}

/** Everything one client receives. Built per viewer; contains only what that viewer may see. */
export interface TableView {
  version: number;
  table: Pick<TableConfig, 'tableId' | 'name' | 'maxSeats' | 'smallBlind' | 'bigBlind' | 'buyIn' | 'actionTimeoutMs'>;
  seats: (SeatView | null)[];
  you: { playerId: string | null; seat: number | null };
  hand: PlayerView | null;
  /** Epoch ms when the current actor's clock runs out (clients correct for clock skew). */
  deadline: number | null;
  serverTime: number;
  handNo: number;
}

export interface ActorDeps {
  randomInt: RandomInt;
  rng: () => number;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => () => void;
  /** Called after every state change; the room re-broadcasts per-client views. */
  onChange: () => void;
  /** Called with each completed hand (persistence hook). Errors are logged, never break the table. */
  onHandComplete?: (rec: HandCompleteRecord) => void;
  log?: (msg: string) => void;
}

export class TableError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
  }
}

/**
 * One actor per table. All mutations (client commands, timers, bot turns) run through
 * `exec`, which executes them one at a time to completion — the table's serial queue.
 */
export class TableActor {
  readonly seats: (Occupant | null)[];
  hand: HandState | null = null;
  events: HandEvent[] = [];
  handNo = 0;
  version = 0;
  deadline: number | null = null;
  private button = -1;
  private handSeats: SeatSnapshot[] = [];
  private handStartedAt = 0;
  private turnTimer: (() => void) | null = null;
  private nextHandTimer: (() => void) | null = null;
  private botCounter = 0;
  private busy = false;
  private pending: (() => void)[] = [];

  constructor(readonly config: TableConfig, private deps: ActorDeps) {
    this.seats = new Array(config.maxSeats).fill(null);
  }

  // ---------------------------------------------------------------- serial queue
  private exec<T>(fn: () => T): T {
    if (this.busy) {
      // Re-entrant call from inside a task (e.g. a zero-delay timer): defer it.
      let out: T;
      this.pending.push(() => (out = fn()));
      return out!;
    }
    this.busy = true;
    try {
      const r = fn();
      this.changed();
      return r;
    } finally {
      this.busy = false;
      const next = this.pending.shift();
      if (next) this.exec(next);
    }
  }

  // ---------------------------------------------------------------- commands
  sit(playerId: string, name: string, seat: number) {
    return this.exec(() => {
      this.assertSeat(seat);
      if (this.seatOf(playerId) !== null) throw new TableError('already_seated', '你已经在座位上了');
      if (this.seats[seat]) throw new TableError('seat_taken', '这个座位已经有人了');
      this.seats[seat] = {
        playerId,
        name,
        isBot: false,
        stack: this.config.buyIn,
        sittingOut: false,
        connected: true,
        timeouts: 0,
        leaveAfterHand: false,
      };
      this.maybeScheduleHand();
    });
  }

  addBot(seat: number, level: BotLevel = 'advanced', style: StyleId | 'random' = 'random') {
    if (level !== 'beginner' && level !== 'advanced') throw new TableError('bad_level', '电脑难度无效');
    if (style !== 'random' && !isStyleId(style)) throw new TableError('bad_style', '电脑风格无效');
    return this.exec(() => {
      this.assertSeat(seat);
      if (this.seats[seat]) throw new TableError('seat_taken', '这个座位已经有人了');
      const n = ++this.botCounter;
      this.seats[seat] = {
        playerId: `bot-${this.config.tableId}-${n}`,
        name: `电脑${n}号`,
        isBot: true,
        botLevel: level,
        botStyle: style === 'random' ? randomStyle(this.deps.rng) : style,
        stack: this.config.buyIn,
        sittingOut: false,
        connected: true,
        timeouts: 0,
        leaveAfterHand: false,
      };
      this.maybeScheduleHand();
    });
  }

  /** Leave the seat (bots: by seat index). Mid-hand: fold now if it is our turn, leave after the hand. */
  stand(playerId: string) {
    return this.exec(() => {
      const seat = this.seatOf(playerId);
      if (seat === null) throw new TableError('not_seated', '你不在座位上');
      this.removeFromSeat(seat);
    });
  }

  removeBot(seat: number) {
    return this.exec(() => {
      const o = this.seats[seat];
      if (!o?.isBot) throw new TableError('not_bot', '这个座位不是电脑玩家');
      this.removeFromSeat(seat);
    });
  }

  rebuy(playerId: string) {
    return this.exec(() => {
      const seat = this.seatOf(playerId);
      if (seat === null) throw new TableError('not_seated', '你不在座位上');
      const o = this.seats[seat]!;
      if (this.inHand(seat)) throw new TableError('in_hand', '牌局进行中不能补码');
      if (o.stack >= this.config.buyIn) throw new TableError('no_rebuy', '筹码未低于买入额');
      o.stack = this.config.buyIn;
      o.sittingOut = false;
      o.timeouts = 0;
      this.maybeScheduleHand();
    });
  }

  setSittingOut(playerId: string, sittingOut: boolean) {
    return this.exec(() => {
      const seat = this.seatOf(playerId);
      if (seat === null) throw new TableError('not_seated', '你不在座位上');
      const o = this.seats[seat]!;
      if (!sittingOut && o.stack <= 0) throw new TableError('no_chips', '请先补码');
      o.sittingOut = sittingOut;
      o.timeouts = 0;
      if (sittingOut && this.hand?.toAct === seat) this.autoAct(seat);
      this.maybeScheduleHand();
    });
  }

  setConnected(playerId: string, connected: boolean) {
    return this.exec(() => {
      const seat = this.seatOf(playerId);
      if (seat !== null) this.seats[seat]!.connected = connected;
    });
  }

  /**
   * A player's action. `handId` + `seq` make it idempotent: a retransmitted or stale
   * action no longer matches the expected sequence and is rejected, never applied twice.
   */
  act(playerId: string, handId: string, seq: number, action: PlayerAction) {
    return this.exec(() => {
      const seat = this.seatOf(playerId);
      const h = this.hand;
      if (seat === null || !h || h.street === 'complete') throw new TableError('no_hand', '当前没有需要你行动的牌局');
      if (h.handId !== handId || h.actionSeq !== seq) throw new TableError('stale', '操作已过期');
      if (h.toAct !== seat) throw new TableError('not_your_turn', '还没轮到你');
      this.seats[seat]!.timeouts = 0;
      this.apply(seat, action);
    });
  }

  dispose() {
    this.turnTimer?.();
    this.nextHandTimer?.();
    this.turnTimer = this.nextHandTimer = null;
  }

  // ---------------------------------------------------------------- views
  viewFor(playerId: string | null): TableView {
    const seat = playerId ? this.seatOf(playerId) : null;
    const h = this.hand;
    return {
      version: this.version,
      table: {
        tableId: this.config.tableId,
        name: this.config.name,
        maxSeats: this.config.maxSeats,
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        buyIn: this.config.buyIn,
        actionTimeoutMs: this.config.actionTimeoutMs,
      },
      seats: this.seats.map((o, i) => {
        if (!o) return null;
        const hp = h?.players.find((p) => p.seat === i);
        const stack = hp && h!.street !== 'complete' ? hp.stack : o.stack;
        return {
          seat: i,
          playerId: o.playerId,
          name: o.name,
          isBot: o.isBot,
          ...(o.isBot ? { botLevel: o.botLevel, botStyle: o.botStyle } : {}),
          stack,
          sittingOut: o.sittingOut,
          connected: o.connected,
          inHand: !!hp,
        };
      }),
      you: { playerId, seat },
      // Viewer = the player dealt into this hand, matched by id (a newcomer in a vacated seat is a spectator).
      hand: h ? projectView(h, playerId ? (this.handSeats.find((s) => s.playerId === playerId)?.seat ?? null) : null) : null,
      deadline: this.deadline,
      serverTime: this.deps.now(),
      handNo: this.handNo,
    };
  }

  seatOf(playerId: string): number | null {
    const i = this.seats.findIndex((o) => o?.playerId === playerId);
    return i >= 0 ? i : null;
  }

  humanCount(): number {
    return this.seats.filter((o) => o && !o.isBot).length;
  }

  // ---------------------------------------------------------------- internals
  private changed() {
    this.version++;
    this.deps.onChange();
  }

  private assertSeat(seat: number) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.config.maxSeats) throw new TableError('bad_seat', '座位号无效');
  }

  private inHand(seat: number): boolean {
    const h = this.hand;
    return !!h && h.street !== 'complete' && h.players.some((p) => p.seat === seat);
  }

  private removeFromSeat(seat: number) {
    if (this.inHand(seat)) {
      const o = this.seats[seat]!;
      o.leaveAfterHand = true;
      o.sittingOut = true;
      if (this.hand!.toAct === seat) this.autoAct(seat);
    } else {
      this.seats[seat] = null;
    }
  }

  private eligibleSeats(): number[] {
    return this.seats.flatMap((o, i) => (o && !o.sittingOut && !o.leaveAfterHand && o.stack > 0 ? [i] : []));
  }

  private maybeScheduleHand() {
    if (this.nextHandTimer) return;
    if (this.hand && this.hand.street !== 'complete') return;
    if (this.eligibleSeats().length < 2) return;
    const delay = this.hand ? this.config.betweenHandsMs : 300;
    this.nextHandTimer = this.deps.setTimer(() => {
      this.nextHandTimer = null;
      this.exec(() => this.startNextHand());
    }, delay);
  }

  private startNextHand() {
    if (this.hand && this.hand.street !== 'complete') return;
    const eligible = this.eligibleSeats();
    if (eligible.length < 2) {
      this.hand = null;
      return;
    }
    // Move the button to the next eligible seat (dead-button rules arrive with tournaments).
    this.button = eligible.find((s) => s > this.button) ?? eligible[0]!;
    this.handNo++;
    const ev: HandEvent = {
      type: 'HandStarted',
      handId: `${this.config.tableId}-${this.handNo}`,
      config: { smallBlind: this.config.smallBlind, bigBlind: this.config.bigBlind },
      seats: eligible.map((seat) => ({ seat, playerId: this.seats[seat]!.playerId, stack: this.seats[seat]!.stack })),
      button: this.button,
      deck: shuffleDeck(this.deps.randomInt),
    };
    this.events = [ev];
    this.handStartedAt = this.deps.now();
    this.handSeats = eligible.map((seat) => {
      const o = this.seats[seat]!;
      return {
        seat,
        playerId: o.playerId,
        name: o.name,
        isBot: o.isBot,
        ...(o.isBot ? { botLevel: o.botLevel, botStyle: o.botStyle } : {}),
        startStack: o.stack,
      };
    });
    this.hand = startHand(ev);
    this.afterStateChange();
  }

  private apply(seat: number, action: PlayerAction) {
    const h = this.hand!;
    try {
      this.hand = applyAction(h, seat, action);
    } catch (e) {
      if (e instanceof IllegalActionError) throw new TableError('illegal', e.message);
      throw e;
    }
    this.events.push({ type: 'Action', seat, seq: h.actionSeq, action });
    this.afterStateChange();
  }

  /** Timeout / sat-out / leaving: check if free, otherwise fold. */
  private autoAct(seat: number) {
    this.apply(seat, timeoutAction(this.hand!));
  }

  private afterStateChange() {
    this.turnTimer?.();
    this.turnTimer = null;
    this.deadline = null;
    const h = this.hand!;

    if (h.street === 'complete') {
      for (const f of h.result!.finalStacks) {
        const o = this.seats[f.seat];
        if (o && o.playerId === f.playerId) o.stack = f.stack;
      }
      try {
        this.deps.onHandComplete?.({
          tableId: this.config.tableId,
          tableName: this.config.name,
          maxSeats: this.config.maxSeats,
          handNo: this.handNo,
          events: this.events,
          state: h,
          seats: this.handSeats,
          startedAt: this.handStartedAt,
          endedAt: this.deps.now(),
        });
      } catch (e) {
        this.deps.log?.(`hand-complete hook failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.seats.forEach((o, i) => {
        if (!o) return;
        if (o.leaveAfterHand) this.seats[i] = null;
        else if (o.stack <= 0) {
          if (o.isBot) o.stack = this.config.buyIn; // bots rebuy automatically
          else o.sittingOut = true; // humans must click rebuy
        }
      });
      this.maybeScheduleHand();
      return;
    }

    const seat = h.toAct!;
    const o = this.seats[seat]!;
    if (o.isBot && !o.sittingOut && !o.leaveAfterHand) {
      const [min, max] = this.config.botThinkMs;
      const handId = h.handId;
      const seq = h.actionSeq;
      this.turnTimer = this.deps.setTimer(() => {
        this.turnTimer = null;
        this.exec(() => {
          const cur = this.hand;
          if (!cur || cur.handId !== handId || cur.actionSeq !== seq) return;
          const view = projectView(cur, seat);
          const action = getBot(o.botLevel ?? 'beginner', o.botStyle ?? 'tag').decide(view, this.deps.rng);
          this.apply(seat, action);
        });
      }, max > 0 ? thinkTimeMs(this.deps.rng, min, max) : 0);
      return;
    }

    if (o.sittingOut || o.leaveAfterHand) {
      const handId = h.handId;
      const seq = h.actionSeq;
      this.turnTimer = this.deps.setTimer(() => {
        this.turnTimer = null;
        this.exec(() => {
          if (this.hand?.handId === handId && this.hand.actionSeq === seq) this.autoAct(seat);
        });
      }, 400);
      return;
    }

    this.deadline = this.deps.now() + this.config.actionTimeoutMs;
    const handId = h.handId;
    const seq = h.actionSeq;
    this.turnTimer = this.deps.setTimer(() => {
      this.turnTimer = null;
      this.exec(() => {
        if (this.hand?.handId !== handId || this.hand.actionSeq !== seq) return;
        o.timeouts++;
        if (o.timeouts >= this.config.maxTimeouts) o.sittingOut = true;
        this.deps.log?.(`seat ${seat} timed out (${o.timeouts})`);
        this.autoAct(seat);
      });
    }, this.config.actionTimeoutMs);
  }
}
