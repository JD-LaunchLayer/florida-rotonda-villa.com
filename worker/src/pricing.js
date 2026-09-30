import { villaRates } from './load-villa-rates.js';
import prices from '../../data/prices.json' with { type: 'json' };

// Same rule as the booking page: data/villa-rates.js buildQuote / priceStay.
// Whole 7-night blocks use the weekly rate of that block's check-in date.
// Leftover nights use each night's day rate. A missing year is not guessed.
export function computeQuote(arrival, departure, extras) {
  const checkIn = villaRates.parseISODate(arrival);
  const checkOut = villaRates.parseISODate(departure);
  return villaRates.buildQuote(prices, checkIn, checkOut, {
    poolHeat: !!(extras && extras.poolHeat),
    cot: !!(extras && extras.cot),
    highChair: !!(extras && extras.highChair),
  });
}

export function toBreakdown(quote) {
  const extraLines = quote.extraLines || [];
  const extrasTotal = extraLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  return {
    currency: 'GBP',
    nights: quote.nights,
    rentalLines: quote.rentalLines,
    missing: quote.missing,
    extraLines,
    rentalTotal: quote.rentalTotal,
    extrasTotal: quote.rentalTotal == null ? null : extrasTotal,
    cleaning: quote.cleaning,
    deposit: quote.deposit,
    depositRefundable: !!quote.depositRefundable,
    balanceDueWeeksBefore: quote.balanceDueWeeksBefore,
    totalToPay: quote.total,
    poolAvailable: !!(quote.pool && quote.pool.available),
  };
}

export function publishedPrices() {
  return prices;
}
