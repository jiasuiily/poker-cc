import { Router, type Request, type Response } from 'express';
import { getAnalysis, requestAnalysis } from '../analysis/service.js';
import { getHandForPlayer, listHands, loadHandForPlayer } from '../history/repo.js';
import { HttpError } from '../http.js';
import type { ApiDeps } from './index.js';
import { requireUser, userOf } from './middleware.js';

const notFound = () => new HttpError(404, '牌局不存在');
const forbidden = () => new HttpError(403, '只能查看自己参与的牌局');

/** Whose hands a router serves: the logged-in user, or (admin) the player in the URL. */
export type TargetOf = (req: Request, res: Response) => string;

/**
 * Replay and per-hand analysis of one hand, seen from the target player's seat
 * (frames are projected for that seat; non-participants get 403).
 */
export function handDetailRoutes(deps: ApiDeps, target: TargetOf): Router {
  const r = Router({ mergeParams: true });

  r.get('/:handId', async (req, res) => {
    const h = await getHandForPlayer(await deps.db(), req.params.handId!, target(req, res));
    if (h.status === 'not_found') throw notFound();
    if (h.status === 'forbidden') throw forbidden();
    res.json({ hand: h.hand, frames: h.frames });
  });

  r.post('/:handId/analysis', async (req, res) => {
    const a = await requestAnalysis(await deps.db(), deps.llm, req.params.handId!, target(req, res), { dailyLimit: deps.llmDailyLimit });
    if (a.status === 'not_found') throw notFound();
    if (a.status === 'forbidden') throw forbidden();
    res.json(a.analysis);
  });

  r.get('/:handId/analysis', async (req, res) => {
    const db = await deps.db();
    const who = target(req, res);
    const h = await loadHandForPlayer(db, req.params.handId!, who);
    if (h.status === 'not_found') throw notFound();
    if (h.status === 'forbidden') throw forbidden();
    const a = await getAnalysis(db, req.params.handId!, who);
    if (!a) throw new HttpError(404, '还没有分析过');
    res.json(a);
  });

  return r;
}

export function handRoutes(deps: ApiDeps): Router {
  const r = Router();
  r.use(requireUser(deps));

  r.get('/', async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json(await listHands(await deps.db(), userOf(res).playerId, { before, limit }));
  });

  r.use(handDetailRoutes(deps, (_req, res) => userOf(res).playerId));
  return r;
}
