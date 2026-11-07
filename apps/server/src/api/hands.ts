import { Router } from 'express';
import { getAnalysis, requestAnalysis } from '../analysis/service.js';
import { getHandForPlayer, listHands, loadHandForPlayer } from '../history/repo.js';
import { HttpError } from '../http.js';
import type { ApiDeps } from './index.js';
import { requireUser, userOf } from './middleware.js';

const notFound = () => new HttpError(404, '牌局不存在');
const forbidden = () => new HttpError(403, '只能查看自己参与的牌局');

export function handRoutes(deps: ApiDeps): Router {
  const r = Router();
  r.use(requireUser(deps));

  r.get('/', async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json(await listHands(await deps.db(), userOf(res).playerId, { before, limit }));
  });

  r.get('/:id', async (req, res) => {
    const h = await getHandForPlayer(await deps.db(), req.params.id, userOf(res).playerId);
    if (h.status === 'not_found') throw notFound();
    if (h.status === 'forbidden') throw forbidden();
    res.json({ hand: h.hand, frames: h.frames });
  });

  r.post('/:id/analysis', async (req, res) => {
    const a = await requestAnalysis(await deps.db(), deps.llm, req.params.id, userOf(res).playerId, { dailyLimit: deps.llmDailyLimit });
    if (a.status === 'not_found') throw notFound();
    if (a.status === 'forbidden') throw forbidden();
    res.json(a.analysis);
  });

  r.get('/:id/analysis', async (req, res) => {
    const db = await deps.db();
    const me = userOf(res).playerId;
    const h = await loadHandForPlayer(db, req.params.id, me);
    if (h.status === 'not_found') throw notFound();
    if (h.status === 'forbidden') throw forbidden();
    const a = await getAnalysis(db, req.params.id, me);
    if (!a) throw new HttpError(404, '还没有分析过');
    res.json(a);
  });

  return r;
}
