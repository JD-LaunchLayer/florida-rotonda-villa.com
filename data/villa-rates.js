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

  function quoteStay(prices, checkIn, checkOut) {
    var nights = [];
    var cursor = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
    var end = new Date(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate());
    while (cursor < end) {
      nights.push(rateForNight(prices, new Date(cursor.getTime())));
      cursor.setDate(cursor.getDate() + 1);
    }

    var groups = [];
    var missing = [];
    var total = 0;
    for (var i = 0; i < nights.length; i++) {
      var night = nights[i];
      if (night.perDay == null || !night.band) {
        missing.push(night);
        continue;
      }
      total += night.perDay;
      var prev = groups[groups.length - 1];
      if (prev && prev.bandId === night.band.id && prev.year === night.year && prev.perDay === night.perDay) {
        prev.nights += 1;
      } else {
        groups.push({
          bandId: night.band.id,
          label: night.band.label,
          year: night.year,
          perDay: night.perDay,
          nights: 1
        });
      }
    }

    return {
      nights: nights.length,
      groups: groups,
      missing: missing,
      total: missing.length ? null : total
    };
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

  global.VillaRates = {
    formatGBP: formatGBP,
    bandForDate: bandForDate,
    loadPrices: loadPrices,
    rateForNight: rateForNight,
    quoteStay: quoteStay,
    renderAbout: renderAbout
  };
})(window);
