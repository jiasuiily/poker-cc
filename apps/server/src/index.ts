import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LoginLimiter } from './accounts/rateLimit.js';
import { mountApi } from './api/index.js';
import { getDb } from './db/client.js';
import { createLlmClient } from './llm.js';
import { TableRoom, type TableMetadata } from './rooms/TableRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport(),
  greet: false,
  express: (app) =>
    mountApi(app, {
      db: getDb,
      llm: createLlmClient(process.env),
      llmDailyLimit: Math.max(0, Number(process.env.LLM_DAILY_LIMIT ?? 30) || 0),
      limiter: new LoginLimiter(),
      listTables: async () =>
        (await matchMaker.query({ name: 'table' })).map((r) => ({ roomId: r.roomId, clients: r.clients, ...(r.metadata as TableMetadata) })),
      createTable: async (opts) => (await matchMaker.createRoom('table', opts)).roomId,
    }),
});

gameServer.define('table', TableRoom);

await getDb(); // run migrations before accepting connections
await gameServer.listen(PORT);
console.log(`poker server listening on :${PORT}`);
