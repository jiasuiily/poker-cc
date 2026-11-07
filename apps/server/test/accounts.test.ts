import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client.js';
import { inviteCodes, players } from '../src/db/schema.js';
import { issueToken, verifyToken } from '../src/auth.js';
import { HttpError } from '../src/http.js';
import { normalizeUsername, sanitizeDisplayName } from '../src/accounts/names.js';
import {
  adminResetPassword,
  changePassword,
  createAdmin,
  createInvites,
  login,
  promote,
  register,
} from '../src/accounts/service.js';
import { LoginLimiter } from '../src/accounts/rateLimit.js';

async function setup(): Promise<{ db: Db; codes: string[] }> {
  const db = await createDb({ memory: true });
  const codes = await createInvites(db, null, 5);
  return { db, codes };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 0;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

describe('names', () => {
  it('normalises usernames and enforces the allowed set', () => {
    expect(normalizeUsername(' Tom_1 ')).toBe('tom_1');
    expect(normalizeUsername('Gu')).toBe('gu');
    for (const bad of ['a', 'a'.repeat(21), '中文名字', 'tom smith', 'tom-1']) {
      expect(() => normalizeUsername(bad)).toThrow(HttpError);
    }
  });

  it('cleans display names: NFC, invisible characters removed, 1–12 code points', () => {
    expect(sanitizeDisplayName(' 小明 ')).toBe('小明');
    expect(sanitizeDisplayName('Bob​')).toBe('Bob');
    expect(sanitizeDisplayName('‮evil')).toBe('evil');
    expect(sanitizeDisplayName('é')).toBe('é'); // decomposed é → precomposed
    expect(sanitizeDisplayName('😀'.repeat(12))).toHaveLength(24); // 12 code points is fine
    expect(() => sanitizeDisplayName('😀'.repeat(13))).toThrow(HttpError);
    expect(() => sanitizeDisplayName('​​')).toThrow(HttpError);
    expect(() => sanitizeDisplayName('<b>x</b>')).toThrow(HttpError);
  });
});

describe('registration', () => {
  it('needs a valid unused invite code, which is then consumed', async () => {
    const { db, codes } = await setup();
    const u = await register(db, { username: 'Alice', displayName: '爱丽丝', password: 'password1', inviteCode: codes[0]! });
    expect(u).toMatchObject({ username: 'alice', displayName: '爱丽丝', isAdmin: false });
    expect(u.id).toMatch(/^p_/);
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, codes[0]!));
    expect(row!.usedBy).toBe(u.id);
    expect(await status(register(db, { username: 'bob', displayName: 'Bob', password: 'password1', inviteCode: codes[0]! }))).toBe(400);
    expect(await status(register(db, { username: 'bob', displayName: 'Bob', password: 'password1', inviteCode: 'NOPE1234' }))).toBe(400);
  });

  it('rejects expired invites', async () => {
    const { db } = await setup();
    const [code] = await createInvites(db, null, 1, -1); // expired yesterday
    expect(await status(register(db, { username: 'carol', displayName: 'Carol', password: 'password1', inviteCode: code! }))).toBe(400);
  });

  it('rejects duplicate usernames (case-insensitive) and lookalike display names without using the invite', async () => {
    const { db, codes } = await setup();
    await register(db, { username: 'bob', displayName: 'Bob', password: 'password1', inviteCode: codes[0]! });
    expect(await status(register(db, { username: 'BOB', displayName: 'Bobby', password: 'password1', inviteCode: codes[1]! }))).toBe(409);
    expect(await status(register(db, { username: 'bob2', displayName: 'Bob​', password: 'password1', inviteCode: codes[1]! }))).toBe(409);
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, codes[1]!));
    expect(row!.usedBy).toBeNull();
  });

  it('requires passwords of at least 6 characters, any kind', async () => {
    const { db, codes } = await setup();
    expect(await status(register(db, { username: 'dave', displayName: 'Dave', password: '12345', inviteCode: codes[0]! }))).toBe(400);
    const digits = await register(db, { username: 'dave', displayName: 'Dave', password: '123456', inviteCode: codes[0]! });
    expect(digits.username).toBe('dave');
    const letters = await register(db, { username: 'dora', displayName: 'Dora', password: 'abcdef', inviteCode: codes[1]! });
    expect(letters.username).toBe('dora');
  });
});

describe('login and tokens', () => {
  it('logs in with the right password only; the error does not reveal which part was wrong', async () => {
    const { db, codes } = await setup();
    await register(db, { username: 'erin', displayName: 'Erin', password: 'password1', inviteCode: codes[0]! });
    expect((await login(db, { username: 'ERIN', password: 'password1' })).username).toBe('erin');
    const wrongPw = await login(db, { username: 'erin', password: 'password2' }).catch((e) => e);
    const noUser = await login(db, { username: 'nobody', password: 'password1' }).catch((e) => e);
    expect(wrongPw).toBeInstanceOf(HttpError);
    expect(wrongPw.status).toBe(401);
    expect(noUser.message).toBe(wrongPw.message);
  });

  it('old nickname-only players cannot log in', async () => {
    const { db } = await setup();
    await db.insert(players).values({ id: 'p_legacy', nickname: '老王' });
    expect(await status(login(db, { username: '老王', password: 'password1' }))).toBe(400);
    const tok = await issueToken({ playerId: 'p_legacy', name: '老王', ver: 0 });
    await expect(verifyToken(tok, db)).rejects.toThrow();
  });

  it('changing the password invalidates old tokens', async () => {
    const { db, codes } = await setup();
    const u = await register(db, { username: 'fred', displayName: 'Fred', password: 'password1', inviteCode: codes[0]! });
    const old = await issueToken({ playerId: u.id, name: u.displayName, ver: u.tokenVersion });
    expect((await verifyToken(old, db)).playerId).toBe(u.id);
    expect(await status(changePassword(db, u.id, 'wrongpass', 'password2'))).toBe(400);
    const ver = await changePassword(db, u.id, 'password1', 'password2');
    await expect(verifyToken(old, db)).rejects.toThrow();
    const fresh = await issueToken({ playerId: u.id, name: u.displayName, ver });
    expect((await verifyToken(fresh, db)).playerId).toBe(u.id);
    expect((await login(db, { username: 'fred', password: 'password2' })).id).toBe(u.id);
  });

  it('admin reset gives a working temporary password and logs the user out everywhere', async () => {
    const { db, codes } = await setup();
    const u = await register(db, { username: 'gina', displayName: 'Gina', password: 'password1', inviteCode: codes[0]! });
    const old = await issueToken({ playerId: u.id, name: u.displayName, ver: u.tokenVersion });
    const temp = await adminResetPassword(db, u.id);
    expect(temp.length).toBeGreaterThanOrEqual(10);
    await expect(verifyToken(old, db)).rejects.toThrow();
    expect((await login(db, { username: 'gina', password: temp })).id).toBe(u.id);
  });

  it('verifyToken reports admin rights', async () => {
    const { db } = await setup();
    const admin = await createAdmin(db, 'root', '管理员', 'adminpass1');
    const tok = await issueToken({ playerId: admin.id, name: admin.displayName, ver: admin.tokenVersion });
    expect((await verifyToken(tok, db)).isAdmin).toBe(true);
  });

  it('promote turns an existing user into an admin', async () => {
    const { db, codes } = await setup();
    const u = await register(db, { username: 'hank', displayName: 'Hank', password: 'password1', inviteCode: codes[0]! });
    await promote(db, 'HANK');
    expect((await login(db, { username: 'hank', password: 'password1' })).isAdmin).toBe(true);
    expect(await status(promote(db, 'nobody'))).toBe(404);
    void u;
  });
});

describe('login rate limit', () => {
  it('locks a key for 15 minutes after 5 failures within 15 minutes', () => {
    let now = 0;
    const lim = new LoginLimiter(() => now);
    const keys = ['ip:1.2.3.4', 'user:erin'];
    for (let i = 0; i < 4; i++) lim.fail(keys);
    expect(lim.lockedUntil(keys)).toBeNull();
    lim.fail(keys);
    expect(lim.lockedUntil(keys)).toBe(15 * 60_000);
    expect(lim.lockedUntil(['user:erin'])).not.toBeNull();
    expect(lim.lockedUntil(['user:other'])).toBeNull();
    now = 15 * 60_000 + 1;
    expect(lim.lockedUntil(keys)).toBeNull();
  });

  it('failures older than the window do not count, and success clears the user key', () => {
    let now = 0;
    const lim = new LoginLimiter(() => now);
    for (let i = 0; i < 4; i++) lim.fail(['user:x']);
    now = 16 * 60_000;
    lim.fail(['user:x']);
    expect(lim.lockedUntil(['user:x'])).toBeNull();
    for (let i = 0; i < 3; i++) lim.fail(['user:x']);
    lim.success(['user:x']);
    lim.fail(['user:x']);
    expect(lim.lockedUntil(['user:x'])).toBeNull();
  });
});
