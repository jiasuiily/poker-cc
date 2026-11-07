import express, { type Application } from 'express';

/**
 * Production: serve the built front end from the same origin as the API and WebSocket.
 * Routing is hash-based, so no SPA fallback is needed. index.html is never cached
 * (so a redeploy is picked up); hashed assets are cached for a long time.
 */
export function mountWeb(app: Application, dir: string): void {
  app.use(
    express.static(dir, {
      index: 'index.html',
      setHeaders(res, path) {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
}
