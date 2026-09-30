import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import prices from '../../data/prices.json' with { type: 'json' };
import villaRates from '../../data/villa-rates.js';
import { isAllowedOrigin } from '../src/cors.js';
import {
  addDaysISO,
  bookingNeedsReminder,
  HOLD_MS,
  isHoldExpired,
  rangesOverlap,
  REMINDER_DAYS_BEFORE_ARRIVAL,
} from '../src/dates.js';
import { confirmBooking, consumeRateLimit, getBooking, rejectBooking } from '../src/db.js';
import { bankDetails, emailConfigured, ownerAddress, replyToAddress, sendEmail } from '../src/email.js';
import { handleRequest } from '../src/http.js';
import { confirmBookingAndEmail, decideAndEmail, sendRequestEmails } from '../src/notifications.js';
import { computeQuote, toBreakdown } from '../src/pricing.js';
import { runScheduled } from '../src/scheduled.js';
import { balanceReminderEmail, confirmationEmail, declineEmail, ownerDecisionEmail, ownerReminderCopy, ownerRequestEmail, requestReceivedEmail } from '../src/templates.js';
import { signDecisionToken, verifyDecisionToken } from '../src/tokens.js';

const workerRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.join(workerRoot, '..');
const NOW = new Date('2026-05-01T15:00:00.000Z');
const TEST_APPROVAL_SECRET = 'test-only-approval-secret-32chars';

function openDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(path.join(workerRoot, 'migrations/0001_init.sql'), 'utf8'));
  return wrap(sqlite);
}

function wrap(sqlite) {
  function prepare(sql) {
    let params = [];
    const statement = {
      bind(...next) {
        params = next.map((value) => (value === undefined ? null : value));
        return statement;
      },
      all() {
        return Promise.resolve({ results: sqlite.prepare(sql).all(...params) });
      },
      first() {
        return Promise.resolve(sqlite.prepare(sql).get(...params) ?? null);
      },
      run() {
        const info = sqlite.prepare(sql).run(...params);
        return Promise.resolve({ success: true, meta: { changes: Number(info.changes) } });
      },
    };
    return statement;
  }

  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function testEnv(db, extra = {}) {
  return {
    DB: db,
    OWNER_EMAIL: 'owner@example.com',
    EMAIL_FROM: 'Florida Rotonda Villa <bookings@example.com>',
    NETLIFY_SITE_SLUG: 'floridarotondavillacom',
    ALLOWED_ORIGINS: 'https://florida-rotonda-villa.com,https://www.florida-rotonda-villa.com,https://florida-rotonda-villa.co.uk,https://www.florida-rotonda-villa.co.uk',
    PROPERTY_TIMEZONE: 'America/New_York',
    REMINDER_TIMEZONE: 'Europe/London',
    APPROVAL_SECRET: TEST_APPROVAL_SECRET,
    ...extra,
  };
}

function payload(overrides = {}) {
  return {
    arrival: '2026-05-06',
    departure: '2026-05-13',
    guests: 2,
    extras: { poolHeat: false, cot: false, highChair: false },
    firstName: 'Ada',
    lastName: 'Guest',
    email: 'ada@guest.test',
    phone: '+44 7700 900123',
    message: 'Looking forward to the lake.',
    termsAccepted: true,
    botcheck: '',
    totalToPay: 1,
    ...overrides,
  };
}

function request(pathname, { method = 'GET', body, origin = 'https://florida-rotonda-villa.com', ip = '203.0.113.10' } = {}) {
  return new Request(`https://florida-rotonda-villa-api.example.workers.dev${pathname}`, {
    method,
    headers: {
      Origin: origin,
      'CF-Connecting-IP': ip,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function postBooking(db, body, extra = {}) {
  const sent = [];
  const sendEmailMock = async (_env, message) => {
    sent.push(message);
    return { dryRun: true, ok: true };
  };
  const response = await handleRequest(request('/api/bookings', { method: 'POST', body, ...extra }), testEnv(db), {
    now: NOW,
    sendEmail: sendEmailMock,
  });
  const json = await response.json();
  return { response, json, sent };
}

test('worker quotes match the booking page for the published examples and a date grid', () => {
  const examples = [
    ['2026-01-04', '2026-01-11', 1200],
    ['2026-01-05', '2026-01-12', 900],
    ['2026-04-30', '2026-05-07', 900],
    ['2026-05-01', '2026-05-08', 800],
    ['2026-08-31', '2026-09-07', 800],
    ['2026-09-01', '2026-09-08', 850],
    ['2026-12-19', '2026-12-26', 850],
    ['2026-12-20', '2026-12-27', 1200],
    ['2026-01-05', '2026-01-15', 900 + 129 * 3],
    ['2026-08-25', '2026-09-08', 1650],
    ['2026-12-28', '2027-01-04', 1200],
  ];
  for (const [arrival, departure, rental] of examples) {
    const quote = computeQuote(arrival, departure, {});
    assert.equal(quote.rentalTotal, rental, `${arrival} to ${departure}`);
  }

  const missing = computeQuote('2026-12-28', '2027-01-05', {});
  assert.equal(missing.rentalTotal, null);
  assert.equal(computeQuote('2027-04-01', '2027-04-08', {}).rentalTotal, null);

  const starts = ['2026-01-04', '2026-01-05', '2026-04-30', '2026-05-01', '2026-08-25', '2026-08-31', '2026-09-01', '2026-10-01', '2026-12-19', '2026-12-20', '2026-12-28'];
  const lengths = [1, 3, 6, 7, 8, 10, 14, 15];
  const optionSets = [
    {},
    { poolHeat: true },
    { cot: true, highChair: true },
    { poolHeat: true, cot: true, highChair: true },
  ];
  for (const arrival of starts) {
    for (const nights of lengths) {
      const departure = addDaysISO(arrival, nights);
      for (const extras of optionSets) {
        const server = computeQuote(arrival, departure, extras);
        const page = villaRates.buildQuote(prices, villaRates.parseISODate(arrival), villaRates.parseISODate(departure), extras);
        assert.equal(server.rentalTotal, page.rentalTotal);
        assert.equal(server.total, page.total);
        assert.equal(server.cleaning, page.cleaning);
        assert.equal(server.deposit, page.deposit);
        assert.deepEqual(server.extraLines.map((line) => [line.id, line.amount]), page.extraLines.map((line) => [line.id, line.amount]));
      }
    }
  }

  const heated = computeQuote('2026-10-01', '2026-10-11', { poolHeat: true, cot: true, highChair: true });
  assert.equal(heated.pool.amount, 180);
  assert.equal(heated.total, 850 + 122 * 3 + 180 + 20 + 20 + 120);
  assert.equal(heated.deposit, 300);
  assert.notEqual(heated.total, heated.total + heated.deposit);
});

test('overlap treats the check-out morning as free', () => {
  assert.equal(rangesOverlap('2026-05-01', '2026-05-08', '2026-05-08', '2026-05-15'), false);
  assert.equal(rangesOverlap('2026-05-01', '2026-05-08', '2026-05-07', '2026-05-10'), true);
  assert.equal(rangesOverlap('2026-05-01', '2026-05-08', '2026-04-28', '2026-05-01'), false);
  assert.equal(rangesOverlap('2027-01-25', '2027-02-01', '2027-02-01', '2027-04-01'), false);
  assert.equal(rangesOverlap('2027-01-31', '2027-02-02', '2027-02-01', '2027-04-01'), true);
  assert.equal(rangesOverlap('2027-04-01', '2027-04-08', '2027-02-01', '2027-04-01'), false);
});

test('a pending hold blocks overlapping nights and allows same-day turnover', async () => {
  const db = openDb();
  const blockedNights = await db.prepare(`SELECT COUNT(*) AS n FROM occupied_nights WHERE source = 'block'`).all();
  assert.equal(blockedNights.results[0].n, 59);

  const first = await postBooking(db, payload());
  assert.equal(first.response.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.status, 'pending');
  assert.equal(first.json.totalToPay, 800 + 120);
  assert.equal(first.json.deposit, 300);
  assert.notEqual(first.json.totalToPay, 1);
  assert.equal(first.sent.length, 2);
  assert.match(first.sent[0].subject, /received/);
  assert.match(first.sent[1].subject, /New booking request/);

  const overlap = await postBooking(db, payload({ arrival: '2026-05-12', departure: '2026-05-19', email: 'other@guest.test' }));
  assert.equal(overlap.response.status, 409);
  assert.equal(overlap.json.error, 'dates_unavailable');

  const turnover = await postBooking(db, payload({
    arrival: '2026-05-13',
    departure: '2026-05-20',
    email: 'next@guest.test',
  }));
  assert.equal(turnover.response.status, 201, JSON.stringify(turnover.json));

  const insideBlock = await postBooking(db, payload({ arrival: '2027-03-01', departure: '2027-03-08', email: 'block@guest.test' }));
  assert.equal(insideBlock.response.status, 409);

  const checkoutOnBlock = await postBooking(db, payload({ arrival: '2027-01-25', departure: '2027-02-01', email: 'before@guest.test' }));
  assert.equal(checkoutOnBlock.response.status, 201, JSON.stringify(checkoutOnBlock.json));

  const checkinOnBlockEnd = await postBooking(db, payload({ arrival: '2027-04-01', departure: '2027-04-08', email: 'after@guest.test' }));
  assert.equal(checkinOnBlockEnd.response.status, 201, JSON.stringify(checkinOnBlockEnd.json));
  assert.equal(checkinOnBlockEnd.json.totalToPay, null);

  const wednesday = new Date('2026-05-06T12:00:00.000Z').getUTCDay();
  assert.notEqual(wednesday, 6);
  assert.equal(first.json.arrival, '2026-05-06');
});

test('availability lists holds and the seeded block without guest details', async () => {
  const db = openDb();
  const created = await postBooking(db, payload());
  const response = await handleRequest(request('/api/availability'), testEnv(db), { now: NOW });
  const body = await response.json();
  const encoded = JSON.stringify(body);
  assert.equal(response.status, 200);
  assert.equal(encoded.includes('ada@guest.test'), false);
  assert.equal(encoded.includes('Guest'), false);
  assert.equal(encoded.includes('phone'), false);
  assert.deepEqual(body.ranges[0], { checkIn: '2027-02-01', checkOut: '2027-04-01' });
  assert.deepEqual(body.ranges.find((range) => range.checkIn === '2026-05-06'), {
    checkIn: created.json.arrival,
    checkOut: created.json.departure,
  });
});

test('honeypot and validation do not create a booking', async () => {
  const db = openDb();
  const bot = await postBooking(db, payload({ botcheck: 'yes' }));
  assert.equal(bot.response.status, 200);
  assert.equal(bot.json.id, undefined);
  assert.equal(bot.sent.length, 0);
  const rows = await db.prepare(`SELECT COUNT(*) AS n FROM bookings`).all();
  assert.equal(rows.results[0].n, 0);

  const summerPool = await postBooking(db, payload({ extras: { poolHeat: true, cot: false, highChair: false } }));
  assert.equal(summerPool.response.status, 400);
  assert.equal(summerPool.json.error, 'pool_heat_unavailable');

  const past = await postBooking(db, payload({ arrival: '2026-04-30', departure: '2026-05-07' }));
  assert.equal(past.response.status, 400);

  const heated = await postBooking(db, payload({
    arrival: '2026-10-01',
    departure: '2026-10-08',
    extras: { poolHeat: true, cot: true, highChair: false },
  }));
  assert.equal(heated.response.status, 201, JSON.stringify(heated.json));
  assert.equal(heated.json.totalToPay, 850 + 126 + 20 + 120);
});

test('pending holds expire 72 hours after they are created and free the nights', async () => {
  const db = openDb();
  const created = await postBooking(db, payload());
  const id = created.json.id;
  const row = await db.prepare(`SELECT created_at, expires_at, status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(row.status, 'pending');
  assert.equal(new Date(row.expires_at).getTime() - new Date(row.created_at).getTime(), HOLD_MS);

  const almost = new Date(new Date(row.expires_at).getTime() - 1);
  assert.equal(isHoldExpired({ status: 'pending', expires_at: row.expires_at }, almost), false);
  assert.equal(isHoldExpired({ status: 'pending', expires_at: row.expires_at }, new Date(row.expires_at)), true);
  assert.equal(isHoldExpired({ status: 'confirmed', expires_at: row.expires_at }, new Date(row.expires_at)), false);

  let scheduled = await runScheduled(testEnv(db), almost);
  assert.deepEqual(scheduled.expired, []);
  const still = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(still.status, 'pending');

  scheduled = await runScheduled(testEnv(db), new Date(row.expires_at));
  assert.deepEqual(scheduled.expired, [id]);
  const expired = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(expired.status, 'expired');
  const nights = await db.prepare(`SELECT COUNT(*) AS n FROM occupied_nights WHERE booking_id = ?`).bind(id).first();
  assert.equal(nights.n, 0);

  const retry = await postBooking(db, payload({ email: 'later@guest.test' }));
  assert.equal(retry.response.status, 201);

  const confirmed = await confirmBooking(db, id, new Date(row.expires_at));
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.error, 'expired');
});

test('confirming a booking keeps the nights, is idempotent, and the invoice carries placeholders', async () => {
  const db = openDb();
  const created = await postBooking(db, payload({
    arrival: '2026-10-01',
    departure: '2026-10-11',
    extras: { poolHeat: true, cot: true, highChair: true },
  }));
  const id = created.json.id;
  const sent = [];
  const confirmed = await confirmBookingAndEmail(db, testEnv(db), id, NOW, async (_env, message) => {
    sent.push(message);
    return { dryRun: true, ok: true };
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.booking.status, 'confirmed');
  const nights = await db.prepare(`SELECT COUNT(*) AS n FROM occupied_nights WHERE booking_id = ?`).bind(id).first();
  assert.equal(nights.n, 10);

  const again = await confirmBooking(db, id, NOW);
  assert.equal(again.error, 'already_confirmed');

  const invoice = sent[0];
  assert.match(invoice.subject, new RegExp(id));
  assert.match(invoice.text, /Booking reference/);
  assert.match(invoice.text, /paid first/);
  assert.match(invoice.text, /6 weeks before arrival/);
  assert.match(invoice.text, /Account name: \[PLACEHOLDER\]/);
  assert.match(invoice.text, /Sort code: \[PLACEHOLDER\]/);
  assert.match(invoice.text, /Account number: \[PLACEHOLDER\]/);
  assert.match(invoice.text, /£300/);
  assert.match(invoice.text, /bank transfer/);
  assert.match(invoice.html, /Booking reference/);
  assert.match(invoice.html, /£300/);
  assert.equal(invoice.html.includes('<pdf'), false);
  assert.equal(invoice.attachments, undefined);
  assert.match(sent[1].subject, /You approved/);
  assert.equal(sent[1].to, 'owner@example.com');
  assert.match(sent[1].text, /ada@guest.test/);
  assert.equal(sent[1].text.includes('Account number'), false);

  const direct = confirmationEmail(confirmed.booking, {});
  assert.deepEqual(bankDetails({}), {
    accountName: '[PLACEHOLDER]',
    sortCode: '[PLACEHOLDER]',
    accountNumber: '[PLACEHOLDER]',
  });
  assert.match(direct.text, /\[PLACEHOLDER\]/);
  const requestMail = requestReceivedEmail(confirmed.booking, testEnv(db));
  assert.equal(requestMail.text.includes('Account number'), false);

  const hidden = await handleRequest(request(`/api/bookings/${id}/confirm`, { method: 'POST', body: {} }), testEnv(db), { now: NOW });
  assert.equal(hidden.status, 404);
});

test('balance reminders are selected exactly seven weeks before arrival and send once', async () => {
  assert.equal(REMINDER_DAYS_BEFORE_ARRIVAL, 49);
  assert.equal(addDaysISO('2026-05-01', 49), '2026-06-19');
  const today = '2026-05-01';
  assert.equal(bookingNeedsReminder({ status: 'confirmed', arrival: '2026-06-19', balance_reminder_sent_at: null }, today), true);
  assert.equal(bookingNeedsReminder({ status: 'confirmed', arrival: '2026-06-18', balance_reminder_sent_at: null }, today), false);
  assert.equal(bookingNeedsReminder({ status: 'confirmed', arrival: '2026-06-20', balance_reminder_sent_at: null }, today), false);
  assert.equal(bookingNeedsReminder({ status: 'pending', arrival: '2026-06-19', balance_reminder_sent_at: null }, today), false);
  assert.equal(bookingNeedsReminder({ status: 'confirmed', arrival: '2026-06-19', balance_reminder_sent_at: 'sent' }, today), false);

  const db = openDb();
  const created = await postBooking(db, payload({ arrival: '2026-06-19', departure: '2026-06-26' }));
  await confirmBooking(db, created.json.id, NOW);

  const calls = [];
  const recipients = [];
  const send = async (_env, message) => {
    calls.push(message.subject);
    recipients.push(message.to);
    return { dryRun: false, ok: true };
  };
  const first = await runScheduled(testEnv(db), NOW, { sendEmail: send });
  assert.deepEqual(first.reminders, [created.json.id]);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /Balance reminder/);
  assert.match(calls[1], /^Copy:/);
  assert.equal(recipients[0], 'ada@guest.test');
  assert.equal(recipients[1], 'owner@example.com');

  const reminderBooking = {
    id: created.json.id,
    arrival: '2026-06-19',
    departure: '2026-06-26',
    guests: 2,
    guest_first_name: 'Ada',
    guest_last_name: 'Guest',
    guest_email: 'ada@guest.test',
    guest_phone: null,
    message: null,
    breakdown: toBreakdown(computeQuote('2026-06-19', '2026-06-26', {})),
  };
  const guest = balanceReminderEmail(reminderBooking, {});
  assert.match(guest.text, /seven weeks/);
  const owner = ownerReminderCopy(reminderBooking, { OWNER_EMAIL: 'owner@example.com' });
  assert.match(owner.subject, /^Copy:/);
  assert.match(owner.text, /ada@guest.test/);

  const second = await runScheduled(testEnv(db), NOW, { sendEmail: send });
  assert.deepEqual(second.reminders, []);
  assert.equal(calls.length, 2);

  const other = openDb();
  const failed = await postBooking(other, payload({ arrival: '2026-06-19', departure: '2026-06-26', email: 'fail@guest.test' }));
  await confirmBooking(other, failed.json.id, NOW);
  let attempts = 0;
  await runScheduled(testEnv(other), NOW, {
    sendEmail: async () => {
      attempts += 1;
      return { dryRun: false, ok: false };
    },
  });
  const cleared = await other.prepare(`SELECT balance_reminder_sent_at FROM bookings WHERE id = ?`).bind(failed.json.id).first();
  assert.equal(cleared.balance_reminder_sent_at, null);
  await runScheduled(testEnv(other), NOW, {
    sendEmail: async () => ({ dryRun: false, ok: true }),
  });
  const marked = await other.prepare(`SELECT balance_reminder_sent_at FROM bookings WHERE id = ?`).bind(failed.json.id).first();
  assert.ok(marked.balance_reminder_sent_at);
  assert.ok(attempts >= 1);
});

test('posting is rate limited and dry-run email does not call the provider', async () => {
  const db = openDb();
  let last;
  for (let day = 6; day <= 13; day += 1) {
    const arrival = `2026-05-${String(day).padStart(2, '0')}`;
    last = await postBooking(db, payload({
      arrival,
      departure: addDaysISO(arrival, 1),
      email: `guest${day}@guest.test`,
    }), { ip: '203.0.113.50' });
  }
  assert.equal(last.response.status, 201);
  const limited = await postBooking(db, payload({
    arrival: '2026-05-14',
    departure: '2026-05-15',
    email: 'ninth@guest.test',
  }), { ip: '203.0.113.50' });
  assert.equal(limited.response.status, 429);

  const direct = await consumeRateLimit(db, 'post:test', NOW.getTime(), 1, 60 * 60 * 1000);
  assert.equal(direct.allowed, true);
  const second = await consumeRateLimit(db, 'post:test', NOW.getTime(), 1, 60 * 60 * 1000);
  assert.equal(second.allowed, false);

  let called = false;
  const dry = await sendEmail(testEnv(db), { to: 'ada@guest.test', subject: 'Hi', text: 'Body', html: '<p>Body</p>' }, () => {
    called = true;
    throw new Error('should not send');
  });
  assert.equal(dry.dryRun, true);
  assert.equal(called, false);
  assert.equal(emailConfigured(testEnv(db)), false);
  const missingFrom = await sendEmail({
    EMAIL_API_KEY: 'test-key',
    EMAIL_FROM: '',
  }, { to: 'ada@guest.test', subject: 'Hi', text: 'Body', html: '<p>Body</p>' }, () => {
    called = true;
    throw new Error('missing EMAIL_FROM must not send');
  });
  assert.equal(missingFrom.dryRun, true);
  assert.equal(called, false);

  const live = await sendEmail({
    EMAIL_API_KEY: 'test-key',
    EMAIL_FROM: 'Florida Rotonda Villa <bookings@florida-rotonda-villa.com>',
    EMAIL_API_URL: 'https://email.example.test/send',
  }, { to: 'ada@guest.test', subject: 'Hi', text: 'Body', html: '<p>Body</p>' }, async (_url, init) => {
    called = true;
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    const payload = JSON.parse(init.body);
    assert.equal(payload.from, 'Florida Rotonda Villa <bookings@florida-rotonda-villa.com>');
    assert.deepEqual(payload.to, ['ada@guest.test']);
    return new Response('{}', { status: 202 });
  });
  assert.equal(live.ok, true);
  assert.equal(live.dryRun, false);
});

test('CORS allows the villa domains and Netlify previews only', () => {
  const env = testEnv(null);
  assert.equal(isAllowedOrigin('https://florida-rotonda-villa.com', env), true);
  assert.equal(isAllowedOrigin('https://www.florida-rotonda-villa.com', env), true);
  assert.equal(isAllowedOrigin('https://florida-rotonda-villa.co.uk', env), true);
  assert.equal(isAllowedOrigin('https://www.florida-rotonda-villa.co.uk', env), true);
  assert.equal(isAllowedOrigin('https://floridarotondavillacom.netlify.app', env), true);
  assert.equal(isAllowedOrigin('https://deploy-preview-5--floridarotondavillacom.netlify.app', env), true);
  assert.equal(isAllowedOrigin('https://florida-rotonda-villa.netlify.app', env), true);
  assert.equal(isAllowedOrigin('https://deploy-preview-4--florida-rotonda-villa.netlify.app', env), true);
  assert.equal(isAllowedOrigin('https://evil.example', env), false);
  assert.equal(isAllowedOrigin('https://florida-rotonda-villa.com.evil.example', env), false);
  assert.equal(isAllowedOrigin('http://florida-rotonda-villa.com', env), false);
  assert.equal(isAllowedOrigin('http://localhost:8888', env), false);
  assert.equal(isAllowedOrigin('http://localhost:8888', { ...env, ALLOW_LOCALHOST: 'true' }), true);
  assert.equal(isAllowedOrigin('https://custom.example', { ...env, ALLOWED_ORIGINS: 'https://custom.example' }), true);
});

function decisionUrl(text, label) {
  const match = text.match(new RegExp(label + ': (https://\\S+)'));
  assert.ok(match, label);
  return new URL(match[1]);
}

function formToken(html, action) {
  const match = html.match(new RegExp('data-action="' + action + '"[\\s\\S]*?name="token" value="([^"]+)"'));
  assert.ok(match, action);
  return match[1];
}

function postDecision(token, ip = '203.0.113.77') {
  return new Request('https://florida-rotonda-villa-api.example.workers.dev/decide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': ip,
    },
    body: new URLSearchParams({ token }).toString(),
  });
}

test('decision tokens are single purpose, expire, and fail when tampered', async () => {
  const exp = '2026-08-01T00:00:00.000Z';
  const token = await signDecisionToken(TEST_APPROVAL_SECRET, { id: 'FRV-AABBCCDD', purpose: 'approve', exp });
  const valid = await verifyDecisionToken(TEST_APPROVAL_SECRET, token, NOW);
  assert.equal(valid.ok, true);
  assert.equal(valid.claims.id, 'FRV-AABBCCDD');
  assert.equal(valid.claims.purpose, 'approve');
  assert.equal(valid.claims.exp, exp);

  const otherSecret = await verifyDecisionToken(`${TEST_APPROVAL_SECRET}-other`, token, NOW);
  assert.equal(otherSecret.ok, false);
  assert.equal(otherSecret.error, 'invalid');

  const [payload, signature] = token.split('.');
  const flippedPayload = payload.slice(0, -1) + (payload.endsWith('A') ? 'B' : 'A');
  const tamperedPayload = await verifyDecisionToken(TEST_APPROVAL_SECRET, `${flippedPayload}.${signature}`, NOW);
  assert.equal(tamperedPayload.error, 'invalid');
  const flippedSignature = signature.slice(0, -1) + (signature.endsWith('a') ? 'b' : 'a');
  const tamperedSignature = await verifyDecisionToken(TEST_APPROVAL_SECRET, `${payload}.${flippedSignature}`, NOW);
  assert.equal(tamperedSignature.error, 'invalid');

  const expiredToken = await signDecisionToken(TEST_APPROVAL_SECRET, {
    id: 'FRV-AABBCCDD',
    purpose: 'reject',
    exp: '2026-05-01T15:00:00.000Z',
  });
  const atExpiry = await verifyDecisionToken(TEST_APPROVAL_SECRET, expiredToken, new Date('2026-05-01T15:00:00.000Z'));
  assert.equal(atExpiry.error, 'expired');
  assert.equal(atExpiry.claims.purpose, 'reject');
  const beforeExpiry = await verifyDecisionToken(TEST_APPROVAL_SECRET, expiredToken, new Date('2026-05-01T14:59:59.999Z'));
  assert.equal(beforeExpiry.ok, true);

  const missing = await verifyDecisionToken('', token, NOW);
  assert.equal(missing.error, 'not_configured');
  await assert.rejects(() => signDecisionToken('too-short', { id: 'FRV-AABBCCDD', purpose: 'view', exp }));
});

test('opening an approval link does not decide, and a second POST is idempotent', async () => {
  const db = openDb();
  const created = await postBooking(db, payload({ message: '<script>alert(1)</script>' }));
  const id = created.json.id;
  const approveUrl = decisionUrl(created.sent[1].text, 'Approve');
  const rejectUrl = decisionUrl(created.sent[1].text, 'Reject');
  assert.equal(approveUrl.pathname, '/decide');
  assert.notEqual(approveUrl.searchParams.get('token'), rejectUrl.searchParams.get('token'));

  const preview = await handleRequest(new Request(approveUrl, {
    headers: { 'CF-Connecting-IP': '203.0.113.77' },
  }), testEnv(db), {
    now: NOW,
    sendEmail: async () => { throw new Error('GET must not send email'); },
  });
  const previewHtml = await preview.text();
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /text\/html/);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  assert.equal(preview.headers.get('referrer-policy'), 'no-referrer');
  assert.match(previewHtml, /#c1a367/);
  assert.match(previewHtml, /Approve/);
  assert.match(previewHtml, /Reject/);
  assert.match(previewHtml, /Ada Guest/);
  assert.equal(previewHtml.includes('<script>'), false);
  assert.match(previewHtml, /&lt;script&gt;/);
  const stillPending = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(stillPending.status, 'pending');

  const scanned = await handleRequest(new Request(approveUrl, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.77' },
  }), testEnv(db), {
    now: NOW,
    sendEmail: async () => { throw new Error('POST of the email URL must not send email'); },
  });
  assert.equal(scanned.status, 400);
  const afterScan = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(afterScan.status, 'pending');

  const row = await db.prepare(`SELECT expires_at FROM bookings WHERE id = ?`).bind(id).first();
  const viewToken = await signDecisionToken(TEST_APPROVAL_SECRET, { id, purpose: 'view', exp: row.expires_at });
  const viewPost = await handleRequest(postDecision(viewToken), testEnv(db), {
    now: NOW,
    sendEmail: async () => { throw new Error('view token must not send email'); },
  });
  assert.equal(viewPost.status, 200);
  assert.match(await viewPost.text(), /Nothing was changed/);
  const afterView = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(afterView.status, 'pending');

  const sent = [];
  const approved = await handleRequest(postDecision(formToken(previewHtml, 'approve')), testEnv(db), {
    now: NOW,
    sendEmail: async (_env, message) => {
      sent.push(message);
      return { dryRun: false, ok: true };
    },
  });
  const approvedHtml = await approved.text();
  assert.equal(approved.status, 200);
  assert.match(approvedHtml, /You approved this booking/);
  assert.match(approvedHtml, /has been emailed/);
  assert.equal(approvedHtml.includes('data-action="approve"'), false);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'ada@guest.test');
  assert.match(sent[0].subject, new RegExp(`Booking confirmed ${id}`));
  assert.match(sent[0].text, /paid first, by bank transfer/);
  assert.match(sent[0].text, /£300/);
  assert.match(sent[0].text, /6 weeks before arrival/);
  assert.match(sent[0].text, /Account name: \[PLACEHOLDER\]/);
  assert.match(sent[0].html, /£300/);
  assert.equal(sent[0].attachments, undefined);
  assert.equal(sent[1].to, 'owner@example.com');
  assert.match(sent[1].subject, /You approved/);
  assert.equal(sent[1].text.includes('Account number'), false);
  const confirmed = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(confirmed.status, 'confirmed');
  const nights = await db.prepare(`SELECT COUNT(*) AS n FROM occupied_nights WHERE booking_id = ?`).bind(id).first();
  assert.equal(nights.n, 7);

  const again = await handleRequest(postDecision(approveUrl.searchParams.get('token')), testEnv(db), {
    now: NOW,
    sendEmail: async () => { throw new Error('second approve must not send email'); },
  });
  assert.equal(again.status, 200);
  assert.match(await again.text(), /already confirmed/);
  const rejectAfter = await handleRequest(postDecision(rejectUrl.searchParams.get('token')), testEnv(db), {
    now: NOW,
    sendEmail: async () => { throw new Error('reject after approve must not send email'); },
  });
  assert.match(await rejectAfter.text(), /already confirmed/);
  const unchanged = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(unchanged.status, 'confirmed');
});

test('reject frees the dates, is idempotent, and the decline email has no bank details', async () => {
  const db = openDb();
  const created = await postBooking(db, payload());
  const id = created.json.id;
  const rejectUrl = decisionUrl(created.sent[1].text, 'Reject');
  const sent = [];
  const declined = await handleRequest(postDecision(rejectUrl.searchParams.get('token'), '203.0.113.78'), testEnv(db), {
    now: NOW,
    sendEmail: async (_env, message) => {
      sent.push(message);
      return { dryRun: false, ok: true };
    },
  });
  assert.equal(declined.status, 200);
  assert.match(await declined.text(), /You declined this request/);
  assert.match(sent[0].text, /sorry we cannot confirm/);
  assert.match(sent[0].text, new RegExp(id));
  assert.equal(sent[0].to, 'ada@guest.test');
  assert.equal(sent[0].text.includes('Account number'), false);
  assert.equal(sent[0].text.includes('[PLACEHOLDER]'), false);
  assert.equal(sent[0].text.includes('bank transfer'), false);
  assert.match(sent[0].html, /sorry we cannot confirm/);
  assert.equal(sent[1].to, 'owner@example.com');
  assert.match(sent[1].subject, /You declined/);
  const row = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(row.status, 'rejected');
  const nights = await db.prepare(`SELECT COUNT(*) AS n FROM occupied_nights WHERE booking_id = ?`).bind(id).first();
  assert.equal(nights.n, 0);

  const again = await handleRequest(postDecision(rejectUrl.searchParams.get('token'), '203.0.113.78'), testEnv(db), {
    now: NOW,
    sendEmail: async () => { throw new Error('second reject must not send email'); },
  });
  assert.match(await again.text(), /already declined/);

  const retry = await postBooking(db, payload({ email: 'next@guest.test' }));
  assert.equal(retry.response.status, 201, JSON.stringify(retry.json));

  const direct = declineEmail({
    id,
    arrival: '2026-05-06',
    departure: '2026-05-13',
    guest_first_name: 'Ada',
    guest_email: 'ada@guest.test',
  }, {});
  assert.equal(direct.text.includes('Account number'), false);
  const owner = ownerDecisionEmail({
    id,
    arrival: '2026-05-06',
    departure: '2026-05-13',
    guest_first_name: 'Ada',
    guest_last_name: 'Guest',
    guest_email: 'ada@guest.test',
  }, { OWNER_EMAIL: 'owner@example.com' }, 'reject');
  assert.equal(owner.to, 'owner@example.com');
  assert.ok(owner.text.length < 500);
});

test('approve refuses a stay whose nights were taken, and a later token cannot revive an expired hold', async () => {
  const db = openDb();
  const created = await postBooking(db, payload());
  const id = created.json.id;
  const approveToken = decisionUrl(created.sent[1].text, 'Approve').searchParams.get('token');
  await db.prepare(`DELETE FROM occupied_nights WHERE booking_id = ?`).bind(id).run();
  const other = await postBooking(db, payload({ email: 'other@guest.test' }), { ip: '203.0.113.90' });
  assert.equal(other.response.status, 201, JSON.stringify(other.json));

  const raced = await handleRequest(postDecision(approveToken, '203.0.113.91'), testEnv(db), {
    now: NOW,
    sendEmail: async () => { throw new Error('overlap must not send email'); },
  });
  const racedHtml = await raced.text();
  assert.equal(raced.status, 409);
  assert.match(racedHtml, /no longer free/);
  const leftPending = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(leftPending.status, 'pending');
  const otherNights = await db.prepare(`SELECT COUNT(*) AS n FROM occupied_nights WHERE booking_id = ?`).bind(other.json.id).first();
  assert.equal(otherNights.n, 7);

  const cleared = await handleRequest(postDecision(formToken(racedHtml, 'reject'), '203.0.113.91'), testEnv(db), {
    now: NOW,
    sendEmail: async () => ({ dryRun: false, ok: true }),
  });
  assert.equal(cleared.status, 200);
  const rejected = await db.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(id).first();
  assert.equal(rejected.status, 'rejected');
  const availability = await handleRequest(request('/api/availability'), testEnv(db), { now: NOW });
  const ranges = (await availability.json()).ranges.filter((range) => range.checkIn === '2026-05-06');
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].checkOut, '2026-05-13');

  const expiredDb = openDb();
  const expiring = await postBooking(expiredDb, payload({ email: 'late@guest.test' }));
  const expires = await expiredDb.prepare(`SELECT expires_at FROM bookings WHERE id = ?`).bind(expiring.json.id).first();
  await runScheduled(testEnv(expiredDb), new Date(expires.expires_at));
  const future = await signDecisionToken(TEST_APPROVAL_SECRET, {
    id: expiring.json.id,
    purpose: 'approve',
    exp: '2099-01-01T00:00:00.000Z',
  });
  const late = await handleRequest(postDecision(future, '203.0.113.92'), testEnv(expiredDb), {
    now: new Date(expires.expires_at),
    sendEmail: async () => { throw new Error('expired approve must not send email'); },
  });
  assert.equal(late.status, 410);
  assert.match(await late.text(), /expired/);
  const expired = await expiredDb.prepare(`SELECT status FROM bookings WHERE id = ?`).bind(expiring.json.id).first();
  assert.equal(expired.status, 'expired');
});

test('bank lines come from env, owner mail is one address, and reminders skip pending and rejected', async () => {
  const db = openDb();
  const created = await postBooking(db, payload({
    arrival: '2026-10-01',
    departure: '2026-10-08',
    extras: { poolHeat: true, cot: false, highChair: false },
  }));
  const sent = [];
  const confirmed = await decideAndEmail(db, testEnv(db, {
    BANK_ACCOUNT_NAME: 'TEST NAME',
    BANK_SORT_CODE: 'TEST-SORT',
    BANK_ACCOUNT_NUMBER: 'TEST-ACCT',
  }), created.json.id, 'approve', NOW, async (_env, message) => {
    sent.push(message);
    return { dryRun: false, ok: true };
  });
  assert.equal(confirmed.ok, true);
  assert.match(sent[0].text, /Account name: TEST NAME/);
  assert.match(sent[0].text, /Sort code: TEST-SORT/);
  assert.match(sent[0].text, /Account number: TEST-ACCT/);
  assert.match(sent[0].text, /6 weeks before arrival/);
  assert.match(sent[0].html, /TEST-ACCT/);
  assert.match(confirmationEmail(confirmed.booking, {}).text, /\[PLACEHOLDER\]/);

  const ownerSends = [];
  const stored = await getBooking(db, created.json.id);
  await sendRequestEmails({
    ...testEnv(db),
    OWNER_EMAIL: 'one@example.com, two@example.com',
  }, stored, async (_env, message) => {
    ownerSends.push(message);
    return { dryRun: true, ok: true };
  }, 'https://florida-rotonda-villa-api.example.workers.dev');
  assert.equal(ownerSends.length, 1);
  assert.equal(ownerSends[0].to, stored.guest_email);
  assert.equal(ownerAddress({ OWNER_EMAIL: 'one@example.com, two@example.com' }), null);
  assert.equal(ownerAddress({ OWNER_EMAIL: 'owner@example.com' }), 'owner@example.com');
  assert.equal(ownerAddress({ OWNER_EMAIL: '' }), null);

  const unsetOwner = [];
  const unset = await sendRequestEmails({
    ...testEnv(db),
    OWNER_EMAIL: '',
  }, stored, async (_env, message) => {
    unsetOwner.push(message);
    return { dryRun: false, ok: true };
  }, 'https://florida-rotonda-villa-api.example.workers.dev');
  assert.equal(unsetOwner.length, 1);
  assert.equal(unsetOwner[0].to, stored.guest_email);
  assert.equal(unset.owner.dryRun, true);

  const pendingDb = openDb();
  const pending = await postBooking(pendingDb, payload({
    arrival: '2026-06-19',
    departure: '2026-06-26',
    email: 'pend@guest.test',
  }));
  const skipped = await runScheduled(testEnv(pendingDb), NOW, {
    sendEmail: async () => { throw new Error('pending must not be reminded'); },
  });
  assert.deepEqual(skipped.reminders, []);
  await rejectBooking(pendingDb, pending.json.id, NOW);
  const skippedRejected = await runScheduled(testEnv(pendingDb), NOW, {
    sendEmail: async () => { throw new Error('rejected must not be reminded'); },
  });
  assert.deepEqual(skippedRejected.reminders, []);

  const unavailable = await handleRequest(new Request('https://florida-rotonda-villa-api.example.workers.dev/decide?token=missing'), testEnv(db, {
    APPROVAL_SECRET: '',
  }), { now: NOW });
  assert.equal(unavailable.status, 503);
  assert.match(await unavailable.text(), /not available/);
});

test('guest emails carry reply_to from REPLY_TO, or from OWNER_EMAIL when that is unset', async () => {
  const booking = {
    id: 'FRV-REPLYTO1',
    arrival: '2026-10-06',
    departure: '2026-10-13',
    guests: 2,
    guest_first_name: 'Ada',
    guest_last_name: 'Guest',
    guest_email: 'ada@guest.test',
    guest_phone: null,
    message: null,
    expires_at: '2026-10-03T20:00:00.000Z',
    breakdown: toBreakdown(computeQuote('2026-10-06', '2026-10-13', {})),
  };
  const owner = 'inbox@sky.test';
  const reply = 'replies@sky.test';
  const guestMails = [
    requestReceivedEmail(booking, { REPLY_TO: reply, OWNER_EMAIL: owner }),
    declineEmail(booking, { REPLY_TO: reply, OWNER_EMAIL: owner }),
    confirmationEmail(booking, { REPLY_TO: reply, OWNER_EMAIL: owner }),
    balanceReminderEmail(booking, { REPLY_TO: reply, OWNER_EMAIL: owner }),
  ];
  for (const mail of guestMails) {
    assert.equal(mail.to, 'ada@guest.test');
    assert.equal(mail.replyTo, reply);
  }
  assert.equal(requestReceivedEmail(booking, { OWNER_EMAIL: owner }).replyTo, owner);
  assert.equal(replyToAddress({ OWNER_EMAIL: owner }), owner);
  assert.equal(replyToAddress({}), null);
  assert.equal(replyToAddress({ REPLY_TO: 'a@sky.test, b@sky.test', OWNER_EMAIL: owner }), null);

  const notice = ownerRequestEmail(booking, { REPLY_TO: reply, OWNER_EMAIL: owner }, null);
  assert.equal(notice.to, owner);
  assert.equal(notice.replyTo, 'ada@guest.test');
  const copy = ownerReminderCopy(booking, { REPLY_TO: reply, OWNER_EMAIL: owner });
  assert.equal(copy.to, owner);
  assert.equal(copy.replyTo, 'ada@guest.test');

  const from = 'Florida Rotonda Villa <bookings@florida-rotonda-villa.com>';
  let payload;
  const sent = await sendEmail({
    EMAIL_API_KEY: 'test-key',
    EMAIL_FROM: from,
    OWNER_EMAIL: owner,
    REPLY_TO: reply,
  }, requestReceivedEmail(booking, { REPLY_TO: reply, OWNER_EMAIL: owner }), async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response('{}', { status: 202 });
  });
  assert.equal(sent.dryRun, false);
  assert.equal(payload.from, from);
  assert.deepEqual(payload.to, ['ada@guest.test']);
  assert.equal(payload.reply_to, reply);

  let fallbackPayload;
  await sendEmail({
    EMAIL_API_KEY: 'test-key',
    EMAIL_FROM: from,
    OWNER_EMAIL: owner,
  }, confirmationEmail(booking, { OWNER_EMAIL: owner }), async (_url, init) => {
    fallbackPayload = JSON.parse(init.body);
    return new Response('{}', { status: 202 });
  });
  assert.equal(fallbackPayload.from, from);
  assert.equal(fallbackPayload.reply_to, owner);
  assert.deepEqual(fallbackPayload.to, ['ada@guest.test']);
});

test('repository copies do not contain real bank details', () => {
  const files = [
    'worker/src/email.js',
    'worker/src/templates.js',
    'worker/src/tokens.js',
    'worker/src/decide.js',
    'worker/src/page.js',
    'worker/src/notifications.js',
    'worker/wrangler.jsonc',
    'worker/.dev.vars.example',
    'docs/BACKEND.md',
  ];
  for (const file of files) {
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    assert.equal(/\b\d{2}-\d{2}-\d{2}\b/.test(text.replace(/\d{4}-\d{2}-\d{2}/g, '')), false, file);
    assert.equal(text.includes('sk_live'), false, file);
    assert.equal(text.includes('re_'), false, file);
    assert.equal(text.includes(TEST_APPROVAL_SECRET), false, file);
  }
});
