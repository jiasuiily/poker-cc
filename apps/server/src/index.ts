import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { issueToken, verifyToken } from './auth.js';
import { getDb } from './db/client.js';
import { findOrCreatePlayer } from './players.js';
import { getHandForPlayer, listHands, loadHandForPlayer } from './history/repo.js';
import { getAnalysis, requestAnalysis } from './analysis/service.js';
import { createLlmClient } from './llm.js';

const llm = createLlmClient(process.env);
const LLM_DAILY_LIMIT = Math.max(0, Number(process.env.LLM_DAILY_LIMIT ?? 30) || 0);

/** Player id from the Authorization header, or null. */
async function authed(req: express.Request): Promise<string | null> {
  try {
    return (await verifyToken(req.headers.authorization?.replace(/^Bearer /, ''))).playerId;
  } catch {
    return null;
  }
}
import { TableRoom, type TableMetadata } from './rooms/TableRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport(),
  greet: false,
  express: (app) => {
    app.use('/api', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return void res.sendStatus(204);
      next();
    });
    app.use('/api', express.json({ limit: '16kb' }));

    app.get('/api/health', (_req, res) => void res.json({ ok: true }));

    // Nickname login: the same nickname always maps to the same player (spec 4.4).
    app.post('/api/auth/nickname', async (req, res) => {
      try {
        const p = await findOrCreatePlayer(await getDb(), req.body?.nickname);
        const user = { playerId: p.id, name: p.nickname };
        res.json({ token: await issueToken(user), ...user });
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : 'bad request' });
      }
    });

    app.get('/api/tables', async (_req, res) => {
      const rooms = await matchMaker.query({ name: 'table' });
      res.json(
        rooms.map((r) => ({ roomId: r.roomId, clients: r.clients, ...(r.metadata as TableMetadata) })),
      );
    });

    app.post('/api/tables', async (req, res) => {
      try {
        await verifyToken(req.headers.authorization?.replace(/^Bearer /, ''));
      } catch {
        return void res.status(401).json({ error: '请先登录' });
      }
      const { name, maxSeats, smallBlind, bigBlind, bots, botLevel, botStyle } = req.body ?? {};
      const room = await matchMaker.createRoom('table', { name, maxSeats, smallBlind, bigBlind, bots, botLevel, botStyle });
      res.json({ roomId: room.roomId });
    });

    app.get('/api/hands', async (req, res) => {
      const me = await authed(req);
      if (!me) return void res.status(401).json({ error: '请先登录' });
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const before = typeof req.query.before === 'string' ? req.query.before : undefined;
      res.json(await listHands(await getDb(), me, { before, limit }));
    });

    app.get('/api/hands/:id', async (req, res) => {
      const me = await authed(req);
      if (!me) return void res.status(401).json({ error: '请先登录' });
      const r = await getHandForPlayer(await getDb(), req.params.id, me);
      if (r.status === 'not_found') return void res.status(404).json({ error: '牌局不存在' });
      if (r.status === 'forbidden') return void res.status(403).json({ error: '只能查看自己参与的牌局' });
      res.json({ hand: r.hand, frames: r.frames });
    });

    app.post('/api/hands/:id/analysis', async (req, res) => {
      const me = await authed(req);
      if (!me) return void res.status(401).json({ error: '请先登录' });
      const r = await requestAnalysis(await getDb(), llm, req.params.id, me, { dailyLimit: LLM_DAILY_LIMIT });
      if (r.status === 'not_found') return void res.status(404).json({ error: '牌局不存在' });
      if (r.status === 'forbidden') return void res.status(403).json({ error: '只能分析自己参与的牌局' });
      res.json(r.analysis);
    });

    app.get('/api/hands/:id/analysis', async (req, res) => {
      const me = await authed(req);
      if (!me) return void res.status(401).json({ error: '请先登录' });
      const db = await getDb();
      const h = await loadHandForPlayer(db, req.params.id, me);
      if (h.status === 'not_found') return void res.status(404).json({ error: '牌局不存在' });
      if (h.status === 'forbidden') return void res.status(403).json({ error: '只能查看自己参与的牌局' });
      const a = await getAnalysis(db, req.params.id, me);
      if (!a) return void res.status(404).json({ error: '还没有分析过' });
      res.json(a);
    });
  },
});

gameServer.define('table', TableRoom);

await getDb(); // run migrations before accepting connections
await gameServer.listen(PORT);
console.log(`poker server listening on :${PORT}`);
