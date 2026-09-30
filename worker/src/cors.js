const PRODUCTION_ORIGINS = [
  'https://florida-rotonda-villa.com',
  'https://www.florida-rotonda-villa.com',
  'https://florida-rotonda-villa.co.uk',
  'https://www.florida-rotonda-villa.co.uk',
];

export function isAllowedOrigin(origin, env) {
  if (!origin || typeof origin !== 'string') return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (PRODUCTION_ORIGINS.includes(origin)) return true;

  const slug = String(env && env.NETLIFY_SITE_SLUG || 'florida-rotonda-villa').trim();
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'https:' && slug && (host === `${slug}.netlify.app` || host.endsWith(`--${slug}.netlify.app`))) {
    return true;
  }

  const extras = String(env && env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (extras.includes(origin)) return true;

  const allowLocal = String(env && env.ALLOW_LOCALHOST || '').toLowerCase() === 'true';
  if (allowLocal && url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return true;
  return false;
}

export function corsHeaders(origin, env) {
  const headers = { Vary: 'Origin' };
  if (!isAllowedOrigin(origin, env)) return headers;
  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  headers['Access-Control-Max-Age'] = '86400';
  return headers;
}
