# Booking page

`/booking` is the on-site booking page. The file lives at `booking.html/index.html`, which is how the other exported pages are stored. `booking/index.html` is the same file for local preview. On Netlify, `netlify.toml` rewrites `/booking` and `/booking/` to that file with status 200, and redirects `/booking.html`, `/booking.html/`, and `/booking-demo.html` to `/booking`. Nav and BOOK NOW links use `/booking`.

The request form posts to the villa booking API. See [BACKEND.md](BACKEND.md). It does not confirm a reservation: the owner confirms, and the dates are held for 72 hours while the request is pending. The contact page still posts to Web3Forms.

## Availability

The calendar reads live ranges from `GET /api/availability`. The API base URL is [`data/booking-api.json`](../data/booking-api.json). If that file has no URL, or the API cannot be reached, the calendar uses [`data/availability.json`](../data/availability.json).

Booked stays are check-in and check-out dates (`YYYY-MM-DD`).

- The check-in date is the first occupied night.
- The check-out date is the departure morning. That night is not occupied, so another guest can check in the same day.
- A guest can also check out on a morning that is someone else's check-in. The overlap check looks at nights only.

The static file's only booked range is check-in 1 February 2027, check-out 1 April 2027. Nights of 1 February through 31 March 2027 are booked. 1 April 2027 is a valid check-in. There are no sample ranges. The live API adds pending and confirmed requests on top of that block.

Any arrival weekday is allowed. The minimum stay is 1 night.

## Pricing rule

The page reads prices only from [`data/prices.json`](../data/prices.json). Amounts are not written into the page.

A stay runs from check-in (inclusive) to check-out (exclusive).

1. Count the nights.
2. If the stay is shorter than 7 nights, charge each night at that night's per-day rate. The night uses the band for its calendar date and the rates for its calendar year.
3. If the stay is 7 nights or longer, take whole 7-night blocks starting on the check-in date. Each block is charged the **weekly** rate of the band that contains that block's first night, using that date's calendar year. Nights inside the block are not priced on their own, even when they fall in another band or another year. Leftover nights after the last whole block use each night's own per-day rate.
4. If a weekly or per-day rate this rule needs is missing — that year is not listed, or that band has no rate — the page shows **no total**. The owner confirms the price. A rate is never copied from another year.

Worked examples use the published 2026 rates:

| Stay | How it is priced |
| --- | --- |
| 7 nights from 4 January 2026 | One week at the Dec 20–Jan 4 weekly rate (£1,200), including 5–10 January |
| 7 nights from 5 January 2026 | One week at the Jan 5–Apr 30 weekly rate (£900) |
| 7 nights from 30 April 2026 | One week at the Jan 5–Apr 30 weekly rate (£900), including 1–6 May |
| 7 nights from 1 May 2026 | One week at the May 1–Aug 31 weekly rate (£800) |
| 7 nights from 31 August 2026 | One week at the May 1–Aug 31 weekly rate (£800), including 1–6 September |
| 7 nights from 1 September 2026 | One week at the Sep 1–Dec 19 weekly rate (£850) |
| 7 nights from 19 December 2026 | One week at the Sep 1–Dec 19 weekly rate (£850), including 20–25 December |
| 7 nights from 20 December 2026 | One week at the Dec 20–Jan 4 weekly rate (£1,200) |
| 10 nights from 5 January 2026 | One week at £900, then 3 nights at £129 |
| 14 nights from 25 August 2026 | Week of 25 August at £800, week of 1 September at £850 |
| 7 nights from 28 December 2026 | One week at the 2026 Dec 20–Jan 4 weekly rate (£1,200). January 2027 is inside the block and is not given its own rate |
| 8 nights from 28 December 2026 | The extra night is 4 January 2027, which has no published rate, so there is no total |

A stay that falls in a year with no rates, such as 2027, has no total.

### Pool heat and other charges

Pool heat uses `extras.poolHeat`. It is offered only when **every night** of the stay is inside the season (`seasonStart` through `seasonEnd`, currently 1 October through 30 April, wrapping the new year). A stay that includes a night outside that season does not show the option.

The charge is `round(nights × weekly amount ÷ 7)` to whole pounds. Seven nights is one week. Any other length is pro-rata by night. With the published £126 weekly amount, that is £18 a night.

Cot hire and high chair hire are once per stay, from `extras.cot` and `extras.highChair`. Final cleaning (`extras.finalCleaning`) is always included. The security deposit (`extras.securityDeposit`) is shown on its own and is not added to the total to pay. The balance-due wording uses `balanceDueWeeksBefore`.

## Tests

```bash
TZ=UTC node --test tests/price-stay.test.js tests/booking-page.test.js worker/test/backend.test.js
```
