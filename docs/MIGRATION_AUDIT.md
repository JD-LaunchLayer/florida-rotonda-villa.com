# Migration audit — florida-rotonda-villa.com

Read-only audit of the static NoCodeXport / Weebly export on `main` at `51f6e0b` (30 September 2026). No site files were changed. `booking-demo.html` and `/booking` were not reviewed. `data/prices.json` is mentioned only because the About page loads it.

This export is not what production serves today. On 30 September 2026, `https://www.florida-rotonda-villa.com/` returned `200` with `x-host: grn156.sf2p.intern.weebly.net` behind Cloudflare. The public URLs below are the ones that host already answers.

## How the numbers were measured

Local static server: Python `http.server` on `127.0.0.1:8765`.

Page weight: headless Chrome (CDP `Network.loadingFinished` encoded bytes), cache disabled, one fresh browser context per page, viewport 390×844, waited for `networkidle0` plus 1.2–1.5 s. Bytes below are transfer size, including response headers, after gzip where the CDN compressed.

Lighthouse 12.8.2, mobile, viewport 390×844, device scale factor 2, simulated throttling (Lighthouse default). Run at 13:09 UTC on 30 September 2026 for every page except About, which was measured again at 13:13 UTC after this branch was moved onto current `main` (the About rate markup had changed; the other pages had not).

A 390px browser pass opened the hamburger on every page. Contrast ratios for solid colours were calculated from the computed colours (WCAG relative luminance). Lighthouse’s colour-contrast audit is reported separately, because it only sees text whose background it can resolve, and it ran with the menu closed.

`index.html` and `404.html` are the same file (MD5 `8b3f6fae1adc322bff8f523bb4c949ef`, 19,673 bytes), so they were not measured twice.

## Result in brief

The pages still render, the mobile menu opens, and nothing scrolls sideways at 390px. The look still depends on Weebly’s CDN (`cdn2.editmysite.com`) for base CSS, fonts, `main.js`, and `stl.js`. About 4.4 MB of exported fonts, images, and scripts are not linked. `index.html` is a copy of the homepage used as `404.html`, while the live Weebly 404 is a real “404 - Page Not Found” page. Inner pages are directories named `about.html/`, so a typical static server 301s `/about.html` to `/about.html/`. Gallery is the heaviest page (1,773 KiB, LCP 8.7 s). Contact pulls in Google reCAPTCHA (~347 KiB) even though the form posts to Web3Forms.

Lighthouse mobile scores (0–100):

| Page | Transfer | Reqs | Performance | Accessibility | Best practices | SEO | LCP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home `/` | 1,003 KiB | 30 | 63 | 86 | 82 | 82 | 7.4 s |
| About `/about.html/` | 941 KiB | 29 | 64 | 90 | 82 | 80 | 6.5 s |
| Facilities `/facilities.html/` | 1,087 KiB | 28 | 58 | 100 | 79 | 82 | 7.7 s |
| Gallery `/gallery.html/` | 1,773 KiB | 46 | 62 | 87 | 79 | 73 | 8.7 s |
| Testimonials `/testimonials.html/` | 922 KiB | 27 | 64 | 90 | 79 | 82 | 6.8 s |
| Contact `/contact.html/` | 1,322 KiB | 31 | 61 | 92 | 82 | 80 | 7.1 s |
| Terms `/terms-and-conditions.html/` | 936 KiB | 27 | 62 | 100 | 82 | 80 | 6.9 s |
| T & C’s scans `/t--cs.html/` | 1,208 KiB | 28 | 61 | 100 | 82 | 82 | 8.4 s |

Best-practices scores are pulled down by protocol-relative CDN URLs. On this HTTP lab server those become `http://`. On the live HTTPS origin they would be HTTPS. The dependency is real; the “insecure request” count is a lab effect.

Other Lighthouse timings from the same runs: Home CLS 0.083 and TBT 100 ms; About CLS 0.009 and TBT 60 ms; Facilities TBT 220 ms; Contact TBT 140 ms and Time to Interactive 10.0 s; Terms TBT 110 ms; Testimonials TBT 110 ms; T & C’s scans TBT 130 ms. Gallery’s CLS and TBT scored 1 (pass). Speed Index was about 4.3–5.7 s. Render-blocking resources were estimated at 3.4–4.6 s of savings. Unused JavaScript was about 263–271 KiB on most pages and 510 KiB on Contact (reCAPTCHA).

## 1. Weebly and other third parties

Every audited page loads the same shell. Sizes are uncompressed `Content-Length` from the CDN on 30 September 2026, plus the gzipped transfer actually seen in Chrome.

| Dependency | Where | Uncompressed | Seen transfer | What it does | What replaces it |
| --- | --- | ---: | ---: | --- | --- |
| `cdn2.editmysite.com/css/sites.css` | every page | 210,877 | ~30 KiB | Weebly base layout | Local file already in the repo: `assets/css/style-41472e3f.css` is byte-identical (MD5 `4f2b8fab32d0af3df6b39a13b4ca232f`). Point the `<link>` at a local copy. |
| `fancybox.css` | every page | 3,911 | ~2 KiB | Lightbox skin | `assets/css/style-49bb4489.css` is the same size. Keep it only while lightbox stays. |
| `social-icons.css` | every page | 12,720 | ~2.4 KiB | Weebly social icon font | `assets/css/style-5f7d8bfe.css`. The icon font inside it still points at `cdn2.editmysite.com`. Drop the stylesheet if no social icons are on the page. |
| `slideshow.css` | Facilities only | 7,353 | (in the Facilities CSS total) | Slideshow skin | `assets/css/style-989f993e.css`. Needed until the slideshow is rewritten. |
| Lato, Cookie, Roboto, Crimson Text `font.css` | every page | 2,572 / 429 / 2,584 / 1,738 | CSS ~1 KiB each; font files below | Theme fonts | Self-host woff2 only. The export’s `assets/css/style-*.css` font sheets still say `url('./regular.eot')` and similar, and those filenames are not in `assets/fonts/`. The hashed font files there (~2.6 MB) are not referenced. |
| Font files actually downloaded | measured on About | — | Lato regular 24 KiB, light 24 KiB, bold 24 KiB; Crimson Text regular 26 KiB; Cookie regular 15 KiB; Roboto bold 17 KiB | Logo, body, buttons | Same files, local. Cookie downloaded even though `#wsite-title` is forced to Crimson Text. |
| `js/site/main.js` | every page | 481,002 | ~149 KiB | Weebly runtime: lightbox, slideshow, flyouts, forms | `assets/animate/main.js` is byte-identical to the CDN copy at `buildTime=1677526202`, but the HTML does not load the local file. Self-host it short term. Remove it once lightbox and the Facilities slideshow have a small local replacement. Menu open/close already works from `files/theme/custom.js`. |
| `js/lang/en/stl.js` | every page, twice | 189,349 | ~35 KiB, twice on Contact and Terms | Weebly strings / templates | The `<script>` tag is duplicated on every page. Contact uses build times `1677526202` and `1691704511`, and Terms uses `1677526202` and `1677879501`, so both URLs download. Other pages repeat the same URL, which the browser fetches once. Local `assets/animate/stl.js` is a different hash from the CDN file; do not swap it in blindly. |
| jQuery 1.8.3 | every page, `/assets/animate/jquery-1.8.3.min.js` | 93,636 | 94 KiB (Python does not gzip it) | Required by the theme scripts and Weebly | Keep a single jQuery until `main.js` and `custom.js` are gone. 1.8.3 is years out of support. |
| `assets/animate/d62029584.js` | every page, before jQuery 1.8.3 | 155,437 | 156 KiB | File starts as jQuery 1.10.2 and then defines `freetobook_widget`, which runs on load | Split or delete. jQuery 1.8.3 replaces `window.jQuery` immediately afterwards, so the 1.10.2 copy is wasted. The widget then calls FreeToBook. |
| FreeToBook | every page | — | ~9–11 KiB from `static.freetobook.com`, plus ~1 KiB from `www.freetobook.com` on Home | Injects a jQuery UI datepicker (unlabelled prev/next links on every page) and, on Home, empty `ftb_widget` search and review slots | Remove the widget script from pages that are not a booking form. Home’s Book-style behaviour is the separate booking work, not this audit. |
| Google reCAPTCHA | Contact only | — | 347 KiB `www.gstatic.com/.../recaptcha__en.js` plus ~1 KiB `www.google.com` | Invisible reCAPTCHA node left from Weebly (`data-sitekey` is in the form) | The form `POST`s to `https://api.web3forms.com/submit` and does not need this script. Remove the Weebly reCAPTCHA block once Web3Forms spam handling is confirmed. |
| `marketplace.editmysite.com/.../marketplace-elements-.../assets/` | About, inside the old rate-table element script | — | not transferred on the measured About load | Weebly “simple table” element | The visible rates are now drawn by `/data/villa-rates.js`. The marketplace script is leftover. |
| Framer badge remover | every page, inline | 1,044 bytes of HTML | same | `MutationObserver` that removes `#__framer-badge` | Delete it. There is no Framer page here. |
| `<!-- Save money on hosting, use PROMO26 for a discount -->` | every audited page | — | — | NoCodeXport promo comment, with “Optimized Aug 7, 2026” | Delete the comment. |
| HomeAway image and links | Testimonials | — | image request failed in the browser (`naturalWidth` 0). `curl` got HTTP 400 from `http://www.homeaway.co.uk/haow/api/image/.../reviews` | Old review badge | The written reviews are in the HTML. The hotlinked badge is dead. |
| TripAdvisor | Testimonials | local badge `assets/meta/meta-782b95b6.png` (6,689 bytes, 336×81) | local | Outbound link | Keep the link if the owner still wants it. The `href` repeats `g34595` and the listing slug, and a stray `</a>` follows the image. A `curl` from this environment returned 403, which is not enough to call the listing gone. |
| FreeToBook reservation URL | About and Contact “Book Now” buttons | — | `http://www.freetobook.com/affiliates/reservation.php?w_id=23326` returned HTTPS 200 without the token | Booking hand-off | Leave the destination to the booking work. The link is `http://` and includes a `w_tkn` query value in the page source. |
| Morning Muse PDF | About | — | `http://www.florida-rotonda-villa.com/pdf/muse.pdf` → HTTPS, then **404** on the live site. The file is not in this repo. | Cafe recommendation link | The sentence can stay. The link target is broken. Do not invent a replacement URL. |

Not found in the audited HTML: Google Analytics, `gtag`, Facebook pixel, Hotjar.

`STATIC_BASE` is `//cdn1.editmysite.com/` and `ASSETS_BASE` is `//cdn2.editmysite.com/`. `cdn1` returned 403 for `/`.

Unlinked local files (safe to delete only after the CSS and fonts above are actually wired):

| Group | Bytes |
| --- | ---: |
| `assets/fonts/` (77 hashed files, not referenced) | 2,677,027 |
| `assets/animate/` not used as a `<script src>` (`main.js`, `stl.js`, `slideshow-jq.js`, `snowday262.js`, `main-customer-accounts-site.js`) | 1,319,934 |
| `assets/images/` (sprites and UI images, not referenced) | 282,965 |
| `assets/css/` (CDN mirrors, not linked) | 242,184 |
| **Total unlinked** | **4,522,110** |

`files/theme/images/default-bg.jpg` is 1,042,590 bytes (1800×1200) and is referenced from `files/main_style.css`, but it was not in the transfer. The header’s inline background wins, so the browser did not download it. `files/theme/plugins.js` (85 KiB, Hammer.js) and `files/theme/mobile.js` (20 KiB) and `files/theme/custom.js` (3.6 KiB) are linked and should stay until the menu is rewritten.

## 2. URL structure

### What is on disk

| Public URL that live Weebly returned 200 for on 30 Sep 2026 | File in this repo |
| --- | --- |
| `/` and the sitemap’s `/index.html` | `index.html` (also byte-identical to `404.html`) |
| `/about.html` | `about.html/index.html` (directory, not a file) |
| `/facilities.html` | `facilities.html/index.html` |
| `/gallery.html` | `gallery.html/index.html` |
| `/testimonials.html` | `testimonials.html/index.html` |
| `/contact.html` | `contact.html/index.html` |
| `/t--cs.html` | `t--cs.html/index.html` |
| `/terms-and-conditions.html` | `terms-and-conditions.html/index.html` |

There are no root-level copies such as a file named `about.html` beside the folder. Nav and footer links are root-absolute (`/about.html`, and so on). They match the live URLs. The Weebly `initFlyouts` blob also lists relative names (`"url":"about.html"`).

On this Python server, `GET /about.html` is **301** to `/about.html/`, and both `/about.html/` and `/about.html/index.html` return **200** with the same HTML. Live Weebly returns **200** for `/about.html` with no slash. After cutover, a host that treats `about.html` as a directory will change the public URL unless redirects or flattened files are added.

`/t--cs.html` and `/terms-and-conditions.html` are not duplicates:

- `/t--cs.html` is the nav item “T & C’s”. The body is two JPEG scans of a terms document. Visible text outside the header and footer is essentially the heading “TERMS & CONDITIONS”.
- `/terms-and-conditions.html` is the full HTML terms. It is not in the header or footer. It is in the live sitemap.

Do not 301 one at the other. They are different documents. Link them to each other.

`index.html` and `404.html` are the same bytes, titled “Florida Rotonda Villa - Home”. A missing URL on the live site is titled “404 - Page Not Found” (checked with `/this-page-does-not-exist-audit`, HTTP 404). This export does not contain that 404. Hosts that serve `404.html` for unknown paths would show the homepage and a 200-looking document (soft 404) if the status is wrong.

### Redirect map to preserve public URLs

Flatten each directory to a real file (`about.html/index.html` → `about.html`) so `/about.html` is 200 with no slash. Then:

| Request | Response |
| --- | --- |
| `http://florida-rotonda-villa.com/*` | 301 `https://www.florida-rotonda-villa.com/*` (live apex already 301s to www) |
| `https://florida-rotonda-villa.com/*` | 301 `https://www.florida-rotonda-villa.com/*` |
| `/index.html` | 301 `/` |
| `/about.html/` and `/about.html/index.html` | 301 `/about.html` |
| same pattern for `facilities`, `gallery`, `testimonials`, `contact`, `terms-and-conditions`, `t--cs` | 301 to the slash-free URL |
| `/pdf/muse.pdf` | leave 404, or restore the file only if the owner still has it. Do not point it at a guessed page. |
| anything else | **404** with a real not-found page (same header and footer), status 404. Do not reuse `index.html`. |

`.co.uk` is not part of that map today. See section 6.

The live sitemap (not in this repo) lists eight `http://www...` URLs, `lastmod` 2023-02-28: the seven pages above plus `/index.html`. A new sitemap should use `https://www.florida-rotonda-villa.com/` for home, not `/index.html`, and should include both terms URLs.

## 3. HTML quality

Shared by all audited pages:

- `<html lang="en">` is set. Viewport is set. Charset is `<meta http-equiv="Content-Type" ... charset=utf-8>`, not `<meta charset>`.
- No `<link rel="canonical">`. No `hreflang`. No JSON-LD.
- No `<h1>`. The banner title is an `<h2>`, then more `<h2>`s in the body. At 390px, `files/mobile-fixes.css` forces `h2` to `20px !important`, and that was the computed size of the first heading.
- Open Graph tags exist (`og:site_name`, `og:title`, `og:description`, `og:image`) but there is no `og:url` or `og:type`. `og:image` is a root-relative path, except Testimonials, whose `og:image` is the HomeAway URL that returned 400. T & C’s scans and Facilities each emit two `og:image` tags.
- A meta `description` exists only on Home (“Executive Villa in Rotonda West Florida”). Lighthouse flagged a missing meta description on the other seven pages. Those pages do have `og:description`, which can be copied into `<meta name="description">` without new copy. Home also has a `keywords` meta; it does not help and can be dropped.
- Titles are unique and were accepted by Lighthouse (`document-title` passed).
- Presentational markup is still there: `<font size="6">`, layout `<table>`s for columns, `align` attributes.
- Gallery images have no `alt`. Other content images use `alt="Picture"` or, for the TripAdvisor badge, `alt="TripAdvisor"`. None use `loading="lazy"` or real `width` / `height` attributes. Gallery thumbs use non-standard `_width` and `_height`.
- Home’s feature image and both T & C’s scans are wrapped in `<a>` with no `href`. Lighthouse `crawlable-anchors` failed on those and on the FreeToBook datepicker links.
- Contact labels: Email and Message are labelled. First and Last have sublabels. The form is usable. See section 8.

### Structured data

A `LodgingBusiness` or `VacationRental` block is reasonable later, using only facts already published:

- Name: Florida Rotonda Villa (and the villa name Minslake, which the pages use).
- URL: `https://www.florida-rotonda-villa.com/`.
- Description: the existing meta description, or a sentence already on the page.
- Image: an existing photo, with an absolute URL.
- Telephone and email: the Contact page already publishes `minslake@sky.com`, `+44 (0)1621 842877`, and `+44 (0)7979 500841`.

Do not invent a Florida street address, geo coordinates, `priceRange`, or star rating. The only postal address on the Contact page is Minsbrook, Mayflower Drive, Maldon, Essex, CM9 6XX. The terms heading says “Pine valley Court, Rotonda, Florida”, which is not a full street address. Do not put the Essex address on the lodging entity as if it were the villa.

## 4. Images and page weight

No WebP or AVIF anywhere. JPEGs are the content photos.

Shared on almost every page: header background `uploads/7/2/0/9/72099671/background-images/524165396.jpg`, **634×478**, 147,833 bytes, stretched with `background-size: cover` across the banner. It is the LCP image on text pages. It is small for a full-width banner.

| Page | Images transferred | Notes |
| --- | --- | --- |
| Home | Header 145 KiB + `3176014.jpg` 642×361, 91,404 bytes, `alt="Picture"`, invalid `style="width:643"` (no unit) | Image total 241 KiB. Lightbox originals are not on this page. |
| About | Header only (149 KiB of images) | No content photo. Rates are HTML tables. |
| Facilities | Image total 335 KiB, including header and `9992397.jpg` **345×456**, 190,791 bytes, `alt="Picture"` | The slideshow’s first slide (Great Room) rendered. Nine of the ten slideshow files are missing from the repo. See section 7. |
| Gallery | Image total 1,016 KiB | 21 thumbs, together 1,031,757 bytes, mostly about 400 px wide, shown three across at 390px. 21 lightbox originals exist (1,742,425 bytes) and are not downloaded until click. No `alt`. Lighthouse `image-alt` and `link-name` failed. |
| Testimonials | Header plus the TripAdvisor PNG. HomeAway image broken. | |
| Contact | Header only | reCAPTCHA is the extra weight, not images. |
| Terms (HTML) | Header only | |
| T & C’s scans | Header + two JPEGs, 573×821 (168,430 bytes) and 584×840 (152,959 bytes) | The legal text is pixels. `alt="Picture"`. Lighthouse `unsized-images` failed. |

Gallery at 390px stays a three-column float (`width: 33.28%`). There is no horizontal page scroll (`scrollWidth` was 390 on every page). The thumbs are just small.

`assets/meta/meta-e743c46f.png` is 449 bytes, 200×200, and is the `og:image` on several pages. It is a tiny preview, not a photo of the villa.

## 5. Mobile and accessibility (390px)

Checked in headless Chrome at 390×844 on Home, About, Facilities, Gallery, Testimonials, Contact, Terms, and T & C’s scans.

- No horizontal overflow on any page.
- The desktop nav is hidden. The hamburger is shown. Clicking it adds `nav-open`. All seven links appear (Home, About, Facilities, Gallery, Testimonials, Contact, T & C’s).
- Hamburger box: **44×44**. Each mobile link: **213×50**. Those meet a 44px target. `files/mobile-fixes.css` (max-width 768px) sets that. The theme’s own hamburger, before that file, is 30×30 and would apply between 769px and 992px.
- Mobile menu colours, measured with the menu open: text `rgb(255, 255, 255)` on `rgb(193, 163, 103)` (`#c1a367`). Contrast **2.41:1**. That fails WCAG AA for normal text (4.5:1) and for large text (3:1). Lighthouse did not flag it, because the menu was closed during Lighthouse.
- Buttons (`.wsite-button-inner`) are the contrast failure Lighthouse did report, on Home, About, and Contact. The theme sets that text to `#c1a367` on white, which is the same **2.41:1**.
- Body rule is `#666666` on `#C8AE79` (**2.68:1**). Lighthouse did not flag the main Home paragraphs, so their resolved background is not that gold pair. It did flag About paragraphs, the Morning Muse link, the mailto link, HomeAway “Read” / “Write”, and FreeToBook widget text.
- Black `#000` on `#C8AE79` would be 9.79:1. White on `#C8AE79` is 2.15:1. The banner heading is white over the photograph; Lighthouse did not score that, because the background is an image.
- Facilities, the HTML terms, and the scan page scored accessibility 100. That does not mean the scan page is accessible: the terms text is inside images with `alt="Picture"`.
- Gallery accessibility 87 is mostly missing alts and unnamed lightbox links.
- Contact accessibility 92. The form can be used. reCAPTCHA and the gold buttons are the drag.
- Hero heading computed size at 390px is 20px, because `mobile-fixes.css` overrides the theme’s banner size with `!important`. Changing that would change the look. Leave it alone unless the owner wants the larger theme size back.

## 6. Sitemap, robots, favicon, hosting, domains

In the repo there is no `robots.txt`, no `sitemap.xml`, no `netlify.toml`, no `_headers`, no `_redirects`, and no `vercel.json`. The only icon is `favicon.ico` at the site root: one 32×32 image, 4,286 bytes. No `<link rel="icon">`, no apple touch icon, no SVG. Browsers still request `/favicon.ico`. The live site’s `/favicon.ico` `Content-Length` was 4286, the same size.

Live `https://www.florida-rotonda-villa.com/robots.txt` (not in the repo) is:

```
Sitemap: http://www.florida-rotonda-villa.com/sitemap.xml

User-agent: NerdyBot
Disallow: /

User-agent: *
Disallow: /ajax/
Disallow: /apps/
```

The sitemap locs are `http://`, not `https://`, and `lastmod` is 2023-02-28. `/ajax/` and `/apps/` are Weebly paths this static site does not have.

Live www response headers included `cache-control: max-age=30, private, no-store` and a Cloudflare `__cf_bm` cookie. A static host should cache HTML briefly and cache fingerprinted CSS, JS, and images for a long time. Security headers to add once third parties are gone or allow-listed: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security`, and a Content-Security-Policy that matches the scripts you still load. A strict CSP today would break `editmysite.com`, FreeToBook, and reCAPTCHA.

### .com and .co.uk

Measured 30 September 2026:

| Host | Result |
| --- | --- |
| `https://florida-rotonda-villa.com/` | 301 to `https://www.florida-rotonda-villa.com/` |
| `https://www.florida-rotonda-villa.com/` | 200, Weebly via Cloudflare. DNS A `199.34.228.72`. |
| `http://www.florida-rotonda-villa.co.uk/` and the apex | 200, 229-byte HTML, `Last-Modified: Thu, 28 Jul 2016`. Meta refresh to the relative URL `defaultsite`. Comment in the file: `UK`. DNS A `217.160.0.151`. |
| `https://www.florida-rotonda-villa.co.uk/` and the apex | TLS handshake failed (`tlsv1 alert internal error`). They do not redirect to `.com`. |

The HTML export mentions `www.florida-rotonda-villa.com` once, on the broken Muse PDF link. It does not mention `.co.uk`. Canonical host for the new site should be `https://www.florida-rotonda-villa.com`. Point `.co.uk` at that host only if the domain is still controlled by the site owner. Nothing in this repo does that today.

## 7. Content flags

These are differences and gaps in the files. They are not corrections, and they are not new facts about the villa.

**Rates.** `data/prices.json` and the About page publish 2024, 2025, and 2026. `docs/PRICES.md` says 2026 uses the same weekly and daily amounts as 2025. With JavaScript on, `/data/villa-rates.js` fetches the JSON, fills `#villa-rates-live`, and hides the fallback (`display: none` was measured). The fallback tables are still in the HTML, including a 2024 heading written as `2024&#8203;&#8203;` (two zero-width spaces). Extras sentences (£ amounts for pool heat, deposit, cot, high chair, cleaning) are also still written in the HTML. Two copies will drift. The 2023 table is gone. There is no 2027 year in the file. Do not invent later prices.

**Two terms pages.** Nav goes to the scans. The HTML terms are only at `/terms-and-conditions.html`. The HTML version says “Pine valley Court” in the `<h2>`; other pages say “Pine Valley”.

**Facilities slideshow files missing from the export** (captions are in the page; the JPEGs are not), all declared around 400 px wide:

- `entrance.jpg`
- `dining_1.jpg`
- `family-room_1.jpg`
- `kitchen.jpg`
- `kitchen2.jpg` (no caption in the slideshow data)
- `master.jpg`
- `masterbath.jpg`
- `bed2.jpg`
- `fambath.jpg`
- `bed3.jpg`

`greatroom_1.jpg` is present (400×305). The Bedroom 2 caption in the slideshow data is the same sentence as the Master Bathroom caption (“Extremely spacious en-suite bathroom…”). The Master Bedroom caption says “it's own”.

**Wording that does not match itself** (counts are in the audited HTML, not a style ruling):

- “Engelwood” (2) and “Englewood” (2).
- “Minnesota Cay” (1) and “Manasota Key” (2).
- “comprises of” (About, and the family-bathroom slideshow caption).
- Terms: “This conduct is subject to” in the Law section, and “can be take to rectify”.
- “jacuzzi” and “Jacuzzi”.
- “neighbour” and, once in the code of conduct, “neighbors”.
- “sq ft” and “sq. ft”.
- Gallery `<h2>` text is “gallery”.
- Testimonials include reviews dated 2013 and 2016. That is what the page says.
- Contact publishes UK phone numbers, `minslake@sky.com`, and the Maldon address above. It does not publish a Florida street address.

**Broken or empty links**

- `pdf/muse.pdf` is 404 on the live site and absent here.
- HomeAway review image is HTTP 400 and broken in the browser.
- Empty `<a>` around the Home photo and both terms scans.
- FreeToBook and HomeAway links are `http://`. FreeToBook’s reservation URL redirects to HTTPS.

## 8. Security and privacy

**Contact form.** `contact.html` posts to `https://api.web3forms.com/submit`. The Web3Forms access key is a hidden field in the HTML. That is how this service works; anyone can read it and submit to the same form. The redirect is `https://web3forms.com/success`, so a successful visitor leaves the site. Fields use `aria-required` but not the `required` attribute. A Weebly invisible reCAPTCHA site key is still in the form, and the page downloads the reCAPTCHA script. `_W.recaptchaUrl` is set on every page, not only Contact.

**FreeToBook.** The reservation links include `w_id` and `w_tkn` in the query string. Treat the token as public, because it already is. The widget on `d62029584.js` calls `www.freetobook.com` and `static.freetobook.com` from every page.

**Scripts.** jQuery 1.8.3 and the bundled 1.10.2 are old. Weebly `main.js` and `stl.js` are remote and protocol-relative. There is no Subresource Integrity. There is no CSP in the repo. No analytics pixels were found.

**Cookies.** The lab pages did not set a first-party cookie. The live Weebly response set Cloudflare `__cf_bm`.

**Privacy.** Third parties that actually ran in the browser: `cdn2.editmysite.com` (all pages), FreeToBook (all pages), Google reCAPTCHA (Contact). HomeAway was requested and failed. TripAdvisor is a link and a local image, not a script.

## 9. Follow-up work

Three pull requests, visual design left as it is. “Quick” means a mechanical edit with a low chance of changing layout. “Medium” means self-hosting and asset cleanup that needs a side-by-side check. “Bigger” means behaviour or copy that needs the owner.

### PR 1 — URLs, metadata, and noise (quick)

- Delete the Framer badge script and the PROMO26 / “Optimized …” comments.
- Remove the duplicate `stl.js` tag. On Contact and Terms, also make the remaining tag use one `buildTime` so the file is not downloaded twice.
- Add `<meta name="description">` from the existing `og:description`, a canonical URL on `https://www.florida-rotonda-villa.com`, `og:url`, and one absolute `og:image`.
- Flatten `page.html/index.html` to a file `page.html`. Add the redirect map in section 2, including `/index.html` → `/`.
- Replace `404.html` with a real not-found page that uses the same header and footer, served with status 404.
- Add `robots.txt` and `sitemap.xml` with `https://www` URLs, both terms URLs, and home as `/`.
- Add `<link rel="icon" href="/favicon.ico">` using the existing file.
- Remove empty `<a>` wrappers. Point FreeToBook links at `https://` if that host stays.
- Add static-host cache headers and the security headers in section 6. Keep CSP loose until PR 2 removes the CDNs, or allow-list them explicitly.
- Link the two terms pages to each other. Do not merge or redirect them.

### PR 2 — Self-host the shell and lighten images (medium)

- Serve `sites.css`, fancybox, social-icons, and slideshow CSS from the copies already in `assets/css`. Stop using `//cdn2.editmysite.com` for CSS.
- Download the woff2 files the font CSS actually requests (the ones measured in section 1) and point `font.css` at them. Then delete the 2.6 MB of unreferenced hashed fonts.
- Self-host one copy of `main.js` and one copy of the CDN `stl.js` (not the mismatched local `stl.js`) until PR 3 removes them.
- Load one jQuery, not two. Drop `d62029584.js` from pages that should not call FreeToBook, or split the widget out so jQuery 1.10.2 is not shipped.
- On Contact, remove the Weebly reCAPTCHA block if Web3Forms is the spam control. That is the 347 KiB.
- Add `width` and `height` (or aspect-ratio) and `loading="lazy"` on below-the-fold images. Do not lazy-load the header, which is the LCP image.
- Gallery: keep thumbs on the page and originals for the click. Add `alt` only where a caption already exists (the Facilities slideshow captions). Do not invent gallery alts; ask for them. Until then, empty `alt` is wrong because the photos are the content, and `alt="Picture"` is what to stop repeating.
- Delete unlinked `assets/images`, `snowday262.js`, `slideshow-jq.js`, and `main-customer-accounts-site.js` after a click-through. Leave `default-bg.jpg` until the CSS rule that references it is gone, or the header will fall back to a 1 MB image.
- About: stop shipping the marketplace element script. Keep `data/prices.json` as the rate source, and generate the no-JS tables from that file so the zero-width `2024` heading and the second copy cannot drift.

### PR 3 — Owner copy, missing photos, and dropping the Weebly runtime (bigger)

- Re-fetch the nine missing Facilities slideshow JPEGs from the current Weebly site if they are still there. Fix the Bedroom 2 caption only with wording the owner supplies. The current caption repeats the master bathroom.
- Give the owner the wording list in section 7 (Engelwood / Englewood, Minnesota Cay / Manasota Key, Pine valley / Pine Valley, “This conduct”, “can be take”, “comprises of”). Do not “correct” place names without them.
- Decide the Muse PDF: restore the file or remove the link. Do not substitute a URL.
- Remove the dead HomeAway badge. Keep the review text.
- Replace lightbox and the Facilities slideshow with short local scripts, then delete `main.js`, `stl.js`, and jQuery. `custom.js` already opens the mobile menu.
- Recompress photos without changing the crop: a larger header than 634×478, and smaller files than the 191 KB / 345×456 Facilities portrait and the two terms scans. WebP alongside JPEG is fine. Do not restyle the page.
- Add JSON-LD from section 3 only.
- If `.co.uk` is still the owner’s domain, 301 the apex and www to `https://www.florida-rotonda-villa.com/` and serve HTTPS. Today it does neither.

Out of scope here: the booking page, new prices, and any change to colours, type, or layout.
