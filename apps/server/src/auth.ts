import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-only-secret-change-me');
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}

export interface AuthUser {
  playerId: string;
  name: string;
}

/** Phase 2: anonymous login with a nickname. Phase 3 replaces this with username + password + invite code. */
export async function issueAnonToken(nickname: unknown): Promise<{ token: string; user: AuthUser }> {
  const name = sanitizeName(nickname);
  // playerId is always server-generated: ids are visible to other players,
  // so accepting one from the client would allow impersonation.
  const user: AuthUser = { playerId: `anon-${randomUUID()}`, name };
  const token = await new SignJWT({ name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.playerId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
  return { token, user };
}

export async function verifyToken(token: unknown): Promise<AuthUser> {
  if (typeof token !== 'string' || !token) throw new Error('missing token');
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  if (!payload.sub || typeof payload.name !== 'string') throw new Error('bad token');
  return { playerId: payload.sub, name: payload.name };
}

export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  if (!s) throw new Error('昵称不能为空');
  return s;
}
