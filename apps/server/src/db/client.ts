import { mkdirSync } from 'node:fs';
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

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
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
    client = new PGlite(dir);
  }
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

let shared: Promise<Db> | null = null;

/** Process-wide database (lazily created). */
export function getDb(): Promise<Db> {
  shared ??= createDb();
  return shared;
}
