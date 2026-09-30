import { addDaysISO, expiresAtFrom, nightsBetween, REMINDER_DAYS_BEFORE_ARRIVAL } from './dates.js';
import { toBreakdown } from './pricing.js';

function intOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

function errorText(error) {
  const parts = [error && error.message, error && error.cause && error.cause.message];
  return parts.filter(Boolean).join(' ');
}

export function isNightConflict(error) {
  return errorText(error).includes('occupied_nights');
}

function isIdConflict(error) {
  const text = errorText(error);
  return text.includes('bookings.id') || text.includes('PRIMARY KEY');
}

export function hydrateBooking(row) {
  if (!row) return null;
  return {
    ...row,
    extras: JSON.parse(row.extras_json),
    breakdown: JSON.parse(row.breakdown_json),
  };
}

export async function getBooking(db, id) {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
  return hydrateBooking(row);
}

export function newBookingId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `FRV-${hex}`;
}

export async function expireDueBookings(db, now) {
  const nowIso = now.toISOString();
  const due = await db.prepare(
    `SELECT id FROM bookings WHERE status = 'pending' AND expires_at <= ?`
  ).bind(nowIso).all();
  const ids = (due.results || []).map((row) => row.id);
  if (!ids.length) return [];
  await db.batch([
    db.prepare(
      `UPDATE bookings SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`
    ).bind(nowIso),
    db.prepare(
      `DELETE FROM occupied_nights WHERE booking_id IN (SELECT id FROM bookings WHERE status = 'expired')`
    ),
  ]);
  return ids;
}

export async function createPendingBooking(db, input, quote, now) {
  await expireDueBookings(db, now);
  const breakdown = toBreakdown(quote);
  const createdAt = now.toISOString();
  const expiresAt = expiresAtFrom(now);
  const nights = nightsBetween(input.arrival, input.departure);
  let id = newBookingId();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const statements = [
      db.prepare(
        `INSERT INTO bookings (
          id, status, arrival, departure, guests, extras_json, breakdown_json,
          currency, rental_total, extras_total, cleaning_total, total_to_pay, deposit,
          guest_first_name, guest_last_name, guest_email, guest_phone, message,
          terms_accepted, created_at, expires_at
        ) VALUES (?, 'pending', ?, ?, ?, ?, ?, 'GBP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).bind(
        id,
        input.arrival,
        input.departure,
        input.guests,
        JSON.stringify(input.extras),
        JSON.stringify(breakdown),
        intOrNull(breakdown.rentalTotal),
        intOrNull(breakdown.extrasTotal),
        intOrNull(breakdown.cleaning),
        intOrNull(breakdown.totalToPay),
        intOrNull(breakdown.deposit),
        input.firstName,
        input.lastName,
        input.email,
        input.phone,
        input.message,
        createdAt,
        expiresAt,
      ),
      ...nights.map((night) => db.prepare(
        `INSERT INTO occupied_nights (night, booking_id, source) VALUES (?, ?, 'booking')`
      ).bind(night, id)),
    ];

    try {
      await db.batch(statements);
      return { ok: true, booking: await getBooking(db, id) };
    } catch (error) {
      if (isNightConflict(error)) {
        return {
          ok: false,
          status: 409,
          error: 'dates_unavailable',
          message: 'Those dates were just taken. Please choose another stay.',
        };
      }
      if (isIdConflict(error) && attempt === 0) {
        id = newBookingId();
        continue;
      }
      throw error;
    }
  }

  return {
    ok: false,
    status: 500,
    error: 'server_error',
    message: 'Something went wrong. Please try again.',
  };
}

export async function listAvailabilityRanges(db, now) {
  await expireDueBookings(db, now);
  const blocks = await db.prepare(
    `SELECT arrival, departure FROM blocked_ranges ORDER BY arrival, departure`
  ).all();
  const holds = await db.prepare(
    `SELECT arrival, departure FROM bookings WHERE status IN ('pending', 'confirmed') ORDER BY arrival, departure`
  ).all();
  const ranges = [];
  for (const row of blocks.results || []) {
    ranges.push({ checkIn: row.arrival, checkOut: row.departure });
  }
  for (const row of holds.results || []) {
    ranges.push({ checkIn: row.arrival, checkOut: row.departure });
  }
  return ranges;
}

function changed(result) {
  return Number(result && result.meta && result.meta.changes) === 1;
}

function classifyDecision(existing, nowIso) {
  if (!existing) return { ok: false, error: 'not_found' };
  if (existing.status === 'expired' || (existing.status === 'pending' && existing.expires_at <= nowIso)) {
    return { ok: false, error: 'expired', booking: existing };
  }
  if (existing.status === 'confirmed') return { ok: false, error: 'already_confirmed', booking: existing };
  if (existing.status === 'rejected') return { ok: false, error: 'already_rejected', booking: existing };
  if (existing.status === 'cancelled') return { ok: false, error: 'already_cancelled', booking: existing };
  return { ok: false, error: 'not_pending', status: existing.status, booking: existing };
}

// The night-count check runs in the same UPDATE as the status change.
// A pending hold whose nights were taken by another stay is left pending.
export async function confirmBooking(db, id, now) {
  await expireDueBookings(db, now);
  const existing = await getBooking(db, id);
  if (!existing) return { ok: false, error: 'not_found' };
  const nowIso = now.toISOString();
  const expectedNights = nightsBetween(existing.arrival, existing.departure).length;
  const result = await db.prepare(
    `UPDATE bookings
     SET status = 'confirmed', confirmed_at = ?
     WHERE id = ?
       AND status = 'pending'
       AND expires_at > ?
       AND (
         SELECT COUNT(*) FROM occupied_nights
         WHERE booking_id = bookings.id
           AND night >= bookings.arrival
           AND night < bookings.departure
       ) = ?
       AND NOT EXISTS (
         SELECT 1 FROM occupied_nights
         WHERE night >= bookings.arrival
           AND night < bookings.departure
           AND IFNULL(booking_id, '') != bookings.id
       )`
  ).bind(nowIso, id, nowIso, expectedNights).run();
  if (changed(result)) return { ok: true, booking: await getBooking(db, id) };
  const again = await getBooking(db, id);
  if (again && again.status === 'pending' && again.expires_at > nowIso) {
    return { ok: false, error: 'overlap', booking: again };
  }
  return classifyDecision(again, nowIso);
}

export async function rejectBooking(db, id, now) {
  await expireDueBookings(db, now);
  const nowIso = now.toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE bookings
       SET status = 'rejected'
       WHERE id = ? AND status = 'pending' AND expires_at > ?`
    ).bind(id, nowIso),
    db.prepare(
      `DELETE FROM occupied_nights
       WHERE booking_id = ?
         AND EXISTS (
           SELECT 1 FROM bookings WHERE id = ? AND status = 'rejected'
         )`
    ).bind(id, id),
  ]);
  if (changed(results && results[0])) return { ok: true, booking: await getBooking(db, id) };
  return classifyDecision(await getBooking(db, id), nowIso);
}

// Seven-week balance reminders are confirmed stays only. Pending and rejected are ignored.
export async function selectReminderBookings(db, today) {
  const arrival = addDaysISO(today, REMINDER_DAYS_BEFORE_ARRIVAL);
  const rows = await db.prepare(
    `SELECT * FROM bookings
     WHERE status = 'confirmed'
       AND balance_reminder_sent_at IS NULL
       AND arrival = ?`
  ).bind(arrival).all();
  return (rows.results || []).map(hydrateBooking);
}

export async function claimReminder(db, id, sentAt) {
  const result = await db.prepare(
    `UPDATE bookings
     SET balance_reminder_sent_at = ?
     WHERE id = ? AND status = 'confirmed' AND balance_reminder_sent_at IS NULL`
  ).bind(sentAt, id).run();
  return !!(result.meta && result.meta.changes === 1);
}

export async function releaseReminder(db, id) {
  await db.prepare(
    `UPDATE bookings SET balance_reminder_sent_at = NULL WHERE id = ? AND status = 'confirmed'`
  ).bind(id).run();
}

export async function consumeRateLimit(db, bucket, nowMs, limit, windowMs) {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const row = await db.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  ).bind(bucket, windowStart).first();
  const count = row ? Number(row.count) : limit + 1;
  return { allowed: count <= limit, count, windowStart };
}

export async function pruneRateLimits(db, nowMs) {
  const cutoff = nowMs - (48 * 60 * 60 * 1000);
  await db.prepare(`DELETE FROM rate_limits WHERE window_start < ?`).bind(cutoff).run();
}
