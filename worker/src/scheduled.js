import { claimReminder, expireDueBookings, pruneRateLimits, releaseReminder, selectReminderBookings } from './db.js';
import { sendEmail } from './email.js';
import { deliveryOk, sendReminderEmails } from './notifications.js';
import { todayISO } from './dates.js';

export async function runScheduled(env, now = new Date(), deps = {}) {
  const send = deps.sendEmail || sendEmail;
  const expired = await expireDueBookings(env.DB, now);
  const today = todayISO(env.REMINDER_TIMEZONE || 'Europe/London', now);
  const due = await selectReminderBookings(env.DB, today);
  const sent = [];

  for (const booking of due) {
    const claimed = await claimReminder(env.DB, booking.id, now.toISOString());
    if (!claimed) continue;
    const emails = await sendReminderEmails(env, booking, send);
    if (!deliveryOk(emails.guest)) {
      await releaseReminder(env.DB, booking.id);
      console.log(JSON.stringify({ event: 'reminder_failed', id: booking.id }));
      continue;
    }
    if (!deliveryOk(emails.owner)) {
      console.log(JSON.stringify({ event: 'reminder_owner_copy_failed', id: booking.id }));
    }
    sent.push(booking.id);
  }

  await pruneRateLimits(env.DB, now.getTime());
  console.log(JSON.stringify({ event: 'cron_complete', expired: expired.length, reminders: sent.length }));
  return { expired, reminders: sent };
}
