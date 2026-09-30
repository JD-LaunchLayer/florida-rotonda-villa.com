# Booking API

The booking page sends requests to a Cloudflare Worker, `florida-rotonda-villa-api`, backed by its own D1 database, `florida-rotonda-villa-db`. The Worker lives in [`worker/`](../worker). This site does not share that Worker or database with any other project.

Guests can request any arrival weekday. The API saves the request as `pending`, holds the nights for 72 hours, and the calendar reads those holds back. A check-out morning is free for the next guest's check-in. The owner approval screen is a later change. `confirmBooking()` in `worker/src/db.js` is internal and is covered by tests. There is no public approve or reject URL.

## What you deploy

From `worker/`, after the steps below:

```bash
npx wrangler deploy
```

That publishes the Worker, the D1 binding, and an hourly cron (`0 * * * *`). The static site stays on Netlify.

The Cloudflare account's workers.dev subdomain is `rotonda-villa`. Confirm it in the dashboard under Workers & Pages → Settings → workers.dev subdomain before the first deploy. With `"workers_dev": true` in `worker/wrangler.jsonc`, Wrangler publishes to `https://<worker-name>.<subdomain>.workers.dev`. For this Worker that URL is:

`https://florida-rotonda-villa-api.rotonda-villa.workers.dev`

[`data/booking-api.json`](../data/booking-api.json) already points at that URL, with no trailing slash:

```json
{ "baseUrl": "https://florida-rotonda-villa-api.rotonda-villa.workers.dev" }
```

Deploy the static site as usual so `/booking` picks up the file. If `baseUrl` is emptied, `/booking` falls back to `data/availability.json` and the form explains that the booking service is not connected. The contact page still posts to Web3Forms.

## First-time setup

The remote database and the first deploy already exist. `worker/wrangler.jsonc` binds `DB` to `florida-rotonda-villa-db` with database id `a760105a-f7d8-48d5-8f21-4a5290fef7b8`. Migration `0001_init.sql` is applied on that remote database. Keep a single D1 binding named `DB`. Wrangler sometimes inserts a second binding, `florida_rotonda_villa_db`, for the same database; delete that entry so only `DB` remains, then redeploy.

To recreate this on a new account:

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create florida-rotonda-villa-db
```

Register or confirm the workers.dev subdomain (`rotonda-villa` on this account) before `wrangler deploy`, or the `workers.dev` URL will not match `data/booking-api.json`. Copy the `database_id` from `d1 create` into the `DB` binding in `worker/wrangler.jsonc`. Then apply the migration to the remote database:

```bash
npx wrangler d1 migrations apply florida-rotonda-villa-db --remote
```

Check the seeded block. It should be 59 nights (1 February 2027 through 31 March 2027). 1 April 2027 is not occupied.

```bash
npx wrangler d1 execute florida-rotonda-villa-db --remote \
  --command "SELECT COUNT(*) AS nights FROM occupied_nights WHERE source = 'block';"
```

Deploy:

```bash
npx wrangler deploy
```

`npx wrangler types` regenerates `worker/worker-configuration.d.ts` after config changes. That file is gitignored.

Local migration check (still not the remote database):

```bash
npx wrangler d1 migrations apply florida-rotonda-villa-db --local
```

## Secrets and variables

Nothing secret belongs in the repo. `worker/wrangler.jsonc` holds the database id and non-secret vars. Bank details and the email API key stay in Worker secrets.

| Name | How to set it | Placeholder behaviour |
| --- | --- | --- |
| `EMAIL_API_KEY` | `npx wrangler secret put EMAIL_API_KEY` | If this is missing, every email is logged as `email_dry_run` and nothing is sent. |
| `EMAIL_FROM` | `npx wrangler secret put EMAIL_FROM` | The committed var is `Florida Rotonda Villa <bookings@example.com>`. A sender containing `example.com` does not send. Use a verified address such as `Florida Rotonda Villa <bookings@your-domain>`. |
| `OWNER_EMAIL` | `npx wrangler secret put OWNER_EMAIL` | The committed var is `owner@example.com`. Mail to that address is logged, not sent. A secret overrides the var. |
| `BANK_ACCOUNT_NAME` | `npx wrangler secret put BANK_ACCOUNT_NAME` | Empty becomes `[PLACEHOLDER]` in the email body. |
| `BANK_SORT_CODE` | `npx wrangler secret put BANK_SORT_CODE` | Empty becomes `[PLACEHOLDER]`. |
| `BANK_ACCOUNT_NUMBER` | `npx wrangler secret put BANK_ACCOUNT_NUMBER` | Empty becomes `[PLACEHOLDER]`. |
| `EMAIL_API_URL` | optional secret | Defaults to `https://api.resend.com/emails`. The body is Resend-shaped: `from`, `to`, `subject`, `text`, `html`, `reply_to`. |
| `NETLIFY_SITE_SLUG` | var in `wrangler.jsonc` | `floridarotondavillacom`, the Netlify site name from the deploy-preview host. Change it if that name differs, then redeploy. |
| `ALLOWED_ORIGINS` | var in `wrangler.jsonc` | Extra exact origins, comma-separated. The committed value lists both production domains and their `www` hosts. |
| `PROPERTY_TIMEZONE` | var | `America/New_York`. "Today" for check-in uses this zone. |
| `REMINDER_TIMEZONE` | var | `Europe/London`. The balance reminder uses this calendar date. |
| `ALLOW_LOCALHOST` | `worker/.dev.vars` only | Set to `true` for local preview. It is not in the production vars. |

Copy `worker/.dev.vars.example` to `worker/.dev.vars` for `npx wrangler dev`. `.dev.vars` is gitignored.

Leave `EMAIL_API_KEY` unset until `EMAIL_FROM` and `OWNER_EMAIL` are real. With a key and an `example.com` sender, the Worker still dry-runs.

Do not put real bank details in `wrangler.jsonc`, source, or this file. Set them with `wrangler secret put` when the account is ready. Confirmation and balance emails print whatever those secrets are, or `[PLACEHOLDER]`.

## HTTP API

CORS allows:

- `https://florida-rotonda-villa.com` and `https://www.florida-rotonda-villa.com`
- `https://florida-rotonda-villa.co.uk` and `https://www.florida-rotonda-villa.co.uk`
- `https://floridarotondavillacom.netlify.app`
- deploy and branch previews such as `https://deploy-preview-5--floridarotondavillacom.netlify.app`
- the earlier slug `florida-rotonda-villa` on `*.netlify.app`, in case a preview still uses it
- origins listed in `ALLOWED_ORIGINS`
- `http://localhost` and `http://127.0.0.1` only when `ALLOW_LOCALHOST=true`

`GET /api/health` returns `{ "ok": true }`.

`GET /api/availability` returns `{ "ranges": [{ "checkIn", "checkOut" }] }`. Pending and confirmed bookings are included. Guest names, email, phone, and messages are not. Responses send `Cache-Control: no-store`.

`POST /api/bookings` accepts JSON:

```json
{
  "arrival": "2026-10-01",
  "departure": "2026-10-08",
  "guests": 2,
  "extras": { "poolHeat": true, "cot": false, "highChair": false },
  "firstName": "Ada",
  "lastName": "Guest",
  "email": "ada@guest.test",
  "phone": "",
  "message": "",
  "termsAccepted": true,
  "botcheck": ""
}
```

The server recomputes the price from `data/prices.json` and `data/villa-rates.js` bundled into the Worker. A total sent by the browser is ignored. The rule matches the booking page: whole 7-night blocks at the weekly rate of that block's check-in date, leftover nights at each night's day rate. Pool heat is £126 a week from October through April, pro-rata by night (`round(nights × weekly / 7)`, which is £18 a night at the published amount) and only when every night is in season. Cot and high chair are once per stay. Final cleaning is included. The refundable deposit is stored separately and is not part of `totalToPay`. A year with no published rate is accepted with `totalToPay: null`; the emails say the owner will confirm the price.

Stays are 1 to 112 nights. Check-in cannot be in the past in `America/New_York`, and cannot be more than 24 months ahead. Guests are 1 to 6.

A hidden `botcheck` or `website` field that is filled in gets `{ "ok": true }` and is not saved. Posts are limited to 8 per IP per hour. Availability reads are limited to 120 per IP per hour. The IP is `CF-Connecting-IP`, stored only as a hash prefix.

Overlapping a pending booking, a confirmed booking, or the blocked February 2027 range returns 409 `dates_unavailable`. The insert of occupied nights is one D1 batch, and `occupied_nights.night` is the primary key, so two simultaneous requests cannot take the same night. A departure date equal to another arrival date does not overlap.

Success is `201` with `id` (for example `FRV-1A2B3C4D`), `status: "pending"`, `expiresAt`, and the server totals. The page shows that reference, or a clear error when the dates were just taken.

## Emails

The module is `worker/src/email.js`. It POSTs to a Resend-style endpoint. With no API key, or a placeholder sender or recipient, it logs `{ "event": "email_dry_run", "to", "subject", "text" }` and does not call the network.

Sent today:

- Guest: request received, including the reference, dates, price breakdown, and the 72-hour hold. No bank details.
- Owner: the same request, plus the guest's phone and message.

Prepared for later, and used by tests and by `confirmBookingAndEmail()`:

- Confirmation invoice, plain text and simple HTML, all in the body. Reference, dates, itemised GBP lines, the refundable deposit to be paid first by bank transfer, the balance due 6 weeks before arrival, and the bank lines. A copy goes to the owner.
- Balance reminder 7 weeks before arrival, with a copy to the owner. The cron claims `balance_reminder_sent_at` before sending. A failed guest send clears the flag so the next run can retry. A second successful run does not send again.

There is no PDF.

## Cron

The hourly cron does two jobs:

1. Sets `pending` bookings with `expires_at <= now` to `expired` and deletes their occupied nights. The same expiry also runs at the start of availability and booking requests, so the calendar does not wait for the hour.
2. Finds `confirmed` bookings whose arrival is exactly 49 days after today's date in `Europe/London` and whose reminder flag is empty, then sends the balance reminder once.

A day the cron misses is not backfilled. The reminder is exactly 7 weeks out, not "7 weeks or later".

## Data

`worker/migrations/0001_init.sql` creates `bookings`, `blocked_ranges`, `occupied_nights`, and `rate_limits`. Status values are `pending`, `confirmed`, `rejected`, `expired`, and `cancelled`. This change only writes `pending`, `confirmed` (via the internal confirm function), and `expired`. Rejected and cancelled are reserved for the approval change. That change must delete `occupied_nights` for a booking it releases.

`expires_at` is `created_at` plus 72 hours. The hold ends at that instant.

The published block is inserted by the migration. Editing `data/availability.json` later does not change D1. Add a new migration for further blocked ranges, and keep the static file in step so the fallback matches. A price change in `data/prices.json` is picked up by the page immediately and by the API only after the Worker is redeployed.

## Tests

```bash
TZ=UTC node --test tests/price-stay.test.js tests/booking-page.test.js worker/test/backend.test.js
```

The API tests use Node's built-in SQLite and the same SQL file. They cover pricing parity with the page, same-day turnover, the blocked range, expiry at 72 hours, reminder selection, the invoice placeholders, rate limiting, and CORS. Node may print an experimental SQLite warning.

## Deployed

The Worker is published at `https://florida-rotonda-villa-api.rotonda-villa.workers.dev`. Remote D1 id `a760105a-f7d8-48d5-8f21-4a5290fef7b8` has migration `0001` applied. A redeploy is required after changing `NETLIFY_SITE_SLUG` or `ALLOWED_ORIGINS`; the allow-list is compiled into the running Worker only when Wrangler uploads it.

## Not tested against real Cloudflare

- The cron trigger firing on Cloudflare's scheduler
- A live email provider, DNS for the sender, and delivery to a real inbox
- A booking submitted from the production domains or the Netlify deploy preview in a browser (the allow-list is unit tested, and preflight checks can be run with curl against the workers.dev URL)
- Custom domains on the Worker, and dashboard logs
