import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { summarizeDecisions, type PlayerStats } from '@poker/strategy';
import type { Db } from '../db/client.js';
import { coachReports } from '../db/schema.js';
import { HttpError } from '../http.js';
import { ensureAllLocalAnalysis, handsLackingAnalysis } from '../analysis/service.js';
import { takeQuota } from '../analysis/quota.js';
import { loadHandForPlayer } from '../history/repo.js';
import { sanitizeLlmText, type LlmClient } from '../llm.js';
import { loadDecisionInputs } from '../stats/player.js';
import { buildCoachPrompt, describeExample, type ExampleView } from './prompt.js';

export const REPORT_DAILY_LIMIT = 3;
export const MIN_REPORT_DECISIONS = 30;
export const STALE_REPORT_SECONDS = 120;

export interface CoachReport {
  id: string;
  createdAt: string;
  status: 'pending' | 'ok' | 'failed';
  stats: PlayerStats;
  text: string | null;
}

type Row = typeof coachReports.$inferSelect;

const toReport = (r: Row): CoachReport => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  status: r.status as CoachReport['status'],
  stats: r.stats as PlayerStats,
  text: r.text,
});

/** A pending report that has been stuck for too long (e.g. the server restarted) is failed. */
const failStaleReports = (db: Db, playerId: string) =>
  db
    .update(coachReports)
    .set({ status: 'failed' })
    .where(
      and(
        eq(coachReports.playerId, playerId),
        eq(coachReports.status, 'pending'),
        lt(coachReports.createdAt, sql`now() - make_interval(secs => ${STALE_REPORT_SECONDS})`),
      ),
    );

/** The player's reports, newest first. Stale pending rows are marked failed first. */
export async function listReports(db: Db, playerId: string): Promise<CoachReport[]> {
  await failStaleReports(db, playerId);
  const rows = await db
    .select()
    .from(coachReports)
    .where(eq(coachReports.playerId, playerId))
    .orderBy(desc(coachReports.createdAt), desc(coachReports.id));
  return rows.map(toReport);
}

export async function createReport(
  db: Db,
  llm: LlmClient | null,
  playerId: string,
  opts?: { timeoutMs?: number },
): Promise<{ report: CoachReport; job: Promise<void> }> {
  if (!llm) throw new HttpError(503, '未配置大模型');

  // Local analysis only (never the model) for hands without a current-version analysis.
  await ensureAllLocalAnalysis(db, playerId, await handsLackingAnalysis(db, playerId), 'report');
  const stats = summarizeDecisions(await loadDecisionInputs(db, playerId));
  if (stats.decisions < MIN_REPORT_DECISIONS) throw new HttpError(400, `再多打几手（至少 ${MIN_REPORT_DECISIONS} 个决策点）`);

  const [previousRow] = await db
    .select()
    .from(coachReports)
    .where(and(eq(coachReports.playerId, playerId), eq(coachReports.status, 'ok')))
    .orderBy(desc(coachReports.createdAt))
    .limit(1);

  // A pending report that has been stuck for too long no longer blocks a new one.
  await failStaleReports(db, playerId);

  const id = `r_${randomUUID()}`;
  let row: Row | undefined;
  try {
    [row] = await db.insert(coachReports).values({ id, playerId, status: 'pending', stats, text: null }).returning();
  } catch (e) {
    if (/unique|duplicate/i.test(String((e as { cause?: unknown })?.cause ?? e))) throw new HttpError(409, '正在生成中');
    throw e;
  }
  if (!row) throw new Error('insert returned no row');

  const markFailed = () => db.update(coachReports).set({ status: 'failed' }).where(eq(coachReports.id, id));
  if (!(await takeQuota(db, playerId, 'report', REPORT_DAILY_LIMIT))) {
    await markFailed();
    throw new HttpError(429, '今天的整体分析次数已用完');
  }

  const job = (async () => {
    try {
      const examples: ExampleView[] = [];
      for (const ex of stats.examples) {
        const h = await loadHandForPlayer(db, ex.handId, playerId);
        if (h.status === 'ok') examples.push(describeExample(h.events, h.meta.heroSeat, ex));
      }
      const previous = previousRow
        ? { stats: previousRow.stats as PlayerStats, text: previousRow.text ?? '', createdAt: previousRow.createdAt.toISOString() }
        : null;
      const { system, user } = buildCoachPrompt(stats, examples, previous);
      const text = await llm.explain(system, user, AbortSignal.timeout(opts?.timeoutMs ?? 60_000), { maxTokens: 2000, maxChars: 4000 });
      await db.update(coachReports).set({ status: 'ok', text: sanitizeLlmText(text, 4000) }).where(eq(coachReports.id, id));
    } catch (e) {
      console.error(`[report ${playerId}] generation failed`, e);
      try {
        await markFailed();
      } catch (e2) {
        console.error(`[report ${playerId}] could not mark failed`, e2);
      }
    }
  })();
  return { report: toReport(row), job };
}
