import { Router } from 'express';
import { isStyleId } from '@poker/ai';
import { HttpError } from '../http.js';
import type { ApiDeps } from './index.js';
import { requireUser } from './middleware.js';

export function tableRoutes(deps: ApiDeps): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    res.json(await deps.listTables());
  });

  r.post('/', requireUser(deps), async (req, res) => {
    const { name, maxSeats, smallBlind, bigBlind, bots, botLevel, botStyle } = req.body ?? {};
    if (botLevel !== undefined && botLevel !== 'beginner' && botLevel !== 'advanced') throw new HttpError(400, '电脑难度无效');
    if (botStyle !== undefined && botStyle !== 'random' && !isStyleId(botStyle)) throw new HttpError(400, '电脑风格无效');
    const roomId = await deps.createTable({ name, maxSeats, smallBlind, bigBlind, bots, botLevel, botStyle });
    res.json({ roomId });
  });

  return r;
}
