import type { ErrorRequestHandler } from 'express';

/** An error whose message is safe to show the user, with the HTTP status to send. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Express error handler: HttpError → its status + message; anything else → 500 with a
 * generic message (details only in the server log, never in the response).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: '请求格式不正确' });
  console.error(`[api] ${req.method} ${req.path} failed`, err);
  res.status(500).json({ error: '服务器出错了，请稍后再试' });
};
