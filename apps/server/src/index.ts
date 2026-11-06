import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { issueAnonToken, verifyToken } from './auth.js';
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

    app.post('/api/auth/anon', async (req, res) => {
      try {
        const { token, user } = await issueAnonToken(req.body?.nickname);
        res.json({ token, ...user });
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
      const { name, maxSeats, smallBlind, bigBlind, bots } = req.body ?? {};
      const room = await matchMaker.createRoom('table', { name, maxSeats, smallBlind, bigBlind, bots });
      res.json({ roomId: room.roomId });
    });
  },
});

gameServer.define('table', TableRoom);

await gameServer.listen(PORT);
console.log(`poker server listening on :${PORT}`);
