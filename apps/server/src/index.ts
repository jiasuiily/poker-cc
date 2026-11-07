import { existsSync } from 'node:fs';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LoginLimiter } from './accounts/rateLimit.js';
import { mountApi } from './api/index.js';
import { closeDb, getDb } from './db/client.js';
import { createLlmClient } from './llm.js';
import { drainSaves } from './persistence.js';
import { SERVER_CREATE_KEY, TableRoom, type TableMetadata } from './rooms/TableRoom.js';
import { mountWeb } from './web.js';

const PORT = Number(process.env.PORT ?? 2567);
/** Built front end (production). In development the Vite dev server serves it instead. */
const WEB_DIR = process.env.WEB_DIR;

const gameServer = new Server({
  transport: new WebSocketTransport(),
  greet: false,
  express: (app) => {
    mountApi(app, {
      db: getDb,
      llm: createLlmClient(process.env),
      llmDailyLimit: Math.max(0, Number(process.env.LLM_DAILY_LIMIT ?? 30) || 0),
      limiter: new LoginLimiter(),
      listTables: async () =>
        (await matchMaker.query({ name: 'table' })).map((r) => ({ roomId: r.roomId, clients: r.clients, ...(r.metadata as TableMetadata) })),
      createTable: async (opts) => (await matchMaker.createRoom('table', { ...opts, serverKey: SERVER_CREATE_KEY })).roomId,
    });
    if (WEB_DIR && existsSync(WEB_DIR)) mountWeb(app, WEB_DIR);
  },
});

gameServer.define('table', TableRoom);

// Graceful shutdown (SIGTERM from docker stop / Ctrl+C): Colyseus disconnects rooms first,
// then we wait for hand saves still in flight and close the database.
gameServer.onShutdown(async () => {
  const r = await drainSaves(15_000);
  if (!r.drained) console.error(`shutdown: ${r.pending} hand save(s) still pending after 15s`);
  await closeDb();
  console.log('shutdown complete');
});

await getDb(); // run migrations before accepting connections
await gameServer.listen(PORT);
console.log(`poker server listening on :${PORT}${WEB_DIR ? ` (serving ${WEB_DIR})` : ''}`);
