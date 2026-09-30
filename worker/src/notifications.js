import { confirmBooking, rejectBooking } from './db.js';
import { ownerAddress, sendEmail } from './email.js';
import { decisionLinks } from './tokens.js';
import {
  balanceReminderEmail,
  confirmationEmail,
  declineEmail,
  ownerDecisionEmail,
  ownerReminderCopy,
  ownerRequestEmail,
  requestReceivedEmail,
} from './templates.js';

async function sendToOwner(env, message, send) {
  const raw = String(env && env.OWNER_EMAIL || '').trim();
  if (!raw) {
    console.log(JSON.stringify({
      event: 'email_dry_run',
      to: [],
      subject: message.subject,
      text: message.text,
    }));
    return { dryRun: true, ok: true };
  }
  const owner = ownerAddress(env);
  if (!owner) {
    console.log(JSON.stringify({ event: 'owner_email_not_single' }));
    return { dryRun: false, ok: false, error: 'owner_email_not_single' };
  }
  return send(env, { ...message, to: owner });
}

export async function sendRequestEmails(env, booking, send = sendEmail, origin) {
  const links = await decisionLinks(env, booking, origin);
  const guest = await send(env, requestReceivedEmail(booking, env));
  const owner = await sendToOwner(env, ownerRequestEmail(booking, env, links), send);
  return { guest, owner };
}

export async function sendConfirmationEmails(env, booking, send = sendEmail) {
  const guest = await send(env, confirmationEmail(booking, env));
  const owner = await sendToOwner(env, ownerDecisionEmail(booking, env, 'approve'), send);
  return { guest, owner };
}

export async function sendDeclineEmails(env, booking, send = sendEmail) {
  const guest = await send(env, declineEmail(booking, env));
  const owner = await sendToOwner(env, ownerDecisionEmail(booking, env, 'reject'), send);
  return { guest, owner };
}

export async function sendReminderEmails(env, booking, send = sendEmail) {
  const guest = await send(env, balanceReminderEmail(booking, env));
  const owner = await sendToOwner(env, ownerReminderCopy(booking, env), send);
  return { guest, owner };
}

export function deliveryOk(result) {
  return !!(result && (result.dryRun || result.ok));
}

export async function decideAndEmail(db, env, id, action, now, send = sendEmail) {
  const result = action === 'approve'
    ? await confirmBooking(db, id, now)
    : await rejectBooking(db, id, now);
  if (!result.ok) return result;
  const emails = action === 'approve'
    ? await sendConfirmationEmails(env, result.booking, send)
    : await sendDeclineEmails(env, result.booking, send);
  console.log(JSON.stringify({
    event: 'booking_decided',
    id: result.booking.id,
    action,
    guestDryRun: !!(emails.guest && emails.guest.dryRun),
    guestOk: !!(emails.guest && (emails.guest.ok || emails.guest.dryRun)),
  }));
  return { ...result, action, emails };
}

export async function confirmBookingAndEmail(db, env, id, now, send = sendEmail) {
  return decideAndEmail(db, env, id, 'approve', now, send);
}
