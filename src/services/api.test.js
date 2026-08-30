// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

// jsdom is unavailable in this toolchain; provide a minimal Web Storage shim so
// these tests run under the node environment.
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new MemStorage();
globalThis.sessionStorage = new MemStorage();

// --- Mocks ------------------------------------------------------------------
// vi.mock is hoisted above module top-level, so shared handles must live in
// vi.hoisted(). A single fake axios instance lets us capture the interceptors
// and drive the response-error (401) handler directly.
const { instance, post, invokeLogout } = vi.hoisted(() => {
  const instance = vi.fn((config) => Promise.resolve({ data: { retried: true }, config }));
  instance.interceptors = {
    request: { use: (fn) => { instance.__req = fn; } },
    response: { use: (_ok, err) => { instance.__resErr = err; } },
  };
  const post = vi.fn(() =>
    Promise.resolve({ data: { token: 'newAccess', refreshToken: 'newRefresh' } }),
  );
  const invokeLogout = vi.fn();
  return { instance, post, invokeLogout };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => instance),
    post,
  },
}));

vi.mock('../utils/authSession.js', () => ({
  getRequestSignal: () => undefined,
  invokeLogout: (...args) => invokeLogout(...args),
}));

// Import AFTER mocks so the interceptors register against the fake instance.
import '../services/api.js';
import {
  setStoredRefreshToken,
  getStoredToken,
  getStoredRefreshToken,
} from '../utils/jwt.js';

const make401 = (url = '/content') => ({
  response: { status: 401 },
  config: { url, headers: {} },
});

describe('api single-flight refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    post.mockClear();
    invokeLogout.mockClear();
    post.mockResolvedValue({ data: { token: 'newAccess', refreshToken: 'newRefresh' } });
  });

  it('issues exactly ONE /auth/refresh for concurrent 401s (no reuse trip)', async () => {
    setStoredRefreshToken('r0');
    const onRejected = instance.__resErr;

    // Two parallel requests fail with 401 at the same time.
    const results = await Promise.all([
      onRejected(make401('/content')),
      onRejected(make401('/auth/me')),
    ]);

    // Single-flight: the refresh endpoint is hit once, not twice.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatch(/\/auth\/refresh$/);
    // Both original requests were retried and resolved.
    expect(results.every((r) => r?.data?.retried)).toBe(true);
    // New rotated tokens were persisted.
    expect(getStoredToken()).toBe('newAccess');
    expect(getStoredRefreshToken()).toBe('newRefresh');
  });

  it('clears the session with reason "reuse" when refresh reports REFRESH_TOKEN_REUSE', async () => {
    setStoredRefreshToken('stolen');
    post.mockRejectedValueOnce({ response: { status: 401, data: { code: 'REFRESH_TOKEN_REUSE' } } });
    const onRejected = instance.__resErr;

    await expect(onRejected(make401('/content'))).rejects.toBeTruthy();

    expect(invokeLogout).toHaveBeenCalledTimes(1);
    expect(invokeLogout.mock.calls[0][0]).toMatchObject({ reason: 'reuse', redirectTo: '/auth/login' });
  });

  it('logs out with reason "expired" when there is no refresh token', async () => {
    // no refresh token stored
    const onRejected = instance.__resErr;
    await expect(onRejected(make401('/content'))).rejects.toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(invokeLogout.mock.calls[0][0]).toMatchObject({ reason: 'expired' });
  });

  it('does not attempt refresh for auth endpoints (login/refresh)', async () => {
    setStoredRefreshToken('r0');
    const onRejected = instance.__resErr;
    await expect(onRejected(make401('/auth/login'))).rejects.toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});
