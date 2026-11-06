/**
 * Infinite-scroll guard for the history list: load the next page only when one exists,
 * nothing is in flight, and the last attempt did not fail (after a failure the user retries).
 */
export function shouldAutoLoad(s: { next: string | null | undefined; loading: boolean; err: string | null }): boolean {
  return !!s.next && !s.loading && !s.err;
}
