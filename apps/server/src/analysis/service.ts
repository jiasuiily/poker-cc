import { and, eq, sql } from 'drizzle-orm';
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
    .onConflictDoUpdate({ target: [llmUsage.playerId, llmUsage.day], set: { count: sql`${llmUsage.count} + 1` } })
    .returning({ count: llmUsage.count });
  return (row?.count ?? 1) <= limit;
}

/**
 * Local analysis is computed (or read from cache) and returned at once. When an LLM is
 * configured and quota allows, commentary is fetched in the background (`job`) and stored.
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

  const [cached] = await db
    .select()
    .from(handAnalyses)
    .where(and(eq(handAnalyses.handId, handId), eq(handAnalyses.playerId, playerId)));
  if (cached && cached.engineVersion === ENGINE_VERSION) {
    return { status: 'ok', analysis: { decisions: cached.decisions as DecisionReport[], llmStatus: cached.llmStatus as LlmStatus, llmText: cached.llmText } };
  }

  const decisions = analyzeHand(hand.events, hand.meta.heroSeat);
  const llmStatus: LlmStatus = !llm ? 'disabled' : (await takeQuota(db, playerId, env.dailyLimit)) ? 'pending' : 'limited';
  const row = { handId, playerId, engineVersion: ENGINE_VERSION, decisions, llmText: null, llmStatus };
  await db
    .insert(handAnalyses)
    .values(row)
    .onConflictDoUpdate({ target: [handAnalyses.handId, handAnalyses.playerId], set: { engineVersion: ENGINE_VERSION, decisions, llmText: null, llmStatus } });

  let job: Promise<void> | undefined;
  if (llmStatus === 'pending' && llm) {
    const { system, user } = buildPrompt(hand.meta, buildReplayFrames(hand.events, hand.meta.heroSeat), decisions);
    job = (async () => {
      let text: string | null = null;
      let status: LlmStatus = 'failed';
      try {
        text = await llm.explain(system, user, AbortSignal.timeout(env.timeoutMs ?? 30_000));
        status = 'ok';
      } catch (e) {
        console.error(`[analysis ${handId}] LLM failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      await db
        .update(handAnalyses)
        .set({ llmText: text, llmStatus: status })
        .where(and(eq(handAnalyses.handId, handId), eq(handAnalyses.playerId, playerId)));
    })().catch((e) => console.error(`[analysis ${handId}] could not store LLM result`, e));
  }
  return { status: 'ok', analysis: { decisions, llmStatus, llmText: null }, job };
}
