import { Router } from 'express';
import { adminResetPassword, createInvites, listInvites, listUsers } from '../accounts/service.js';
import type { ApiDeps } from './index.js';
import { requireAdmin, requireUser, userOf } from './middleware.js';

export function adminRoutes(deps: ApiDeps): Router {
  const r = Router();
  r.use(requireUser(deps), requireAdmin);

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

  r.post('/users/:id/reset-password', async (req, res) => {
    res.json({ password: await adminResetPassword(await deps.db(), req.params.id) });
  });

  return r;
}
