import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginLimiter } from '../src/accounts/rateLimit.js';
import { mountApi, type ApiDeps } from '../src/api/index.js';
import { createDb } from '../src/db/client.js';
import { drainSaves, trackSave } from '../src/persistence.js';
import { mountWeb } from '../src/web.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

async function serve(deps: Partial<ApiDeps>, webDir?: string) {
  const db = await createDb({ memory: true });
  const app = express();
  mountApi(app, {
    db: async () => db,
    llm: null,
    llmDailyLimit: 30,
    limiter: new LoginLimiter(),
    listTables: async () => [],
    createTable: async () => 'r',
    ...deps,
  });
  if (webDir) mountWeb(app, webDir);
  const server = app.listen(0);
  cleanups.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('health check', () => {
  it('reports the database as reachable', async () => {
    const base = await serve({});
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
  });

  it('returns 503 when the database is down', async () => {
    const base = await serve({ db: () => Promise.reject(new Error('down')) });
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: false });
  });
});

describe('serving the built front end', () => {
  it('serves index.html at / and assets, while /api keeps working', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>德州扑克</title>');
    writeFileSync(join(dir, 'app.js'), 'console.log(1)');
    const base = await serve({}, dir);
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('德州扑克');
    expect(page.headers.get('cache-control')).toMatch(/no-cache/);
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});

describe('draining saves at shutdown', () => {
  it('waits for pending saves, and gives up after the timeout', async () => {
    let done = false;
    trackSave(new Promise<void>((r) => setTimeout(() => ((done = true), r()), 50)));
    expect(await drainSaves(2000)).toEqual({ drained: true, pending: 0 });
    expect(done).toBe(true);
    let release!: () => void;
    trackSave(new Promise<void>((r) => (release = r))); // stuck until released
    expect(await drainSaves(50)).toEqual({ drained: false, pending: 1 });
    release();
    expect(await drainSaves(500)).toEqual({ drained: true, pending: 0 });
  });

  it('a failed save does not break draining', async () => {
    trackSave(Promise.reject(new Error('db down')));
    expect((await drainSaves(500)).pending).toBe(0);
  });
});
