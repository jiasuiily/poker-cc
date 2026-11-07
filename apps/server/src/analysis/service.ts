import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { buildReplayFrames } from '@poker/core';
import { analyzeHand, ENGINE_VERSION, type DecisionReport } from '@poker/strategy';
import type { Db } from '../db/client.js';
import { handAnalyses, llmUsage } from '../db/schema.js';
import { loadHandForPlayer } from '../history/repo.js';
import type { LlmClient } from '../llm.js';
import { buildPrompt } from './prompt.js';

export type LlmStatus = 'pending' | 'ok' | 'failed' | 'disabled' | 'limited';

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

/** YYYY-MM-DD in Asia/Shanghai. */
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);

export async function getAnalysis(db: Db, handId: string, playerId: string): Promise<AnalysisResponse | null> {
  const [row] = await db
    .select()
    .from(handAnalyses)
    .where(and(eq(handAnalyses.handId, handId), eq(handAnalyses.playerId, playerId)));
  if (!row) return null;
  return { decisions: row.decisions as DecisionReport[], llmStatus: row.llmStatus as LlmStatus, llmText: row.llmText };
}

/** Count one LLM use for today; false when the daily limit is already reached. */
async function takeQuota(db: Db, playerId: string, limit: number): Promise<boolean> {
  const day = dayOf(new Date());
  const [row] = await db
    .insert(llmUsage)
    .values({ playerId, day, count: 1 })
    .onConflictDoUpdate({ target: [llmUsage.playerId, llmUsage.day, llmUsage.kind], set: { count: sql`${llmUsage.count} + 1` } })
    .returning({ count: llmUsage.count });
  return (row?.count ?? 1) <= limit;
}

/** A 'pending' LLM step older than this is treated as abandoned (e.g. the server restarted). */
const STALE_PENDING_SECONDS = 60;

const keyOf = (handId: string, playerId: string) => and(eq(handAnalyses.handId, handId), eq(handAnalyses.playerId, playerId));

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
  const hand = await loadHandForPlayer(db, handId, playerId);
  if (hand.status !== 'ok') return hand;

  // 1) Local analysis row (idempotent; concurrent first requests converge on one row).
  const [existing] = await db.select().from(handAnalyses).where(keyOf(handId, playerId));
  let decisions = existing?.decisions as DecisionReport[] | undefined;
  if (!existing || existing.engineVersion !== ENGINE_VERSION) {
    decisions = analyzeHand(hand.events, hand.meta.heroSeat);
    await db
      .insert(handAnalyses)
      .values({ handId, playerId, engineVersion: ENGINE_VERSION, decisions, llmText: null, llmStatus: 'failed', createdAt: new Date(0) })
      .onConflictDoUpdate({
        target: [handAnalyses.handId, handAnalyses.playerId],
        set: { engineVersion: ENGINE_VERSION, decisions, llmText: null, llmStatus: 'failed', createdAt: new Date(0) },
        setWhere: sql`${handAnalyses.engineVersion} <> ${ENGINE_VERSION}`,
      });
  }

  // 2) Claim the LLM step: only one request wins; ok and fresh pending are left alone.
  const read = async (): Promise<AnalysisResponse> => (await getAnalysis(db, handId, playerId))!;
  if (!llm) {
    await db
      .update(handAnalyses)
      .set({ llmStatus: 'disabled' })
      .where(and(keyOf(handId, playerId), sql`${handAnalyses.llmStatus} <> 'ok'`));
    return { status: 'ok', analysis: await read() };
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
  if (claimed.length === 0) return { status: 'ok', analysis: await read() };

  if (!(await takeQuota(db, playerId, env.dailyLimit))) {
    await db.update(handAnalyses).set({ llmStatus: 'limited' }).where(keyOf(handId, playerId));
    return { status: 'ok', analysis: await read() };
  }

  const { system, user } = buildPrompt(hand.meta, buildReplayFrames(hand.events, hand.meta.heroSeat), decisions ?? []);
  const job = (async () => {
    let text: string | null = null;
    let status: LlmStatus = 'failed';
    try {
      text = await llm.explain(system, user, AbortSignal.timeout(env.timeoutMs ?? 30_000));
      status = 'ok';
    } catch (e) {
      console.error(`[analysis ${handId}] LLM failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await db.update(handAnalyses).set({ llmText: text, llmStatus: status }).where(keyOf(handId, playerId));
  })().catch((e) => console.error(`[analysis ${handId}] could not store LLM result`, e));
  return { status: 'ok', analysis: await read(), job };
}
