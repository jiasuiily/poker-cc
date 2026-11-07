import { randomInt, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from '../db/client.js';
import { inviteCodes, players } from '../db/schema.js';
import { HttpError } from '../http.js';
import { normalizeUsername, sanitizeDisplayName, validatePassword } from './names.js';

export interface Account {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  tokenVersion: number;
}

const toAccount = (r: typeof players.$inferSelect): Account => ({
  id: r.id,
  username: r.username ?? '',
  displayName: r.nickname,
  isAdmin: r.isAdmin,
  tokenVersion: r.tokenVersion,
});

/** Unambiguous alphabet (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (len: number) => Array.from({ length: len }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

async function assertFree(db: Db, username: string, displayName: string) {
  const [u] = await db.select({ id: players.id }).from(players).where(eq(players.username, username));
  if (u) throw new HttpError(409, '用户名已被使用');
  const [n] = await db.select({ id: players.id }).from(players).where(eq(players.nickname, displayName));
  if (n) throw new HttpError(409, '显示名已被使用');
}

/** Consume the invite and create the account in one transaction. */
export async function register(
  db: Db,
  input: { username: unknown; displayName: unknown; password: unknown; inviteCode: unknown },
): Promise<Account> {
  const username = normalizeUsername(input.username);
  const displayName = sanitizeDisplayName(input.displayName);
  const password = validatePassword(input.password);
  const code = String(input.inviteCode ?? '').trim().toUpperCase();
  await assertFree(db, username, displayName);
  const passwordHash = await hash(password);
  const id = `p_${randomUUID()}`;
  try {
    return await db.transaction(async (tx) => {
      const used = await tx
        .update(inviteCodes)
        .set({ usedBy: id, usedAt: new Date() })
        .where(and(eq(inviteCodes.code, code), isNull(inviteCodes.usedBy), or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, sql`now()`))))
        .returning({ code: inviteCodes.code });
      if (used.length === 0) throw new HttpError(400, '邀请码无效、已过期或已被使用');
      const [row] = await tx.insert(players).values({ id, nickname: displayName, username, passwordHash }).returning();
      return toAccount(row!);
    });
  } catch (e) {
    // A concurrent registration grabbed the name between the check and the insert.
    if (!(e instanceof HttpError) && /unique|duplicate/i.test(String((e as { cause?: unknown })?.cause ?? e))) {
      throw new HttpError(409, '用户名或显示名已被使用');
    }
    throw e;
  }
}

const BAD_LOGIN = '用户名或密码错误';

export async function login(db: Db, input: { username: unknown; password: unknown }): Promise<Account> {
  const username = normalizeUsername(input.username);
  const password = String(input.password ?? '');
  const [row] = await db.select().from(players).where(eq(players.username, username));
  if (!row?.passwordHash || !(await verify(row.passwordHash, password))) throw new HttpError(401, BAD_LOGIN);
  return toAccount(row);
}

export async function getAccount(db: Db, id: string): Promise<Account | null> {
  const [row] = await db.select().from(players).where(eq(players.id, id));
  return row?.passwordHash ? toAccount(row) : null;
}

/** Returns the new token version (old tokens stop working). */
export async function changePassword(db: Db, id: string, oldPassword: unknown, newPassword: unknown): Promise<number> {
  const [row] = await db.select().from(players).where(eq(players.id, id));
  if (!row?.passwordHash) throw new HttpError(404, '账号不存在');
  if (!(await verify(row.passwordHash, String(oldPassword ?? '')))) throw new HttpError(400, '原密码不正确');
  const passwordHash = await hash(validatePassword(newPassword));
  const [u] = await db
    .update(players)
    .set({ passwordHash, tokenVersion: sql`${players.tokenVersion} + 1` })
    .where(eq(players.id, id))
    .returning({ v: players.tokenVersion });
  return u!.v;
}

/** Sets a random temporary password and logs the user out everywhere. Returns the password. */
export async function adminResetPassword(db: Db, id: string): Promise<string> {
  const temp = randomCode(10);
  const passwordHash = await hash(temp);
  const updated = await db
    .update(players)
    .set({ passwordHash, tokenVersion: sql`${players.tokenVersion} + 1` })
    .where(and(eq(players.id, id), sql`${players.username} is not null`))
    .returning({ id: players.id });
  if (updated.length === 0) throw new HttpError(404, '账号不存在');
  return temp;
}

/** `expiresInDays` may be negative (tests); omitted = never expires. */
export async function createInvites(db: Db, createdBy: string | null, count: number, expiresInDays?: number): Promise<string[]> {
  const n = Math.max(1, Math.min(50, Math.floor(count)));
  const expiresAt = expiresInDays === undefined ? null : new Date(Date.now() + expiresInDays * 86_400_000);
  const codes = Array.from({ length: n }, () => randomCode(8));
  await db.insert(inviteCodes).values(codes.map((code) => ({ code, createdBy, expiresAt })));
  return codes;
}

export async function listInvites(db: Db) {
  return db
    .select({ code: inviteCodes.code, createdAt: inviteCodes.createdAt, expiresAt: inviteCodes.expiresAt, usedBy: players.nickname, usedAt: inviteCodes.usedAt })
    .from(inviteCodes)
    .leftJoin(players, eq(players.id, inviteCodes.usedBy))
    .orderBy(desc(inviteCodes.createdAt))
    .limit(200);
}

export async function listUsers(db: Db) {
  return db
    .select({ id: players.id, username: players.username, displayName: players.nickname, isAdmin: players.isAdmin, createdAt: players.createdAt })
    .from(players)
    .where(sql`${players.username} is not null`)
    .orderBy(asc(players.createdAt));
}

/** CLI: create an admin without an invite. */
export async function createAdmin(db: Db, usernameRaw: unknown, displayNameRaw: unknown, password: unknown): Promise<Account> {
  const username = normalizeUsername(usernameRaw);
  const displayName = sanitizeDisplayName(displayNameRaw ?? usernameRaw);
  await assertFree(db, username, displayName);
  const passwordHash = await hash(validatePassword(password));
  const [row] = await db.insert(players).values({ id: `p_${randomUUID()}`, nickname: displayName, username, passwordHash, isAdmin: true }).returning();
  return toAccount(row!);
}

/** CLI: grant admin to an existing account. */
export async function promote(db: Db, usernameRaw: unknown): Promise<void> {
  const username = normalizeUsername(usernameRaw);
  const updated = await db.update(players).set({ isAdmin: true }).where(eq(players.username, username)).returning({ id: players.id });
  if (updated.length === 0) throw new HttpError(404, '没有这个用户');
}
