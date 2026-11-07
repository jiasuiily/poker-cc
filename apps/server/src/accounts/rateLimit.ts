const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_FAILURES = 5;

/**
 * In-memory login throttle (single process). Keys are e.g. `ip:<addr>` and `user:<name>`;
 * 5 failures for a key within 15 minutes lock that key for 15 minutes.
 */
export class LoginLimiter {
  private failures = new Map<string, number[]>();
  private locks = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  /** Epoch ms until which any of the keys is locked, or null. */
  lockedUntil(keys: string[]): number | null {
    const t = this.now();
    let until: number | null = null;
    for (const k of keys) {
      const u = this.locks.get(k);
      if (u === undefined) continue;
      if (u <= t) this.locks.delete(k);
      else until = Math.max(until ?? 0, u);
    }
    return until;
  }

  fail(keys: string[]): void {
    const t = this.now();
    for (const k of keys) {
      const recent = (this.failures.get(k) ?? []).filter((x) => t - x < WINDOW_MS);
      recent.push(t);
      if (recent.length >= MAX_FAILURES) {
        this.locks.set(k, t + LOCK_MS);
        this.failures.delete(k);
      } else this.failures.set(k, recent);
    }
  }

  success(keys: string[]): void {
    for (const k of keys) this.failures.delete(k);
  }
}
