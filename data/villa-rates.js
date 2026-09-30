(function (global) {
  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatGBP(amount) {
    var n = Number(amount);
    if (!isFinite(n)) return '';
    return '£' + n.toLocaleString('en-GB');
  }

  function monthDayKey(date) {
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function bandWraps(band) {
    return band.start > band.end;
  }

  function bandForDate(bands, date) {
    var key = monthDayKey(date);
    for (var i = 0; i < bands.length; i++) {
      var band = bands[i];
      if (bandWraps(band)) {
        if (key >= band.start || key <= band.end) return band;
      } else if (key >= band.start && key <= band.end) {
        return band;
      }
    }
    return null;
  }

  function monthNameFromKey(key) {
    var month = Number(String(key).slice(0, 2));
    return MONTH_NAMES[month - 1] || '';
  }

  function loadPrices(url) {
    return fetch(url || '/data/prices.json', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load prices');
      return res.json();
    });
  }

  function yearRecord(prices, year) {
    var years = prices.years || [];
    for (var i = 0; i < years.length; i++) {
      if (Number(years[i].year) === Number(year)) return years[i];
    }
    return null;
  }

  function rateForNight(prices, date) {
    var band = bandForDate(prices.bands || [], date);
    var record = yearRecord(prices, date.getFullYear());
    var rate = band && record && record.rates ? record.rates[band.id] : null;
    return {
      date: date,
      year: date.getFullYear(),
      band: band,
      perDay: rate ? Number(rate.perDay) : null,
      perWeek: rate ? Number(rate.perWeek) : null
    };
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    var next = startOfDay(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function toISODate(date) {
    var day = startOfDay(date);
    return day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());
  }

  function parseISODate(iso) {
    var parts = String(iso).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function eachNight(checkIn, checkOut, fn) {
    if (!checkIn || !checkOut) return 0;
    var cursor = startOfDay(checkIn);
    var end = startOfDay(checkOut);
    var count = 0;
    while (cursor < end) {
      fn(new Date(cursor.getTime()), count);
      cursor.setDate(cursor.getDate() + 1);
      count += 1;
    }
    return count;
  }

  function rateMissing(rate, field) {
    return !rate || !rate.band || rate[field] == null || !isFinite(rate[field]);
  }

  function pushNightGroups(prices, start, count, lines, missing) {
    var group = null;
    var gap = null;
    var i;
    for (i = 0; i < count; i++) {
      var date = addDays(start, i);
      var rate = rateForNight(prices, date);
      if (rateMissing(rate, 'perDay')) {
        group = null;
        var gapYear = date.getFullYear();
        var gapBand = rate && rate.band ? rate.band.id : null;
        if (gap && gap.year === gapYear && gap.bandId === gapBand) {
          gap.nights += 1;
        } else {
          gap = {
            type: 'nights',
            date: toISODate(date),
            nights: 1,
            year: gapYear,
            bandId: gapBand,
            label: rate && rate.band ? rate.band.label : null
          };
          missing.push(gap);
        }
        continue;
      }
      gap = null;
      if (group && group.bandId === rate.band.id && group.year === rate.year && group.rate === rate.perDay) {
        group.nights += 1;
        group.amount += rate.perDay;
      } else {
        group = {
          type: 'nights',
          date: toISODate(date),
          nights: 1,
          year: rate.year,
          bandId: rate.band.id,
          label: rate.band.label,
          rate: rate.perDay,
          amount: rate.perDay
        };
        lines.push(group);
      }
    }
  }

  // Pricing rule (see docs/BOOKING.md):
  // Each night belongs to the band for that calendar date, priced from that
  // calendar year's rates in prices.json.
  // Stays under 7 nights: every night at that night's per-day rate.
  // Stays of 7 nights or more: whole 7-night blocks starting at check-in.
  // Each block uses the weekly rate of the band of that block's first night
  // (the block check-in date) and that date's year. Leftover nights use each
  // night's per-day rate. A rate the rule needs from a year that is not in
  // prices.json is not guessed: rentalTotal is null.
  function priceStay(prices, checkIn, checkOut) {
    var nights = eachNight(checkIn, checkOut, function () {});
    var lines = [];
    var missing = [];
    if (nights < 1) {
      return { nights: 0, lines: lines, missing: missing, rentalTotal: null };
    }

    if (nights >= 7) {
      var weeks = Math.floor(nights / 7);
      var leftover = nights % 7;
      var w;
      for (w = 0; w < weeks; w++) {
        var blockStart = addDays(checkIn, w * 7);
        var rate = rateForNight(prices, blockStart);
        if (rateMissing(rate, 'perWeek')) {
          missing.push({
            type: 'week',
            date: toISODate(blockStart),
            nights: 7,
            year: blockStart.getFullYear(),
            bandId: rate && rate.band ? rate.band.id : null,
            label: rate && rate.band ? rate.band.label : null
          });
        } else {
          lines.push({
            type: 'week',
            date: toISODate(blockStart),
            nights: 7,
            year: rate.year,
            bandId: rate.band.id,
            label: rate.band.label,
            rate: rate.perWeek,
            amount: rate.perWeek
          });
        }
      }
      if (leftover) pushNightGroups(prices, addDays(checkIn, weeks * 7), leftover, lines, missing);
    } else {
      pushNightGroups(prices, checkIn, nights, lines, missing);
    }

    var rentalTotal = null;
    if (!missing.length) {
      rentalTotal = 0;
      var n;
      for (n = 0; n < lines.length; n++) rentalTotal += lines[n].amount;
    }

    return {
      nights: nights,
      lines: lines,
      missing: missing,
      rentalTotal: rentalTotal
    };
  }

  function nightInPoolSeason(date, seasonStart, seasonEnd) {
    var key = monthDayKey(date);
    if (!seasonStart || !seasonEnd) return false;
    if (seasonStart <= seasonEnd) return key >= seasonStart && key <= seasonEnd;
    return key >= seasonStart || key <= seasonEnd;
  }

  // Pool heat is shown only when every night of the stay is inside the season
  // on extras.poolHeat (October–April, wrapping the new year). The charge is
  // the weekly amount divided by 7, times the number of nights, rounded to
  // whole pounds. A 7-night stay is one week; any other length is pro-rata.
  function poolHeatForStay(prices, checkIn, checkOut) {
    var pool = prices && prices.extras ? prices.extras.poolHeat : null;
    var weekly = pool && pool.amount != null ? Number(pool.amount) : null;
    var nightly = [];
    eachNight(checkIn, checkOut, function (date) { nightly.push(date); });
    var priced = weekly != null && isFinite(weekly);
    var available = !!(pool && priced && nightly.length && nightly.every(function (date) {
      return nightInPoolSeason(date, pool.seasonStart, pool.seasonEnd);
    }));
    return {
      available: available,
      nights: nightly.length,
      weekly: priced ? weekly : null,
      perNight: priced ? weekly / 7 : null,
      amount: available ? Math.round(nightly.length * weekly / 7) : 0,
      seasonStart: pool ? pool.seasonStart : null,
      seasonEnd: pool ? pool.seasonEnd : null,
      seasonStartLabel: pool ? monthNameFromKey(pool.seasonStart) : '',
      seasonEndLabel: pool ? monthNameFromKey(pool.seasonEnd) : ''
    };
  }

  function finiteAmount(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function buildQuote(prices, checkIn, checkOut, options) {
    options = options || {};
    var stay = priceStay(prices, checkIn, checkOut);
    var pool = poolHeatForStay(prices, checkIn, checkOut);
    var extras = (prices && prices.extras) || {};
    var extraLines = [];
    var extrasKnown = true;
    var extrasTotal = 0;

    function pushExtra(selected, amount, line) {
      if (!selected) return;
      if (amount == null) {
        extrasKnown = false;
        return;
      }
      line.amount = amount;
      extraLines.push(line);
      extrasTotal += amount;
    }

    if (options.poolHeat && pool.available) {
      pushExtra(true, pool.amount, {
        id: 'poolHeat',
        label: 'Pool heat',
        nights: pool.nights,
        perNight: pool.perNight,
        weekly: pool.weekly
      });
    }
    pushExtra(!!options.cot, finiteAmount(extras.cot && extras.cot.amount), { id: 'cot', label: 'Cot hire' });
    pushExtra(!!options.highChair, finiteAmount(extras.highChair && extras.highChair.amount), { id: 'highChair', label: 'High chair hire' });

    var cleaning = finiteAmount(extras.finalCleaning && extras.finalCleaning.amount);
    var deposit = finiteAmount(extras.securityDeposit && extras.securityDeposit.amount);
    if (cleaning == null) extrasKnown = false;

    var total = null;
    if (stay.rentalTotal != null && extrasKnown) {
      total = stay.rentalTotal + extrasTotal + cleaning;
    }

    return {
      nights: stay.nights,
      rentalLines: stay.lines,
      missing: stay.missing,
      rentalTotal: stay.rentalTotal,
      pool: pool,
      extraLines: extraLines,
      cleaning: cleaning,
      deposit: deposit,
      depositRefundable: !!(extras.securityDeposit && extras.securityDeposit.refundable),
      balanceDueWeeksBefore: prices ? prices.balanceDueWeeksBefore : null,
      total: total
    };
  }

  // A booked range is check-in inclusive, check-out exclusive. The check-out
  // morning is free, including when it is another guest's check-in.
  function nightIsBooked(ranges, date) {
    var iso = toISODate(date);
    var list = ranges || [];
    var i;
    for (i = 0; i < list.length; i++) {
      var range = list[i] || {};
      var start = range.checkIn || range.start;
      var end = range.checkOut || range.end;
      if (start && end && iso >= start && iso < end) return true;
    }
    return false;
  }

  function stayHitsBookedNight(ranges, checkIn, checkOut) {
    var hit = false;
    eachNight(checkIn, checkOut, function (date) {
      if (nightIsBooked(ranges, date)) hit = true;
    });
    return hit;
  }

  function cell(text) {
    return '<td class="cell"><div class="paragraph">' + text + '</div></td>';
  }

  function renderTables(prices) {
    var bands = prices.bands || [];
    var years = (prices.years || []).slice().sort(function (a, b) {
      return Number(a.year) - Number(b.year);
    });
    var html = '';
    for (var y = 0; y < years.length; y++) {
      var record = years[y];
      var rows = '';
      for (var b = 0; b < bands.length; b++) {
        var band = bands[b];
        var rate = record.rates && record.rates[band.id];
        if (!rate) continue;
        rows += '<tr>' +
          cell(band.label) +
          cell(formatGBP(rate.perWeek) + '<br />') +
          cell(formatGBP(rate.perDay) + '<br />') +
          '</tr>';
      }
      html += '<div class="simple-table-wrapper"><table class="simple-table style-top">' +
        '<tr>' +
        cell(String(record.year) + '<br />') +
        cell('per week') +
        cell('per day') +
        '</tr>' +
        rows +
        '</table></div>';
    }
    return html;
  }

  function renderExtras(prices) {
    var extras = prices.extras || {};
    var pool = extras.poolHeat || {};
    var cot = extras.cot || {};
    var chair = extras.highChair || {};
    var cleaning = extras.finalCleaning || {};
    var deposit = extras.securityDeposit || {};
    var weeks = prices.balanceDueWeeksBefore;
    var seasonStart = monthNameFromKey(pool.seasonStart);
    var seasonEnd = monthNameFromKey(pool.seasonEnd);

    return '<div class="paragraph">' +
      '<span style="color:rgb(0, 0, 0)">Pool heat is optional and is charged at ' +
      formatGBP(pool.amount) + ' per week if requested at the time of booking, this is only needed between ' +
      seasonStart + ' and ' + seasonEnd +
      '. For your convenience we offer a variety of payment methods.&nbsp;</span>' +
      '<span style="color:rgb(0, 0, 0)">&nbsp;A security deposit of ' + formatGBP(deposit.amount) +
      ' is required along with the final balance ' + weeks +
      ' weeks prior to arrival. The security deposit is fully refundable pending an inspection from our management company.<br />' +
      'Cot hire is ' + formatGBP(cot.amount) + ' per stay.<br />' +
      'High Chair hire is ' + formatGBP(chair.amount) + ' per stay.<br /><br />' +
      'There is a final cleaning fee of ' + formatGBP(cleaning.amount) + '.</span><br /></div>';
  }

  function renderAbout(root, prices) {
    var live = root.querySelector('[data-villa-rates-live]');
    var fallback = root.querySelector('[data-villa-rates-fallback]');
    if (!live) return;
    live.innerHTML = renderExtras(prices) + renderTables(prices);
    live.classList.remove('villa-rates-off');
    if (fallback) fallback.classList.add('villa-rates-off');
  }

  var api = {
    formatGBP: formatGBP,
    bandForDate: bandForDate,
    loadPrices: loadPrices,
    rateForNight: rateForNight,
    priceStay: priceStay,
    poolHeatForStay: poolHeatForStay,
    buildQuote: buildQuote,
    nightIsBooked: nightIsBooked,
    stayHitsBookedNight: stayHitsBookedNight,
    parseISODate: parseISODate,
    toISODate: toISODate,
    renderAbout: renderAbout
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  global.VillaRates = api;
})(typeof window !== 'undefined' ? window : globalThis);
