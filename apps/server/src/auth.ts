import { SignJWT, jwtVerify } from 'jose';
import { getAccount } from './accounts/service.js';
import type { Db } from './db/client.js';

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-only-secret-change-me');
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}

export interface AuthUser {
  playerId: string;
  /** Display name shown at tables. */
  name: string;
  isAdmin: boolean;
}

/** 7-day token; `ver` must match the account's token_version (password changes revoke tokens). */
export async function issueToken(user: { playerId: string; name: string; ver: number }): Promise<string> {
  return new SignJWT({ name: user.name, ver: user.ver })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.playerId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

/**
 * Verify signature and expiry, then check the account still exists, has a password and
 * the token version is current. The display name comes from the database, not the token.
 */
export async function verifyToken(token: unknown, db: Db): Promise<AuthUser> {
  if (typeof token !== 'string' || !token) throw new Error('missing token');
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  if (!payload.sub || typeof payload.ver !== 'number') throw new Error('token expired: please log in again');
  const acc = await getAccount(db, payload.sub);
  if (!acc || acc.tokenVersion !== payload.ver) throw new Error('token expired: please log in again');
  return { playerId: acc.id, name: acc.displayName, isAdmin: acc.isAdmin };
}
