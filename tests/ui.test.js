import { describe, it, expect } from 'vitest';
import { getBetButtonDisabledState, getCurrentBalanceValue } from '../modules/ui.js';

describe('getBetButtonDisabledState', () => {
  it('disables buttons whose bet exceeds the current balance', () => {
    expect(getBetButtonDisabledState(100, 50)).toBe(true);
    expect(getBetButtonDisabledState(50, 100)).toBe(false);
  });

  it('treats missing balance as unknown instead of a fake zero', () => {
    globalThis.window = globalThis.window || {};
    globalThis.window.DAMA_BALANCE = undefined;
    expect(getCurrentBalanceValue()).toBeNull();
  });
});
