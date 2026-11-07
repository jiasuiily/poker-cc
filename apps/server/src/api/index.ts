import express, { type Application } from 'express';
import { sql } from 'drizzle-orm';
import type { LoginLimiter } from '../accounts/rateLimit.js';
import type { Db } from '../db/client.js';
import { errorHandler } from '../http.js';
import type { LlmClient } from '../llm.js';
import type { TableRoomOptions } from '../rooms/TableRoom.js';
import { adminRoutes } from './admin.js';
import { authRoutes, meRoute } from './auth.js';
import { handRoutes } from './hands.js';
import { tableRoutes } from './tables.js';

/** Everything the HTTP API needs; injected so tests can use an in-memory DB and stub rooms. */
export interface ApiDeps {
  db: () => Promise<Db>;
  llm: LlmClient | null;
  llmDailyLimit: number;
  limiter: LoginLimiter;
  listTables: () => Promise<unknown[]>;
  createTable: (opts: TableRoomOptions) => Promise<string>;
}

export function mountApi(app: Application, deps: ApiDeps): void {
  // Behind Caddy (docker network) or localhost: trust private proxies for req.ip.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });
  app.use('/api', express.json({ limit: '16kb' }));

  // Container health check: also probes the database.
  app.get('/api/health', async (_req, res) => {
    try {
      await (await deps.db()).execute(sql`select 1`);
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });
  app.use('/api/auth', authRoutes(deps));
  app.use('/api/me', meRoute(deps));
  app.use('/api/admin', adminRoutes(deps));
  app.use('/api/tables', tableRoutes(deps));
  app.use('/api/hands', handRoutes(deps));
  app.use('/api', (_req, res) => void res.status(404).json({ error: '接口不存在' }));
  app.use(errorHandler);
}
