export const HOLD_MS = 72 * 60 * 60 * 1000;
export const REMINDER_DAYS_BEFORE_ARRIVAL = 49;
export const MAX_NIGHTS = 112;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function isISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function addDaysISO(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonthsISO(iso, months) {
  const [year, month, day] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)));
  return date.toISOString().slice(0, 10);
}

export function nightsBetween(arrival, departure) {
  const nights = [];
  let cursor = arrival;
  while (cursor < departure) {
    nights.push(cursor);
    cursor = addDaysISO(cursor, 1);
  }
  return nights;
}

export function todayISO(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year').value;
  const month = parts.find((part) => part.type === 'month').value;
  const day = parts.find((part) => part.type === 'day').value;
  return `${year}-${month}-${day}`;
}

export function formatLongDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatWhen(isoTimestamp, timeZone = 'Europe/London') {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(isoTimestamp));
  return `${formatted} (${timeZone})`;
}

// Check-out is exclusive. A departure morning may be the next guest's arrival.
export function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function isHoldExpired(booking, now) {
  return booking.status === 'pending' && booking.expires_at <= now.toISOString();
}

export function bookingNeedsReminder(booking, today) {
  return booking.status === 'confirmed'
    && !booking.balance_reminder_sent_at
    && booking.arrival === addDaysISO(today, REMINDER_DAYS_BEFORE_ARRIVAL);
}

export function expiresAtFrom(now) {
  return new Date(now.getTime() + HOLD_MS).toISOString();
}
