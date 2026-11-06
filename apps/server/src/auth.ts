import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-only-secret-change-me');
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}

export interface AuthUser {
  playerId: string;
  name: string;
}

/** Sign a 7-day token for a player (the id always comes from the players table). */
export async function issueToken(user: AuthUser): Promise<string> {
  return new SignJWT({ name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.playerId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifyToken(token: unknown): Promise<AuthUser> {
  if (typeof token !== 'string' || !token) throw new Error('missing token');
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  if (!payload.sub || typeof payload.name !== 'string') throw new Error('bad token');
  return { playerId: payload.sub, name: payload.name };
}

/** Trimmed, 1–16 characters, no control characters or angle brackets. Rejects rather than truncates. */
export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim();
  if (!s) throw new Error('昵称不能为空');
  if ([...s].length > 16) throw new Error('昵称最多 16 个字');
  return s;
}
