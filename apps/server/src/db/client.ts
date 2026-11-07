import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

/** Common query surface of the PGlite and node-postgres drivers. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Overridable for the bundled production build, which lives elsewhere. */
const MIGRATIONS = process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../drizzle', import.meta.url));
/** Repo-root data/pglite, regardless of the working directory. */
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../../data/pglite', import.meta.url));

/**
 * DATABASE_URL set → real PostgreSQL; otherwise PGlite on disk (PGLITE_DIR, default data/pglite),
 * or in memory for tests. PGlite allows one process per directory.
 * Runs migrations before returning.
 */
export async function createDb(opts: { url?: string; dataDir?: string; memory?: boolean } = {}): Promise<Db> {
  const url = opts.url ?? (opts.memory ? undefined : process.env.DATABASE_URL);
  if (url) {
    const db = drizzlePg(new pg.Pool({ connectionString: url }), { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as Db;
  }
  let client: PGlite;
  if (opts.memory) client = new PGlite();
  else {
    const dir = opts.dataDir ?? process.env.PGLITE_DIR ?? DEFAULT_DATA_DIR;
    mkdirSync(dir, { recursive: true }); // PGlite does not create missing parent directories
    acquireDirLock(dir);
    client = new PGlite(dir);
  }
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

/** File inside a PGlite data directory recording which process has it open. */
export const LOCK_FILE = '.server.lock';

const heldLocks = new Set<string>();
let exitHookInstalled = false;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * PGlite has no cross-process locking: two processes on one directory corrupt it.
 * Refuse to start when another live process holds the directory; take over stale locks.
 */
function acquireDirLock(dir: string): void {
  const file = join(dir, LOCK_FILE);
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) {
      throw new Error(
        `数据库目录 ${dir} 正被进程 ${pid} 使用。PGlite 同一时间只能被一个进程打开：先关闭那个服务，或用 PGLITE_DIR 换一个目录。`,
      );
    }
  }
  writeFileSync(file, String(process.pid));
  heldLocks.add(file);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', () => {
      for (const f of heldLocks) {
        try {
          if (readFileSync(f, 'utf8').trim() === String(process.pid)) unlinkSync(f);
        } catch {
          /* already gone */
        }
      }
    });
  }
}

let shared: Promise<Db> | null = null;

/** Process-wide database (lazily created). */
export function getDb(): Promise<Db> {
  shared ??= createDb();
  return shared;
}

/** Close the process-wide database (graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (!shared) return;
  const db = (await shared) as unknown as { $client: { close?: () => Promise<void>; end?: () => Promise<void> } };
  shared = null;
  if (db.$client.end) await db.$client.end(); // pg Pool
  else await db.$client.close?.(); // PGlite
}
