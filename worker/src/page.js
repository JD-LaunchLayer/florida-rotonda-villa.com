import { formatLongDate, formatWhen } from './dates.js';
import { escapeHtml } from './templates.js';

function formatGBP(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return 'No published total';
  return `£${Number(amount).toLocaleString('en-GB')}`;
}

function extraSummary(booking) {
  const extras = booking.extras || {};
  const chosen = [];
  if (extras.poolHeat) chosen.push('Pool heat');
  if (extras.cot) chosen.push('Cot');
  if (extras.highChair) chosen.push('High chair');
  return chosen.length ? chosen.join(', ') : 'None';
}

function summaryRows(booking, timeZone) {
  const breakdown = booking.breakdown || {};
  return [
    ['Reference', booking.id],
    ['Guest', `${booking.guest_first_name} ${booking.guest_last_name}`],
    ['Email', booking.guest_email],
    ['Phone', booking.guest_phone || 'Not given'],
    ['Check-in', formatLongDate(booking.arrival)],
    ['Check-out', formatLongDate(booking.departure)],
    ['Nights', String(breakdown.nights ?? '')],
    ['Guests', String(booking.guests)],
    ['Extras', extraSummary(booking)],
    ['Total to pay', formatGBP(breakdown.totalToPay)],
    ['Deposit, paid first', formatGBP(breakdown.deposit)],
    ['Hold ends', formatWhen(booking.expires_at, timeZone || 'Europe/London')],
  ];
}

function actionForm(action, token, label) {
  return `<form method="post" action="/decide" data-action="${action}">
      <input type="hidden" name="token" value="${escapeHtml(token)}" autocomplete="off">
      <button type="submit" class="${action}">${label}</button>
    </form>`;
}

export function renderDecisionPage(view) {
  const booking = view.booking;
  const rows = booking
    ? summaryRows(booking, view.timeZone).map(([label, value]) => (
      `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )).join('')
    : '';
  const messageBlock = booking && booking.message
    ? `<h2>Message</h2><p class="message">${escapeHtml(booking.message)}</p>`
    : '';
  const forms = [];
  if (view.approveToken) forms.push(actionForm('approve', view.approveToken, 'Approve'));
  if (view.rejectToken) forms.push(actionForm('reject', view.rejectToken, 'Reject'));
  const actions = forms.length
    ? `<div class="actions">${forms.join('')}</div><p class="hint">Opening this page does not decide the request. Nothing changes until you press Approve or Reject.</p>`
    : '';
  const tone = view.tone || 'neutral';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(view.title || 'Booking decision')}</title>
  <style>
    :root {
      --gold: #c1a367;
      --ink: #2c2416;
      --muted: #5c564c;
      --line: #e4dcc8;
      --paper: #fffcf7;
      --cream: #f7f1e4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--cream);
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
      line-height: 1.45;
    }
    main { max-width: 38rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    h1 { font-size: 1.7rem; font-weight: normal; margin: 0 0 0.35rem; }
    h2 { font-size: 1.05rem; font-weight: normal; margin: 1.25rem 0 0.4rem; }
    .brand { color: var(--muted); letter-spacing: 0.04em; font-size: 0.85rem; margin: 0 0 1rem; }
    .banner {
      background: var(--paper);
      border-left: 4px solid var(--gold);
      padding: 0.85rem 1rem;
      margin: 0 0 1rem;
    }
    .banner.bad { border-left-color: #8c2f2f; }
    .card { background: var(--paper); border: 1px solid var(--line); padding: 0.4rem 1rem 0.8rem; }
    .row { display: grid; grid-template-columns: 9.5rem 1fr; gap: 0.75rem; align-items: baseline; padding: 0.55rem 0; border-bottom: 1px solid var(--line); }
    @media (max-width: 36rem) {
      .row { grid-template-columns: 1fr; gap: 0.1rem; }
    }
    .row:last-child { border-bottom: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .message { white-space: pre-wrap; margin: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.25rem; }
    .actions form { flex: 1 1 10rem; margin: 0; }
    button {
      width: 100%;
      font: inherit;
      font-size: 1rem;
      padding: 0.75rem 1rem;
      cursor: pointer;
    }
    button.approve { background: var(--gold); color: #1f1a12; border: 1px solid var(--gold); }
    button.reject { background: transparent; color: var(--ink); border: 1px solid var(--gold); }
    button:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
    .hint { color: var(--muted); font-size: 0.95rem; }
  </style>
</head>
<body>
  <main>
    <p class="brand">Florida Rotonda Villa</p>
    <h1>${escapeHtml(view.heading || 'Booking')}</h1>
    <p class="banner ${tone === 'bad' ? 'bad' : ''}">${escapeHtml(view.message || '')}</p>
    ${rows ? `<div class="card">${rows}</div>` : ''}
    ${messageBlock}
    ${actions}
  </main>
</body>
</html>`;
}
