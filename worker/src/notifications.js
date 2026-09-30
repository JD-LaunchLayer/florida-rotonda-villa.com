import { confirmBooking } from './db.js';
import { sendEmail } from './email.js';
import {
  balanceReminderEmail,
  confirmationEmail,
  ownerConfirmationCopy,
  ownerReminderCopy,
  ownerRequestEmail,
  requestReceivedEmail,
} from './templates.js';

export async function sendRequestEmails(env, booking, send = sendEmail) {
  const guest = await send(env, requestReceivedEmail(booking, env));
  const owner = await send(env, ownerRequestEmail(booking, env));
  return { guest, owner };
}

export async function sendConfirmationEmails(env, booking, send = sendEmail) {
  const guest = await send(env, confirmationEmail(booking, env));
  const owner = await send(env, ownerConfirmationCopy(booking, env));
  return { guest, owner };
}

export async function sendReminderEmails(env, booking, send = sendEmail) {
  const guest = await send(env, balanceReminderEmail(booking, env));
  const owner = await send(env, ownerReminderCopy(booking, env));
  return { guest, owner };
}

export function deliveryOk(result) {
  return !!(result && (result.dryRun || result.ok));
}

// Used by tests and the future owner approval step. No public route calls this.
export async function confirmBookingAndEmail(db, env, id, now, send = sendEmail) {
  const confirmed = await confirmBooking(db, id, now);
  if (!confirmed.ok) return confirmed;
  const emails = await sendConfirmationEmails(env, confirmed.booking, send);
  return { ...confirmed, emails };
}
