const TOKEN_KEY = 'authToken_enc';
const REFRESH_TOKEN_KEY = 'refreshToken_enc';

const obfuscate = (str) => {
  if (!str) return '';
  return btoa(str.split('').reverse().join(''));
};

const deobfuscate = (encoded) => {
  if (!encoded) return '';
  try {
    return atob(encoded).split('').reverse().join('');
  } catch {
    return '';
  }
};

export const getStoredToken = () => {
  const enc = localStorage.getItem(TOKEN_KEY);
  return deobfuscate(enc);
};

export const setStoredToken = (token) => {
  localStorage.setItem(TOKEN_KEY, obfuscate(token));
};

export const getStoredRefreshToken = () => {
  const enc = localStorage.getItem(REFRESH_TOKEN_KEY);
  return deobfuscate(enc);
};

export const setStoredRefreshToken = (token) => {
  if (!token) {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    return;
  }
  localStorage.setItem(REFRESH_TOKEN_KEY, obfuscate(token));
};

export const clearStoredToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem('csrf_token');
};

export const generateCsrfToken = () => {
  const token = btoa(String(Date.now()) + '.' + Math.random().toString(36).slice(2));
  sessionStorage.setItem('csrf_token', token);
  return token;
};

export const getCsrfToken = () => sessionStorage.getItem('csrf_token');

export const decodeJwtPayload = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

export const isTokenExpired = (token, skewSeconds = 30) => {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
};
