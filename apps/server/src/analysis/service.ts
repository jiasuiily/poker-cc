import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { buildReplayFrames } from '@poker/core';
import { analyzeHand, ENGINE_VERSION, type DecisionReport } from '@poker/strategy';
import type { Db } from '../db/client.js';
import { handAnalyses, handPlayers } from '../db/schema.js';
import { loadHandForPlayer } from '../history/repo.js';
import type { LlmClient } from '../llm.js';
import { buildPrompt } from './prompt.js';
import { takeQuota, type UsageKind } from './quota.js';

/** Ids of every hand the player took part in, newest first. */
export async function playerHandIds(db: Db, playerId: string): Promise<string[]> {
  const rows = await db
    .select({ handId: handPlayers.handId })
    .from(handPlayers)
    .where(eq(handPlayers.playerId, playerId))
    .orderBy(desc(handPlayers.endedAt), desc(handPlayers.handId));
  return rows.map((r) => r.handId);
}

/** The player's hands that have no analysis row for the current engine version yet. */
export async function handsLackingAnalysis(db: Db, playerId: string): Promise<string[]> {
  const done = await db
    .select({ handId: handAnalyses.handId })
    .from(handAnalyses)
    .where(and(eq(handAnalyses.playerId, playerId), eq(handAnalyses.engineVersion, ENGINE_VERSION)));
  const have = new Set(done.map((r) => r.handId));
  return (await playerHandIds(db, playerId)).filter((id) => !have.has(id));
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * Local analysis (step 1) for the given hands, yielding to the event loop after each one so a
 * long catch-up cannot starve table timers. Failures are logged under `label` and skipped.
 */
export async function ensureAllLocalAnalysis(db: Db, playerId: string, handIds: string[], label: string): Promise<void> {
  for (const id of handIds) {
    try {
      await ensureLocalAnalysis(db, id, playerId);
    } catch (e) {
      console.error(`[${label} ${playerId}] local analysis of ${id} failed`, e);
    }
    await tick();
  }
}

/** 'idle' is only ever reported (never stored): the commentary has not been attempted yet. */
export type LlmStatus = 'pending' | 'ok' | 'failed' | 'disabled' | 'limited' | 'idle';

export interface AnalysisResponse {
  decisions: DecisionReport[];
  llmStatus: LlmStatus;
  llmText: string | null;
}

export interface AnalysisEnv {
  dailyLimit: number;
  /** LLM request timeout (spec: 30 s). */
  timeoutMs?: number;
}

export async function getAnalysis(db: Db, handId: string, playerId: string): Promise<AnalysisResponse | null> {
  const [row] = await db
    .select()
    .from(handAnalyses)
    .where(and(eq(handAnalyses.handId, handId), eq(handAnalyses.playerId, playerId)));
  if (!row) return null;
  // ensureLocalAnalysis stores 'failed' with an epoch createdAt as the "never attempted" marker.
  const idle = row.llmStatus === 'failed' && row.createdAt.getTime() === 0;
  return { decisions: row.decisions as DecisionReport[], llmStatus: idle ? 'idle' : (row.llmStatus as LlmStatus), llmText: row.llmText };
}

/** A 'pending' LLM step older than this is treated as abandoned (e.g. the server restarted). */
const STALE_PENDING_SECONDS = 60;

const keyOf = (handId: string, playerId: string) => and(eq(handAnalyses.handId, handId), eq(handAnalyses.playerId, playerId));

/**
 * Step 1: make sure the local analysis row exists for the current engine version
 * (idempotent; concurrent first requests converge on one row).
 */
export async function ensureLocalAnalysis(db: Db, handId: string, playerId: string): Promise<'ok' | 'forbidden' | 'not_found'> {
  const hand = await loadHandForPlayer(db, handId, playerId);
  if (hand.status !== 'ok') return hand.status;

  const [existing] = await db.select().from(handAnalyses).where(keyOf(handId, playerId));
  if (!existing || existing.engineVersion !== ENGINE_VERSION) {
    const decisions = analyzeHand(hand.events, hand.meta.heroSeat);
    await db
      .insert(handAnalyses)
      .values({ handId, playerId, engineVersion: ENGINE_VERSION, decisions, llmText: null, llmStatus: 'failed', createdAt: new Date(0) })
      .onConflictDoUpdate({
        target: [handAnalyses.handId, handAnalyses.playerId],
        set: { engineVersion: ENGINE_VERSION, decisions, llmText: null, llmStatus: 'failed', createdAt: new Date(0) },
        setWhere: sql`${handAnalyses.engineVersion} <> ${ENGINE_VERSION}`,
      });
  }
  return 'ok';
}

/**
 * Step 2: claim the LLM step atomically (only one caller wins; ok and fresh pending are left
 * alone -> 'busy'), take quota of the given kind, and start the model call in the background.
 * Assumes the local analysis row exists (see ensureLocalAnalysis).
 */
export async function claimAndExplain(
  db: Db,
  llm: LlmClient | null,
  handId: string,
  playerId: string,
  quota: { kind: UsageKind; limit: number },
  timeoutMs?: number,
): Promise<{ outcome: 'started' | 'busy' | 'limited' | 'disabled'; job?: Promise<void> }> {
  if (!llm) {
    await db
      .update(handAnalyses)
      .set({ llmStatus: 'disabled' })
      .where(and(keyOf(handId, playerId), sql`${handAnalyses.llmStatus} <> 'ok'`));
    return { outcome: 'disabled' };
  }
  const claimed = await db
    .update(handAnalyses)
    .set({ llmStatus: 'pending', createdAt: sql`now()` })
    .where(
      and(
        keyOf(handId, playerId),
        or(
          inArray(handAnalyses.llmStatus, ['failed', 'limited', 'disabled']),
          and(eq(handAnalyses.llmStatus, 'pending'), sql`${handAnalyses.createdAt} < now() - interval '${sql.raw(String(STALE_PENDING_SECONDS))} seconds'`),
        ),
      ),
    )
    .returning({ handId: handAnalyses.handId });
  if (claimed.length === 0) return { outcome: 'busy' };

  if (!(await takeQuota(db, playerId, quota.kind, quota.limit))) {
    await db.update(handAnalyses).set({ llmStatus: 'limited' }).where(keyOf(handId, playerId));
    return { outcome: 'limited' };
  }

  const hand = await loadHandForPlayer(db, handId, playerId);
  const stored = await getAnalysis(db, handId, playerId);
  if (hand.status !== 'ok' || !stored) {
    await db.update(handAnalyses).set({ llmStatus: 'failed' }).where(keyOf(handId, playerId));
    return { outcome: 'busy' };
  }
  const { system, user } = buildPrompt(hand.meta, buildReplayFrames(hand.events, hand.meta.heroSeat), stored.decisions);
  const job = (async () => {
    let text: string | null = null;
    let status: LlmStatus = 'failed';
    try {
      text = await llm.explain(system, user, AbortSignal.timeout(timeoutMs ?? 30_000));
      status = 'ok';
    } catch (e) {
      console.error(`[analysis ${handId}] LLM failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await db.update(handAnalyses).set({ llmText: text, llmStatus: status }).where(keyOf(handId, playerId));
  })().catch((e) => console.error(`[analysis ${handId}] could not store LLM result`, e));
  return { outcome: 'started', job };
}

/**
 * Local analysis is computed once per engine version and returned at once. The LLM step is
 * claimed atomically, so a double click calls the model once; failed, limited, disabled and
 * stale pending steps can be claimed again by a later request.
 */
export async function requestAnalysis(
  db: Db,
  llm: LlmClient | null,
  handId: string,
  playerId: string,
  env: AnalysisEnv,
): Promise<{ status: 'ok'; analysis: AnalysisResponse; job?: Promise<void> } | { status: 'forbidden' } | { status: 'not_found' }> {
  const local = await ensureLocalAnalysis(db, handId, playerId);
  if (local !== 'ok') return { status: local };
  const { outcome, job } = await claimAndExplain(db, llm, handId, playerId, { kind: 'hand', limit: env.dailyLimit }, env.timeoutMs);
  const analysis = (await getAnalysis(db, handId, playerId))!;
  // A job that was just started is reported as pending even if a fast model already finished.
  if (outcome === 'started') return { status: 'ok', analysis: { ...analysis, llmStatus: 'pending', llmText: null }, job };
  return { status: 'ok', analysis, job };
}
