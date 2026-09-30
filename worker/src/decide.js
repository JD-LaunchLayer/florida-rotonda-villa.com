import { consumeRateLimit, expireDueBookings, getBooking } from './db.js';
import { deliveryOk, decideAndEmail } from './notifications.js';
import { renderDecisionPage } from './page.js';
import { signDecisionToken, verifyDecisionToken } from './tokens.js';

const WINDOW_MS = 60 * 60 * 1000;

function htmlResponse(view, status) {
  return new Response(renderDecisionPage(view), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

async function clientBucket(request, action) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${action}:${ip}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${action}:${hex.slice(0, 32)}`;
}

function plainView(heading, message, tone) {
  return { title: heading, heading, message, tone: tone || 'neutral' };
}

function statusView(booking) {
  if (!booking) return plainView('Booking not found', 'This booking could not be found.', 'bad');
  if (booking.status === 'confirmed') {
    return {
      title: `Booking ${booking.id}`,
      heading: `Booking ${booking.id}`,
      message: 'This booking is already confirmed. No further email was sent.',
      booking,
    };
  }
  if (booking.status === 'rejected') {
    return {
      title: `Booking ${booking.id}`,
      heading: `Booking ${booking.id}`,
      message: 'This request was already declined. No further email was sent.',
      booking,
    };
  }
  if (booking.status === 'cancelled') {
    return {
      title: `Booking ${booking.id}`,
      heading: `Booking ${booking.id}`,
      message: 'This booking is cancelled.',
      booking,
      tone: 'bad',
    };
  }
  return {
    title: `Booking ${booking.id}`,
    heading: `Booking ${booking.id}`,
    message: 'This request has expired. The dates are no longer held.',
    booking,
    tone: 'bad',
  };
}

function guestSentence(emails) {
  if (!emails || !emails.guest) return '';
  if (!deliveryOk(emails.guest)) return ' The guest email could not be sent. Please write to them directly.';
  if (emails.guest.dryRun) return ' Email is not configured, so the guest message was prepared and not sent.';
  return ' The guest has been emailed.';
}

async function actionTokens(env, booking, claims) {
  const exp = booking.expires_at < claims.exp ? booking.expires_at : claims.exp;
  const approveToken = await signDecisionToken(env.APPROVAL_SECRET, { id: booking.id, purpose: 'approve', exp });
  const rejectToken = await signDecisionToken(env.APPROVAL_SECRET, { id: booking.id, purpose: 'reject', exp });
  return { approveToken, rejectToken };
}

async function reviewView(env, booking, claims, now, note) {
  if (!booking) return { view: plainView('Booking not found', 'This booking could not be found.', 'bad'), status: 404 };
  const timeZone = env.REMINDER_TIMEZONE || 'Europe/London';
  if (booking.status !== 'pending') return { view: { ...statusView(booking), timeZone }, status: 200 };
  if (booking.expires_at <= now.toISOString()) {
    return {
      status: 410,
      view: {
        ...statusView(booking),
        timeZone,
        message: 'This request has expired. The dates are no longer held.',
        tone: 'bad',
      },
    };
  }
  const tokens = await actionTokens(env, booking, claims);
  return {
    status: 200,
    view: {
      title: `Review ${booking.id}`,
      heading: `Review ${booking.id}`,
      message: note || 'The dates are held. Approve the stay or reject the request.',
      booking,
      timeZone,
      ...tokens,
    },
  };
}

async function tokenFromBody(request) {
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  try {
    if (type.includes('application/json')) {
      const value = JSON.parse(await request.text());
      return value && typeof value.token === 'string' ? value.token : '';
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const form = await request.formData();
      const token = form.get('token');
      return typeof token === 'string' ? token : '';
    }
  } catch {
    return '';
  }
  return '';
}

async function limit(request, env, now, action, max) {
  const bucket = await clientBucket(request, action);
  const result = await consumeRateLimit(env.DB, bucket, now.getTime(), max, WINDOW_MS);
  if (result.allowed) return null;
  return htmlResponse(plainView(
    'Please wait',
    'Too many attempts from this connection. Wait a while and open the email link again.',
    'bad',
  ), 429);
}

function invalidResponse(error) {
  if (error === 'not_configured') {
    return htmlResponse(plainView(
      'Approval unavailable',
      'Approval links are not available yet.',
      'bad',
    ), 503);
  }
  return htmlResponse(plainView(
    'Link not valid',
    'This link is not valid.',
    'bad',
  ), 400);
}

async function loadBooking(env, claims, now) {
  await expireDueBookings(env.DB, now);
  if (!claims) return null;
  return getBooking(env.DB, claims.id);
}

export async function handleDecision(request, env, now, send) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return htmlResponse(plainView(
      'Open the email link',
      'Open the link from the email, then use the buttons on the page.',
      'bad',
    ), 405);
  }

  const limited = await limit(
    request,
    env,
    now,
    request.method === 'POST' ? 'decide-post' : 'decide-get',
    request.method === 'POST' ? 60 : 120,
  );
  if (limited) return limited;

  const token = request.method === 'POST'
    ? await tokenFromBody(request)
    : new URL(request.url).searchParams.get('token') || '';
  const verified = await verifyDecisionToken(env.APPROVAL_SECRET, token, now);

  if (!verified.ok && verified.error !== 'expired') return invalidResponse(verified.error);

  const booking = await loadBooking(env, verified.claims, now);
  const timeZone = env.REMINDER_TIMEZONE || 'Europe/London';

  if (verified.error === 'expired') {
    const view = booking ? { ...statusView(booking), timeZone } : plainView(
      'Link expired',
      'This request has expired. The dates are no longer held.',
      'bad',
    );
    if (booking && (booking.status === 'pending' || booking.status === 'expired')) {
      view.message = 'This request has expired. The dates are no longer held.';
      view.tone = 'bad';
    }
    return htmlResponse(view, 410);
  }

  if (request.method === 'GET' || (verified.claims.purpose !== 'approve' && verified.claims.purpose !== 'reject')) {
    const note = request.method === 'POST'
      ? 'Nothing was changed. Use Approve or Reject.'
      : '';
    const review = await reviewView(env, booking, verified.claims, now, note);
    return htmlResponse(review.view, review.status);
  }

  const result = await decideAndEmail(env.DB, env, verified.claims.id, verified.claims.purpose, now, send);
  if (result.ok) {
    const approved = verified.claims.purpose === 'approve';
    return htmlResponse({
      title: `Booking ${result.booking.id}`,
      heading: approved ? `Approved ${result.booking.id}` : `Declined ${result.booking.id}`,
      message: (approved
        ? 'You approved this booking.'
        : 'You declined this request. The dates are free.') + guestSentence(result.emails),
      booking: result.booking,
      timeZone,
      tone: approved ? 'neutral' : 'bad',
    }, 200);
  }

  if (result.error === 'overlap') {
    const tokens = booking && booking.status === 'pending'
      ? await actionTokens(env, result.booking || booking, verified.claims)
      : {};
    return htmlResponse({
      title: 'Dates not free',
      heading: `Booking ${verified.claims.id}`,
      message: 'These dates are no longer free, so the booking was not confirmed. You can reject the request to clear the hold.',
      booking: result.booking || booking,
      timeZone,
      tone: 'bad',
      rejectToken: tokens.rejectToken || null,
    }, 409);
  }

  if (result.error === 'not_found') {
    return htmlResponse(plainView('Booking not found', 'This booking could not be found.', 'bad'), 404);
  }

  const failed = result.booking || booking;
  if (result.error === 'expired') {
    return htmlResponse({
      ...statusView(failed),
      timeZone,
      message: 'This request has expired. The dates are no longer held.',
      tone: 'bad',
    }, 410);
  }
  return htmlResponse({ ...statusView(failed), timeZone }, 200);
}
