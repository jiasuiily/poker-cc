import { desc, sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Spec 4.2. Column names are snake_case in SQL, camelCase in TS. */

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  nickname: text('nickname').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const hands = pgTable('hands', {
  id: text('id').primaryKey(),
  tableId: text('table_id').notNull(),
  tableName: text('table_name').notNull(),
  handNo: integer('hand_no').notNull(),
  smallBlind: integer('small_blind').notNull(),
  bigBlind: integer('big_blind').notNull(),
  maxSeats: integer('max_seats').notNull(),
  button: integer('button').notNull(),
  /** SeatSnapshot[] */
  seats: jsonb('seats').notNull(),
  /** Full HandEvent[] including the deck — server-side only. */
  events: jsonb('events').notNull(),
  /** HandResult */
  result: jsonb('result').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
});

export const handPlayers = pgTable(
  'hand_players',
  {
    handId: text('hand_id')
      .notNull()
      .references(() => hands.id, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull(),
    seat: integer('seat').notNull(),
    net: integer('net').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.handId, t.playerId] }), index('hand_players_player_ended').on(t.playerId, desc(t.endedAt), desc(t.handId))],
);

export const handAnalyses = pgTable(
  'hand_analyses',
  {
    handId: text('hand_id')
      .notNull()
      .references(() => hands.id, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull(),
    engineVersion: integer('engine_version').notNull(),
    /** DecisionReport[] */
    decisions: jsonb('decisions').notNull(),
    llmText: text('llm_text'),
    /** pending | ok | failed | disabled | limited */
    llmStatus: text('llm_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [primaryKey({ columns: [t.handId, t.playerId] })],
);

export const llmUsage = pgTable(
  'llm_usage',
  {
    playerId: text('player_id').notNull(),
    /** YYYY-MM-DD in Asia/Shanghai */
    day: text('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.day] })],
);
