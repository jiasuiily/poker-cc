import { Router } from 'express';
import { issueToken } from '../auth.js';
import { normalizeUsername } from '../accounts/names.js';
import { changePassword, getAccount, login, register, type Account } from '../accounts/service.js';
import { recordLogin } from '../accounts/activity.js';
import { HttpError } from '../http.js';
import type { ApiDeps } from './index.js';
import { requireUser, userOf } from './middleware.js';

const session = async (a: Account) => ({
  token: await issueToken({ playerId: a.id, name: a.displayName, ver: a.tokenVersion }),
  playerId: a.id,
  name: a.displayName,
  username: a.username,
  isAdmin: a.isAdmin,
});

export function authRoutes(deps: ApiDeps): Router {
  const r = Router();

  r.post('/register', async (req, res) => {
    const db = await deps.db();
    const a = await register(db, req.body ?? {});
    await recordLogin(db, a.id);
    res.json(await session(a));
  });

  r.post('/login', async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const keys = [`user:${username}`, `ip:${req.ip}`];
    const until = deps.limiter.lockedUntil(keys);
    if (until) {
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      throw new HttpError(429, `登录失败次数过多，请 ${minutes} 分钟后再试`);
    }
    try {
      const db = await deps.db();
      const a = await login(db, { username, password: req.body?.password });
      deps.limiter.success([`user:${username}`]);
      await recordLogin(db, a.id);
      res.json(await session(a));
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) deps.limiter.fail(keys);
      throw e;
    }
  });

  r.post('/password', requireUser(deps), async (req, res) => {
    const db = await deps.db();
    const me = userOf(res);
    await changePassword(db, me.playerId, req.body?.oldPassword, req.body?.newPassword);
    res.json(await session((await getAccount(db, me.playerId))!));
  });

  return r;
}

export function meRoute(deps: ApiDeps): Router {
  const r = Router();
  r.get('/', requireUser(deps), async (_req, res) => {
    const a = await getAccount(await deps.db(), userOf(res).playerId);
    if (!a) throw new HttpError(401, '登录已过期，请重新登录');
    res.json({ playerId: a.id, name: a.displayName, username: a.username, isAdmin: a.isAdmin });
  });
  return r;
}
