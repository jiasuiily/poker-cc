import { Router } from 'express';
import type { BatchRunner } from '../analysis/batch.js';
import { HttpError } from '../http.js';
import { usedToday } from '../analysis/quota.js';
import { createReport, listReports, REPORT_DAILY_LIMIT } from '../coach/service.js';
import { playerStats, playerTrend } from '../stats/player.js';
import { handDetailRoutes, type TargetOf } from './hands.js';
import type { ApiDeps } from './index.js';
import { requireUser, userOf } from './middleware.js';

/**
 * A player's review: stats, trend, one-click analysis, overall reports and hand replays.
 * Mounted for the logged-in user at /api/me, and for admins at /api/admin/players/:id/review.
 * Everything runs on the target player's data and daily quotas.
 */
export function playerReviewRoutes(deps: ApiDeps, runner: BatchRunner, target: TargetOf): Router {
  const r = Router({ mergeParams: true });

  r.post('/analyze-all', async (req, res) => {
    res.json(await runner.start(target(req, res)));
  });

  r.get('/analyze-all', async (req, res) => {
    res.json(await runner.progress(target(req, res)));
  });

  r.get('/stats', async (req, res) => {
    const range = req.query.range === undefined ? 'all' : req.query.range;
    if (range !== '7d' && range !== '30d' && range !== 'all') throw new HttpError(400, 'range 只能是 7d、30d 或 all');
    res.json(await playerStats(await deps.db(), target(req, res), range));
  });

  r.get('/trend', async (req, res) => {
    const raw = req.query.days;
    const days = raw === undefined ? 30 : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'days 必须是 1 到 365 的整数');
    res.json(await playerTrend(await deps.db(), target(req, res), days));
  });

  r.post('/reports', async (req, res) => {
    const { report } = await createReport(await deps.db(), deps.llm, target(req, res));
    res.status(202).json(report);
  });

  r.get('/reports', async (req, res) => {
    const db = await deps.db();
    const playerId = target(req, res);
    const reports = await listReports(db, playerId);
    // Refused attempts also count, so the used number can exceed the limit.
    const remainingToday = Math.max(0, REPORT_DAILY_LIMIT - (await usedToday(db, playerId, 'report')));
    res.json({ reports, remainingToday });
  });

  r.use('/hands', handDetailRoutes(deps, target));
  return r;
}

/** Personal-center routes (mounted at /api/me, after the plain GET /api/me). */
export function meRoutes(deps: ApiDeps, runner: BatchRunner): Router {
  const r = Router();
  r.use(requireUser(deps));
  r.use(playerReviewRoutes(deps, runner, (_req, res) => userOf(res).playerId));
  return r;
}
