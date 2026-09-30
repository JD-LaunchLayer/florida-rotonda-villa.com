const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const VillaRates = require('../data/villa-rates.js');

const prices = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/prices.json'), 'utf8'));
const availability = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/availability.json'), 'utf8'));

function d(iso) {
  return VillaRates.parseISODate(iso);
}

function stay(checkIn, checkOut, source) {
  return VillaRates.priceStay(source || prices, d(checkIn), d(checkOut));
}

function rental(checkIn, checkOut, source) {
  return stay(checkIn, checkOut, source).rentalTotal;
}

test('band edges use the published month-day boundaries', () => {
  function bandId(iso) {
    return VillaRates.bandForDate(prices.bands, d(iso)).id;
  }
  assert.equal(bandId('2026-01-04'), 'dec-jan');
  assert.equal(bandId('2026-01-05'), 'jan-apr');
  assert.equal(bandId('2026-04-30'), 'jan-apr');
  assert.equal(bandId('2026-05-01'), 'may-aug');
  assert.equal(bandId('2026-08-31'), 'may-aug');
  assert.equal(bandId('2026-09-01'), 'sep-dec');
  assert.equal(bandId('2026-12-19'), 'sep-dec');
  assert.equal(bandId('2026-12-20'), 'dec-jan');
});

test('seven nights are one weekly block at the check-in date band', () => {
  assert.equal(rental('2026-01-04', '2026-01-11'), 1200);
  assert.equal(rental('2026-01-05', '2026-01-12'), 900);
  assert.equal(rental('2026-04-30', '2026-05-07'), 900);
  assert.equal(rental('2026-05-01', '2026-05-08'), 800);
  assert.equal(rental('2026-08-31', '2026-09-07'), 800);
  assert.equal(rental('2026-09-01', '2026-09-08'), 850);
  assert.equal(rental('2026-12-19', '2026-12-26'), 850);
  assert.equal(rental('2026-12-20', '2026-12-27'), 1200);

  const janEdge = stay('2026-01-04', '2026-01-11');
  assert.equal(janEdge.lines.length, 1);
  assert.equal(janEdge.lines[0].type, 'week');
  assert.equal(janEdge.lines[0].bandId, 'dec-jan');
  assert.equal(janEdge.lines[0].amount, 1200);
});

test('ten nights are one week plus three per-day nights', () => {
  const quote = stay('2026-01-05', '2026-01-15');
  assert.equal(quote.nights, 10);
  assert.equal(quote.lines.length, 2);
  assert.equal(quote.lines[0].type, 'week');
  assert.equal(quote.lines[0].amount, 900);
  assert.equal(quote.lines[1].type, 'nights');
  assert.equal(quote.lines[1].nights, 3);
  assert.equal(quote.lines[1].rate, 129);
  assert.equal(quote.rentalTotal, 900 + 129 * 3);

  const crossing = stay('2026-04-30', '2026-05-10');
  assert.equal(crossing.lines[0].bandId, 'jan-apr');
  assert.equal(crossing.lines[0].amount, 900);
  assert.equal(crossing.lines[1].bandId, 'may-aug');
  assert.equal(crossing.lines[1].nights, 3);
  assert.equal(crossing.lines[1].rate, 114);
  assert.equal(crossing.rentalTotal, 900 + 114 * 3);
});

test('fourteen nights are two week blocks, including a band change', () => {
  const sameBand = stay('2026-01-05', '2026-01-19');
  assert.equal(sameBand.nights, 14);
  assert.equal(sameBand.lines.length, 2);
  assert.equal(sameBand.lines[0].type, 'week');
  assert.equal(sameBand.lines[1].type, 'week');
  assert.equal(sameBand.rentalTotal, 1800);

  const crossing = stay('2026-08-25', '2026-09-08');
  assert.equal(crossing.lines[0].date, '2026-08-25');
  assert.equal(crossing.lines[0].bandId, 'may-aug');
  assert.equal(crossing.lines[0].amount, 800);
  assert.equal(crossing.lines[1].date, '2026-09-01');
  assert.equal(crossing.lines[1].bandId, 'sep-dec');
  assert.equal(crossing.lines[1].amount, 850);
  assert.equal(crossing.rentalTotal, 1650);
});

test('shorter than a week uses each night band, including band edges', () => {
  assert.equal(rental('2026-05-01', '2026-05-02'), 114);
  assert.equal(rental('2026-05-01', '2026-05-07'), 114 * 6);

  const spring = stay('2026-04-29', '2026-05-02');
  assert.equal(spring.nights, 3);
  assert.deepEqual(spring.lines.map((line) => line.bandId), ['jan-apr', 'may-aug']);
  assert.equal(spring.rentalTotal, 129 + 129 + 114);

  const christmas = stay('2026-12-19', '2026-12-21');
  assert.equal(christmas.lines[0].bandId, 'sep-dec');
  assert.equal(christmas.lines[0].nights, 1);
  assert.equal(christmas.lines[1].bandId, 'dec-jan');
  assert.equal(christmas.rentalTotal, 122 + 171);
});

test('a week that starts in a published year does not invent the next year', () => {
  assert.equal(rental('2026-12-28', '2027-01-04'), 1200);
  const overflow = stay('2026-12-28', '2027-01-05');
  assert.equal(overflow.nights, 8);
  assert.equal(overflow.rentalTotal, null);
  assert.ok(overflow.missing.some((item) => item.year === 2027));
});

test('a year with no published rates has no total', () => {
  const quote = stay('2027-04-01', '2027-04-08');
  assert.equal(quote.nights, 7);
  assert.equal(quote.rentalTotal, null);
  assert.equal(quote.missing[0].year, 2027);
  assert.equal(rental('2023-06-01', '2023-06-08'), null);
});

test('pool heat follows the published season and rounds pro-rata nights', () => {
  function pool(checkIn, checkOut, source) {
    return VillaRates.poolHeatForStay(source || prices, d(checkIn), d(checkOut));
  }

  const week = pool('2026-10-01', '2026-10-08');
  assert.equal(week.available, true);
  assert.equal(week.amount, 126);

  const ten = pool('2026-10-01', '2026-10-11');
  assert.equal(ten.available, true);
  assert.equal(ten.amount, 180);

  const three = pool('2026-10-01', '2026-10-04');
  assert.equal(three.available, true);
  assert.equal(three.amount, 54);

  assert.equal(pool('2026-04-24', '2026-05-01').available, true);
  assert.equal(pool('2026-04-24', '2026-05-01').amount, 126);
  assert.equal(pool('2026-04-25', '2026-05-02').available, false);
  assert.equal(pool('2026-09-30', '2026-10-07').available, false);
  assert.equal(pool('2026-05-01', '2026-05-08').available, false);
  assert.equal(pool('2026-01-10', '2026-01-17').available, true);
  assert.equal(pool('2026-12-20', '2027-01-03').available, true);
  assert.equal(pool('2026-12-20', '2027-01-03').amount, 252);

  const custom = JSON.parse(JSON.stringify(prices));
  custom.extras.poolHeat.amount = 100;
  assert.equal(pool('2026-01-10', '2026-01-11', custom).amount, 14);
  assert.equal(pool('2026-01-10', '2026-01-13', custom).amount, 43);
  assert.equal(pool('2026-01-10', '2026-01-18', custom).amount, 114);
});

test('the quote total adds chosen extras and cleaning and leaves the deposit out', () => {
  const quoted = VillaRates.buildQuote(prices, d('2026-10-01'), d('2026-10-11'), {
    poolHeat: true,
    cot: true,
    highChair: true
  });
  assert.equal(quoted.rentalTotal, 850 + 122 * 3);
  assert.equal(quoted.cleaning, 120);
  assert.equal(quoted.deposit, 300);
  assert.equal(quoted.total, 850 + 366 + 180 + 20 + 20 + 120);
  assert.equal(quoted.total, quoted.rentalTotal + 180 + 20 + 20 + quoted.cleaning);

  const summer = VillaRates.buildQuote(prices, d('2026-05-01'), d('2026-05-08'), { poolHeat: true });
  assert.equal(summer.pool.available, false);
  assert.equal(summer.extraLines.length, 0);
  assert.equal(summer.total, 800 + 120);

  const unpriced = VillaRates.buildQuote(prices, d('2027-04-01'), d('2027-04-08'), { cot: true });
  assert.equal(unpriced.rentalTotal, null);
  assert.equal(unpriced.total, null);
});

test('availability is the February 2027 block only, and checkout mornings are free', () => {
  assert.deepEqual(availability.ranges, [
    { checkIn: '2027-02-01', checkOut: '2027-04-01' }
  ]);
  const ranges = availability.ranges;
  assert.equal(VillaRates.nightIsBooked(ranges, d('2027-02-01')), true);
  assert.equal(VillaRates.nightIsBooked(ranges, d('2027-03-31')), true);
  assert.equal(VillaRates.nightIsBooked(ranges, d('2027-04-01')), false);
  assert.equal(VillaRates.nightIsBooked(ranges, d('2027-01-31')), false);
  assert.equal(VillaRates.stayHitsBookedNight(ranges, d('2027-01-25'), d('2027-02-01')), false);
  assert.equal(VillaRates.stayHitsBookedNight(ranges, d('2027-01-31'), d('2027-02-02')), true);
  assert.equal(VillaRates.stayHitsBookedNight(ranges, d('2027-04-01'), d('2027-04-08')), false);
});
