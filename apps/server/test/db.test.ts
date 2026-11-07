import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { createAdmin, login } from '../src/accounts/service.js';

describe('createDb', () => {
  it('creates a missing nested data directory and persists across reopen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pgl-'));
    const dir = join(root, 'a', 'b', 'pglite');
    try {
      const db1 = await createDb({ dataDir: dir });
      const a = await createAdmin(db1, 'persist', '持久化', 'password1');
      await (db1 as unknown as { $client: { close(): Promise<void> } }).$client.close();
      const db2 = await createDb({ dataDir: dir });
      expect((await login(db2, { username: 'persist', password: 'password1' })).id).toBe(a.id);
      await (db2 as unknown as { $client: { close(): Promise<void> } }).$client.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('migration 0003', () => {
  it('gives llm_usage rows that existed before it kind = hand', async () => {
    const src = fileURLToPath(new URL('../drizzle', import.meta.url));
    const root = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      // Stage a migrations folder holding only 0000-0002.
      mkdirSync(join(root, 'meta'), { recursive: true });
      for (const f of readdirSync(src).filter((f) => /^000[0-2]_.*\.sql$/.test(f))) copyFileSync(join(src, f), join(root, f));
      const journal = JSON.parse(readFileSync(join(src, 'meta', '_journal.json'), 'utf8'));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 2);
      writeFileSync(join(root, 'meta', '_journal.json'), JSON.stringify(journal));
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: root });
      await client.query(`insert into llm_usage (player_id, day, count) values ('p', '2026-11-01', 4)`);
      await migrate(drizzle(client), { migrationsFolder: src });
      const r = await client.query<{ kind: string; count: number }>(`select kind, count from llm_usage`);
      expect(r.rows).toEqual([{ kind: 'hand', count: 4 }]);
      await client.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
