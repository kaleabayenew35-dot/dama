import { describe, it, expect } from 'vitest';
import { createAuthGate, shouldTreatBalanceFetchAsNonBlocking } from '../modules/urlAuth.js';

describe('createAuthGate', () => {
  it('settles once and preserves the first outcome', async () => {
    const gate = createAuthGate();
    const seen = [];

    gate.promise.then(
      value => seen.push(['resolve', value]),
      error => seen.push(['reject', error.message || error])
    );

    gate.resolve(true);
    gate.reject(new Error('should not change state'));

    await Promise.resolve();

    expect(seen).toEqual([['resolve', true]]);
  });
});

describe('shouldTreatBalanceFetchAsNonBlocking', () => {
  it('treats auth failures as non-blocking', () => {
    expect(shouldTreatBalanceFetchAsNonBlocking(401)).toBe(true);
    expect(shouldTreatBalanceFetchAsNonBlocking(403)).toBe(true);
    expect(shouldTreatBalanceFetchAsNonBlocking('HTTP 401')).toBe(true);
  });

  it('keeps server and network failures blocking', () => {
    expect(shouldTreatBalanceFetchAsNonBlocking(500)).toBe(false);
    expect(shouldTreatBalanceFetchAsNonBlocking('timeout')).toBe(false);
  });
});
