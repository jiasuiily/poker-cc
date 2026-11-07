import { HttpError } from '../http.js';

/** Login name: NFC, trimmed, lower-cased; 3–20 of [a-z0-9_]. */
export function normalizeUsername(raw: unknown): string {
  const s = String(raw ?? '').normalize('NFC').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(s)) throw new HttpError(400, '用户名须为 3–20 位字母、数字或下划线');
  return s;
}

/**
 * Display name shown at tables: NFC, with control and format characters removed
 * (zero-width, bidi overrides, C0/C1 controls) so lookalike names collapse to the same
 * string; 1–12 code points; no angle brackets.
 */
export function sanitizeDisplayName(raw: unknown): string {
  const s = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim();
  if (!s) throw new HttpError(400, '显示名不能为空');
  if (/[<>]/.test(s)) throw new HttpError(400, '显示名不能包含 < 或 >');
  if ([...s].length > 12) throw new HttpError(400, '显示名最多 12 个字');
  return s;
}

/** 6–128 characters of any kind. */
export function validatePassword(raw: unknown): string {
  const s = String(raw ?? '');
  if (s.length < 6) throw new HttpError(400, '密码至少 6 位');
  if (s.length > 128) throw new HttpError(400, '密码太长');
  return s;
}
