const SESSION_COOKIE = 'diary_editor_session';
const SESSION_MAX_AGE = 60 * 60 * 8;

export function getSessionCookie(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const item = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return item ? item.slice(SESSION_COOKIE.length + 1) : '';
}

export async function createSession(username, secret, now = Date.now()) {
  const payload = encodeBase64Url(JSON.stringify({
    username,
    expiresAt: Math.floor(now / 1000) + SESSION_MAX_AGE,
  }));
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySession(value, env, now = Date.now()) {
  if (!value || !env.EDITOR_SESSION_SECRET || !env.EDITOR_USERNAME) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = value.slice(0, separator);
  const suppliedSignature = value.slice(separator + 1);
  const expectedSignature = await sign(payload, env.EDITOR_SESSION_SECRET);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const decoded = JSON.parse(decodeBase64Url(payload));
    if (decoded.username !== env.EDITOR_USERNAME || !Number.isFinite(decoded.expiresAt)) return null;
    if (decoded.expiresAt <= Math.floor(now / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function sessionCookie(value, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return encodeBase64Url(String.fromCharCode(...new Uint8Array(signature)));
}

function encodeBase64Url(value) {
  const binary = typeof value === 'string' ? value : String(value);
  const bytes = new TextEncoder().encode(binary);
  let encoded = '';
  for (const byte of bytes) encoded += String.fromCharCode(byte);
  return btoa(encoded).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
