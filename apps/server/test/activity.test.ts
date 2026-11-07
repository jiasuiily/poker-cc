import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { players } from '../src/db/schema.js';
import { mountApi, type ApiDeps } from '../src/api/index.js';
import { LoginLimiter } from '../src/accounts/rateLimit.js';
import { createInvites } from '../src/accounts/service.js';
import { isAtTable, tableJoined, tableLeft, touchSeen } from '../src/accounts/activity.js';

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start() {
  const db = await createDb({ memory: true });
  const deps: ApiDeps = {
    db: async () => db,
    llm: null,
    llmDailyLimit: 30,
    limiter: new LoginLimiter(),
    listTables: async () => [],
    createTable: async () => 'room1',
  };
  const app = express();
  mountApi(app, deps);
  const server = app.listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  return { db, call };
}

const row = async (db: Awaited<ReturnType<typeof createDb>>, id: string) => (await db.select().from(players).where(eq(players.id, id)))[0]!;

describe('login tracking', () => {
  it('counts register, successful logins, not failures', async () => {
    const { db, call } = await start();
    const [code] = await createInvites(db, null, 1);
    const r = await call('/api/auth/register', { username: 'alice', displayName: 'ALICE', password: 'password1', inviteCode: code });
    expect(r.status).toBe(200);
    const id = r.body.playerId as string;
    const a = await row(db, id);
    expect(a.loginCount).toBe(1);
    expect(a.lastLoginAt).toBeTruthy();
    expect(a.lastSeenAt).toBeTruthy();

    expect((await call('/api/auth/login', { username: 'alice', password: 'wrongwrong' })).status).toBe(401);
    expect((await row(db, id)).loginCount).toBe(1);

    await new Promise((res) => setTimeout(res, 10));
    expect((await call('/api/auth/login', { username: 'alice', password: 'password1' })).status).toBe(200);
    const b = await row(db, id);
    expect(b.loginCount).toBe(2);
    expect(b.lastLoginAt!.getTime()).toBeGreaterThan(a.lastLoginAt!.getTime());
  });
});

describe('touchSeen', () => {
  it('writes at most once per 60 s per player', async () => {
    const { db, call } = await start();
    const [code] = await createInvites(db, null, 1);
    const id = (await call('/api/auth/register', { username: 'bob', displayName: 'BOB', password: 'password1', inviteCode: code })).body.playerId as string;
    const t0 = Date.now() + 10_000_000;
    await touchSeen(db, id, t0);
    expect((await row(db, id)).lastSeenAt!.getTime()).toBe(t0);
    await touchSeen(db, id, t0 + 30_000);
    expect((await row(db, id)).lastSeenAt!.getTime()).toBe(t0);
    await touchSeen(db, id, t0 + 61_000);
    expect((await row(db, id)).lastSeenAt!.getTime()).toBe(t0 + 61_000);
  });
});

describe('table presence', () => {
  it('counts connections per player', () => {
    tableJoined('p1');
    tableJoined('p1');
    tableLeft('p1');
    expect(isAtTable('p1')).toBe(true);
    tableLeft('p1');
    expect(isAtTable('p1')).toBe(false);
    tableLeft('p1');
    expect(isAtTable('p1')).toBe(false);
  });
});
