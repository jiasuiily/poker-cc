import { describe, expect, it } from 'vitest';
import { shouldAutoLoad } from '../src/paging';

describe('history auto-loading', () => {
  it('loads the next page when there is one and nothing is in flight', () => {
    expect(shouldAutoLoad({ next: 'c', loading: false, err: null })).toBe(true);
  });
  it('stops after an error until the user retries', () => {
    expect(shouldAutoLoad({ next: 'c', loading: false, err: '请求失败 (500)' })).toBe(false);
  });
  it('does nothing while loading or at the end', () => {
    expect(shouldAutoLoad({ next: 'c', loading: true, err: null })).toBe(false);
    expect(shouldAutoLoad({ next: null, loading: false, err: null })).toBe(false);
    expect(shouldAutoLoad({ next: undefined, loading: false, err: null })).toBe(false);
  });
});
