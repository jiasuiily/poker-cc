import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, LOCK_FILE } from '../src/db/client.js';

const roots: string[] = [];
function freshDir() {
  const root = mkdtempSync(join(tmpdir(), 'pgl-lock-'));
  roots.push(root);
  return join(root, 'pglite');
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const close = (db: unknown) => (db as { $client: { close(): Promise<void> } }).$client.close();

describe('PGlite directory lock', () => {
  it('refuses a directory held by another live process', async () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    // The parent process (the test runner) is alive and is not us.
    writeFileSync(join(dir, LOCK_FILE), String(process.ppid));
    await expect(createDb({ dataDir: dir })).rejects.toThrow(new RegExp(`正被进程 ${process.ppid} 使用`));
  });

  it('takes over a stale lock left by a dead process', async () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LOCK_FILE), '999999');
    const db = await createDb({ dataDir: dir });
    expect(readFileSync(join(dir, LOCK_FILE), 'utf8').trim()).toBe(String(process.pid));
    await close(db);
  });

  it('writes its own pid on a fresh directory', async () => {
    const dir = freshDir();
    const db = await createDb({ dataDir: dir });
    expect(readFileSync(join(dir, LOCK_FILE), 'utf8').trim()).toBe(String(process.pid));
    await close(db);
  });
});
