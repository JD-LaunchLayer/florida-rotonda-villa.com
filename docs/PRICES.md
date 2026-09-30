# Villa prices

Published weekly and daily rates live in one file: [`data/prices.json`](../data/prices.json).

The About page and the booking demo both read that file. Change a number there and both pages pick it up. Do not type prices into the HTML.

## What you can edit

- **A year's rates.** Each year lists a price per week and per day for the bands you want to publish. To change 2025, edit that year's `perWeek` and `perDay` values.
- **A new year.** Copy a year object, set `year`, and fill in the bands you want to show. A band you leave out is omitted from that year's table. 2023 is the example: it has no Jan 5–Apr 30 row, and its Dec 20–Jan 4 rate differs from later years.
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

- About (`/about.html`) draws the year tables and the extras sentences from this file when JavaScript runs. The tables already in the page stay as the no-JavaScript fallback, so a normal browser only needs this file edited.
- The booking demo (`/booking-demo.html`) uses the per-day rate for each night. It is a rough quote. The final price is confirmed by the owner. Years that are not listed here are not given a guessed price.
