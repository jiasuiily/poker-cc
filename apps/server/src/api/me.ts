import { Router } from 'express';
import type { BatchRunner } from '../analysis/batch.js';
import { HttpError } from '../http.js';
import { createReport, listReports } from '../coach/service.js';
import { playerStats, playerTrend } from '../stats/player.js';
import type { ApiDeps } from './index.js';
import { requireUser, userOf } from './middleware.js';

/** Personal-center routes (mounted at /api/me, after the plain GET /api/me). */
export function meRoutes(deps: ApiDeps, runner: BatchRunner): Router {
  const r = Router();
  r.use(requireUser(deps));

  r.post('/analyze-all', async (_req, res) => {
    res.json(await runner.start(userOf(res).playerId));
  });

  r.get('/analyze-all', async (_req, res) => {
    res.json(await runner.progress(userOf(res).playerId));
  });

  r.get('/stats', async (req, res) => {
    const range = req.query.range === undefined ? 'all' : req.query.range;
    if (range !== '7d' && range !== '30d' && range !== 'all') throw new HttpError(400, 'range 只能是 7d、30d 或 all');
    res.json(await playerStats(await deps.db(), userOf(res).playerId, range));
  });

  r.get('/trend', async (req, res) => {
    const raw = req.query.days;
    const days = raw === undefined ? 30 : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'days 必须是 1 到 365 的整数');
    res.json(await playerTrend(await deps.db(), userOf(res).playerId, days));
  });

  r.post('/reports', async (_req, res) => {
    const { report } = await createReport(await deps.db(), deps.llm, userOf(res).playerId);
    res.status(202).json(report);
  });

  r.get('/reports', async (_req, res) => {
    res.json(await listReports(await deps.db(), userOf(res).playerId));
  });

  return r;
}
