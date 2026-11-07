import { and, eq, sql } from 'drizzle-orm';
import { ENGINE_VERSION } from '@poker/strategy';
import type { Db } from '../db/client.js';
import { handAnalyses, handPlayers } from '../db/schema.js';
import type { LlmClient } from '../llm.js';
import { claimAndExplain, ensureLocalAnalysis, playerHandIds } from './service.js';

export interface BatchProgress {
  running: boolean;
  hands: number;
  localDone: number;
  llmDone: number;
  llmQueued: number;
  llmSkipped: number;
  reason: 'limit' | 'disabled' | null;
}

interface JobState {
  running: boolean;
  llmQueued: number;
  llmSkipped: number;
  reason: 'limit' | 'disabled' | null;
  done: Promise<void>;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * One-click "analyse all my hands": an in-process queue, one job per player. Step 1 computes the
 * local analysis for every hand; step 2 asks the model for commentary one hand at a time, newest
 * first, against the batch quota. State of the last finished job is kept until the next start.
 */
export class BatchRunner {
  private jobs = new Map<string, JobState>();

  constructor(private opts: { db: () => Promise<Db>; llm: LlmClient | null; dailyLimit: number; timeoutMs?: number }) {}

  async start(playerId: string): Promise<BatchProgress> {
    const existing = this.jobs.get(playerId);
    if (!existing?.running) {
      const state: JobState = { running: true, llmQueued: 0, llmSkipped: 0, reason: null, done: Promise.resolve() };
      state.done = this.run(playerId, state)
        .catch((e) => console.error(`[batch ${playerId}] failed`, e))
        .finally(() => {
          state.running = false;
          state.llmQueued = 0;
        });
      this.jobs.set(playerId, state);
    }
    return this.progress(playerId);
  }

  async idle(playerId: string): Promise<void> {
    await this.jobs.get(playerId)?.done;
  }

  async progress(playerId: string): Promise<BatchProgress> {
    const db = await this.opts.db();
    const [{ n: hands }] = await db.select({ n: sql<number>`count(*)::int` }).from(handPlayers).where(eq(handPlayers.playerId, playerId));
    const rows = await db
      .select({ engineVersion: handAnalyses.engineVersion, llmStatus: handAnalyses.llmStatus })
      .from(handAnalyses)
      .where(eq(handAnalyses.playerId, playerId));
    const s = this.jobs.get(playerId);
    return {
      running: s?.running ?? false,
      hands,
      localDone: rows.filter((r) => r.engineVersion === ENGINE_VERSION).length,
      llmDone: rows.filter((r) => r.llmStatus === 'ok').length,
      llmQueued: s?.running ? s.llmQueued : 0,
      llmSkipped: s?.llmSkipped ?? 0,
      reason: s?.reason ?? null,
    };
  }

  private async run(playerId: string, state: JobState): Promise<void> {
    const db = await this.opts.db();
    const ids = await playerHandIds(db, playerId);

    // Step 1: local analysis for every hand.
    for (const id of ids) {
      try {
        await ensureLocalAnalysis(db, id, playerId);
      } catch (e) {
        console.error(`[batch ${playerId}] local analysis of ${id} failed`, e);
      }
      await tick();
    }

    // Step 2: commentary for hands that have none yet.
    const okRows = await db
      .select({ handId: handAnalyses.handId })
      .from(handAnalyses)
      .where(and(eq(handAnalyses.playerId, playerId), eq(handAnalyses.llmStatus, 'ok')));
    const ok = new Set(okRows.map((r) => r.handId));
    const todo = ids.filter((id) => !ok.has(id));
    state.llmQueued = todo.length;

    if (!this.opts.llm) {
      state.llmSkipped = todo.length;
      state.llmQueued = 0;
      state.reason = 'disabled';
      return;
    }

    for (let i = 0; i < todo.length; i++) {
      const id = todo[i];
      state.llmQueued = todo.length - i;
      let res;
      try {
        res = await claimAndExplain(db, this.opts.llm, id, playerId, { kind: 'batch', limit: this.opts.dailyLimit }, this.opts.timeoutMs);
      } catch (e) {
        console.error(`[batch ${playerId}] explaining ${id} failed`, e);
        continue;
      }
      if (res.outcome === 'limited') {
        state.llmSkipped = todo.length - i;
        state.llmQueued = 0;
        state.reason = 'limit';
        return;
      }
      if (res.outcome === 'started') await res.job;
      await tick();
    }
    state.llmQueued = 0;
  }
}
