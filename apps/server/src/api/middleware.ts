import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type AuthUser } from '../auth.js';
import { HttpError } from '../http.js';
import type { ApiDeps } from './index.js';

export const bearer = (req: Request) => req.headers.authorization?.replace(/^Bearer /, '');

/** Sets res.locals.user or responds 401. */
export function requireUser(deps: ApiDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let user: AuthUser;
    try {
      user = await verifyToken(bearer(req), await deps.db());
    } catch (e) {
      if (e instanceof Error && /token|jwt|JWS|exp|signature|missing/i.test(e.message)) {
        return next(new HttpError(401, '登录已过期，请重新登录'));
      }
      return next(e);
    }
    res.locals.user = user;
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!(res.locals.user as AuthUser | undefined)?.isAdmin) return next(new HttpError(403, '需要管理员权限'));
  next();
}

export const userOf = (res: Response) => res.locals.user as AuthUser;
