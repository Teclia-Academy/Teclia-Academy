import axios from 'axios';
import { getRequestSignal, invokeLogout } from '../utils/authSession.js';
import {
  getCsrfToken,
  getStoredToken,
  getStoredRefreshToken,
  setStoredToken,
  setStoredRefreshToken,
  generateCsrfToken,
} from '../utils/jwt.js';

const resolveApiBase = () => {
  const configured = import.meta.env?.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  if (import.meta.env?.PROD) {
    return '/api';
  }
  return 'http://localhost:3001/api';
};

const API_BASE_URL = resolveApiBase();
export const BACKEND_BASE_URL = API_BASE_URL.replace(/\/api$/, '') || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Endpoints that must NOT trigger the refresh/logout recovery flow: an auth
// failure here is a genuine credential/token error, not an expired session.
const AUTH_ENDPOINTS = /\/auth\/(login|signup|forgot-password|reset-password|refresh)/;

// Add JWT token, CSRF header, and abort signal to requests.
// Note: CSRF protection via Authorization header (Bearer) is sufficient for JWT
// (not cookie-based). We keep X-CSRF-Token for defense-in-depth where needed.
api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (
    !config.url.includes('/auth/') &&
    config.method &&
    !['get', 'head', 'options'].includes(config.method.toLowerCase())
  ) {
    let csrf = getCsrfToken();
    if (!csrf) {
      csrf = generateCsrfToken();
    }
    if (csrf) config.headers['X-CSRF-Token'] = csrf;
  }
  config.signal = getRequestSignal();
  return config;
});

// ---------------------------------------------------------------------------
// Single-flight refresh token rotation
// ---------------------------------------------------------------------------
// When several requests fail with 401 at once (e.g. multiple tabs / parallel
// fetches), we must issue exactly ONE /auth/refresh call and have every waiter
// reuse its result. Firing N refreshes would present the same (now-rotated)
// refresh token N times and trip server-side reuse detection, nuking the whole
// family. The `refreshPromise` gate guarantees a single in-flight rotation.
let refreshPromise = null;

const performRefresh = async () => {
  const storedRefresh = getStoredRefreshToken();
  if (!storedRefresh) {
    const err = new Error('No refresh token available');
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }
  // Use a bare axios call so this request bypasses the api instance interceptors
  // (no recursion, no auth header injection).
  const resp = await axios.post(
    `${API_BASE_URL}/auth/refresh`,
    { refreshToken: storedRefresh },
    { headers: { 'Content-Type': 'application/json' } },
  );
  const { token, refreshToken } = resp.data;
  setStoredToken(token);
  setStoredRefreshToken(refreshToken);
  return token;
};

const refreshAccessToken = () => {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const original = error.config ?? {};
    const url = original.url ?? '';
    const isAuthEndpoint = AUTH_ENDPOINTS.test(url);

    // Attempt a single-flight refresh + retry once for expired access tokens.
    if (status === 401 && !isAuthEndpoint && !original._retry) {
      original._retry = true;

      if (!getStoredRefreshToken()) {
        invokeLogout({ reason: 'expired', showToast: true, redirectTo: '/auth/login' });
        return Promise.reject(error);
      }

      try {
        const newToken = await refreshAccessToken();
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        original.signal = getRequestSignal();
        return api(original);
      } catch (refreshErr) {
        // Refresh failed: reuse detected, revoked, expired, or invalid.
        // Clear the session and send the user back to login with a reason so a
        // reused/stolen-token event surfaces a clear "please sign in again".
        const code = refreshErr.response?.data?.code;
        const reason = code === 'REFRESH_TOKEN_REUSE' ? 'reuse' : 'expired';
        invokeLogout({ reason, showToast: true, redirectTo: '/auth/login' });
        return Promise.reject(refreshErr);
      }
    }

    if (status === 401 && !isAuthEndpoint) {
      invokeLogout({ reason: 'expired', showToast: true, redirectTo: '/auth/login' });
    }

    return Promise.reject(error);
  },
);

export const authService = {
  signup: (email, password, name) =>
    api.post('/auth/signup', { email, password, name }),
  login: (email, password) =>
    api.post('/auth/login', { email, password }),
  // Send the refresh token so the server can durably revoke its family.
  logout: () =>
    api.post('/auth/logout', { refreshToken: getStoredRefreshToken() || undefined }),
  // Revoke every refresh-token family for the current user (all devices).
  logoutAll: () =>
    api.post('/auth/logout-all'),
  getCurrentUser: () =>
    api.get('/auth/me'),
  updateProfile: (name, avatar) => {
    if (avatar instanceof FormData) {
      return api.patch('/auth/profile', avatar, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    }

    const payload = {};
    if (name) payload.name = name;
    if (avatar) payload.avatarUrl = avatar;
    return api.patch('/auth/profile', payload);
  },
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (email) =>
    api.post('/auth/forgot-password', { email }),
  resetPassword: (email, pin, newPassword) =>
    api.post('/auth/reset-password', { email, pin, newPassword }),
  verifyRecoveryEmail: (email) =>
    api.post('/auth/verify-recovery-email', { email }),
  getStudents: () =>
    api.get('/auth/students'),
  updateStudentPlan: (studentId, planTier) =>
    api.patch(`/auth/students/${studentId}/plan`, { plan_tier: planTier }),
  deleteStudent: (studentId) =>
    api.delete(`/auth/students/${studentId}`),
  updateStudentStatus: (studentId, status) =>
    api.patch(`/admin/users/${studentId}/status`, { status }),
};

export const adminService = {
  getDashboardStats: () =>
    api.get('/admin/stats'),
  getAuditEvents: (params = {}) =>
    api.get('/admin/audit', { params }),
  deleteContent: (contentId) =>
    api.delete(`/content/${contentId}`),
};

export const statsService = {
  recordVisit: () => api.post('/stats/visit'),
  getVisitStats: () => api.get('/stats/visits'),
};

export const contentService = {
  getContent: () =>
    api.get('/content'),
  getContentById: (id) =>
    api.get(`/content/${id}`),
  getFreeContent: () =>
    api.get('/content/free'),
};

export const paymentsService = {
  submitPaymentMethod: ({ planTier, paymentMethodId, idempotencyKey }) =>
    api.post(
      '/payments/payment-method',
      { planTier, paymentMethodId, idempotencyKey },
      { headers: { ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) } },
    ),
  getPaymentStatus: (paymentId) =>
    api.get(`/payments/${paymentId}`),
};

// PCI invariant: never send PAN (card number) to backend; only Stripe paymentMethodId.
// Cryptographically-random idempotency key when available.
export const generateIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Request failed');
  }

  return data;
}

export async function createPaymentIntent(planTier, token) {
  return request('/payments/intent', {
    method: 'POST',
    body: { plan_tier: planTier },
    token,
  });
}

export async function confirmPaymentIntent(paymentId, token) {
  return request(`/payments/intent/${paymentId}/confirm`, {
    method: 'POST',
    token,
  });
}

export default api;
