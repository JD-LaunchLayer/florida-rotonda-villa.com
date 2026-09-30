const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

const pages = [
  'index.html',
  '404.html',
  'about.html/index.html',
  'contact.html/index.html',
  'facilities.html/index.html',
  'gallery.html/index.html',
  'testimonials.html/index.html',
  'terms-and-conditions.html/index.html',
  't--cs.html/index.html',
  'booking.html/index.html'
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function menus(html) {
  return [...html.matchAll(/<ul class="wsite-menu-default">([\s\S]*?)<\/ul>/g)].map((match) => {
    return [...match[1].matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((link) => {
      const label = link[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      return label + '|' + link[1];
    });
  });
}

const expected = [
  'Home|/',
  'About|/about.html',
  'Facilities|/facilities.html',
  'Gallery|/gallery.html',
  'Testimonials|/testimonials.html',
  'Contact|/contact.html',
  'Book|/booking',
  "T & C's|/t--cs.html"
];

test('every page nav lists the same links in the same order', () => {
  for (const page of pages) {
    const found = menus(read(page));
    assert.ok(found.length >= 2, page + ' should have desktop and mobile menus');
    // 404.html stays a copy of the home page until a later change, so its Book link is unchanged.
    const want = page === '404.html'
      ? expected.map((item) => item === 'Book|/booking' ? 'Book|/booking.html' : item)
      : expected;
    for (const menu of found) {
      assert.deepEqual(menu, want, page);
    }
  }
});

test('netlify serves /booking as the booking page', () => {
  const config = read('netlify.toml');
  assert.match(config, /from = "\/booking"\s+to = "\/booking\.html\/index\.html"\s+status = 200/s);
  assert.match(config, /from = "\/booking\/"\s+to = "\/booking\.html\/index\.html"\s+status = 200/s);
  assert.match(config, /from = "\/booking\.html"\s+to = "\/booking"\s+status = 301/s);
  assert.match(config, /from = "\/booking-demo\.html"\s+to = "\/booking"\s+status = 301/s);
});

test('booking page is indexable and the old demo is only a redirect', () => {
  const booking = read('booking.html/index.html');
  assert.equal(/noindex/i.test(booking), false);
  assert.match(booking, /rel="canonical" href="\/booking"/);
  const demo = read('booking-demo.html');
  assert.match(demo, /url=\/booking/);
  assert.match(demo, /noindex/);
  assert.equal(/demo/i.test(demo), false);
});

test('page script has no dollar signs or hard-coded prices', () => {
  const html = read('booking.html/index.html');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const logic = scripts[scripts.length - 1];
  assert.equal(logic.includes('$'), false);
  assert.equal(/£\s*\d/.test(logic), false);
  for (const amount of ['900', '800', '850', '1200', '129', '114', '122', '171', '126', '300', '18']) {
    assert.equal(logic.includes(amount), false, amount);
  }
  assert.equal(html.includes('booking-demo'), false);
  assert.equal(/freetobook/i.test(html), false);
});

test('booking requests go to the villa API and the contact form stays on Web3Forms', () => {
  const booking = read('booking.html/index.html');
  assert.equal(/web3forms/i.test(booking), false);
  assert.equal(/access_key/i.test(booking), false);
  assert.match(booking, /\/api\/bookings/);
  assert.match(booking, /\/api\/availability/);
  assert.match(booking, /\/data\/availability\.json/);
  assert.match(booking, /\/data\/booking-api\.json/);
  const contact = read('contact.html/index.html');
  assert.match(contact, /https:\/\/api\.web3forms\.com\/submit/);
});

test('old booking-demo and Free to Book reservation links are gone', () => {
  const htmlFiles = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) htmlFiles.push(full);
    }
  }
  walk(root);
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    assert.equal(/href="[^"]*booking-demo/.test(html), false, file);
    assert.equal(/freetobook\.com\/affiliates\/reservation/.test(html), false, file);
  }
});
