import { corsHeaders } from './cors.js';
import { consumeRateLimit, createPendingBooking, listAvailabilityRanges } from './db.js';
import { sendEmail } from './email.js';
import { deliveryOk, sendRequestEmails } from './notifications.js';
import { computeQuote } from './pricing.js';
import { validateBookingInput } from './validate.js';

const POST_LIMIT = 8;
const GET_LIMIT = 120;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_BODY = 16000;

function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, env),
    },
  });
}

async function clientBucket(request, action) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${action}:${ip}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${action}:${hex.slice(0, 32)}`;
}

function isHoneypot(body) {
  const bot = body && body.botcheck;
  const website = body && body.website;
  if (bot === true) return true;
  if (typeof bot === 'string' && bot.trim()) return true;
  if (typeof website === 'string' && website.trim()) return true;
  return false;
}

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().includes('application/json')) {
    return { ok: false, message: 'Send the booking as JSON.' };
  }
  const advertised = Number(request.headers.get('Content-Length') || 0);
  if (advertised > MAX_BODY) return { ok: false, message: 'The booking request is too large.' };
  const text = await request.text();
  if (text.length > MAX_BODY) return { ok: false, message: 'The booking request is too large.' };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'The booking request must be a JSON object.' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, message: 'The booking request is not valid JSON.' };
  }
}

async function getAvailability(request, env, origin, now) {
  const bucket = await clientBucket(request, 'get');
  const limit = await consumeRateLimit(env.DB, bucket, now.getTime(), GET_LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return json({
      ok: false,
      error: 'rate_limited',
      message: 'Too many requests from this connection. Please wait a while and try again.',
    }, 429, origin, env);
  }
  const ranges = await listAvailabilityRanges(env.DB, now);
  return json({ ranges }, 200, origin, env);
}

async function postBooking(request, env, origin, now, send) {
  const bucket = await clientBucket(request, 'post');
  const limit = await consumeRateLimit(env.DB, bucket, now.getTime(), POST_LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return json({
      ok: false,
      error: 'rate_limited',
      message: 'Too many requests from this connection. Please wait a while and try again.',
    }, 429, origin, env);
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return json({ ok: false, error: 'invalid_json', message: parsed.message }, 400, origin, env);
  if (isHoneypot(parsed.value)) return json({ ok: true }, 200, origin, env);

  const validated = validateBookingInput(parsed.value, now, env.PROPERTY_TIMEZONE || 'America/New_York');
  if (!validated.ok) return json({ ok: false, error: validated.error, message: validated.message }, 400, origin, env);

  const quote = computeQuote(validated.value.arrival, validated.value.departure, validated.value.extras);
  if (validated.value.extras.poolHeat && !(quote.pool && quote.pool.available)) {
    return json({
      ok: false,
      error: 'pool_heat_unavailable',
      message: 'Pool heat is only available when every night of the stay is between October and April.',
    }, 400, origin, env);
  }

  const created = await createPendingBooking(env.DB, validated.value, quote, now);
  if (!created.ok) return json({ ok: false, error: created.error, message: created.message }, created.status, origin, env);

  const emails = await sendRequestEmails(env, created.booking, send);
  const emailed = deliveryOk(emails.guest);
  return json({
    ok: true,
    id: created.booking.id,
    status: 'pending',
    expiresAt: created.booking.expires_at,
    arrival: created.booking.arrival,
    departure: created.booking.departure,
    currency: 'GBP',
    totalToPay: created.booking.breakdown.totalToPay,
    deposit: created.booking.breakdown.deposit,
    email: emailed ? (emails.guest.dryRun ? 'dry_run' : 'sent') : 'failed',
  }, 201, origin, env);
}

export async function handleRequest(request, env, deps = {}) {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const now = deps.now instanceof Date ? deps.now : new Date();
  const send = deps.sendEmail || sendEmail;

  if (request.method === 'OPTIONS' && (path === '/api/availability' || path === '/api/bookings')) {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }

  try {
    if (request.method === 'GET' && path === '/api/health') return json({ ok: true }, 200, origin, env);
    if (request.method === 'GET' && path === '/api/availability') return await getAvailability(request, env, origin, now);
    if (request.method === 'POST' && path === '/api/bookings') return await postBooking(request, env, origin, now, send);
    return json({ ok: false, error: 'not_found', message: 'Not found.' }, 404, origin, env);
  } catch (error) {
    console.log(JSON.stringify({ event: 'request_error', message: String(error && error.message || error) }));
    return json({ ok: false, error: 'server_error', message: 'Something went wrong. Please try again.' }, 500, origin, env);
  }
}
