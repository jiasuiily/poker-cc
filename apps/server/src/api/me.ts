import { Router } from 'express';
import type { BatchRunner } from '../analysis/batch.js';
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

  return r;
}
