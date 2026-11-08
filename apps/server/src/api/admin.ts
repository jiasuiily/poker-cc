import { Router } from 'express';
import type { BatchRunner } from '../analysis/batch.js';
import { adminResetPassword, adminSetPassword, createInvites, getAccount, listInvites, listUsers } from '../accounts/service.js';
import { listReports } from '../coach/service.js';
import { HttpError } from '../http.js';
import { adminPlayers } from '../stats/admin.js';
import type { ApiDeps } from './index.js';
import { playerReviewRoutes } from './me.js';
import { requireAdmin, requireUser, userOf } from './middleware.js';

export function adminRoutes(deps: ApiDeps, runner: BatchRunner): Router {
  const r = Router();
  r.use(requireUser(deps), requireAdmin);

  r.get('/players/:id', async (req, res) => {
    const a = await getAccount(await deps.db(), req.params.id);
    if (!a) throw new HttpError(404, '没有这个玩家');
    res.json({ id: a.id, displayName: a.displayName, username: a.username });
  });

  // The admin sees and runs a player's review exactly as the player would (their data, their quotas).
  r.use(
    '/players/:id/review',
    playerReviewRoutes(deps, runner, (req) => String(req.params.id)),
  );

  r.post('/users/:id/password', async (req, res) => {
    await adminSetPassword(await deps.db(), req.params.id, req.body?.password);
    res.json({ ok: true });
  });

  r.get('/invites', async (_req, res) => {
    res.json(await listInvites(await deps.db()));
  });

  r.post('/invites', async (req, res) => {
    const count = Number(req.body?.count ?? 1) || 1;
    const days = req.body?.expiresInDays === undefined || req.body?.expiresInDays === null ? undefined : Math.max(1, Number(req.body.expiresInDays) || 7);
    res.json({ codes: await createInvites(await deps.db(), userOf(res).playerId, count, days) });
  });

  r.get('/users', async (_req, res) => {
    res.json(await listUsers(await deps.db()));
  });

  r.get('/players', async (_req, res) => {
    res.json(await adminPlayers(await deps.db()));
  });

  r.get('/players/:id/reports', async (req, res) => {
    // Numbers and report text only: examples carry hand ids, actions and reasons.
    const reports = await listReports(await deps.db(), req.params.id);
    res.json(reports.map(({ stats: { examples: _examples, ...stats }, ...rest }) => ({ ...rest, stats })));
  });

  r.post('/users/:id/reset-password', async (req, res) => {
    res.json({ password: await adminResetPassword(await deps.db(), req.params.id) });
  });

  return r;
}
