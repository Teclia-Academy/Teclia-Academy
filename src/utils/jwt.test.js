// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';

// jsdom is unavailable in this toolchain; provide a minimal Web Storage shim so
// these tests run under the node environment. jwt.js only touches storage at
// call time, so defining these before the tests execute is sufficient.
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new MemStorage();
globalThis.sessionStorage = new MemStorage();

import {
  setStoredToken,
  getStoredToken,
  setStoredRefreshToken,
  getStoredRefreshToken,
  clearStoredToken,
} from './jwt.js';

describe('jwt token storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('round-trips the access token without storing plaintext', () => {
    setStoredToken('access.jwt.value');
    expect(getStoredToken()).toBe('access.jwt.value');
    // Raw value must not be present verbatim in storage (obfuscated at rest).
    expect(localStorage.getItem('authToken_enc')).not.toBe('access.jwt.value');
  });

  it('round-trips the refresh token separately from the access token', () => {
    setStoredToken('access.jwt.value');
    setStoredRefreshToken('refresh.jwt.value');
    expect(getStoredRefreshToken()).toBe('refresh.jwt.value');
    expect(getStoredToken()).toBe('access.jwt.value');
    expect(localStorage.getItem('refreshToken_enc')).not.toBe('refresh.jwt.value');
  });

  it('clears the refresh token when set to a falsy value', () => {
    setStoredRefreshToken('refresh.jwt.value');
    setStoredRefreshToken(null);
    expect(getStoredRefreshToken()).toBe('');
  });

  it('clearStoredToken wipes both access and refresh tokens', () => {
    setStoredToken('a');
    setStoredRefreshToken('r');
    clearStoredToken();
    expect(getStoredToken()).toBe('');
    expect(getStoredRefreshToken()).toBe('');
  });
});
