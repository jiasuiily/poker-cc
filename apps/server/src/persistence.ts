/**
 * Tracks in-flight database writes (hand saves) so a graceful shutdown can wait for them.
 */
const pending = new Set<Promise<unknown>>();

export function trackSave<T>(p: Promise<T>): Promise<T> {
  const tracked = p.finally(() => pending.delete(tracked));
  // A failing save is logged by its owner; draining must not reject because of it.
  tracked.catch(() => {});
  pending.add(tracked);
  return tracked;
}

/** Wait for all pending saves, at most `timeoutMs`. */
export async function drainSaves(timeoutMs: number): Promise<{ drained: boolean; pending: number }> {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, left))]);
  }
  return { drained: pending.size === 0, pending: pending.size };
}
