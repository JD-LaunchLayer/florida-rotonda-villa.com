const MIN_SECRET_LENGTH = 16;
const PURPOSES = new Set(['view', 'approve', 'reject']);
const ID_PATTERN = /^FRV-[0-9A-F]{8}$/;
const EXP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function secretText(secret) {
  return String(secret || '').trim();
}

export function approvalSecretReady(secret) {
  return secretText(secret).length >= MIN_SECRET_LENGTH;
}

function bytesToBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('bad token');
  if (text.length % 4 === 1) throw new Error('bad token');
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

function encodePayload(claims) {
  const json = JSON.stringify({ id: claims.id, purpose: claims.purpose, exp: claims.exp });
  return bytesToBase64Url(new TextEncoder().encode(json));
}

export async function signDecisionToken(secret, claims) {
  const key = secretText(secret);
  if (!approvalSecretReady(key)) throw new Error('APPROVAL_SECRET is not set');
  if (!claims || !ID_PATTERN.test(claims.id) || !PURPOSES.has(claims.purpose) || !EXP_PATTERN.test(claims.exp)) {
    throw new Error('decision token claims are not valid');
  }
  const payload = encodePayload(claims);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(key, 'sign'), new TextEncoder().encode(payload));
  return `${payload}.${bytesToBase64Url(signature)}`;
}

export async function verifyDecisionToken(secret, token, now) {
  try {
    const key = secretText(secret);
    if (!approvalSecretReady(key)) return { ok: false, error: 'not_configured' };
    if (typeof token !== 'string' || token.length < 20 || token.length > 2000) return { ok: false, error: 'invalid' };
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'invalid' };
    const signature = base64UrlToBytes(parts[1]);
    if (signature.length !== 32) return { ok: false, error: 'invalid' };
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(key, 'verify'),
      signature,
      new TextEncoder().encode(parts[0]),
    );
    if (!valid) return { ok: false, error: 'invalid' };
    const body = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (!body || !ID_PATTERN.test(body.id) || !PURPOSES.has(body.purpose) || !EXP_PATTERN.test(body.exp)) {
      return { ok: false, error: 'invalid' };
    }
    if (body.exp <= now.toISOString()) return { ok: false, error: 'expired', claims: body };
    return { ok: true, claims: body };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

export async function decisionLinks(env, booking, origin) {
  try {
    if (!approvalSecretReady(env && env.APPROVAL_SECRET) || !origin || !booking) return null;
    const exp = booking.expires_at;
    const base = String(origin).replace(/\/+$/, '');
    const links = {};
    for (const purpose of ['view', 'approve', 'reject']) {
      const token = await signDecisionToken(env.APPROVAL_SECRET, { id: booking.id, purpose, exp });
      links[purpose] = `${base}/decide?token=${encodeURIComponent(token)}`;
    }
    return links;
  } catch (error) {
    console.log(JSON.stringify({ event: 'approval_link_failed', message: String(error && error.message || error) }));
    return null;
  }
}
