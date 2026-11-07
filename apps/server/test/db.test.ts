import { mkdtempSync, rmSync } from 'node:fs';
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
