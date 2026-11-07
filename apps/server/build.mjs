// Production bundle: dist/index.js (server) and dist/cli.js (admin commands).
// Everything is bundled, including the TypeScript workspace packages, except modules that
// ship native binaries or WASM; those are listed in dist/package.json and installed with npm.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Installed at runtime (native / WASM). */
const RUNTIME_DEPS = ['@node-rs/argon2', '@electric-sql/pglite'];
/** Optional peers some libraries try to load; absent at runtime is fine. */
const OPTIONAL = ['pg-native', 'bufferutil', 'utf-8-validate', 'msgpackr-extract'];

const versionOf = (name) => {
  let dir = dirname(require.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === name) return pkg.version;
    } catch {
      /* keep walking up */
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`cannot find version of ${name}`);
    dir = up;
  }
};

mkdirSync(join(here, 'dist'), { recursive: true });
await build({
  entryPoints: { index: join(here, 'src/index.ts'), cli: join(here, 'src/cli.ts') },
  outdir: join(here, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external: [...RUNTIME_DEPS, ...OPTIONAL],
  // CommonJS dependencies inside an ESM bundle need require/__dirname.
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __fu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      'const require = __cr(import.meta.url);',
      'const __filename = __fu(import.meta.url);',
      'const __dirname = __dn(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
});

writeFileSync(
  join(here, 'dist', 'package.json'),
  JSON.stringify(
    {
      name: 'poker-server-dist',
      private: true,
      type: 'module',
      dependencies: Object.fromEntries(RUNTIME_DEPS.map((d) => [d, versionOf(d)])),
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote dist/package.json');
