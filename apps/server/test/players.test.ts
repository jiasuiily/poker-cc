import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { players } from '../src/db/schema.js';
import { findOrCreatePlayer } from '../src/players.js';

describe('createDb', () => {
  it('creates a missing nested data directory and persists across reopen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pgl-'));
    const dir = join(root, 'a', 'b', 'pglite');
    try {
      const db1 = await createDb({ dataDir: dir });
      const p = await findOrCreatePlayer(db1, '持久化');
      await (db1 as unknown as { $client: { close(): Promise<void> } }).$client.close();
      const db2 = await createDb({ dataDir: dir });
      expect((await findOrCreatePlayer(db2, '持久化')).id).toBe(p.id);
      await (db2 as unknown as { $client: { close(): Promise<void> } }).$client.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('players', () => {
  it('same nickname returns the same id; trimmed; different nicknames differ', async () => {
    const db = await createDb({ memory: true });
    const a = await findOrCreatePlayer(db, '小明');
    const b = await findOrCreatePlayer(db, ' 小明 ');
    const c = await findOrCreatePlayer(db, '小明2');
    expect(a.id).toMatch(/^p_[0-9a-f-]{36}$/);
    expect(b.id).toBe(a.id);
    expect(b.nickname).toBe('小明');
    expect(c.id).not.toBe(a.id);
  });

  it('rejects empty and over-long nicknames', async () => {
    const db = await createDb({ memory: true });
    await expect(findOrCreatePlayer(db, '   ')).rejects.toThrow();
    await expect(findOrCreatePlayer(db, '一二三四五六七八九十一二三四五六七')).rejects.toThrow();
  });

  it('concurrent creates resolve to a single row', async () => {
    const db = await createDb({ memory: true });
    const all = await Promise.all(Array.from({ length: 10 }, () => findOrCreatePlayer(db, '老王')));
    expect(new Set(all.map((p) => p.id)).size).toBe(1);
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(players);
    expect(rows[0]!.n).toBe(1);
  });
});
