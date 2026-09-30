# Villa prices

Published weekly and daily rates live in one file: [`data/prices.json`](../data/prices.json).

The About page and the booking page both read that file. Change a number there and both pages pick it up. Do not type prices into the HTML.

## What you can edit

- **A year's rates.** Each year lists a price per week and per day for the bands you want to publish. To change 2026, edit that year's `perWeek` and `perDay` values.
- **A new year.** Copy a year object, set `year`, and fill in each band. A band you leave out is omitted from that year's table. The published years are 2024, 2025, and 2026. 2026 uses the same weekly and daily amounts as 2025.
- **Extras.** Pool heat, cot, high chair, final cleaning, and the refundable security deposit are under `extras`. `balanceDueWeeksBefore` is the number of weeks before arrival when the balance is due.

Amounts are whole pounds. `currency` is `GBP`. The pages format them as £1,200.

## What stays fixed

The four date bands do not change from year to year:

| Band | Dates |
| --- | --- |
| `jan-apr` | 5 January – 30 April |
| `may-aug` | 1 May – 31 August |
| `sep-dec` | 1 September – 19 December |
| `dec-jan` | 20 December – 4 January (this band crosses the new year) |

Do not add, remove, or rename bands when you only need a price change. The `id`, `start`, and `end` fields (`MM-DD`) are what the booking quote uses to decide which band a night falls in.

A night uses the prices for that night's calendar year. 4 January and 31 December are both in the Dec 20–Jan 4 band, each at that calendar year's rate. If a year is not in the file, the quote does not guess a price.

## Pages

- About (`/about.html`) draws the 2024, 2025, and 2026 tables and the extras sentences from this file when JavaScript runs. The same three tables stay in the page as the no-JavaScript fallback. A normal browser only needs this file edited.
- The booking page (`/booking`) prices a stay with the rule in [BOOKING.md](BOOKING.md). Years that are not listed here are not given a guessed price.
