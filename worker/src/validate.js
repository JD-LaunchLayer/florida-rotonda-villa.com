import { addMonthsISO, isISODate, MAX_NIGHTS, nightsBetween, todayISO } from './dates.js';

const NAME = /^[\p{L}][\p{L}\s.'’-]*$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\-\s]{7,40}$/;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validName(value) {
  const text = cleanText(value);
  return text.length >= 1 && text.length <= 80 && NAME.test(text);
}

function flag(value, field) {
  if (value == null || value === false || value === true) return { ok: true, value: value === true };
  return { ok: false, error: 'invalid_' + field, message: field + ' must be yes or no.' };
}

export function validateBookingInput(body, now, timeZone) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid_body', message: 'The booking request must be a JSON object.' };
  }

  const arrival = cleanText(body.arrival);
  const departure = cleanText(body.departure);
  if (!isISODate(arrival) || !isISODate(departure) || departure <= arrival) {
    return { ok: false, error: 'invalid_dates', message: 'Choose a check-in date and a later check-out date.' };
  }

  const nights = nightsBetween(arrival, departure);
  if (nights.length < 1 || nights.length > MAX_NIGHTS) {
    return {
      ok: false,
      error: 'invalid_dates',
      message: 'A stay must be between 1 and ' + MAX_NIGHTS + ' nights.',
    };
  }

  const today = todayISO(timeZone || 'America/New_York', now);
  if (arrival < today) {
    return { ok: false, error: 'invalid_dates', message: 'Check-in cannot be in the past.' };
  }
  const horizon = addMonthsISO(today, 24);
  if (arrival > horizon) {
    return { ok: false, error: 'invalid_dates', message: 'Check-in must be within the next two years.' };
  }

  const guests = body.guests;
  if (!Number.isInteger(guests) || guests < 1 || guests > 6) {
    return { ok: false, error: 'invalid_guests', message: 'The villa takes 1 to 6 guests.' };
  }

  const firstName = cleanText(body.firstName);
  const lastName = cleanText(body.lastName);
  if (!validName(firstName) || !validName(lastName)) {
    return { ok: false, error: 'invalid_name', message: 'Enter a first name and a last name.' };
  }

  const email = cleanText(body.email).toLowerCase();
  if (!email || email.length > 200 || !EMAIL.test(email)) {
    return { ok: false, error: 'invalid_email', message: 'Enter a valid email address.' };
  }

  const phone = cleanText(body.phone);
  if (phone && !PHONE.test(phone)) {
    return { ok: false, error: 'invalid_phone', message: 'Enter a phone number using digits, spaces, and + ( ) - only.' };
  }

  const message = cleanText(body.message);
  if (message.length > 2000 || message.includes('\u0000')) {
    return { ok: false, error: 'invalid_message', message: 'The message is too long.' };
  }

  if (body.termsAccepted !== true) {
    return { ok: false, error: 'terms_required', message: 'Please accept the terms and conditions.' };
  }

  const extras = body.extras && typeof body.extras === 'object' ? body.extras : {};
  const poolHeat = flag(extras.poolHeat, 'poolHeat');
  const cot = flag(extras.cot, 'cot');
  const highChair = flag(extras.highChair, 'highChair');
  if (!poolHeat.ok) return { ok: false, error: 'invalid_extras', message: 'Pool heat must be yes or no.' };
  if (!cot.ok) return { ok: false, error: 'invalid_extras', message: 'Cot hire must be yes or no.' };
  if (!highChair.ok) return { ok: false, error: 'invalid_extras', message: 'High chair hire must be yes or no.' };

  return {
    ok: true,
    value: {
      arrival,
      departure,
      guests,
      firstName,
      lastName,
      email,
      phone: phone || null,
      message: message || null,
      extras: {
        poolHeat: poolHeat.value,
        cot: cot.value,
        highChair: highChair.value,
      },
    },
  };
}
