import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { mountApi, type ApiDeps } from '../src/api/index.js';
import { LoginLimiter } from '../src/accounts/rateLimit.js';
import { createAdmin, createInvites } from '../src/accounts/service.js';

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(over: Partial<ApiDeps> = {}) {
  const db = await createDb({ memory: true });
  const created: unknown[] = [];
  const deps: ApiDeps = {
    db: async () => db,
    llm: null,
    llmDailyLimit: 30,
    limiter: new LoginLimiter(),
    listTables: async () => [],
    createTable: async (opts) => {
      created.push(opts);
      return 'room1';
    },
    ...over,
  };
  const app = express();
  mountApi(app, deps);
  const server = app.listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  return { db, call, created };
}

async function registered(db: Db, call: Awaited<ReturnType<typeof start>>['call'], username = 'alice') {
  const [code] = await createInvites(db, null, 1);
  const r = await call('POST', '/api/auth/register', { username, displayName: username.toUpperCase(), password: 'password1', inviteCode: code });
  expect(r.status).toBe(200);
  return r.body as { token: string; playerId: string; name: string; isAdmin: boolean };
}

describe('auth API', () => {
  it('register → me → login, and the old nickname login is gone', async () => {
    const { db, call } = await start();
    const u = await registered(db, call);
    expect(u.name).toBe('ALICE');
    expect((await call('GET', '/api/me', undefined, u.token)).body).toMatchObject({ playerId: u.playerId, username: 'alice', isAdmin: false });
    const login = await call('POST', '/api/auth/login', { username: 'Alice', password: 'password1' });
    expect(login.status).toBe(200);
    expect(login.body.playerId).toBe(u.playerId);
    expect((await call('POST', '/api/auth/nickname', { nickname: 'x' })).status).toBe(404);
    expect((await call('GET', '/api/me')).status).toBe(401);
  });

  it('locks login after 5 failures for that username', async () => {
    const { db, call } = await start();
    await registered(db, call);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/api/auth/login', { username: 'alice', password: 'wrongpass' })).status).toBe(401);
    const locked = await call('POST', '/api/auth/login', { username: 'alice', password: 'password1' });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/分钟/);
  });

  it('changing the password returns a new token and rejects the old one', async () => {
    const { db, call } = await start();
    const u = await registered(db, call);
    const r = await call('POST', '/api/auth/password', { oldPassword: 'password1', newPassword: 'password2' }, u.token);
    expect(r.status).toBe(200);
    expect((await call('GET', '/api/me', undefined, u.token)).status).toBe(401);
    expect((await call('GET', '/api/me', undefined, r.body.token)).status).toBe(200);
  });

  it('server errors return 500 with a generic message, not the raw error', async () => {
    const { call } = await start({ db: async () => Promise.reject(new Error('connection refused: secret details')) });
    const r = await call('POST', '/api/auth/login', { username: 'alice', password: 'password1' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/secret details/);
  });

  it('bad input returns 400 with a Chinese message', async () => {
    const { call } = await start();
    const r = await call('POST', '/api/auth/register', { username: 'a', displayName: 'x', password: 'password1', inviteCode: 'X' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/用户名/);
  });
});

describe('admin API', () => {
  it('is admin-only', async () => {
    const { db, call } = await start();
    const u = await registered(db, call);
    expect((await call('GET', '/api/admin/users', undefined, u.token)).status).toBe(403);
    expect((await call('POST', '/api/admin/invites', { count: 2 }, u.token)).status).toBe(403);
  });

  it('creates invites, lists users and resets passwords', async () => {
    const { db, call } = await start();
    const admin = await createAdmin(db, 'root', '管理员', 'adminpass1');
    const tok = (await call('POST', '/api/auth/login', { username: 'root', password: 'adminpass1' })).body.token as string;
    const inv = await call('POST', '/api/admin/invites', { count: 2, expiresInDays: 7 }, tok);
    expect(inv.status).toBe(200);
    expect(inv.body.codes).toHaveLength(2);
    const reg = await call('POST', '/api/auth/register', { username: 'bob', displayName: 'Bob', password: 'password1', inviteCode: inv.body.codes[0] });
    expect(reg.status).toBe(200);
    const list = await call('GET', '/api/admin/invites', undefined, tok);
    expect(list.body.find((i: { code: string }) => i.code === inv.body.codes[0]).usedBy).toBe('Bob');
    const users = await call('GET', '/api/admin/users', undefined, tok);
    expect(users.body.map((u: { username: string }) => u.username)).toEqual(['root', 'bob']);
    const reset = await call('POST', `/api/admin/users/${reg.body.playerId}/reset-password`, {}, tok);
    expect(reset.status).toBe(200);
    expect((await call('GET', '/api/me', undefined, reg.body.token)).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { username: 'bob', password: reset.body.password })).status).toBe(200);
    void admin;
  });
});

describe('tables API', () => {
  it('validates bot level and style before creating a table', async () => {
    const { db, call, created } = await start();
    const u = await registered(db, call);
    expect((await call('POST', '/api/tables', { name: 't', bots: 1, botLevel: 'expert', botStyle: 'tag' }, u.token)).status).toBe(400);
    expect((await call('POST', '/api/tables', { name: 't', bots: 1, botLevel: 'advanced', botStyle: 'xyz' }, u.token)).status).toBe(400);
    const ok = await call('POST', '/api/tables', { name: 't', bots: 1, botLevel: 'beginner', botStyle: 'random' }, u.token);
    expect(ok.status).toBe(200);
    expect(created).toHaveLength(1);
    expect((await call('POST', '/api/tables', { name: 't' })).status).toBe(401);
  });
});
