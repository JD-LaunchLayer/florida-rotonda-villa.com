import { addDaysISO, formatLongDate, formatWhen } from './dates.js';
import { bankDetails } from './email.js';

function formatGBP(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return 'the owner will confirm this amount';
  return `£${Number(amount).toLocaleString('en-GB')}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rentalLine(line) {
  const when = formatLongDate(line.date);
  if (line.type === 'week') {
    return `7 nights from ${when} at the weekly rate (${line.label}, ${line.year}): ${formatGBP(line.amount)}`;
  }
  const noun = line.nights === 1 ? 'night' : 'nights';
  return `${line.nights} ${noun} from ${when} at ${formatGBP(line.rate)} per night (${line.label}, ${line.year}): ${formatGBP(line.amount)}`;
}

function breakdownLines(booking) {
  const breakdown = booking.breakdown || {};
  const lines = [];
  if (breakdown.rentalTotal == null) {
    const years = [...new Set((breakdown.missing || []).map((item) => item.year).filter(Boolean))];
    lines.push(years.length
      ? `There is no published rate for ${years.join(', ')}. The owner will confirm the price.`
      : 'There is no published rate for this stay. The owner will confirm the price.');
  } else {
    for (const line of breakdown.rentalLines || []) lines.push(rentalLine(line));
  }
  for (const extra of breakdown.extraLines || []) {
    lines.push(`${extra.label}: ${formatGBP(extra.amount)}`);
  }
  if (breakdown.cleaning != null) lines.push(`Final cleaning (included): ${formatGBP(breakdown.cleaning)}`);
  lines.push(`Total to pay (excluding refundable security deposit): ${formatGBP(breakdown.totalToPay)}`);
  lines.push(`Refundable security deposit (not included in the total): ${formatGBP(breakdown.deposit)}`);
  return lines;
}

function stayLines(booking) {
  return [
    `Booking reference: ${booking.id}`,
    `Check-in: ${formatLongDate(booking.arrival)}`,
    `Check-out: ${formatLongDate(booking.departure)}`,
    `Nights: ${booking.breakdown.nights}`,
    `Guests: ${booking.guests}`,
    `Name: ${booking.guest_first_name} ${booking.guest_last_name}`,
    `Email: ${booking.guest_email}`,
    `Phone: ${booking.guest_phone || 'not given'}`,
  ];
}

function balanceDueDate(booking) {
  const weeks = Number(booking.breakdown.balanceDueWeeksBefore);
  const count = Number.isFinite(weeks) ? weeks : 6;
  return { weeks: count, date: addDaysISO(booking.arrival, -7 * count) };
}

function bankLines(env) {
  const bank = bankDetails(env);
  const marked = [bank.accountName, bank.sortCode, bank.accountNumber].some((value) => value === '[PLACEHOLDER]');
  const lines = [
    'Bank transfer details',
    `Account name: ${bank.accountName}`,
    `Sort code: ${bank.sortCode}`,
    `Account number: ${bank.accountNumber}`,
  ];
  if (marked) {
    lines.push('Lines that say [PLACEHOLDER] are not real bank details. The owner replaces them before taking payment.');
  }
  return lines;
}

function paymentLines(booking, env) {
  const due = balanceDueDate(booking);
  const deposit = formatGBP(booking.breakdown.deposit);
  const balance = formatGBP(booking.breakdown.totalToPay);
  return [
    `The refundable security deposit of ${deposit} is paid first, by bank transfer.`,
    `The balance of ${balance} is due ${due.weeks} weeks before arrival, on ${formatLongDate(due.date)}.`,
    ...bankLines(env),
  ];
}

function htmlFromText(text) {
  const paragraphs = escapeHtml(text).split('\n').map((line) => (line ? `<p>${line}</p>` : '<br>')).join('\n');
  return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;color:#211b12;line-height:1.45">${paragraphs}</body></html>`;
}

function message(to, subject, lines, replyTo) {
  const text = lines.join('\n');
  return { to, subject, text, html: htmlFromText(text), replyTo };
}

export function requestReceivedEmail(booking, env) {
  const lines = [
    `Hello ${booking.guest_first_name},`,
    '',
    'We have received your booking request for the Florida Rotonda villa. This is not a confirmed booking yet. The dates are held while the owner reviews the request.',
    `The hold ends at ${formatWhen(booking.expires_at, 'Europe/London')} if the owner has not confirmed it.`,
    '',
    ...stayLines(booking),
    '',
    'Price breakdown',
    ...breakdownLines(booking),
    '',
    'Any arrival day is allowed. The owner confirms the booking. The refundable security deposit is paid first after confirmation, and the balance is due before arrival.',
    '',
    'Florida Rotonda Villa',
  ];
  return message(booking.guest_email, `Booking request received ${booking.id}`, lines, env.OWNER_EMAIL);
}

export function ownerRequestEmail(booking, env, links) {
  const lines = [
    'New booking request. The dates are held as pending.',
    `Hold ends: ${formatWhen(booking.expires_at, 'Europe/London')}`,
    '',
  ];
  if (links && links.approve && links.reject) {
    lines.push(
      'Open a link to review the request. Opening it does not approve or reject the stay. Use the button on the page.',
      'These links are only for you. Anyone who opens them can decide this request.',
      `Approve: ${links.approve}`,
      `Reject: ${links.reject}`,
      '',
    );
  } else {
    lines.push('The approval links are not included because APPROVAL_SECRET is not set on the Worker.', '');
  }
  lines.push(
    ...stayLines(booking),
    '',
    `Message: ${booking.message || 'none'}`,
    '',
    'Price breakdown',
    ...breakdownLines(booking),
  );
  return message(env.OWNER_EMAIL, `New booking request ${booking.id}`, lines, booking.guest_email);
}

export function declineEmail(booking, env) {
  const lines = [
    `Hello ${booking.guest_first_name},`,
    '',
    'Thank you for asking to stay at the Florida Rotonda villa. We are sorry we cannot confirm this request.',
    '',
    `Booking reference: ${booking.id}`,
    `Check-in: ${formatLongDate(booking.arrival)}`,
    `Check-out: ${formatLongDate(booking.departure)}`,
    '',
    'The dates are no longer held. You are welcome to request another stay.',
    '',
    'Florida Rotonda Villa',
  ];
  return message(booking.guest_email, `Booking request declined ${booking.id}`, lines, env.OWNER_EMAIL);
}

export function ownerDecisionEmail(booking, env, action) {
  const approved = action === 'approve';
  const verb = approved ? 'approved' : 'declined';
  const lines = [
    `You ${verb} booking ${booking.id}.`,
    '',
    `${booking.guest_first_name} ${booking.guest_last_name}`,
    booking.guest_email,
    `Check-in: ${formatLongDate(booking.arrival)}`,
    `Check-out: ${formatLongDate(booking.departure)}`,
    '',
    approved
      ? 'A confirmation with the payment details was prepared for the guest.'
      : 'A decline was prepared for the guest, and the dates are free for another request.',
  ];
  return message(env.OWNER_EMAIL, `You ${verb} booking ${booking.id}`, lines, booking.guest_email);
}

export function confirmationEmail(booking, env) {
  const lines = [
    `Hello ${booking.guest_first_name},`,
    '',
    'Your booking at the Florida Rotonda villa is confirmed.',
    '',
    ...stayLines(booking),
    '',
    'Price breakdown',
    ...breakdownLines(booking),
    '',
    ...paymentLines(booking, env),
    '',
    'Please use the booking reference as the payment reference.',
    '',
    'Florida Rotonda Villa',
  ];
  return message(booking.guest_email, `Booking confirmed ${booking.id}`, lines, env.OWNER_EMAIL);
}

// The approval flow sends ownerDecisionEmail. This copy remains for comparison with the guest invoice.
export function ownerConfirmationCopy(booking, env) {
  const guest = confirmationEmail(booking, env);
  const text = `Copy of the confirmation sent to ${booking.guest_first_name} ${booking.guest_last_name} (${booking.guest_email}).\n\n${guest.text}`;
  return { ...guest, to: env.OWNER_EMAIL, subject: `Copy: ${guest.subject}`, text, html: htmlFromText(text), replyTo: booking.guest_email };
}

export function balanceReminderEmail(booking, env) {
  const due = balanceDueDate(booking);
  const lines = [
    `Hello ${booking.guest_first_name},`,
    '',
    `This is a reminder seven weeks before your arrival. The balance is due on ${formatLongDate(due.date)}, which is ${due.weeks} weeks before arrival.`,
    '',
    ...stayLines(booking),
    '',
    'Price breakdown',
    ...breakdownLines(booking),
    '',
    ...paymentLines(booking, env),
    '',
    'If you have already paid the refundable security deposit, this reminder is for the balance only.',
    '',
    'Florida Rotonda Villa',
  ];
  return message(booking.guest_email, `Balance reminder ${booking.id}`, lines, env.OWNER_EMAIL);
}

export function ownerReminderCopy(booking, env) {
  const guest = balanceReminderEmail(booking, env);
  const text = `Copy of the balance reminder sent to ${booking.guest_first_name} ${booking.guest_last_name} (${booking.guest_email}).\n\n${guest.text}`;
  return { ...guest, to: env.OWNER_EMAIL, subject: `Copy: ${guest.subject}`, text, html: htmlFromText(text), replyTo: booking.guest_email };
}
