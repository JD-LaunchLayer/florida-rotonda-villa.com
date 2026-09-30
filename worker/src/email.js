const DEFAULT_EMAIL_API_URL = 'https://api.resend.com/emails';

export function isPlaceholderAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return text.includes('example.com') || text.includes('example.net') || text.includes('[placeholder]');
}

export function emailConfigured(env) {
  const key = String(env && env.EMAIL_API_KEY || '').trim();
  const from = String(env && env.EMAIL_FROM || '').trim();
  if (!key || !from) return false;
  if (isPlaceholderAddress(from)) return false;
  return true;
}

export function bankDetails(env) {
  return {
    accountName: placeholder(env && env.BANK_ACCOUNT_NAME),
    sortCode: placeholder(env && env.BANK_SORT_CODE),
    accountNumber: placeholder(env && env.BANK_ACCOUNT_NUMBER),
  };
}

function placeholder(value) {
  const text = String(value || '').trim();
  return text || '[PLACEHOLDER]';
}

function singleAddress(value) {
  const text = String(value || '').trim();
  if (!text || text.includes(',') || text.includes(';')) return null;
  const emails = text.match(/[^\s<>]+@[^\s<>]+/g) || [];
  if (emails.length !== 1) return null;
  return text;
}

// Owner mail goes to this one address. A list is refused so a secret cannot fan out.
export function ownerAddress(env) {
  return singleAddress(env && env.OWNER_EMAIL);
}

// Guest Reply-To. REPLY_TO wins; otherwise the single OWNER_EMAIL. Neither is hardcoded.
export function replyToAddress(env) {
  const explicit = String(env && env.REPLY_TO || '').trim();
  if (explicit) return singleAddress(explicit);
  return ownerAddress(env);
}

// Resend-style HTTP API. With no key, or a placeholder sender, this logs and does not send.
export async function sendEmail(env, message, fetchImpl = fetch) {
  const to = Array.isArray(message.to) ? message.to : [message.to];
  if (!emailConfigured(env) || to.some((address) => isPlaceholderAddress(address))) {
    console.log(JSON.stringify({
      event: 'email_dry_run',
      to,
      subject: message.subject,
      text: message.text,
    }));
    return { dryRun: true, ok: true };
  }

  const endpoint = String(env.EMAIL_API_URL || DEFAULT_EMAIL_API_URL).trim();
  const payload = {
    from: env.EMAIL_FROM,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  if (message.replyTo && !isPlaceholderAddress(message.replyTo)) payload.reply_to = message.replyTo;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      console.log(JSON.stringify({ event: 'email_failed', status: response.status, detail }));
      return { dryRun: false, ok: false, status: response.status };
    }
    return { dryRun: false, ok: true };
  } catch (error) {
    console.log(JSON.stringify({ event: 'email_failed', message: String(error && error.message || error) }));
    return { dryRun: false, ok: false };
  }
}
