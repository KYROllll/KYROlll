// Browser integration checks for the free-download KYROIII store.
// Covers the storefront layout, the tagged audio preview, the "DOWNLOAD FREE"
// drawer (welded to its trigger, with the ambient glow) and all three
// package-specific unlock paths (email-only MP3, subscribe + like + Instagram
// WAV and Pro), ending on the download page and its
// PDF license.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = new URL(path === '/' ? 'index.html' : `.${path}`, root);
  const type = types[extname(file.pathname)] || 'application/octet-stream';
  if (req.method === 'HEAD') {
    // The download page probes each file; answer from the directory entry so a
    // 38 MB WAV is never read just to learn that it exists.
    try { await stat(file); res.writeHead(200, { 'Content-Type': type }); res.end(); }
    catch { res.writeHead(404); res.end(); }
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
// Every POST the gates make to the newsletter provider. The authoritative post
// now happens at SIGN & UNLOCK, with a JSON body, so the test answers the CORS
// preflight too and records the headers alongside the parsed body.
const subscribeRequests = [];
// Every request that reaches Formspree, preflight included. The final assertion
// proves the KYROIII — FREE DOWNLOADS form is the only endpoint the store contacts.
const providerRequests = [];
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'accept, content-type',
};
const postJSON = (index) => {
  try { return JSON.parse(subscribeRequests[index].body); } catch { return null; }
};
const waitForPostCount = async (count, label = '') => {
  const started = Date.now();
  while (subscribeRequests.length < count && Date.now() - started < 8000) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(subscribeRequests.length, count, label || `${count} newsletter post(s) recorded`);
};
// The superseded forms must not exist anywhere in the source. They are assembled
// from fragments so this assertion does not itself leave a live old id behind.
const SUPERSEDED_FORM_IDS = ['x' + 'kjjjnry', 'xg' + 'aoppwo'];
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.md', '.json', '.txt', '.yml', '.yaml', '.xml', '.svg']);
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules']);
async function textFilesUnder(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) files.push(...await textFilesUnder(path));
    } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}
async function supersededFormReferences() {
  const hits = [];
  for (const file of await textFilesUnder(fileURLToPath(root))) {
    const text = await readFile(file, 'utf8');
    for (const id of SUPERSEDED_FORM_IDS) {
      if (text.includes(id)) hits.push(`${file}: ${id}`);
    }
  }
  return hits;
}
async function setupPage(options = {}) {
  const context = await browser.newContext(options);
  // Keep the run hermetic: same-origin files come from the test server, bundled
  // assets are read from disk, and anything external (the YouTube gate's
  // subscribe/like links) never leaves the machine.
  await context.route('**/*', async route => {
    const req = route.request(), target = new URL(req.url());
    if (target.origin === url) return route.continue();
    if (target.origin === 'https://formspree.io') {
      providerRequests.push({ url: req.url(), method: req.method() });
    }
    // application/json is not a CORS-safelisted content type, so the browser
    // sends a preflight before the Formspree POST. Answer it with the headers
    // Formspree itself answers with, then record and answer the POST.
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    if (req.method() === 'POST') {
      subscribeRequests.push({ url: req.url(), body: req.postData() || '', headers: req.headers() });
      return route.fulfill({
        status: 200,
        headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS),
        body: JSON.stringify({ ok: true }),
      });
    }
    if (target.pathname.startsWith('/assets/')) {
      return route.fulfill({ path: new URL(`.${target.pathname}`, root).pathname });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  // The gate's step links open new tabs; close them so they never navigate out.
  context.on('page', popup => { if (popup !== page) popup.close().catch(() => {}); });
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(tmpdir(), 'opencode', `kyrolll-${name}.png`), fullPage: true });
// The beat-detail head is the title and its specs only. The YouTube icon that
// used to sit beside the title is gone in both the locked and the live state:
// `videoFor()` still backs the gate's "like this beat" step, but nothing in the
// page chrome links out to YouTube.
const noYouTubeButton = async (page, card) => {
  assert.equal(await page.locator(`${card} .card__youtube-link`).count(), 0, 'the beat detail renders no YouTube icon');
  assert.equal(await page.locator(`${card} .beat-detail__head a[href*="youtube.com"]`).count(), 0, 'the beat detail head carries no YouTube link');
  assert.equal(await page.locator(`${card} .beat-detail__head svg`).count(), 0, 'the title block holds no icon at all');
};

const noOverflow = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');

// The beat-detail title is the page's display line, and the longest ones —
// `[FREE 100%] LIL GOTIT TYPE BEAT - SQUISH!` and `… JUST D0 IT` — have to read
// as a balanced block at every width: inside the glass card, wrapping whole
// words, with display leading and clear air before the specs line.
const assertCleanTitle = async (page, card, label) => {
  const report = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const title = root && root.querySelector('.beat-detail__title');
    const content = root && root.querySelector('.beat-detail__content');
    const specs = root && root.querySelector('.card__specs');
    if (!title || !content) return null;
    const style = getComputedStyle(title);
    const rect = title.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const span = title.querySelector('span') || title;
    const range = document.createRange();
    range.selectNodeContents(span);
    const boxes = Array.from(range.getClientRects()).filter(box => box.width > 1 && box.height > 1);
    const specsRect = specs ? specs.getBoundingClientRect() : null;
    return {
      text: title.textContent.replace(/\s+/g, ' ').trim(),
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      whiteSpace: style.whiteSpace,
      overflow: title.scrollWidth - title.clientWidth,
      width: rect.width,
      contentWidth: contentRect.width,
      lines: new Set(boxes.map(box => Math.round(box.top * 100) / 100)).size,
      widestLine: boxes.length ? Math.max(...boxes.map(box => box.width)) : 0,
      gapToSpecs: specsRect ? Math.round((specsRect.top - rect.bottom) * 10) / 10 : null,
    };
  }, card);
  assert(report, `${label}: the beat title renders`);
  assert(report.width <= report.contentWidth + 1, `${label}: the title stays inside the glass card (${report.width} vs ${report.contentWidth})`);
  assert(report.overflow <= 1, `${label}: the title clips nothing (${report.overflow}px)`);
  assert.notEqual(report.whiteSpace, 'nowrap', `${label}: the title is allowed to wrap`);
  assert(report.lineHeight >= report.fontSize * 1.02, `${label}: the title keeps readable display leading`);
  assert(report.lineHeight <= report.fontSize * 1.32, `${label}: the title is not loosely spaced`);
  assert(report.lines >= 1 && report.lines <= 4, `${label}: the title wraps to ${report.lines} clean lines`);
  assert(report.widestLine <= report.width + 1, `${label}: every rendered line stays inside the title box`);
  assert(report.gapToSpecs === null || report.gapToSpecs >= 0, `${label}: the specs line never overlaps the title`);
  return report;
};

// No catalog card may paint outside its own bounds. `.catalog-tile__link` used to
// be `height: 100%` inside a grid-stretched tile, so the action slot — the
// countdown pill on a scheduled drop, the DOWNLOAD FREE button otherwise — hung
// ~44px past the card's bottom border and bled into the next tile (visibly, into
// THE FLOW's neighbour on a single-column phone).
const noCardBleed = async (page, label) => {
  const report = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('#grid .catalog-tile').forEach(tile => {
      const tr = tile.getBoundingClientRect();
      const actions = tile.querySelector('.catalog-tile__actions');
      const ar = actions && actions.getBoundingClientRect();
      rows.push({
        id: tile.id,
        overflow: tile.scrollHeight - tile.clientHeight,
        actionsBelow: ar ? Math.round((ar.bottom - tr.bottom) * 10) / 10 : 0,
      });
    });
    return rows;
  });
  assert(report.length > 0, `${label}: at least one catalog card is rendered`);
  report.forEach(r => {
    assert(r.overflow <= 1, `${label}: ${r.id} contains its own children (overflow ${r.overflow}px)`);
    assert(r.actionsBelow <= 1, `${label}: ${r.id} keeps its action slot inside the card (${r.actionsBelow}px below the border)`);
  });
  return report;
};

// Every record is the same KYROIII record: one photographed 12" — the supplied
// studio shot, cut to the disc and alpha-masked (`assets/vinyl-classic.png`) —
// carries the grooves, both soft speculars, the lead-in band and the tan centre
// label. The record holds only the label plate, and the original flower logo sits
// dead centre on it as a static print — no animation of any kind. There is no
// rim, no per-beat palette, no pasted cover and no generated artwork layer.
const assertPressing = async (page, card, label, options = {}) => {
  const record = page.locator(`${card} .vinyl-record`);
  await record.waitFor();
  const pressing = await record.evaluate((el) => {
    const body = getComputedStyle(el);
    const logo = el.querySelector('.vinyl-record__logo');
    const logoFrame = el.querySelector('.vinyl-record__logo-frame');
    const stage = el.querySelector('.vinyl-flower-stage');
    const recordRect = el.getBoundingClientRect();
    const frameRect = logoFrame.getBoundingClientRect();
    const sleeveRect = document.querySelector('.beat-detail__artwork').getBoundingClientRect();
    const stageRect = document.querySelector('.beat-detail__artwork-wrap').getBoundingClientRect();
    return {
      classes: el.className,
      bodyBg: body.backgroundImage,
      backgroundSize: body.backgroundSize,
      children: [...el.children].map(child => child.className),
      splashCount: el.querySelectorAll('.vinyl-record__rim, .vinyl-record__gold, [class*="splash"], [class*="blob"], [class*="splatter"]').length,
      logo: !!logo,
      src: logo ? logo.getAttribute('src') : null,
      logoAnimation: logo ? getComputedStyle(logo).animationName : null,
      logoDuration: logo ? getComputedStyle(logo).animationDuration : null,
      stageTag: stage ? stage.tagName : null,
      frameRatio: frameRect.width / recordRect.width,
      // The flower frame's centre against the disc's centre, in px.
      frameOffset: [
        (frameRect.left + frameRect.width / 2) - (recordRect.left + recordRect.width / 2),
        (frameRect.top + frameRect.height / 2) - (recordRect.top + recordRect.height / 2),
      ],
      insideStage: recordRect.left >= stageRect.left - 1 && recordRect.right <= stageRect.right + 1,
      diameterRatio: recordRect.width / sleeveRect.width,
      coverFilter: getComputedStyle(document.querySelector('.beat-detail__artwork img')).filter,
    };
  });
  assert.equal(pressing.classes.includes('vinyl-record'), true, `${label}: the record is the shared pressing`);
  assert.match(pressing.bodyBg, /assets\/vinyl-classic\.png/, `${label}: the disc is the photographed vinyl`);
  assert.equal(pressing.backgroundSize, 'contain', `${label}: the photographed disc fills its box`);
  assert.deepEqual(pressing.children, ['vinyl-record__logo-frame'], `${label}: the record holds only the flower`);
  assert.equal(pressing.splashCount, 0, `${label}: no rim, splash, blob or artwork element is generated`);
  assert.equal(pressing.logo, true, `${label}: the signature flower is the label`);
  assert.equal(pressing.src, 'assets/kyrolll-flower-label.png', `${label}: the label is the original flower logo artwork`);
  // The label is a print, not an animation: the plate and its flower are still
  // in every state, motion preference or not.
  assert.equal(pressing.logoAnimation, 'none', `${label}: the centre label is static — it never spins`);
  // Dead centre of the disc — which is the photographed label's own centre.
  assert(Math.abs(pressing.frameOffset[0]) < 1, `${label}: the flower is horizontally centred on the label`);
  assert(Math.abs(pressing.frameOffset[1]) < 1, `${label}: the flower is vertically centred on the label`);
  assert(Math.abs(pressing.frameRatio - 0.30) < 0.01, `${label}: the label plate covers the photographed label`);
  assert(Math.abs(pressing.diameterRatio - 0.92) < 0.01, `${label}: the record keeps its 92% inset diameter`);
  assert.equal(pressing.insideStage, true, `${label}: the record never breaches the artwork stage`);
  assert.equal(pressing.coverFilter, 'none', `${label}: the cover art keeps its original colour`);
  return pressing;
};

// Every rendered colour except the hero tagline's green / pink glitch palette
// must be an equal-channel grey. (A vinyl disc is a photograph of the pressing,
// which this computed-style sweep does not read; the footer's social marks are
// now monochrome `currentColor` SVG, so they need no exemption either.)
const noHue = async (page, label) => {
  const report = await page.evaluate(() => {
    const plain = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor', 'caretColor', 'fill', 'stroke', 'columnRuleColor', 'boxShadow', 'textShadow'];
    const runs = value => [...String(value).matchAll(/rgba?\(([^)]*)\)/g)]
      .map(m => m[1].split(',').slice(0, 3).map(Number))
      .filter(rgb => rgb.length === 3 && rgb.every(Number.isFinite));
    const bad = [];
    let inspected = 0;
    document.querySelectorAll('*').forEach(el => {
      if (el.closest('.brand-tagline')) return;
      const cs = getComputedStyle(el);
      inspected += 1;
      plain.forEach(prop => runs(cs[prop]).forEach(rgb => {
        if (!(rgb[0] === rgb[1] && rgb[1] === rgb[2])) bad.push(el.tagName + '.' + (el.className || '-') + ' ' + prop + ' = ' + cs[prop]);
      }));
    });
    return { bad: [...new Set(bad)], inspected };
  });
  assert(report.inspected > 50, `${label}: the audit really walked the page (${report.inspected} elements)`);
  assert.deepEqual(report.bad, [], `${label}: every non-tagline rendered colour is an equal-channel grey`);
  // The centre label is the original KYROIII logo art — the white flower on its
  // own solid black plate — so the record needs no colour exception at all: the
  // plate is black and white and the artwork supplies it, not the stylesheet.
  const cssText = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(cssText, /\.vinyl-record__logo-frame \{[\s\S]*?background: #000000/, 'the label plate is the logo artwork\'s own solid black');
  assert.doesNotMatch(cssText, /radial-gradient\(circle at 50% 42%/, 'no painted brown-gold label survives — the artwork is the label');
};

// The ALL-CAPS identity, checked on what actually renders: every text node that
// is authored with a lowercase letter must resolve to `text-transform: uppercase`
// (a string that is already caps — the wordmark, say — is left as authored).
const noLowercase = async (page, label) => {
  const report = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const bad = [];
    let node, nodes = 0;
    while ((node = walker.nextNode())) {
      nodes += 1;
      const text = node.textContent.trim();
      if (!/[a-z]/.test(text)) continue;
      const el = node.parentElement;
      if (!el || el.closest('script, style, template, noscript')) continue;
      if (getComputedStyle(el).textTransform !== 'uppercase') bad.push(el.tagName + '.' + (el.className || '-') + ' :: ' + text.slice(0, 40));
    }
    return { bad: [...new Set(bad)], nodes };
  });
  assert(report.nodes > 5, `${label}: the audit really walked the text nodes (${report.nodes})`);
  assert.deepEqual(report.bad, [], `${label}: every text node renders in the ALL-CAPS brand voice`);
};
const CARD = '#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af';
const BEAT_ID = '6c56eda2-df4a-45b0-b9b7-68f8efdbb1af';
// Two isolated forms: the free-download gates record into the FREE DOWNLOADS
// form, and the support desk into its own SUPPORT TICKETS form. Nothing may
// cross between them.
const PROVIDER = 'https://formspree.io/f/mvkkkoew';
const SUPPORT_PROVIDER = 'https://formspree.io/f/mrpplrlg';
// The scheduled second release, [FREE 100%] FUTURE TYPE BEAT - THE FLOW.
const FLOW_ID = '5f9bbcab-e010-4efe-b459-9c9182e1d85b';
const FLOW_CARD = '#card-5f9bbcab-e010-4efe-b459-9c9182e1d85b';
const FLOW_RELEASE = Date.parse('2026-10-19T23:00:00+03:00');
// The third release, [FREE 100%] LIL BABY TYPE BEAT - GREEN FLESH, drops tonight.
const GREEN_FLESH_ID = 'a4acc928-410a-4200-8463-13bd9258058d';
const GREEN_FLESH_CARD = '#card-a4acc928-410a-4200-8463-13bd9258058d';
const GREEN_FLESH_RELEASE = Date.parse('2026-10-22T23:00:00+03:00');
// The fourth release, [FREE 100%] LIL GOTIT TYPE BEAT - SQUISH!, drops tonight.
const SQUISH_ID = 'squish';
const SQUISH_CARD = '#card-squish';
const SQUISH_RELEASE = Date.parse('2026-10-25T23:00:00+02:00');
// The fifth release, [FREE 100%] YEAT TYPE BEAT - JUST D0 IT, is scheduled for
// 23:00 Israel time on 27 October 2026.
const JUST_DO_IT_ID = 'just-d0-it';
const JUST_DO_IT_CARD = '#card-just-d0-it';
const JUST_DO_IT_RELEASE = Date.parse('2026-10-27T23:00:00+02:00');
// The sixth release, [FREE 100%] YEAT TYPE BEAT - A.D.L, drops today at 19:00
// Israel time and wears the white-splatter pressing.
const ADLL_ID = 'adll';
const ADLL_CARD = '#card-adll';
const ADLL_RELEASE = Date.parse('2026-11-02T19:00:00+02:00');
// The seventh release, [FREE 100%] GUNNA TYPE BEAT - VVS MOTION, drops at 22:00
// Israel time on 7 November 2026 — the instant `catalog.js` carries — and its
// record carries the same original flower label as every other beat.
const GUNNA_ID = '72f9b3e3-7d3a-490e-b8b5-5b1e9d8e3668';
const GUNNA_CARD = '#card-' + GUNNA_ID;
const GUNNA_RELEASE = Date.parse('2026-11-07T22:00:00+02:00');
// The eighth release, [FREE 100%] FUTURE TYPE BEAT - WHITE NIGHT, drops at 20:00
// Israel time on 9 November 2026 — the instant `catalog.js` carries.
const WHITE_NIGHT_ID = 'white-night';
const WHITE_NIGHT_CARD = '#card-white-night';
const WHITE_NIGHT_RELEASE = Date.parse('2026-11-09T20:00:00+02:00');
// The store runs eight beats. ALL_LIVE_NOW is a pinned instant just after the
// newest release landed: every card is a live tile there, whatever the machine
// clock says, so the catalog-wide checks stand on firm ground.
const ALL_LIVE_NOW = WHITE_NIGHT_RELEASE + 3600000;

// The store's one durable record is the global exclusive-claims register: it is
// what retires a claimed beat on every page and what remembers the buyer. Gate
// input itself is still never remembered (no unlock set, no address, no
// signature), so the only other key sessionStorage may hold is the catalog
// scroll offset.
const CATALOG_SCROLL_KEY = 'kyrolll_catalog_scroll';
const EXCLUSIVE_CLAIMS_KEY = 'kyrolll_exclusive_claims';
const ALLOWED_LOCAL_KEYS = [EXCLUSIVE_CLAIMS_KEY];
const noGateMemory = async (page, label) => {
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  assert.deepEqual(storage.local.filter(key => !ALLOWED_LOCAL_KEYS.includes(key)), [],
    `${label}: localStorage holds no gate state beyond the exclusive-claims register`);
  assert.deepEqual(storage.session.filter(key => key !== CATALOG_SCROLL_KEY), [], `${label}: sessionStorage holds no gate state`);
};

// Every string drawn on a PDF page, unescaped — the material for the ALL-CAPS
// check (structural tokens like `endobj` are not text and are irrelevant).
const pdfRuns = (text) => [...text.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)]
  .map(m => m[1].replace(/\\([()\\])/g, '$1'));

// Open the beat page, open the package menu and pick a package.
async function pickPackage(page, packageId) {
  await page.goto(`${url}/?beat=flesh`);
  await page.locator(`${CARD} .download-trigger`).click();
  await page.locator('.download-menu.is-open').waitFor();
  assert.equal(await page.locator('.download-tier').count(), 3);
  const pack = await page.evaluate(id => window.KYROlll_PACKAGES.find(item => item.id === id), packageId);
  assert.equal(await page.locator(`.download-tier[data-package="${packageId}"] .download-tier__tag`).innerText(), pack.tag, `${packageId}: the drawer badge matches the package`);
  assert.equal(await page.locator(`.download-tier[data-package="${packageId}"] .download-tier__blurb`).innerText(), pack.blurb, `${packageId}: the drawer description matches the package`);
  // The panel becomes a scroller on short viewports; every tier must keep its
  // natural height (a shrunk flex child is exactly the clipping bug this guards)
  // and the panel must stay on screen.
  // The drawer is part of the trigger, not a popup floating over the page: it is
  // rendered inside the button's own container, spans exactly the button's width
  // and butts straight onto its edge — and the ambient bloom is lit while it is
  // open. Every tier keeps its natural height (a shrunk flex child is exactly the
  // clipping bug this guards) and the panel stays on screen.
  assert(await page.evaluate(() => {
    const menu = document.querySelector('.download-menu');
    const trigger = document.querySelector('[data-download-trigger][aria-expanded="true"]');
    const host = trigger && trigger.parentElement;
    const list = menu && menu.querySelector('.download-menu__list');
    if (!list || !host || !trigger) return false;
    const tiers = Array.from(menu.querySelectorAll('.download-tier'));
    const squished = tiers.some(tier => tier.scrollHeight > tier.clientHeight + 1);
    const natural = tiers.reduce((sum, tier) => sum + tier.getBoundingClientRect().height, 0) + 8 * (tiers.length - 1);
    const box = menu.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    const cs = getComputedStyle(menu);
    /* Root-anchored: a direct child of <body>, painted `fixed`, so no ancestor's
       `overflow` or stacking context can clip or bury it. It is still aligned to
       the button it belongs to, edge to edge, with the seam between them. */
    const rooted = menu.parentElement === document.body && cs.position === 'fixed';
    const aligned = Math.abs(box.left - t.left) < 2 && Math.abs(box.right - t.right) < 2;
    const seam = Math.abs(box.top - t.bottom) < 1.5 || Math.abs(box.bottom - t.top) < 1.5;
    const glow = host.classList.contains('is-menu-open') &&
      getComputedStyle(host, '::after').backgroundImage.includes('radial-gradient') &&
      getComputedStyle(trigger).boxShadow !== 'none';
    const inView = box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
    return !squished && list.clientHeight + 1 >= natural && rooted && aligned && seam && glow && inView;
  }), 'the drawer is root-anchored (fixed on <body>), welded to its trigger with the ambient glow lit, and every tier renders without clipping');
  await page.locator(`.download-tier[data-package="${packageId}"]`).click();
}

// Every gate now closes with the REVIEW & SIGN stage: the terms have to be read
// to the end AND BOTH halves of the signature captured — a FULL name (first and
// last) typed into the field AND a genuine drawing on the pad — before SIGN &
// UNLOCK comes alive. TYPE and DRAW share that one readiness state.
const signStage = (page) => page.locator('.gate-modal__card--sign');
async function readTerms(page) {
  await page.locator('[data-sign-terms]').evaluate(el => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });
}
// Type the full name, ink the pad, read the terms and unlock.
async function signLicense(page, name) {
  await signStage(page).waitFor();
  await page.locator('#sign-name').fill(name);
  await drawSignature(page);
  await readTerms(page);
  await page.locator('[data-sign-submit]').click();
}
// Ink a two-stroke signature on the pad with real pointer input. The pad is
// hidden until DRAW is selected, and it may sit below the dialog's fold, so it
// is scrolled into the card's own viewport before the pointer is measured.
async function drawSignature(page) {
  await page.locator('[data-sign-mode="draw"]').click();
  await page.locator('[data-sign-canvas]').scrollIntoViewIfNeeded();
  const box = await page.locator('[data-sign-canvas]').boundingBox();
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const stroke = async points => {
    const first = at(points[0][0], points[0][1]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const [fx, fy] of points.slice(1)) { const p = at(fx, fy); await page.mouse.move(p.x, p.y); }
    await page.mouse.up();
  };
  await stroke([[0.10, 0.72], [0.16, 0.30], [0.24, 0.66], [0.32, 0.26], [0.40, 0.70]]);
  await stroke([[0.48, 0.52], [0.58, 0.24], [0.70, 0.62], [0.82, 0.30], [0.92, 0.56]]);
}
// The multi-point vector paths in a PDF — only a drawn signature emits those.
const drawnPaths = text => [...text.matchAll(/m ((?:[\d.]+ [\d.]+ l )+)/g)]
  .map(m => m[1].trim().split(/ l /))
  .filter(path => path.length >= 2);

// Every package reaches the same friction-free two-step gate — the email form,
// then REVIEW & SIGN — and none of them renders a social step, a like, a follow
// or a subscribe. There is nothing to hold, count or click through.
async function expectCleanGate(page) {
  assert.equal(await page.locator('.gate-step').count(), 0, 'the gate carries no social step');
  assert.equal(await page.locator('[data-gate-action]').count(), 0, 'the gate carries no like/follow action');
  assert.equal(await page.locator('.gate-modal a[href*="youtube.com"], .gate-modal a[href*="instagram.com"], .gate-modal a[href*="tiktok.com"], .gate-modal a[href*="x.com"]').count(), 0,
    'the gate opens no social profile');
  assert.equal(await page.locator('#gate-email').count(), 1, 'the gate asks for the email');
  assert.equal(await page.locator('#gate-optin').count(), 1, 'the gate asks for the mandatory opt-in');
}

try {
  browser = await chromium.launch({ headless: true });
  const desktop = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await desktop.goto(`${url}/?now=${ALL_LIVE_NOW}`);
  // The preloader's flower and the hero flower can become ready in the same
  // frame (the veil is removed a moment later), so wait on the hero stage.
  await desktop.locator('.brand-logo-container .logo-stage.is-ready').waitFor();
  // The veil must not lift until the hero flower is fully built — wait for it to
  // go, then confirm the flower stayed built (is-built is a permanent marker).
  await desktop.locator('#preloader').waitFor({ state: 'detached' });
  assert.equal(await desktop.locator('.brand-logo-container .logo-stage.is-built').count(), 1);
  assert.equal(await desktop.evaluate(() => document.documentElement.classList.contains('preloader-armed')), false);
  await noOverflow(desktop);
  await noHue(desktop, 'the storefront');
  await noLowercase(desktop, 'the storefront');
  // The footer's four profiles are pure black-and-white marks, not coloured
  // boxes: each anchor is a transparent 52px tap target whose inline SVG is
  // painted in `currentColor`, so the icon sits directly in the black field.
  const social = await desktop.locator('.footer__social a').evaluateAll(nodes => nodes.map(node => {
    const svg = node.querySelector('svg');
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      className: node.className,
      text: node.textContent.trim(),
      href: node.getAttribute('href'),
      label: node.getAttribute('aria-label'),
      title: node.getAttribute('title'),
      rel: node.getAttribute('rel'),
      svg: !!svg,
      viewBox: svg && svg.getAttribute('viewBox'),
      fills: svg ? [...svg.querySelectorAll('[fill]')].map(child => child.getAttribute('fill')) : [],
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      radius: parseFloat(style.borderTopLeftRadius),
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      touchAction: style.touchAction,
    };
  }));
  assert.deepEqual(social.map(item => ({ href: item.href, label: item.label })), [
    { href: 'https://www.youtube.com/@KYROlll00', label: 'KYROIII on YouTube' },
    { href: 'https://www.instagram.com/kyrolll00/', label: 'KYROIII on Instagram' },
    { href: 'https://www.tiktok.com/@kyrolll00', label: 'KYROIII on TikTok' },
    { href: 'https://x.com/KYROlll00', label: 'KYROIII on X' }
  ], 'the footer links every official social profile');
  social.forEach(item => {
    assert.equal(item.text, '', `${item.label} renders as an icon, not a text link`);
    assert.equal(item.svg, true, `${item.label} carries its official SVG mark`);
    assert.equal(item.viewBox, '0 0 24 24', `${item.label} uses the square brand viewBox`);
    assert.equal(item.rel, 'noopener noreferrer', `${item.label} opens safely in a new tab`);
    assert(item.width >= 44 && item.height >= 44, `${item.label} is a ${item.width}x${item.height} tap target`);
    assert.equal(item.radius, 0, `${item.label} sits on no rounded tile`);
    assert.equal(item.background, 'rgba(0, 0, 0, 0)', `${item.label} has no background box`);
    assert.equal(item.borderWidth, '0px', `${item.label} draws no border box`);
    assert(item.fills.length >= 1 && item.fills.every(fill => fill === 'currentColor' || fill === 'none'), `${item.label} is a monochrome currentColor mark`);
    assert.equal(item.touchAction, 'manipulation', `${item.label} answers the first tap`);
  });
  assert.match(social[0].className, /social-icon--youtube/, 'the YouTube badge carries its own modifier');
  assert.deepEqual(social[0].fills.sort(), ['currentColor', 'none'], 'the YouTube mark is a white outline and play');
  assert.match(social[1].className, /social-icon--instagram/, 'the Instagram badge carries its own modifier');
  assert.deepEqual(social[1].fills.sort(), ['currentColor', 'none', 'none'], 'the Instagram mark is a white line icon');
  assert.match(social[2].className, /social-icon--tiktok/, 'the TikTok badge carries its own modifier');
  assert.deepEqual(social[2].fills, ['currentColor'], 'the TikTok mark is one white silhouette');
  assert.match(social[3].className, /social-icon--x/, 'the X badge carries its own modifier');
  assert.deepEqual(social[3].fills, ['currentColor'], 'the X mark is one white silhouette');
  assert.equal(await desktop.locator('.footer a[href^="mailto:"]').count(), 0, 'the footer no longer hands anyone to a mail client');
  assert.equal(await desktop.locator('.footer__support[data-support-open]').count(), 1, 'the footer SUPPORT control opens the built-in desk');
  assert.equal(await desktop.locator('.brand-tagline__text').textContent(), 'THAT MY FAVORITE');
  assert.equal(await desktop.locator('.brand-tagline__heart svg').count(), 1);
  assert.deepEqual(await desktop.locator('.brand-tagline__text').evaluate(el => ({
    green: getComputedStyle(el, '::before').color,
    pink: getComputedStyle(el, '::after').color,
  })), { green: 'rgb(57, 255, 139)', pink: 'rgb(255, 62, 165)' });
  assert.equal(await desktop.locator('#grid .catalog-tile').count(), 8);
  assert.equal(await desktop.locator('#grid .catalog-tile').first().getAttribute('id'), 'card-' + WHITE_NIGHT_ID, 'the newest release leads the grid');
  assert.equal(await desktop.evaluate(() => window.KYROlll_HELPERS.beatById('adll').title), '[FREE 100%] YEAT TYPE BEAT - A.D.L', 'ADLL is live in the catalog');
  assert.equal(await desktop.evaluate(() => window.KYROlll_HELPERS.beatById('white-night').title), '[FREE 100%] FUTURE TYPE BEAT - WHITE NIGHT', 'WHITE NIGHT is live in the catalog');
  assert.equal(await desktop.locator('.catalog-tile__art img').first().evaluate(el => getComputedStyle(el).filter), 'none', 'catalog cover art keeps its original colour');
  assert.match(await desktop.locator(CARD).innerText(), /\[FREE 100%\] DON TOLIVER TYPE BEAT - FLESH/i);
  assert.match(await desktop.locator(GREEN_FLESH_CARD).innerText(), /\[FREE 100%\] LIL BABY TYPE BEAT - GREEN FLESH/i);
  assert.match(await desktop.locator(SQUISH_CARD).innerText(), /\[FREE 100%\] LIL GOTIT TYPE BEAT - SQUISH!/i);
  assert.match(await desktop.locator(JUST_DO_IT_CARD).innerText(), /\[FREE 100%\] YEAT TYPE BEAT - JUST D0 IT/i);
  assert.match(await desktop.locator(ADLL_CARD).innerText(), /\[FREE 100%\] YEAT TYPE BEAT - A\.D\.L/i);
  assert.match(await desktop.locator('.marquee-track').innerText(), /YEAT TYPE BEAT - A\.D\.L/i, 'the ticker announces the newest drop');
  assert.match(await desktop.locator('.marquee-track').innerText(), /YEAT TYPE BEAT - JUST D0 IT/i, 'the ticker announces the fifth drop');
  assert.match(await desktop.locator('.marquee-track').innerText(), /8 RELEASES LIVE/, 'the studio count is the eight live releases');
  assert.match(await desktop.locator('.marquee-track').innerText(), /FUTURE TYPE BEAT - WHITE NIGHT/i, 'the ticker announces the newest drop');
  assert.match(await desktop.locator('.marquee-track').innerText(), /LIL GOTIT TYPE BEAT - SQUISH!/i, 'the ticker announces the fourth drop');
  assert.match(await desktop.locator('.marquee-track').innerText(), /LIL BABY TYPE BEAT - GREEN FLESH/i, 'the ticker announces the renamed third drop');
  await shot(desktop, 'desktop');

  // ------------------------------------------------------------------ marquee
  // The ticker is a continuously moving strip and must never hitch while the
  // page scrolls, so it is isolated from scroll entirely: its own composited
  // layer on the banner *and* the track, a paint-isolated box, and no scroll
  // handler or scroll-driven class change anywhere near it. This page keeps
  // motion on so the animation really runs.
  const ticker = await setupPage({ viewport: { width: 1280, height: 900 } });
  await ticker.goto(url);
  await ticker.locator('.marquee-track').waitFor();
  const marqueeCss = await ticker.evaluate(() => {
    const banner = getComputedStyle(document.querySelector('.marquee-banner'));
    const track = getComputedStyle(document.querySelector('.marquee-track'));
    return {
      bannerWillChange: banner.willChange,
      bannerTransform: banner.transform,
      bannerContain: banner.contain,
      trackWillChange: track.willChange,
      trackTransform: track.transform,
      bannerOpacity: banner.opacity,
      bannerClasses: document.querySelector('.marquee-banner').className,
    };
  });
  assert.match(marqueeCss.bannerWillChange, /transform/, 'the marquee banner is promoted for transforms');
  assert.match(marqueeCss.bannerTransform, /matrix/, 'the marquee banner carries a GPU transform');
  assert.match(marqueeCss.bannerContain, /paint/, 'the marquee banner is paint-isolated from the rest of the page');
  assert.match(marqueeCss.trackWillChange, /transform/, 'the moving track keeps its own compositor layer');
  assert.match(marqueeCss.trackTransform, /matrix/, 'the moving track carries a GPU transform');
  // The banner is exempt from the scroll reveal: an ancestor held at opacity < 1
  // groups the strip and drops the ticker's compositor animation for the length
  // of the fade — which fires exactly as the user scrolls the strip into view.
  assert.match(marqueeCss.bannerClasses, /reveal/, 'the marquee is still offered the shared reveal');
  assert.equal(marqueeCss.bannerOpacity, '1', 'the marquee never fades behind a reveal curtain');
  const marqueeAnim = await ticker.evaluate(() => {
    const animations = document.querySelector('.marquee-track').getAnimations();
    const a = animations.find(x => x.effect && x.effect.getKeyframes().some(k => k.transform));
    if (!a) return null;
    const kf = a.effect.getKeyframes();
    return {
      easing: kf.map(k => k.easing),
      transforms: kf.map(k => k.transform),
      iterationCount: String(a.effect.getTiming().iterations),
    };
  });
  assert(marqueeAnim, 'the ticker runs a transform animation');
  assert(marqueeAnim.easing.every(e => e === 'linear'), 'the ticker moves with linear timing');
  assert(marqueeAnim.transforms.every(t => /translate3d/.test(t)), 'the ticker animates a GPU translate3d, never a layout property');
  assert.equal(marqueeAnim.iterationCount, 'Infinity', 'the ticker loops forever');
  // A resize that changes only the height (a phone's address bar collapsing as
  // you scroll) must not rebuild the track: that synchronous re-layout plus a
  // fresh animation is exactly what hitched the ticker during a scroll. Only a
  // real width change may rebuild.
  const resizeGuard = await ticker.evaluate(async () => {
    const track = document.querySelector('.marquee-track');
    track.firstElementChild.__probe = 'keep';
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { kept: track.firstElementChild.__probe === 'keep', copies: track.querySelectorAll('.marquee-copy').length };
  });
  assert.equal(resizeGuard.copies, 2, 'the ticker is built from two identical copies');
  assert(resizeGuard.kept, 'a height-only resize never rebuilds the ticker');
  await ticker.setViewportSize({ width: 1100, height: 900 });
  await ticker.waitForTimeout(150);
  assert.equal(await ticker.evaluate(() => document.querySelector('.marquee-track').firstElementChild.__probe === 'keep'), false, 'a real width change does rebuild the ticker');
  await ticker.close();

  // Direct beat link: the card carries one "DOWNLOAD FREE" trigger.
  const direct = await setupPage({ viewport: { width: 1024, height: 800 }, reducedMotion: 'reduce', acceptDownloads: true });
  await direct.goto(`${url}/?beat=flesh`);
  assert.match(await direct.title(), /FLESH/);
  assert.equal(await direct.locator('#grid .beat-detail').count(), 1);
  assert.match(await direct.locator(CARD).innerText(), /130 BPM \/\/ AM/i);
  assert.equal(await direct.locator(`${CARD} audio`).getAttribute('src'), 'assets/previews/flesh.mp3');
  assert.equal(await direct.locator(`${CARD} .download-trigger`).count(), 1);
  const stableSelectors = [
    '.beat-detail',
    '.beat-preview',
    '.beat-detail__artwork-wrap',
    '.beat-detail__artwork',
    '.beat-detail__artwork img',
  ];
  for (const selector of stableSelectors) {
    const element = direct.locator(selector).first();
    const measure = () => element.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollY: window.scrollY };
    });
    const before = await measure();
    await element.hover();
    const after = await measure();
    assert.deepEqual(
      [after.x, after.y + after.scrollY, after.width, after.height],
      [before.x, before.y + before.scrollY, before.width, before.height],
      `${selector} remains stationary on hover`,
    );
  }
  // Every beat plays the identical photographed 12": FLESH included, with no
  // per-beat finish and no hand-assigned vinyl variant anywhere in the catalog.
  const fleshVinyl = await assertPressing(direct, CARD, 'FLESH', { reducedMotion: true });
  const catalogFinishes = await direct.evaluate(() => window.KYROlll_CATALOG
    .filter(beat => beat.vinylVariant || beat.vinyl)
    .map(beat => beat.slug));
  assert.deepEqual(catalogFinishes, [], 'no beat carries a hand-assigned vinyl finish');
  assert.equal(fleshVinyl.logo, true, 'FLESH carries the signature flower on the photographed label');
  await shot(direct, 'beat-detail');
  await direct.close();

  const gridDeckGeometry = (page) => page.evaluate(() => {
    const rect = (el) => {
      const box = el.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top + window.scrollY,
        width: box.width,
        height: box.height,
      };
    };
    const grid = document.getElementById('grid');
    const gridStyle = getComputedStyle(grid);
    return {
      scrollY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      grid: rect(grid),
      padding: gridStyle.padding,
      gap: gridStyle.gap,
      children: [...grid.children].map((child) => {
        const box = rect(child);
        return {
          id: child.id,
          className: child.className,
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        };
      }),
    };
  });

  // ------------------------------------------------------- catalog scroll memory
  // Opening a beat rewrites the URL and rebuilds the grid. The catalog offset is
  // remembered in sessionStorage for that trip, so Back — and an explicit exit
  // through ALL BEATS — lands exactly where the visitor left, not at the top of
  // a long catalog. Only the offset is stored: no gate state, no address.
  const checkScrollMemory = async (page, label, tap, viewportHeight) => {
    await page.goto(`${url}/?now=${ALL_LIVE_NOW}`);
    await page.locator('#grid .catalog-tile').first().waitFor();
    await page.locator('#preloader').waitFor({ state: 'detached' });
    await page.evaluate(() => {
      const card = document.querySelector('#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af');
      window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 180);
    });
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => window.scrollY);
    assert(before > 300, `${label}: the catalog really scrolled (${before}px)`);
    const point = await page.evaluate(() => {
      const link = document.querySelector('#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af .catalog-tile__link');
      const rect = link.getBoundingClientRect();
      return { x: Math.round(rect.left + Math.min(60, rect.width / 2)), y: Math.round(rect.top + 40) };
    });
    assert(point.y > 0 && point.y < viewportHeight, `${label}: the tile sits under the pointer (${point.y})`);
    await tap(point);
    await page.locator('#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af.beat-detail').waitFor();
    assert.match(page.url(), /\?beat=6c56eda2/, `${label}: the tile opens its beat detail`);
    await page.waitForTimeout(250);
    const detailDeckBefore = await gridDeckGeometry(page);
    await page.waitForTimeout(700);
    const detailDeckAfter = await gridDeckGeometry(page);
    assert.deepEqual(Object.values(detailDeckAfter), Object.values(detailDeckBefore), `${label}: the beat-detail grid deck is locked while settling`);
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
    assert.deepEqual(Object.keys(stored), [CATALOG_SCROLL_KEY], `${label}: only the scroll offset is remembered`);
    assert(Math.abs(Number(stored[CATALOG_SCROLL_KEY]) - before) <= 2, `${label}: the saved offset is the catalog position`);
    await page.goBack();
    await page.locator('#grid .catalog-tile').first().waitFor();
    await page.waitForFunction(top => Math.abs(window.scrollY - top) <= 2, before, { timeout: 5000 });
    assert(Math.abs(await page.evaluate(() => window.scrollY) - before) <= 2, `${label}: Back restores the exact catalog position`);
    const catalogBefore = await gridDeckGeometry(page);
    await page.waitForTimeout(700);
    const catalogAfter = await gridDeckGeometry(page);
    assert.deepEqual(Object.values(catalogAfter), Object.values(catalogBefore), `${label}: the catalog grid deck is locked after Back`);
    // The ALL BEATS control is the second way out of a beat page; it uses the
    // same memory instead of jumping to the grid heading.
    await tap(point);
    await page.locator('#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af.beat-detail').waitFor();
    await page.locator('#all-beats-link').click();
    await page.locator('#grid .catalog-tile').first().waitFor();
    await page.waitForFunction(top => Math.abs(window.scrollY - top) <= 2, before, { timeout: 5000 });
    assert(Math.abs(await page.evaluate(() => window.scrollY) - before) <= 2, `${label}: ALL BEATS restores the exact catalog position`);
    const allBeatsBefore = await gridDeckGeometry(page);
    await page.waitForTimeout(700);
    const allBeatsAfter = await gridDeckGeometry(page);
    assert.deepEqual(Object.values(allBeatsAfter), Object.values(allBeatsBefore), `${label}: the catalog grid deck is locked after ALL BEATS`);
    await page.close();
  };
  const desktopScroll = await setupPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await checkScrollMemory(desktopScroll, 'desktop', ({ x, y }) => desktopScroll.mouse.click(x, y), 900);
  const phoneScroll = await setupPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await checkScrollMemory(phoneScroll, 'phone', ({ x, y }) => phoneScroll.touchscreen.tap(x, y), 844);

  // The way back to the catalog is a sticky glass rail, not a link that scrolls
  // away: it is hidden on the catalog, visible on every beat page, still pinned to
  // the top of the viewport after a long scroll, a real 44px tap target, and it
  // returns to the remembered catalog offset rather than the top of the grid.
  const railPage = await setupPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await railPage.goto(`${url}/`);
  await railPage.locator('#grid .catalog-tile').first().waitFor();
  assert.equal(await railPage.locator('#beat-navigation').isVisible(), false, 'the catalog hides the ALL BEATS rail');
  await railPage.locator('#grid .catalog-tile__link').first().click();
  await railPage.locator('.beat-detail').waitFor();
  assert.equal(await railPage.locator('#beat-navigation').isVisible(), true, 'the beat page shows the ALL BEATS rail');
  const railContract = await railPage.evaluate(() => {
    const nav = document.getElementById('beat-navigation');
    const link = document.getElementById('all-beats-link');
    const navStyle = getComputedStyle(nav);
    const linkStyle = getComputedStyle(link);
    const rect = link.getBoundingClientRect();
    return {
      position: navStyle.position,
      top: navStyle.top,
      zIndex: Number(navStyle.zIndex),
      veilZ: Number(getComputedStyle(document.querySelector('.preloader')).zIndex),
      linkHeight: Math.round(rect.height),
      linkWidth: Math.round(rect.width),
      linkText: link.innerText.replace(/\s+/g, ' ').trim(),
      isReturnControl: link.hasAttribute('data-beat-back'),
      radius: linkStyle.borderTopLeftRadius,
      cursor: linkStyle.cursor,
      label: link.getAttribute('aria-label'),
    };
  });
  assert.equal(railContract.position, 'sticky', 'the ALL BEATS rail is sticky');
  assert.equal(railContract.top, '0px', 'the rail pins to the top of the viewport');
  assert(railContract.zIndex < railContract.veilZ, 'the rail paints under the loading veil');
  assert(railContract.zIndex < 999999, 'the rail paints under the package drawer and the gate modal');
  assert.equal(railContract.linkText, '← ALL BEATS', 'the rail reads as a back control');
  assert.equal(railContract.label, 'Back to all beats', 'the rail is labelled for assistive tech');
  assert.equal(railContract.isReturnControl, true, 'the link is marked as the beat-page return control');
  assert.equal(railContract.radius, '999px', 'the return control is a pill, not a bare text link');
  assert.equal(railContract.cursor, 'pointer', 'the return control reads as clickable');
  assert(railContract.linkHeight >= 44, `the return control is a ${railContract.linkHeight}px tap target`);
  assert(railContract.linkWidth >= 120, `the return control is a ${railContract.linkWidth}px wide target`);
  await railPage.locator('#all-beats-link').click();
  await railPage.locator('#grid .catalog-tile').first().waitFor();
  // A cold beat link lands with the rail already pinned at the very top of the
  // viewport — no hunting, no waiting for the card to settle. The landing is one
  // explicit instant scroll (`window.scrollTo`), never a smooth travel.
  await railPage.goto(`${url}/?beat=flesh`, { waitUntil: 'domcontentloaded' });
  await railPage.locator('.beat-detail').waitFor();
  const landing = await railPage.evaluate(() => ({
    railTop: Math.round(document.getElementById('beat-navigation').getBoundingClientRect().top),
    railVisible: document.getElementById('beat-navigation').getBoundingClientRect().bottom > 0,
    cardTop: Math.round(document.querySelector('.beat-detail').getBoundingClientRect().top),
    scrollY: Math.round(window.scrollY),
  }));
  assert.equal(landing.railTop, 0, 'the rail is pinned at the absolute top the moment the beat page lands');
  assert.equal(landing.railVisible, true, 'the rail is in plain sight on landing');
  assert(landing.cardTop >= 44, `the beat card clears the pinned rail on landing (${landing.cardTop}px)`);
  assert(landing.scrollY > 0, 'a deep beat link scrolls the card into view instantly');
  await railPage.evaluate(() => window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight - window.innerHeight)));
  await railPage.waitForTimeout(150);
  const pinnedTop = await railPage.evaluate(() => document.getElementById('beat-navigation').getBoundingClientRect().top);
  assert(Math.abs(pinnedTop) <= 1, `the rail stays pinned while the beat page scrolls (top ${pinnedTop})`);
  await railPage.locator('#all-beats-link').click();
  await railPage.locator('#grid .catalog-tile').first().waitFor();
  assert.equal(await railPage.evaluate(() => document.documentElement.classList.contains('beat-page')), false, 'the return control leaves the beat page');
  await railPage.close();

  // The reveal is deliberately bold, but it is still just a translate: the
  // record must clear the sleeve enough to show the centre label plate, stay
  // inside the stage, and leave the page with zero horizontal scroll on a phone
  // and a desktop. The sleeve and stage must not move when `vinyl-open` lands.
  const vinylPage = await setupPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  await vinylPage.goto(`${url}/?beat=flesh`);
  await vinylPage.locator('.beat-detail').waitFor();
  const vinylGeometry = () => vinylPage.evaluate(() => {
    const stage = document.querySelector('.beat-detail__artwork-wrap').getBoundingClientRect();
    const sleeve = document.querySelector('.beat-detail__artwork').getBoundingClientRect();
    const recordEl = document.querySelector('.vinyl-record');
    const record = recordEl.getBoundingClientRect();
    // The plate is static, so its box is the label's box at every moment.
    const logoFrame = document.querySelector('.vinyl-record__logo-frame').getBoundingClientRect();
    const logoImage = document.querySelector('.vinyl-record__logo');
    const logoStyle = getComputedStyle(logoImage);
    // The label plate covers the photographed label: it is 30% of the disc's
    // diameter, a hair wider than the 28.06% printed circle underneath it.
    const labelDiameter = record.width * 0.30;
    const label = {
      left: record.left + record.width / 2 - labelDiameter / 2,
      right: record.left + record.width / 2 + labelDiameter / 2,
      top: record.top + record.height / 2 - labelDiameter / 2 + scrollY,
      bottom: record.top + record.height / 2 + labelDiameter / 2 + scrollY,
    };
    return {
      stage: { left: stage.left, right: stage.right, top: stage.top + scrollY, width: stage.width, height: stage.height },
      sleeve: { left: sleeve.left, right: sleeve.right, top: sleeve.top + scrollY, bottom: sleeve.bottom + scrollY, width: sleeve.width, height: sleeve.height },
      record: { left: record.left, right: record.right, top: record.top + scrollY, bottom: record.bottom + scrollY, width: record.width, height: record.height },
      label,
      logo: { left: logoFrame.left, right: logoFrame.right, top: logoFrame.top + scrollY, bottom: logoFrame.bottom + scrollY, width: logoFrame.width, height: logoFrame.height },
      logoAnimation: {
        name: logoStyle.animationName,
        duration: logoStyle.animationDuration,
        iteration: logoStyle.animationIterationCount,
        timing: logoStyle.animationTimingFunction,
      },
      viewport: { width: innerWidth, scrollWidth: document.documentElement.scrollWidth },
      transform: getComputedStyle(recordEl).transform,
    };
  });
  const tucked = await vinylGeometry();
  const tuckedPaint = await vinylPage.evaluate(() => {
    const record = document.querySelector('.vinyl-record');
    const img = document.querySelector('.vinyl-record__logo');
    const rs = getComputedStyle(record);
    const is = getComputedStyle(img);
    return {
      discOpacity: rs.opacity,
      discVisibility: rs.visibility,
      discTransition: rs.transitionProperty,
      discWillChange: rs.willChange,
      discBackface: rs.backfaceVisibility,
      discPosition: rs.position,
      imgOpacity: is.opacity,
      imgVisibility: is.visibility,
      imgAnimation: is.animationName,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      loading: img.getAttribute('loading'),
    };
  });
  assert.equal(await vinylPage.locator('.beat-detail').evaluate(el => el.classList.contains('vinyl-open')), false, 'the record starts tucked behind the sleeve');
  // A tucked disc hides by paint, never by opacity: a fade made the label arrive
  // half-there (measured at 0.52–0.75 mid-slide), so the disc is opaque for its
  // whole life and only its paint is paused while the sleeve covers it.
  assert.equal(tuckedPaint.discOpacity, '1', 'the tucked disc is already fully opaque — the label never fades in');
  assert.equal(tuckedPaint.discVisibility, 'hidden', 'a tucked disc takes no paint behind the opaque sleeve');
  assert.equal(tuckedPaint.discTransition, 'transform', 'the reveal transitions the transform only');
  assert.match(tuckedPaint.discWillChange, /transform/, 'the tucked disc keeps its compositor layer');
  assert.equal(tuckedPaint.discBackface, 'hidden', 'the tucked disc hides its backface during the GPU slide');
  assert.equal(tuckedPaint.discPosition, 'absolute', 'the tucked disc sits outside document flow');
  assert.equal(tuckedPaint.imgOpacity, '1', 'the label print is opaque while the disc waits');
  assert.equal(tuckedPaint.imgVisibility, 'visible', 'nothing on the label suppresses its own paint');
  assert.equal(tuckedPaint.imgAnimation, 'none', 'the label carries no animation even while tucked');
  // The label is fetched eagerly and decoded synchronously, so the flower is
  // already on the plate when the disc emerges instead of popping in later.
  assert.equal(tuckedPaint.loading, null, 'the label is never lazy-loaded');
  assert.equal(tuckedPaint.complete, true, 'the label artwork has finished loading before the reveal');
  assert.equal(tuckedPaint.naturalWidth, 1024, 'the label artwork is decoded at its full size before the reveal');
  assert(tucked.record.right <= tucked.sleeve.right + 1, 'the tucked record sits behind the sleeve');
  // The 1.35 s class timer shares the main thread with the preloader's flower
  // build, which can block for several seconds on a software rasteriser; allow
  // for that without weakening the reveal assertions themselves.
  await vinylPage.locator('.beat-detail.vinyl-open').waitFor({ timeout: 15000 });
  const revealSamples = [];
  for (let frame = 0; frame < 10; frame += 1) {
    await vinylPage.waitForTimeout(110);
    revealSamples.push(await vinylGeometry());
  }
  const phoneReveal = await vinylGeometry();
  const openPaint = await vinylPage.evaluate(() => {
    const record = document.querySelector('.vinyl-record');
    const img = document.querySelector('.vinyl-record__logo');
    const rs = getComputedStyle(record);
    const is = getComputedStyle(img);
    return {
      discOpacity: rs.opacity,
      discVisibility: rs.visibility,
      discWillChange: rs.willChange,
      discBackface: rs.backfaceVisibility,
      discPosition: rs.position,
      imgOpacity: is.opacity,
      imgVisibility: is.visibility,
      imgAnimation: is.animationName,
      imgTransform: is.transform,
    };
  });
  // The pulled-out disc is in exactly the paint state it had while tucked: only
  // the transform ever moved, so nothing about the label can change or drop
  // when the 1 s slide ends.
  assert.equal(openPaint.discOpacity, '1', 'the disc stays fully opaque through the reveal');
  assert.equal(openPaint.discVisibility, 'visible', 'the emerging disc is painted');
  assert.match(openPaint.discWillChange, /transform/, 'the opened disc keeps its compositor layer');
  assert.equal(openPaint.discBackface, 'hidden', 'the opened disc keeps its backface hidden');
  assert.equal(openPaint.discPosition, 'absolute', 'the opened disc remains outside document flow');
  assert(Math.abs(phoneReveal.record.top - tucked.record.top) <= 1, 'the vinyl slide keeps its vertical position while moving horizontally');
  assert(Math.abs(phoneReveal.record.height - tucked.record.height) <= 1, 'the vinyl slide never resizes the disc');
  assert.equal(openPaint.imgOpacity, '1', 'the label print is opaque on the exposed disc');
  assert.equal(openPaint.imgVisibility, 'visible', 'the label print is painted on the exposed disc');
  assert.equal(openPaint.imgAnimation, 'none', 'the exposed label is still a static print');
  assert.equal(openPaint.imgTransform, 'none', 'the exposed label takes no transform');
  const checkContained = (sample, label) => {
    assert(sample.viewport.scrollWidth <= sample.viewport.width, `${label}: zero horizontal page overflow`);
    assert(sample.record.right <= sample.stage.right + 1, `${label}: the record never leaves the stage on the right`);
    assert(sample.record.left >= sample.stage.left - 1, `${label}: the record never leaves the stage on the left`);
    // The 92% diameter and 4% top/bottom inset are the fix for the circular
    // record poking past the sleeve's horizontal edges.
    assert(sample.record.top >= sample.sleeve.top - 0.5, `${label}: the record top stays inside the sleeve top`);
    assert(sample.record.bottom <= sample.sleeve.bottom + 0.5, `${label}: the record bottom stays inside the sleeve bottom`);
  };
  const checkReveal = (sample, label) => {
    checkContained(sample, label);
    assert(sample.record.right - sample.sleeve.right > sample.stage.width * 0.3, `${label}: the disc clears the sleeve generously`);
    assert(sample.label.right - sample.sleeve.right > 20, `${label}: the centre label plate is exposed`);
    // The complete logo is inside the label plate and entirely to the right of
    // the sleeve once the record has ridden out: no petal is cropped.
    assert(sample.logo.left >= sample.sleeve.right - 0.5, `${label}: the whole logo clears the sleeve edge`);
    assert(sample.logo.right <= sample.label.right + 0.5, `${label}: the whole logo stays on the exposed label`);
    assert(sample.logo.left >= sample.label.left - 0.5, `${label}: the whole logo stays on the label`);
    assert(sample.logo.top >= sample.label.top - 0.5, `${label}: the logo top stays on the label`);
    assert(sample.logo.bottom <= sample.label.bottom + 0.5, `${label}: the logo bottom stays on the label`);
  };
  for (const sample of revealSamples) checkContained(sample, 'phone, mid-reveal');
  checkReveal(phoneReveal, 'phone, fully open');
  assert(Math.abs(phoneReveal.sleeve.width / phoneReveal.stage.width - 0.6) < 0.01, 'the phone cover sleeve is 60% of the stage');
  assert.equal(phoneReveal.logoAnimation.name, 'none', 'the centre label carries no animation at all');
  const spinA = await vinylPage.locator('.vinyl-record__logo').evaluate(el => getComputedStyle(el).transform);
  await vinylPage.waitForTimeout(180);
  const spinB = await vinylPage.locator('.vinyl-record__logo').evaluate(el => getComputedStyle(el).transform);
  assert.equal(spinA, 'none', 'the centre label carries no transform at all');
  assert.equal(spinA, spinB, 'the centre label never rotates — it is a static print');
  assert(phoneReveal.record.left - tucked.record.left > phoneReveal.stage.width * 0.25, 'the phone reveal is a real slide, not a nudge');
  assert.match(phoneReveal.transform, /matrix/, 'the opened disc carries a composited transform');
  // The reveal only moves the record: the stage and sleeve keep their document
  // position and size through the whole 1.35 s delay + slide.
  assert.deepEqual([phoneReveal.stage.left, phoneReveal.stage.top, phoneReveal.stage.width, phoneReveal.stage.height], [tucked.stage.left, tucked.stage.top, tucked.stage.width, tucked.stage.height], 'the phone stage never moves');
  assert.deepEqual([phoneReveal.sleeve.left, phoneReveal.sleeve.top, phoneReveal.sleeve.width, phoneReveal.sleeve.height], [tucked.sleeve.left, tucked.sleeve.top, tucked.sleeve.width, tucked.sleeve.height], 'the phone sleeve never moves');
  // The same contract at the two intermediate widths as well: 375px is the
  // narrowest phone the store targets, and 768px is the single-column tablet.
  for (const [width, height] of [[375, 812], [768, 1024]]) {
    await vinylPage.setViewportSize({ width, height });
    await vinylPage.waitForTimeout(350);
    const sample = await vinylGeometry();
    checkReveal(sample, `${width}px`);
    assert(Math.abs(sample.sleeve.width / sample.stage.width - 0.6) < 0.01, `${width}px: the cover sleeve stays 60% of the stage`);
  }
  // The same contract at the desktop width.
  await vinylPage.setViewportSize({ width: 1440, height: 1000 });
  await vinylPage.waitForTimeout(350);
  const desktopReveal = await vinylGeometry();
  checkReveal(desktopReveal, 'desktop');
  assert(Math.abs(desktopReveal.sleeve.width / desktopReveal.stage.width - 0.6) < 0.01, 'the desktop cover sleeve is 60% of the stage');
  assert(desktopReveal.sleeve.width >= 340, 'the desktop cover sleeve stays a large, commanding square');
  assert(desktopReveal.record.left - desktopReveal.sleeve.left > desktopReveal.stage.width * 0.3, 'the desktop reveal is equally generous');
  // THE FLOW plays the identical photographed pressing: no per-beat finish, no
  // rim element, and the retired modifier classes are gone.
  await vinylPage.goto(`${url}/?beat=the-flow`);
  await vinylPage.locator('.beat-detail').waitFor();
  assert.equal(await vinylPage.locator('.vinyl-record__rim').count(), 0, 'no synthetic rim is generated');
  assert.equal(await vinylPage.locator('.vinyl-record--white').count(), 0, 'the retired pearl-disc modifier is gone');
  assert.equal(await vinylPage.locator('.vinyl-record--gold-rim').count(), 0, 'the retired gold-rim modifier is gone');
  await assertPressing(vinylPage, FLOW_CARD, 'THE FLOW');
  await vinylPage.close();

  // Package 1 — MP3 Lease: the email gate. It asks from scratch every single
  // time: the submit stays locked until the address is valid AND the mandatory
  // opt-in is ticked, a malformed address is refused (and never posted), and a
  // valid one unlocks the clean download page — the tagged MP3 plus the PDF
  // license (no raw text preview, no .txt, no copy button).
  const serials = [];
  const mp3Page = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await pickPackage(mp3Page, 'mp3');
  await mp3Page.locator('.gate-modal').waitFor();
  assert.equal(await mp3Page.locator('.gate-step').count(), 0, 'the MP3 lease carries no social step');
  assert.equal(await mp3Page.locator('[data-gate-action]').count(), 0, 'the MP3 lease asks for the email and opt-in only');
  assert.equal(await mp3Page.locator('#gate-optin').isChecked(), true, 'the opt-in starts ticked');
  assert.equal(await mp3Page.locator('#gate-email').inputValue(), '', 'no remembered address is prefilled');
  assert.equal(await mp3Page.locator('[data-gate-submit]').isDisabled(), true, 'no address, no unlock');
  await mp3Page.locator('#gate-email').fill('not-an-email');
  await mp3Page.locator('#gate-email').press('Enter');
  assert.equal(await mp3Page.locator('#gate-error').isVisible(), true);
  assert.equal(subscribeRequests.length, 0, 'a malformed address is never sent to the provider');
  await mp3Page.locator('#gate-optin').uncheck();
  await mp3Page.locator('#gate-email').fill('mp3-buyer@example.com');
  // A well-formed address earns the field its own tick, right in the label.
  assert.equal(await mp3Page.locator('.gate-field.is-valid').count(), 1, 'a valid address ticks the field');
  assert.equal(await mp3Page.locator('[data-gate-submit]').isDisabled(), true, 'the opt-in is mandatory');
  await mp3Page.locator('#gate-optin').check();
  assert.equal(await mp3Page.locator('[data-gate-submit]').isDisabled(), false);
  await mp3Page.locator('[data-gate-submit]').click();
  // The address is in; the gate now opens the LICENSE REVIEW & SIGNATURE stage
  // on the same card instead of leaving for the download page — the files stay
  // locked until the terms are read and the license is signed.
  await signStage(mp3Page).waitFor();
  assert.equal(subscribeRequests.length, 0, 'the email step alone posts nothing — the one record belongs at SIGN & UNLOCK');
  assert.equal(await mp3Page.evaluate(() => new URLSearchParams(location.search).has('t')), false, 'the gate has not left for the download page yet');
  assert.equal(await mp3Page.locator('.gate-step').count(), 0, 'the sign stage replaces the gate body');
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), true, 'SIGN & UNLOCK starts locked');
  assert.match(await mp3Page.locator('#gate-hint').innerText(), /SCROLL THROUGH THE TERMS/);
  assert(await mp3Page.locator('[data-sign-terms]').evaluate(el => el.scrollHeight > el.clientHeight + 4), 'the terms are longer than their pane, so they really have to be read');
  assert.match(await mp3Page.locator('[data-sign-terms]').innerText(), /NON-PROFIT AND COMMERCIAL/);
  assert.match(await mp3Page.locator('[data-sign-terms]').innerText(), /PROD\. BY KYROIII/);
  // The signature sheet is a clean field: nothing is drawn behind the signature,
  // so the customer never signs over the brand's flower. The name that signs the
  // license must still be a FULL one: first AND last.
  assert.equal(await mp3Page.locator('.sign-watermark').count(), 0, 'the signature sheet carries no flower watermark');
  await mp3Page.locator('#sign-name').fill('Madonna');
  await readTerms(mp3Page);
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), true, 'a single word cannot sign the license');
  assert.match(await mp3Page.locator('#gate-hint').innerText(), /FIRST AND LAST/);
  // Zero bypasses: even with the disabled attribute stripped — the one thing a
  // script could reach for — the single-word signature is still refused.
  await mp3Page.evaluate(() => {
    const btn = document.querySelector('[data-sign-submit]');
    btn.disabled = false;
    btn.click();
  });
  assert.equal(await mp3Page.locator('#gate-error').isVisible(), true, 'the refused signature reports why');
  assert.match(await mp3Page.locator('#gate-error').innerText(), /FIRST AND LAST NAME REQUIRED/);
  assert.equal(await mp3Page.evaluate(() => new URLSearchParams(location.search).has('t')), false, 'a one-word signature never unlocks');
  assert.equal(await mp3Page.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'mp3'), BEAT_ID), false, 'nothing was granted');
  // Back to the top of the terms, so the order check below still starts from
  // "terms not read yet".
  await mp3Page.locator('[data-sign-terms]').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), true, 'an unread license stays locked');
  await mp3Page.locator('#sign-name').fill('Jordan Vega');
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), true, 'a full name alone never unlocks — the pad must be signed too');
  assert.match(await mp3Page.locator('#gate-hint').innerText(), /FULL NAME SET — SWITCH TO DRAW TAB & SIGN THE PAD TO UNLOCK/);
  await readTerms(mp3Page);
  assert(await mp3Page.locator('[data-sign-terms]').evaluate(el => el.scrollTop > 0), 'the terms pane really scrolled to the end');
  assert.equal(await mp3Page.locator('.gate-modal__card--sign .gate-field.is-valid').count(), 1, 'a full name ticks its field');
  assert.match(await mp3Page.locator('[data-sign-stamp]').innerText(), /JORDAN VEGA/, 'the stamp previews the name while the pad is still empty');
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), true, 'read terms + a full name still needs the drawn signature');
  // DRAW is the same readiness machine, not a second rule: the shared button is
  // still locked there until the pad carries a genuine stroke.
  await mp3Page.locator('[data-sign-mode="draw"]').click();
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), true, 'DRAW sees the same locked state');
  await drawSignature(mp3Page);
  assert.match(await mp3Page.locator('#gate-hint').innerText(), /ALL SET — SIGN & UNLOCK/);
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), false, 'full name + drawing + read terms unlocks');
  // Back on TYPE the button is still enabled and the drawing still travels:
  // the state is shared, so a click from either tab carries both halves.
  await mp3Page.locator('[data-sign-mode="type"]').click();
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), false, 'TYPE shares the enabled state');
  await mp3Page.locator('[data-sign-submit]').click();
  await mp3Page.waitForURL(/download\.html\?beat=.*&package=mp3/);
  assert.match(mp3Page.url(), /sign=Jordan(%20|\+)Vega/, 'the signature is handed forward in the flow URL');
  assert.match(mp3Page.url(), /sig=/, 'the drawn signature is handed forward alongside the full name');
  await noGateMemory(mp3Page, 'after the MP3 gate');
  await waitForPostCount(1, 'the valid address is posted to the provider');
  assert.equal(subscribeRequests[0].url, PROVIDER, 'posted to the configured Formspree endpoint');
  assert.match(subscribeRequests[0].headers['content-type'], /^application\/json/i, 'the analytics post is JSON');
  assert.equal(subscribeRequests[0].headers.accept, 'application/json', 'the analytics post asks for a JSON answer');
  const mp3Post = postJSON(0);
  assert(mp3Post, 'the Formspree body is valid JSON');
  assert.equal(mp3Post.email, 'mp3-buyer@example.com', 'the record carries the email from the gate');
  assert.equal(mp3Post.fullName, 'Jordan Vega', 'the record carries the verified full name');
  assert.equal(mp3Post.beatTitle, '[FREE 100%] DON TOLIVER TYPE BEAT - FLESH', 'the record carries the full catalog title');
  assert.equal(mp3Post.beatShortTitle, 'FLESH', 'the record carries the short beat title');
  assert.equal(mp3Post.beatId, 'flesh', 'the record carries the beat slug');
  assert.equal(mp3Post.beatBpmAndKey, '130 BPM // AM', 'the record carries the beat tempo and key');
  assert.equal(mp3Post.packageTier, 'mp3', 'the record carries the package tier');
  assert.equal(mp3Post.packageName, 'MP3 LEASE', 'the record carries the full package label');
  assert.equal(mp3Post.includedFiles, 'MP3 + PDF LICENSE', 'the record lists the unlocked files');
  assert.match(mp3Post.licenseSerial, /^KYRO-\d{4}-FLESH-\d{6}$/, 'the record carries the exact license serial');
  assert.equal(mp3Post.gateStepsCompleted, 'EMAIL + LICENSE AGREEMENT', 'the MP3 gate records its email + license steps');
  assert.equal(mp3Post.socialStepsCompleted, undefined, 'the MP3 record carries no social-step field');
  assert.equal(mp3Post.newsletterOptIn, 'YES', 'the record confirms the mandatory opt-in');
  assert.equal(mp3Post.signatureMethod, 'DRAW + TYPE SYNCHRONIZED', 'the record confirms the signature method');
  assert.equal(mp3Post.deviceType, 'DESKTOP', 'the record carries the device class');
  assert.equal(mp3Post.sourcePage, 'index.html', 'the record carries the source page');
  assert.match(mp3Post.timestampLocal, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, 'the record carries a local timestamp');
  assert.match(mp3Post._subject, /^KYROIII STORE — \[MP3 LEASE\] FLESH \(Jordan Vega\)$/, 'the subject is human-readable and complete');
  assert.match(await mp3Page.title(), /MP3 LEASE/);
  assert.equal(await mp3Page.locator('.dl-hero__flower').count(), 1); // the 3D flower branding
  assert.equal(await mp3Page.locator('.download-item').count(), 1); // the tagged MP3 (license is its own panel)
  assert.equal(await mp3Page.locator('.gate-modal').count(), 0);
  // The plain-text license is gone: only the PDF action remains, behind a
  // certificate block that shows the serial the document will carry.
  assert.equal(await mp3Page.locator('#license-view').count(), 0);
  assert.equal(await mp3Page.locator('[data-license-download]').count(), 0);
  assert.equal(await mp3Page.locator('[data-license-copy]').count(), 0);
  // The certificate block is clean too — no flower watermark sits behind it;
  // the store's mark lives in the PDF's LICENSOR approval seal.
  assert.equal(await mp3Page.locator('.license-cert__watermark').count(), 0, 'the certificate block carries no flower watermark');
  await noHue(mp3Page, 'the download page');
  await noLowercase(mp3Page, 'the download page');
  assert.equal(await mp3Page.locator('[data-license-pdf]').count(), 1);
  const serial = await mp3Page.locator('#license-serial').innerText();
  assert.match(serial, /^KYRO-\d{4}-FLESH-\d{6}$/);
  assert.equal(mp3Post.licenseSerial, serial, 'the Formspree record and the issued license share one serial');
  assert.equal(mp3Page.url().includes(encodeURIComponent(serial)), true, 'the sign-stage serial rides to the download page in the flow URL');
  serials.push(serial);
  // The hand-over is named the way an engineer reads it: the beat, its tempo and
  // its key, straight off the filename.
  // The value handed to the download (and shown on the page) is exactly the
  // studio name; only its rendering is uppercased by the stylesheet.
  assert.equal(await mp3Page.locator('.download-item__name').textContent(), 'KYROIII - FLESH (130 BPM - AM).mp3');
  assert.equal(await mp3Page.locator('.download-item__name').evaluate(el => getComputedStyle(el).textTransform), 'uppercase', 'the row is rendered in the ALL-CAPS voice');
  assert.equal(await mp3Page.locator('#license-stamp .license-cert__mark').count(), 1, 'the drawn signature captured in the gate is stamped on the page too');
  assert.match(await mp3Page.locator('#license-stamp').innerText(), /DRAWN SIGNATURE STAMPED ON YOUR PDF/);
  const [mp3] = await Promise.all([
    mp3Page.waitForEvent('download'),
    mp3Page.locator('[data-file-index="0"]').click(),
  ]);
  assert.equal(mp3.suggestedFilename(), 'KYROIII - FLESH (130 BPM - AM).mp3');
  // The luxury PDF license: a real file, not a viewer, with a valid PDF header,
  // the serial on the page and in the document, and the whole deal in the copy.
  const [pdf] = await Promise.all([
    mp3Page.waitForEvent('download'),
    mp3Page.locator('[data-license-pdf]').click(),
  ]);
  assert.match(pdf.suggestedFilename(), /^KYROIII - LICENSE - FLESH \(KYRO-\d{4}-FLESH-\d{6}\)\.pdf$/, 'the license downloads directly under its studio name and serial');
  const pdfBytes = await readFile(await pdf.path());
  const pdfText = pdfBytes.toString('latin1');
  assert.equal(pdfText.slice(0, 5), '%PDF-');
  assert(pdfText.includes('%%EOF'));
  assert(pdfText.includes(serial), 'the serial shown on the page is printed in the PDF');
  assert(pdfText.includes('PROD. BY KYROIII')); // the one credit rule
  assert(pdfText.includes('COMMERCIAL')); // commercial / profit use is granted
  assert(pdfText.includes('NON-PROFIT'));
  // The grant is package-level: the MP3 lease is explicitly NON-EXCLUSIVE, names
  // streaming/monetisation, and states its one limit; the exclusive branch must
  // never bleed into a lease certificate.
  assert(pdfText.includes('THIS LICENSE IS NON-EXCLUSIVE'));
  assert(pdfText.includes('OTHER ARTISTS MAY LICENSE THE SAME BEAT'));
  assert(pdfText.includes('STREAM IT'));
  assert(pdfText.includes('LIMITS: KEEP THE CREDIT, NEVER RESELL THE BEAT AS A BEAT OR LICENSE'));
  assert.equal(pdfText.includes('THIS LICENSE IS EXCLUSIVE'), false, 'the MP3 lease never claims exclusive rights');
  assert.equal(pdfText.includes('THE BEAT IS RETIRED'), false, 'the MP3 lease never retires the beat');
  assert(pdfText.includes('CERTIFICATE OF FREE LICENSE'));
  assert(pdfText.includes('TAGGED MP3 AUDIO FILE')); // this package's includes
  assert(pdfText.includes('Im1 Do'), 'the flower mark is embedded in the header');
  // The embedded mark is stamped again inside the LICENSOR approval stamp, and
  // nothing is drawn behind the LICENSEE signature any more: the old watermark
  // graphics state is gone and the stamp's flower draw lands in the right column.
  assert.equal((pdfText.match(/\/Im1 Do/g) || []).length, 2, 'the flower is drawn twice: the masthead and the licensor stamp');
  assert.equal(pdfText.includes('/GS1'), false, 'no LICENSEE watermark graphics state remains');
  const stampFlower = pdfText.match(/q 28\.00 0 0 28\.00 ([\d.]+) ([\d.]+) cm \/Im1 Do Q/);
  assert(stampFlower && Number(stampFlower[1]) > 300, 'the flower approval stamp sits in the LICENSOR (right) column');
  assert(pdfText.includes('OFFICIAL VERIFIED SEAL'), 'the approval stamp carries its official legend');
  assert(pdfText.includes('AUTHORIZED LICENSOR'), 'the approval stamp marks the document authorised');
  assert(pdfText.includes('PAGE 1 OF 1'), 'document-control footer, one page for every package');
  // Strict ALL CAPS branding: no lowercase letter survives anywhere in the doc.
  assert.deepEqual(pdfRuns(pdfText).filter(run => /[a-z]/.test(run)), [], 'every PDF string is uppercase');
  // Immaculate signatures: both sides pre-filled and dated, the LICENSEE with
  // the signature captured in the gate's sign step. (Parentheses are escaped by
  // the PDF writer.)
  assert(pdfText.includes('JORDAN VEGA'), 'the LICENSEE block carries the signature captured in the gate');
  assert(pdfText.includes('LICENSOR \\(KYROIII\\)'), 'the LICENSOR signature block');
  assert(pdfText.includes('SIGNED '), 'the licensee block is dated');
  // The redesign: the flower mark leads a centred masthead, and the whole page
  // lays out as one ruled certificate strip.
  assert(pdfText.includes('FREE MUSIC LICENSE PROGRAM'));
  assert(pdfText.includes('NON-EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE'));
  assert(drawnPaths(pdfText).length >= 2, 'the drawn signature is vector ink on the certificate');
  // Monochromatic palette: matte black #0B0B0B, white type, and the crisp
  // white/silver borders — a pure #FFFFFF frame with the equal-channel twin of
  // the requested #a1a1aa silver for the hairlines, rules and columns.
  assert(pdfText.includes('0.043 0.043 0.043 rg'), 'deep matte black field (#0B0B0B)');
  assert(pdfText.includes('1 1 1 1 RG'), 'crisp white outer frame (#FFFFFF)');
  assert(pdfText.includes('0.631 0.631 0.631'), 'silver hairline / rules (#A1A1A1, the neutral twin of #a1a1aa)');
  assert(pdfText.includes('1 1 1 RG'), 'white signature rules and corner ticks');
  // The hero mark floats cleanly: nothing draws a box, plate or frame around it.
  assert.equal(/[\d.]+ [\d.]+ 120\.00 120\.00 re S/.test(pdfText), false, 'the flower has zero box borders around it');
  // `x y z rg` for fills, `x y z width RG` for strokes.
  const colors = [...pdfText.matchAll(/(?:([\d.]+) ([\d.]+) ([\d.]+) rg)|(?:([\d.]+) ([\d.]+) ([\d.]+) [\d.]+ RG)/g)]
    .map(m => [m[1] ?? m[4], m[2] ?? m[5], m[3] ?? m[6]]);
  assert(colors.length > 0, 'the document paints its own colors');
  const tinted = colors.filter(c => c[0] !== c[1] || c[1] !== c[2]);
  assert.equal(tinted.length, 0, `every color is an equal-channel grey (zero blue): ${JSON.stringify(tinted)}`);
  // Clean footer: vector barcode + the official store link, uppercase.
  assert(pdfText.includes('HTTPS://KYROILL.STORE'), 'the store link is printed in the footer');
  assert(/1 1 1 rg\n[\d.]+ [\d.]+ [\d.]+ [\d.]+ re f/.test(pdfText), 'vector barcode drawn in the footer');

  // Re-signing on the download page enforces the same full-name rule: a single
  // word is refused inline and never reaches the document (the previous
  // signature is kept), and the ALL-CAPS rule holds over the accepted name.
  await mp3Page.locator('#license-signature').fill('Madonna');
  assert.equal(await mp3Page.locator('#license-sign-error').isVisible(), true, 'a single word is refused on the download page re-sign too');
  assert.match(await mp3Page.locator('#license-sign-error').innerText(), /FULL NAME/);
  assert.equal(await mp3Page.locator('#license-stamp .license-cert__mark').count(), 1, 'the refused re-sign keeps the drawn signature');
  await mp3Page.locator('#license-signature').fill('Matan Kaplan');
  assert.equal(await mp3Page.locator('#license-sign-error').isVisible(), false, 'a full name clears the refusal');
  await mp3Page.waitForFunction(() => {
    const stamp = document.getElementById('license-stamp');
    return stamp && stamp.dataset.stamped === 'true' && /MATAN KAPLAN/.test(stamp.textContent || '');
  }, null, { timeout: 5000 });
  const [signedPdf] = await Promise.all([
    mp3Page.waitForEvent('download'),
    mp3Page.locator('[data-license-pdf]').click(),
  ]);
  const signedText = (await readFile(await signedPdf.path())).toString('latin1');
  assert(signedText.includes('MATAN KAPLAN'), 're-signing re-stamps the LICENSEE block');
  assert(!signedText.includes('JORDAN VEGA'), 'the previous signature is replaced, not appended');
  assert(!signedText.includes('Matan Kaplan'), 'the signature is stamped in caps, exactly as the PDF is');
  assert.equal(signedText.includes(serial), true, 'the signed copy keeps this issuance serial');
  assert.deepEqual(pdfRuns(signedText).filter(run => /[a-z]/.test(run)), [], 'the signed license is uppercase too');
  assert.equal(signedText.includes('PAGE 1 OF 1'), true, 'the signed license still fits one page');
  await shot(mp3Page, 'download-mp3');
  await mp3Page.close();

  // Package 2 — Standard WAV Lease: the same clean email + license gate, with
  // no social step in front of it. The page then lists the MP3 + WAV.
  const wavPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await pickPackage(wavPage, 'wav');
  await wavPage.locator('.gate-modal').waitFor();
  const wavPack = await wavPage.evaluate(() => window.KYROlll_PACKAGES.find(item => item.id === 'wav'));
  assert.equal(wavPack.tag, 'EMAIL + LICENSE', 'the WAV package badge names the email + license gate');
  assert.equal(wavPack.gate, 'email', 'the WAV package uses the shared email gate');
  assert.equal(wavPack.blurb, 'TAGGED MP3 + HIGH-QUALITY WAV + LICENSE. ENTER YOUR EMAIL, ACCEPT THE LICENSE AND UNLOCK.', 'the WAV package describes the clean gate');
  assert.match(await wavPage.locator('.gate-modal__copy').first().innerText(), /ENTER YOUR EMAIL TO UNLOCK THE STANDARD WAV LEASE/, 'the WAV gate asks only for the email before the license');
  await expectCleanGate(wavPage);
  await noYouTubeButton(wavPage, CARD);
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), true);
  await wavPage.locator('#gate-email').fill('wav-buyer@example.com');
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), false);
  await wavPage.locator('[data-gate-submit]').click();
  await signLicense(wavPage, 'Wav Buyer');
  await wavPage.waitForURL(/package=wav/);
  await waitForPostCount(2, 'the WAV gate posts its address too');
  const wavPost = postJSON(1);
  assert(wavPost, 'the WAV Formspree body is valid JSON');
  assert.equal(wavPost.email, 'wav-buyer@example.com', 'the WAV record carries its email');
  assert.equal(wavPost.fullName, 'Wav Buyer', 'the WAV record carries its full name');
  assert.equal(wavPost.beatId, 'flesh', 'the WAV record carries the beat slug');
  assert.equal(wavPost.packageTier, 'wav', 'the WAV record carries its tier');
  assert.equal(wavPost.packageName, 'STANDARD WAV LEASE', 'the WAV record carries its label');
  assert.equal(wavPost.includedFiles, 'MP3 + WAV + PDF LICENSE', 'the WAV record lists its files');
  assert.equal(wavPost.gateStepsCompleted, 'EMAIL + LICENSE AGREEMENT', 'the WAV record names the two completed gate steps');
  assert.equal(wavPost.socialStepsCompleted, undefined, 'the WAV record carries no social-step field');
  assert.equal(wavPost.deviceType, 'DESKTOP', 'the WAV record carries the device class');
  assert.equal(wavPost.sourcePage, 'index.html', 'the WAV record carries the source page');
  assert.equal(wavPost.newsletterOptIn, 'YES', 'the WAV record confirms the opt-in');
  assert.match(subscribeRequests[1].headers['content-type'], /^application\/json/i, 'the WAV analytics post is JSON');
  assert.match(await wavPage.locator('#download-sub').innerText(), /EVERY FILE BELOW IS YOURS, FREE\. CREDIT \(PROD\. BY KYROIII\)/i, 'the download page states the free grant');
  assert.match(await wavPage.locator('#download-meta').innerText(), /EMAIL \+ LICENSE/i, 'the download page carries the package badge');
  assert.match(await wavPage.locator('#download-list').innerText(), /HIGH-QUALITY WAV/i);
  assert.equal(await wavPage.locator('.download-item').count(), 2); // tagged MP3 + high-quality WAV
  // Every hand-over carries the beat's tempo and key, audio or archive alike.
  assert.deepEqual(await wavPage.locator('.download-item__name').allTextContents(), [
    'KYROIII - FLESH (130 BPM - AM).mp3',
    'KYROIII - FLESH (130 BPM - AM).wav',
  ]);
  // The license panel is the same certificate block on every package: serial
  // minted, one PDF action, no raw text.
  const wavSerial = await wavPage.locator('#license-serial').innerText();
  assert.match(wavSerial, /^KYRO-\d{4}-FLESH-\d{6}$/);
  assert.equal(wavPost.licenseSerial, wavSerial, 'the WAV Formspree record and its PDF share one serial');
  serials.push(wavSerial);
  assert.equal(await wavPage.locator('#license-view').count(), 0);
  assert.equal(await wavPage.locator('.download-list__empty').count(), 0);
  // This package's own license is stamped with this flow's address.
  const [wavPdf] = await Promise.all([
    wavPage.waitForEvent('download'),
    wavPage.locator('[data-license-pdf]').click(),
  ]);
  const wavText = (await readFile(await wavPdf.path())).toString('latin1');
  assert(wavText.includes(wavSerial), 'the WAV license carries its own serial');
  assert(wavText.includes('WAV BUYER'), 'the WAV license carries its own signature');
  assert(wavText.includes('WAV-BUYER@EXAMPLE.COM'), 'the WAV license records the address this issuance went to');
  assert(wavText.includes('THIS LICENSE IS NON-EXCLUSIVE'), 'the WAV lease is non-exclusive like the MP3 lease');
  assert(wavText.includes('NON-EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE'), 'the WAV masthead names its non-exclusive grant');
  assert.equal(wavText.includes('THE BEAT IS RETIRED'), false, 'the WAV lease never retires the beat');
  assert.deepEqual(pdfRuns(wavText).filter(run => /[a-z]/.test(run)), [], 'the WAV license is uppercase too');
  await shot(wavPage, 'download-wav');
  await wavPage.close();

  // Package 3 — Exclusive / Pro: the same clean email + license gate as every
  // other tier, with no social step at all. A malformed address is refused (and
  // the opt-in is on by default); a valid one unlocks the stems package and is
  // posted to the configured newsletter provider.
  const proPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await proPage.goto(`${url}/?beat=flesh`);
  const endpoint = await proPage.evaluate(() => window.KYROlll_NEWSLETTER && window.KYROlll_NEWSLETTER.endpoint);
  assert.match(endpoint, /^https:\/\//, 'a newsletter provider endpoint is configured');
  assert.equal(endpoint, PROVIDER, 'the Formspree endpoint the gate posts to');
  const endpointConfig = await proPage.evaluate(() => ({
    site: window.KYROlll_SITE && window.KYROlll_SITE.formspreeEndpoint,
    paid: window.KYROlll_SITE && window.KYROlll_SITE.paidFormspreeEndpoint,
    paidConfig: window.KYROlll_NEWSLETTER && window.KYROlll_NEWSLETTER.paidEndpoint,
    resolved: window.KYROlll_DOWNLOADS && window.KYROlll_DOWNLOADS.newsletterEndpoint(),
  }));
  assert.equal(endpointConfig.site, PROVIDER, 'catalog exposes the free form as SITE.formspreeEndpoint');
  assert.equal(endpointConfig.paid, '', 'the future paid endpoint slot exists but is intentionally unset');
  assert.equal(endpointConfig.paidConfig, endpointConfig.paid, 'the newsletter config keeps the paid slot separate');
  assert.equal(endpointConfig.resolved, PROVIDER, 'the download layer resolves the free-download form');
  await proPage.locator(`${CARD} .download-trigger`).click();
  await proPage.locator('.download-menu.is-open').waitFor();
  await proPage.locator('.download-tier[data-package="exclusive"]').click();
  await proPage.locator('.gate-modal').waitFor();
  const proPack = await proPage.evaluate(() => window.KYROlll_PACKAGES.find(item => item.id === 'exclusive'));
  assert.equal(proPack.tag, 'EMAIL + LICENSE', 'the Pro package badge names the email + license gate');
  assert.equal(proPack.gate, 'email', 'the Pro package uses the shared email gate');
  assert.equal(proPack.blurb, 'FULL STEMS + MP3 + WAV + EXCLUSIVE LICENSE. ENTER YOUR EMAIL, ACCEPT THE LICENSE AND UNLOCK.', 'the Pro package describes the clean gate and names its exclusive license');
  assert.match(await proPage.locator('.gate-modal__copy').first().innerText(), /ENTER YOUR EMAIL TO UNLOCK THE EXCLUSIVE \/ PRO PACKAGE/, 'the Pro gate asks only for the email before the license');
  assert.equal(await proPage.locator('#gate-optin').isChecked(), true);
  // The email gate is a real <form> pointing at that provider endpoint.
  assert.equal(await proPage.locator('[data-gate-form]').getAttribute('action'), endpoint);
  assert.equal(await proPage.locator('[data-gate-form]').getAttribute('method'), 'post');
  // The Pro tier is the same clean gate: email + license, and not one social
  // step, like, follow or subscribe. There is no comment step either.
  await expectCleanGate(proPage);
  await noYouTubeButton(proPage, CARD);
  assert.equal(await proPage.locator('#gate-comment').count(), 0, 'the comment step is gone');
  assert.equal(await proPage.locator('[data-gate-submit]').isDisabled(), true);
  await proPage.locator('#gate-email').fill('not-an-email');
  await proPage.locator('#gate-email').press('Enter');
  assert.equal(await proPage.locator('#gate-error').isVisible(), true);
  assert.equal(subscribeRequests.length, 2, 'a malformed address is never sent to the provider');
  await proPage.locator('#gate-email').fill('producer@example.com');
  await proPage.locator('[data-gate-submit]').click();
  // This license is signed by hand: the pad takes real pointer strokes, and the
  // drawing travels on to the download page and into the PDF as vector paths.
  await signStage(proPage).waitFor();
  // DRAW mode is not a shortcut past the full name: with the name field empty —
  // and again with a single word — a bare drawing leaves SIGN & UNLOCK locked,
  // and the sheet says exactly what is still missing.
  await drawSignature(proPage);
  assert.equal(await proPage.locator('#sign-name').inputValue(), '', 'the full-name field starts empty and stays visible in DRAW mode');
  assert.equal(await proPage.locator('[data-sign-submit]').isDisabled(), true, 'a drawing with no name stays locked');
  assert.match(await proPage.locator('[data-sign-stamp]').innerText(), /FULL NAME REQUIRED/, 'the sheet reports the missing full name');
  await readTerms(proPage);
  // With the terms read, the live hint states exactly what is still missing.
  assert.match(await proPage.locator('#gate-hint').innerText(), /SIGNATURE CAPTURED — ENTER YOUR FULL FIRST & LAST NAME TO UNLOCK/);
  await proPage.locator('#sign-name').fill('MATAN');
  assert.equal(await proPage.locator('[data-sign-submit]').isDisabled(), true, 'a drawing plus a single word stays locked');
  assert.match(await proPage.locator('[data-sign-stamp]').innerText(), /FULL NAME REQUIRED/);
  // The full name is enforced in DRAW mode exactly as the disabled-button check
  // is: stripping the attribute still refuses a one-word signature.
  await proPage.evaluate(() => { const b = document.querySelector('[data-sign-submit]'); b.disabled = false; b.click(); });
  assert.equal(await proPage.evaluate(() => new URLSearchParams(location.search).has('t')), false, 'a one-word DRAW signature never unlocks');
  assert.match(await proPage.locator('#gate-error').innerText(), /FIRST AND LAST NAME REQUIRED/);
  await proPage.locator('#sign-name').fill('MATAN MAMADOV');
  assert.match(await proPage.locator('[data-sign-stamp]').innerText(), /SIGNATURE CAPTURED/, 'a full name plus a valid drawing is captured');
  assert.match(await proPage.locator('#gate-hint').innerText(), /ALL SET — SIGN & UNLOCK/);
  assert.equal(await proPage.locator('[data-sign-submit]').isDisabled(), false, 'a full name plus a valid drawing unlocks DRAW mode');
  // The same shared button stays enabled on TYPE — and the click from there still
  // carries the drawn strokes, because the readiness state is not per-tab.
  await proPage.locator('[data-sign-mode="type"]').click();
  assert.equal(await proPage.locator('[data-sign-submit]').isDisabled(), false, 'TYPE shares the enabled state');
  await proPage.locator('[data-sign-submit]').click();
  // The exclusive signature is what claims the beat: the live catalog entry is
  // marked while the success surface is still up, before the flow moves on.
  await proPage.waitForFunction((id) => window.KYROlll_HELPERS.isExclusiveLocked(id), BEAT_ID, { timeout: 5000 });
  assert.equal(await proPage.evaluate((id) => window.KYROlll_HELPERS.isExclusiveLocked(id), BEAT_ID), true, 'SIGN & UNLOCK claims the exclusive beat');
  await proPage.waitForURL(/package=exclusive/);
  assert.match(await proPage.locator('#download-sub').innerText(), /EVERY FILE BELOW IS YOURS, FREE\. CREDIT \(PROD\. BY KYROIII\)/i, 'the download page states the free grant');
  assert.match(await proPage.locator('#download-meta').innerText(), /EMAIL \+ LICENSE/i, 'the download page carries the Pro package badge');
  assert.match(proPage.url(), /sig=/, 'the drawing is handed forward, packed into the flow URL');
  assert.match(proPage.url(), /sign=MATAN(%20|\+)MAMADOV/, 'the full name rides forward alongside the drawing');
  assert(await proPage.locator('.license-cert__mark path').count() >= 2, 'the download page replays the drawn signature');
  // Upright, never flipped: SVG shares the canvas' top-left origin, so the first
  // pen position — drawn 72% down the pad — must land 72% down the mark. (The
  // `1 - y` flip that used to be here rendered every drawing upside down while
  // the PDF, whose origin is the bottom-left, stayed correct, so the preview and
  // the document disagreed.)
  const mark = await proPage.locator('.license-cert__mark').evaluate(svg => {
    const paths = Array.from(svg.querySelectorAll('path'));
    const pts = d => d.replace(/^M/, '').split('L').map(pair => pair.trim().split(/\s+/).map(Number));
    const box = svg.viewBox.baseVal;
    return { fx: pts(paths[0].getAttribute('d'))[0][0] / box.width, fy: pts(paths[0].getAttribute('d'))[0][1] / box.height, paths: paths.length };
  });
  assert(mark.paths >= 2, 'the mark replays both drawn strokes');
  assert(Math.abs(mark.fy - 0.72) < 0.05, `the drawn signature is upright, not flipped (first pen at ${mark.fy.toFixed(2)} of the pad's height)`);
  assert(Math.abs(mark.fx - 0.205) < 0.04, 'the mark keeps the pad aspect ratio and its horizontal placement');
  await waitForPostCount(3, 'the valid address is posted to the newsletter provider');
  assert.equal(subscribeRequests[2].url, endpoint, 'posted to the configured provider endpoint');
  assert.match(subscribeRequests[2].headers['content-type'], /^application\/json/i, 'the Pro analytics post is JSON');
  const proPost = postJSON(2);
  assert(proPost, 'the Pro Formspree body is valid JSON');
  assert.equal(proPost.email, 'producer@example.com', 'the Pro record carries its email');
  assert.equal(proPost.fullName, 'MATAN MAMADOV', 'the Pro record carries the drawn signature\'s full name');
  assert.equal(proPost.beatTitle, '[FREE 100%] DON TOLIVER TYPE BEAT - FLESH', 'the Pro record carries the full title');
  assert.equal(proPost.beatShortTitle, 'FLESH', 'the Pro record carries the short title');
  assert.equal(proPost.beatId, 'flesh', 'the Pro record carries the beat slug');
  assert.equal(proPost.packageTier, 'exclusive', 'the Pro record carries its tier');
  assert.equal(proPost.packageName, 'EXCLUSIVE / PRO PACKAGE', 'the Pro record carries its label');
  assert.equal(proPost.includedFiles, 'MP3 + WAV + TRACKED STEMS + PDF LICENSE', 'the Pro record lists every unlocked file');
  assert.equal(proPost.gateStepsCompleted, 'EMAIL + LICENSE AGREEMENT', 'the Pro record names the two completed gate steps');
  assert.equal(proPost.socialStepsCompleted, undefined, 'the Pro record carries no social-step field');
  assert.equal(proPost.deviceType, 'DESKTOP', 'the Pro record carries the device class');
  assert.equal(proPost.sourcePage, 'index.html', 'the Pro record carries the source page');
  assert.equal(proPost.newsletterOptIn, 'YES', 'the Pro record confirms the opt-in');
  assert.equal(proPost.signatureMethod, 'DRAW + TYPE SYNCHRONIZED', 'the Pro record confirms the signature method');
  assert.match(proPost._subject, /^KYROIII STORE — \[EXCLUSIVE \/ PRO PACKAGE\] FLESH \(MATAN MAMADOV\)$/, 'the Pro subject is human-readable and complete');
  assert.match(await proPage.locator('#download-list').innerText(), /TRACKED STEMS/i);
  assert.equal(await proPage.locator('.download-item').count(), 3); // MP3 + WAV + stems (license is its own panel)
  assert.deepEqual(await proPage.locator('.download-item__name').allTextContents(), [
    'KYROIII - FLESH (130 BPM - AM).mp3',
    'KYROIII - FLESH (130 BPM - AM).wav',
    'KYROIII - FLESH (130 BPM - AM) - TRACKED STEMS.zip',
  ]);
  const proSerial = await proPage.locator('#license-serial').innerText();
  assert.match(proSerial, /^KYRO-\d{4}-FLESH-\d{6}$/);
  assert.equal(proPost.licenseSerial, proSerial, 'the Pro Formspree record and its PDF share one serial');
  serials.push(proSerial);
  assert.equal(await proPage.locator('#license-view').count(), 0);
  // Every issuance mints its own serial — no two licenses ever share an id.
  assert.equal(new Set(serials).size, serials.length, 'no two licenses share a serial');
  const [proPdf] = await Promise.all([
    proPage.waitForEvent('download'),
    proPage.locator('[data-license-pdf]').click(),
  ]);
  const proText = (await readFile(await proPdf.path())).toString('latin1');
  assert(proText.includes('PRODUCER@EXAMPLE.COM'), 'the exclusive license records the address this issuance went to');
  // A hand-drawn mark is still attributed to its signer: the FULL name captured
  // alongside the drawing is printed in the LICENSEE metadata micro-line.
  assert.match(proText, /SIGNED \d{4}-\d{2}-\d{2} - MATAN MAMADOV - PRODUCER@EXAMPLE\.COM/, 'the drawn license records the full name that signed it');
  assert(proText.includes('PAGE 1 OF 1'), 'the exclusive package still fits one page');
  // The exclusive grant is printed, not implied: the masthead, clause 1.0 and
  // the includes list all say exclusive, while the shared credit rule and the
  // free commercial grant stay identical to every lease.
  assert(proText.includes('EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE'), 'the exclusive masthead names its grant');
  assert.equal(proText.includes('NON-EXCLUSIVE - WORLDWIDE'), false, 'the exclusive certificate never reads as a lease');
  assert(proText.includes('THIS LICENSE IS EXCLUSIVE'), 'clause 1.0 grants exclusive rights');
  assert(proText.includes('THE BEAT IS RETIRED AND NEVER LICENSED AGAIN'), 'the exclusive grant retires the beat');
  assert(proText.includes('THIS BEAT IS 100% FREE FOR NON-PROFIT AND COMMERCIAL / PROFIT USE'), 'the exclusive license stays 100% free and commercial');
  assert(pdfRuns(proText).includes('(PROD. BY KYROIII)'), 'the exclusive license still carries the mandatory credit');
  assert(pdfRuns(proText).join(' ').includes('FULL EXCLUSIVE RIGHTS - RESELL, RE-LICENSE & TRADE'), 'the includes spell out the exclusive grant and its resale freedom');
  assert(pdfRuns(proText).join(' ').includes('YOU MAY RESELL, RE-LICENSE, TRANSFER OR TRADE IT AND KEEP 100% OF THE PROCEEDS'), 'the exclusive grant permits resale and re-licensing');
  assert.equal(pdfRuns(proText).join(' ').includes('LIMITS: KEEP THE CREDIT, NEVER RESELL'), false, 'the exclusive grant carries no resale restriction');
  // The hand-drawn signature reaches the PDF as real vector strokes, inside the
  // LICENSEE column, and the document stays monochrome and uppercase.
  const ink = drawnPaths(proText);
  assert(ink.length >= 2, `the drawn signature is stamped into the PDF as vector strokes: ${ink.length}`);
  assert(proText.includes('1 1 1 1.05 RG'), 'the drawn signature is inked in pure crisp white (#FFFFFF)');
  assert.equal(proText.includes('0.8 0.8 0.8'), false, 'no off-white/blue pen is left in the document');
  const inkX = ink.flatMap(path => path.map(point => Number(String(point).split(' ')[0])));
  assert(Math.max(...inkX) < 300, 'the drawn strokes sit inside the LICENSEE column');
  // The document and the page agree on which way is up: the PDF grows its y
  // upwards, so the point the canvas drew higher must end up higher (a bigger y)
  // in both. A flip on either side would break this in opposite directions.
  const firstStroke = ink[0].map(point => Number(String(point).split(' ')[1]));
  // (`drawnPaths` captures the points after the stroke's opening move, so the
  // SVG list is trimmed the same way before the two are compared.)
  const firstSvgYs = (await proPage.locator('.license-cert__mark path').first().evaluate(path =>
    path.getAttribute('d').replace(/^M/, '').split('L').map(pair => Number(pair.trim().split(/\s+/)[1])))).slice(1);
  assert(firstSvgYs.length >= 2 && firstStroke.length >= 2, 'both sides carry the drawn points to compare');
  assert.equal(firstSvgYs[0] < firstSvgYs[1], firstStroke[0] > firstStroke[1], 'the preview and the PDF orient the signature the same way');
  assert.equal(drawnPaths(proText).length, ink.length, 'the signs are stable');
  assert.deepEqual(pdfRuns(proText).filter(run => /[a-z]/.test(run)), [], 'the hand-signed license is uppercase too');

  // The exclusive signature is durable: returning to the beat in the same
  // browser paints the buyer's signature badge, replaces the whole download
  // area and leaves the artwork, record and player exactly as they were.
  await proPage.goto(`${url}/?beat=flesh`);
  await proPage.locator(`${CARD} .exclusive-badge`).waitFor();
  assert.equal((await proPage.locator(`${CARD} .exclusive-badge__text`).innerText()).trim(), 'OWNED', 'the returning buyer sees the private master badge');
  assert.equal((await proPage.locator(`${CARD} .exclusive-badge__kicker`).innerText()).trim(), 'PRIVATE MASTER // YOURS', 'the buyer is recognised on return');
  assert.match(await proPage.locator(`${CARD} .card__specs`).innerText(), /OWNED \/ YOURS/, 'the beat page specs carry the ownership marker');
  assert.equal(await proPage.locator(`${CARD} .download-trigger`).count(), 0, 'a claimed beat offers no lease trigger');
  assert.equal(await proPage.locator(`${CARD} .exclusive-locked-button`).count(), 0, 'the badge replaces the disabled control');
  assert.equal(await proPage.locator(`${CARD} .beat-preview`).count(), 1, 'a claimed beat keeps its player');
  assert.equal(await proPage.locator(`${CARD} .vinyl-record`).count(), 1, 'a claimed beat keeps its vinyl');

  // On an unclaimed beat, fresh state still rules: selecting ANY package
  // re-opens the full gate from scratch, with nothing remembered or prefilled,
  // and the REVIEW & SIGNATURE stage is never auto-opened. The signature step is
  // mandatory on every selection.
  await proPage.goto(`${url}/?beat=just-d0-it&now=${ALL_LIVE_NOW}`);
  for (const pkg of ['mp3', 'wav', 'exclusive']) {
    await proPage.locator(`${JUST_DO_IT_CARD} .download-trigger`).click();
    await proPage.locator('.download-menu.is-open').waitFor();
    await proPage.locator(`.download-tier[data-package="${pkg}"]`).click();
    await proPage.locator('.gate-modal').waitFor();
    assert.equal(await proPage.locator('#gate-email').inputValue(), '', `${pkg}: the address is never remembered`);
    assert.equal(await proPage.locator('[data-gate-submit]').isDisabled(), true, `${pkg}: the gate starts closed again`);
    assert.equal(await proPage.locator('.gate-modal__card--sign').count(), 0, `${pkg}: the sign step is never auto-opened`);
    assert.equal(await proPage.locator('#sign-name').count(), 0, `${pkg}: no signature is ever prefilled`);
    assert.equal(await proPage.locator('#gate-comment').count(), 0, `${pkg}: there is no comment step at all`);
    await proPage.locator('.gate-modal__card [data-gate-cancel]').click();
    await proPage.locator('.gate-modal').waitFor({ state: 'detached' });
  }
  assert.equal(subscribeRequests.length, 3, 'opening a gate posts nothing');
  await noGateMemory(proPage, 'after three gates in one browser');
  await proPage.close();

  // A cold download link (no grant token from a gate) is gated over the page,
  // so the flow is identical from any entry point.
  const coldPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await coldPage.goto(`${url}/download.html?beat=${BEAT_ID}&package=exclusive`);
  await coldPage.locator('.gate-modal').waitFor();
  assert.equal(await coldPage.locator('#gate-email').inputValue(), '');
  assert.match(await coldPage.locator('#download-list').innerText(), /UNLOCK THIS PACKAGE/i);
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), false, 'a cold entry starts with no grant');

  // A passed gate is recorded for this view, and this one is the exclusive
  // license: signing it claims the beat, so a later selection is refused rather
  // than gated again — the exclusive rights are already gone.
  assert.equal(await coldPage.locator('.gate-step').count(), 0, 'a cold link opens the same social-free gate');
  await coldPage.locator('#gate-email').fill('cold-entrant@example.com');
  await coldPage.locator('[data-gate-submit]').click();
  await signLicense(coldPage, 'Cold Entrant');
  // The success beat holds ~1.4 s and then the page paints its file rows.
  await coldPage.locator('.download-item').first().waitFor({ timeout: 15000 });
  assert.match(await coldPage.locator('#download-list').innerText(), /TRACKED STEMS/i);
  await waitForPostCount(4, 'a gate passed on the download page posts one complete record too');
  const coldPost = postJSON(3);
  assert(coldPost, 'the cold-gate Formspree body is valid JSON');
  assert.equal(coldPost.email, 'cold-entrant@example.com', 'the cold record carries its email');
  assert.equal(coldPost.fullName, 'Cold Entrant', 'the cold record carries its full name');
  assert.equal(coldPost.packageTier, 'exclusive', 'the cold record carries its tier');
  assert.equal(coldPost.gateStepsCompleted, 'EMAIL + LICENSE AGREEMENT', 'the cold record names the two completed gate steps');
  assert.equal(coldPost.deviceType, 'DESKTOP', 'the cold record carries the device class');
  assert.equal(coldPost.sourcePage, 'download.html', 'the record knows it was signed on the download page');
  const coldSerial = await coldPage.locator('#license-serial').innerText();
  assert.equal(coldPost.licenseSerial, coldSerial, 'the cold gate adopts the serial it recorded into the PDF');
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), true, 'the pass is recorded for this view');
  await noGateMemory(coldPage, 'after a gate passed on the download page itself');
  const postsBeforeMemory = subscribeRequests.length;
  // That signature was the exclusive license, so the beat is now claimed for
  // good: selecting it again opens no gate at all, and nothing is posted.
  assert.equal(await coldPage.evaluate(id => window.KYROlll_HELPERS.isExclusiveLocked(id), BEAT_ID), true, 'the exclusive signature claims the beat');
  await coldPage.evaluate(id => { window.KYROlll_DOWNLOADS.start(id, 'exclusive'); }, BEAT_ID);
  await coldPage.waitForTimeout(120);
  assert.equal(await coldPage.locator('.gate-modal').count(), 0, 'a claimed beat never re-opens a gate');
  assert.equal(await coldPage.locator('.download-menu').count(), 0, 'a claimed beat never re-opens the drawer');
  assert.equal(subscribeRequests.length, postsBeforeMemory, 're-opening a claimed beat posts nothing');
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), true, 'the pass stays recorded for this view');
  await coldPage.reload();
  await coldPage.waitForFunction(() => !!window.KYROlll_DOWNLOADS);
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), false, 'the record does not outlive the page');
  assert.equal(await coldPage.evaluate(id => window.KYROlll_HELPERS.isExclusiveLocked(id), BEAT_ID), true, 'the exclusive claim survives a reload');
  assert.equal(await coldPage.evaluate(id => window.KYROlll_HELPERS.isExclusiveOwned(id), BEAT_ID), true, 'the buyer keeps ownership across sessions');
  await coldPage.close();

  // A phone is where the store is used most — and where a dialog that measures
  // itself in `100vh` hides its own unlock button behind the browser chrome. The
  // whole flow is walked at 390×844 with touch on: the menu and the card inside
  // the visible viewport, the field and controls answering on the first tap, the
  // pad owning the gesture, and the unlock button reachable by scrolling the
  // dialog itself.
  const phone = await setupPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await phone.goto(`${url}/?beat=flesh`);
  await noOverflow(phone);
  await phone.locator(`${CARD} .download-trigger`).click();
  await phone.locator('.download-menu.is-open').waitFor();
  assert(await phone.evaluate(() => {
    const menu = document.querySelector('.download-menu');
    const trigger = document.querySelector('[data-download-trigger][aria-expanded="true"]');
    const box = menu.getBoundingClientRect(), t = trigger.getBoundingClientRect();
    const rooted = menu.parentElement === document.body && getComputedStyle(menu).position === 'fixed';
    const attached = Math.abs(box.left - t.left) < 2 && Math.abs(box.right - t.right) < 2 &&
      (Math.abs(box.top - t.bottom) < 1.5 || Math.abs(box.bottom - t.top) < 1.5);
    return rooted && attached && box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
  }), 'the root-anchored drawer stays welded to its trigger and lands inside the phone viewport');
  await phone.locator('.download-tier[data-package="exclusive"]').click();
  await phone.locator('.gate-modal').waitFor();
  assert(await phone.evaluate(() => {
    const card = document.querySelector('.gate-modal__card');
    const box = card.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  }), 'the gate card fits the phone viewport');
  assert(await phone.evaluate(() => document.documentElement.classList.contains('gate-open')), 'the page behind the dialog is locked');
  await expectCleanGate(phone);
  assert.equal(await phone.locator('.gate-optin').evaluate(el => getComputedStyle(el).touchAction), 'manipulation', 'the controls answer on the first tap');
  assert(parseFloat(await phone.locator('#gate-email').evaluate(el => getComputedStyle(el).fontSize)) >= 16, 'the field is large enough that iOS does not zoom the page');
  await phone.locator('#gate-email').fill('phone-buyer@example.com');
  await phone.locator('[data-gate-submit]').click();
  await signStage(phone).waitFor();
  assert.equal(await phone.locator('[data-sign-canvas]').evaluate(el => getComputedStyle(el).touchAction), 'none', 'the pad owns the gesture, so a stroke is never a page scroll');
  assert.equal(await phone.locator('.sign-watermark').count(), 0, 'no flower watermark on the phone signature sheet');
  await noLowercase(phone, 'the sign sheet');
  await phone.locator('[data-sign-submit]').scrollIntoViewIfNeeded();
  assert(await phone.evaluate(() => {
    const box = document.querySelector('[data-sign-submit]').getBoundingClientRect();
    return box.top >= -1 && box.bottom <= innerHeight + 1;
  }), 'the unlock button is reachable inside the phone viewport');
  await phone.locator('#sign-name').fill('Ada Lovelace');
  await readTerms(phone);
  assert.equal(await phone.locator('[data-sign-submit]').isDisabled(), true, 'a full name alone still leaves the phone locked');
  await drawSignature(phone);
  assert.equal(await phone.locator('[data-sign-submit]').isDisabled(), false, 'a full name plus a drawn signature unlocks on a phone too');
  await phone.locator('[data-sign-submit]').click();
  await phone.waitForURL(/package=exclusive/);
  await waitForPostCount(5, 'the phone flow posts its complete record too');
  const phonePost = postJSON(4);
  assert(phonePost, 'the phone Formspree body is valid JSON');
  assert.equal(phonePost.fullName, 'Ada Lovelace', 'the phone record carries the full name');
  assert.equal(phonePost.email, 'phone-buyer@example.com', 'the phone record carries the email');
  assert.equal(phonePost.packageTier, 'exclusive', 'the phone record carries the tier');
  assert.equal(phonePost.gateStepsCompleted, 'EMAIL + LICENSE AGREEMENT', 'the phone record names the two gate steps');
  assert.equal(phonePost.deviceType, 'MOBILE', 'a 390px touch viewport is recorded as MOBILE');
  assert.equal(phonePost.sourcePage, 'index.html', 'the phone record carries the source page');
  await noOverflow(phone);
  await noHue(phone, 'the phone flow');
  assert.equal(await phone.locator('.license-cert__watermark').count(), 0, 'the certificate carries no flower watermark on a phone either');
  assert.equal(await phone.locator('.download-item').count(), 3);
  assert(await phone.evaluate(() => document.body.style.position === ''), 'the page is released when the dialog closes');
  await shot(phone, 'phone');
  await phone.close();

  // The dialog has exactly one exit: its CANCEL button. Escape and a click on
  // the backdrop are deliberately inert, so a stray key or tap can never wipe a
  // gate (or a signature) in progress; CANCEL closes cleanly and releases the page.
  const escPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await pickPackage(escPage, 'exclusive');
  await escPage.locator('.gate-modal').waitFor();
  await escPage.keyboard.press('Escape');
  await escPage.waitForTimeout(120);
  assert.equal(await escPage.locator('.gate-modal').count(), 1, 'Escape never closes the gate');
  assert.equal(await escPage.evaluate(() => document.documentElement.classList.contains('gate-open')), true, 'the page stays locked while the gate is open');
  await escPage.locator('.gate-modal__backdrop').click({ position: { x: 5, y: 5 } });
  await escPage.waitForTimeout(320);
  assert.equal(await escPage.locator('.gate-modal').count(), 1, 'the backdrop never closes the gate');
  assert.equal(await escPage.evaluate(() => document.documentElement.classList.contains('gate-open')), true, 'the backdrop click never unlocks the page');
  await escPage.mouse.click(5, 5);
  await escPage.waitForTimeout(320);
  assert.equal(await escPage.locator('.gate-modal').count(), 1, 'a click outside the dialog never closes the gate');
  await escPage.locator('.gate-modal').click({ position: { x: 5, y: 5 } });
  await escPage.waitForTimeout(320);
  assert.equal(await escPage.locator('.gate-modal').count(), 1, 'the modal root absorbs the empty-area click');
  assert.equal(await escPage.evaluate(() => document.documentElement.classList.contains('gate-open')), true, 'the modal root click never unlocks the page');
  await escPage.locator('.gate-modal__card [data-gate-cancel]').click();
  await escPage.locator('.gate-modal').waitFor({ state: 'detached' });
  assert.equal(await escPage.evaluate(() => document.documentElement.classList.contains('gate-open')), false, 'CANCEL releases the page');
  await escPage.close();

  // The signature stage has the same single exit and no prefill: a backdrop click
  // leaves the empty, locked signature sheet exactly where it was, and only the
  // explicit CANCEL closes it. The intact stage still unlocks after the click.
  const signDismiss = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await pickPackage(signDismiss, 'mp3');
  await signDismiss.locator('.gate-modal').waitFor();
  await signDismiss.locator('#gate-email').fill('dismiss@example.com');
  await signDismiss.locator('[data-gate-submit]').click();
  await signStage(signDismiss).waitFor();
  assert.equal(await signDismiss.locator('#sign-name').inputValue(), '', 'the signature stage starts empty');
  assert.equal(await signDismiss.locator('[data-sign-submit]').isDisabled(), true, 'the signature stage starts locked');
  await signDismiss.locator('.gate-modal__backdrop').click({ position: { x: 5, y: 5 } });
  await signDismiss.waitForTimeout(320);
  assert.equal(await signStage(signDismiss).isVisible(), true, 'the backdrop never closes the signature stage');
  assert.equal(await signDismiss.evaluate(() => document.documentElement.classList.contains('gate-open')), true, 'the backdrop click never unlocks the page from the sign stage');
  await signDismiss.mouse.click(5, 5);
  await signDismiss.waitForTimeout(320);
  assert.equal(await signStage(signDismiss).isVisible(), true, 'a click outside the dialog never closes the signature stage');
  await signDismiss.locator('.gate-modal').click({ position: { x: 5, y: 5 } });
  await signDismiss.waitForTimeout(320);
  assert.equal(await signDismiss.locator('.gate-modal').count(), 1, 'the modal root absorbs the empty-area click');
  assert.equal(await signStage(signDismiss).isVisible(), true, 'the modal root never closes the signature stage');
  assert.equal(await signDismiss.locator('#sign-name').inputValue(), '', 'the signature is still not prefilled');
  assert.equal(await signDismiss.locator('[data-sign-submit]').isDisabled(), true, 'the signature stage is still locked');
  await signDismiss.locator('#sign-name').fill('Dana Scully');
  await drawSignature(signDismiss);
  await readTerms(signDismiss);
  assert.equal(await signDismiss.locator('[data-sign-submit]').isDisabled(), false, 'the intact sign stage still reaches SIGN & UNLOCK');
  await signDismiss.locator('.gate-modal__card [data-gate-cancel]').click();
  await signDismiss.locator('.gate-modal').waitFor({ state: 'detached' });
  assert.equal(await signDismiss.evaluate(() => document.documentElement.classList.contains('gate-open')), false, 'CANCEL releases the page from the sign stage');
  await signDismiss.close();

  // TYPE and DRAW are one readiness machine. A full name is not a signature and a
  // drawing is not a license: the shared SIGN & UNLOCK stays grey until BOTH are
  // present (with the terms read), and switching tabs cannot change that.
  const syncPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await pickPackage(syncPage, 'mp3');
  await syncPage.locator('.gate-modal').waitFor();
  await syncPage.locator('#gate-email').fill('sync-buyer@example.com');
  await syncPage.locator('[data-gate-submit]').click();
  await signStage(syncPage).waitFor();
  // 1. A valid full name typed on TYPE is not enough.
  await syncPage.locator('#sign-name').fill('MATAN MAMADOV');
  await readTerms(syncPage);
  assert.equal(await syncPage.locator('[data-sign-mode="type"]').evaluate(el => el.classList.contains('is-active')), true, 'the sheet starts on TYPE');
  assert.equal(await syncPage.locator('[data-sign-submit]').isDisabled(), true, 'a full name alone stays locked on TYPE');
  assert.match(await syncPage.locator('#gate-hint').innerText(), /FULL NAME SET — SWITCH TO DRAW TAB & SIGN THE PAD TO UNLOCK/);
  // 2. A drawing with a single-word name stays locked — and the lock is shared,
  //    so TYPE sees exactly the same disabled button.
  await syncPage.locator('[data-sign-mode="draw"]').click();
  await syncPage.locator('#sign-name').fill('MATAN');
  await drawSignature(syncPage);
  assert.equal(await syncPage.locator('[data-sign-submit]').isDisabled(), true, 'a drawing plus a single word stays locked on DRAW');
  assert.match(await syncPage.locator('[data-sign-stamp]').innerText(), /FULL NAME REQUIRED/);
  await syncPage.locator('[data-sign-mode="type"]').click();
  assert.equal(await syncPage.locator('[data-sign-submit]').isDisabled(), true, 'the locked state is shared with TYPE');
  assert.match(await syncPage.locator('#gate-hint').innerText(), /SIGNATURE CAPTURED — ENTER YOUR FULL FIRST & LAST NAME TO UNLOCK/);
  // 3. Both halves: enabled on TYPE, and still enabled on DRAW.
  await syncPage.locator('#sign-name').fill('MATAN MAMADOV');
  assert.equal(await syncPage.locator('[data-sign-submit]').isDisabled(), false, 'full name + drawing enables on TYPE');
  assert.match(await syncPage.locator('#gate-hint').innerText(), /ALL SET — SIGN & UNLOCK/);
  await syncPage.locator('[data-sign-mode="draw"]').click();
  assert.equal(await syncPage.locator('[data-sign-submit]').isDisabled(), false, 'full name + drawing stays enabled on DRAW');
  // 4. Empty-area clicks — the backdrop at (5, 5), the viewport corner and the
  //    modal root itself — never close, reset or dismiss the stage.
  await syncPage.locator('.gate-modal__backdrop').click({ position: { x: 5, y: 5 } });
  await syncPage.waitForTimeout(320);
  assert.equal(await signStage(syncPage).isVisible(), true, 'a backdrop click at (5, 5) never closes the sign stage');
  assert.equal(await syncPage.evaluate(() => document.documentElement.classList.contains('gate-open')), true, 'the backdrop click never unlocks the page');
  await syncPage.mouse.click(5, 5);
  await syncPage.waitForTimeout(320);
  assert.equal(await signStage(syncPage).isVisible(), true, 'an empty-area click never closes the sign stage');
  await syncPage.locator('.gate-modal').click({ position: { x: 5, y: 5 } });
  await syncPage.waitForTimeout(320);
  assert.equal(await syncPage.locator('.gate-modal').count(), 1, 'the modal root never closes the sign stage');
  assert.equal(await syncPage.evaluate(() => document.documentElement.classList.contains('gate-open')), true, 'the modal root click never unlocks the page');
  assert.equal(await syncPage.locator('[data-sign-mode="draw"]').evaluate(el => el.classList.contains('is-active')), true, 'the stage is not reset by the clicks');
  assert.equal(await syncPage.locator('#sign-name').inputValue(), 'MATAN MAMADOV', 'the name is not reset by the clicks');
  assert.equal(await syncPage.locator('[data-sign-submit]').isDisabled(), false, 'the enabled button survives the clicks');
  await syncPage.locator('.gate-modal__card [data-gate-cancel]').click();
  await syncPage.locator('.gate-modal').waitFor({ state: 'detached' });
  await syncPage.close();

  const playback = await setupPage({ viewport: { width: 480, height: 800 }, reducedMotion: 'reduce' });
  await playback.goto(`${url}/index.html?beat=flesh`);
  // The player is strictly contained and GPU-promoted, so the scrub writes on
  // every `timeupdate` can never reflow the card or the sections around it.
  const playerCss = await playback.evaluate((card) => {
    const p = getComputedStyle(document.querySelector(card + ' .beat-preview'));
    const s = getComputedStyle(document.querySelector(card + ' .beat-preview__seek'));
    const t = getComputedStyle(document.querySelector(card + ' .beat-preview__time'));
    return {
      pContain: p.contain, pTransform: p.transform, pWillChange: p.willChange,
      pBackface: p.backfaceVisibility, pPerspective: p.perspective,
      sContain: s.contain, sTransform: s.transform, sOverflow: s.overflow, sRadius: s.borderRadius,
      timeWrap: t.whiteSpace, timeNumeric: t.fontVariantNumeric, timeFeatures: t.fontFeatureSettings,
      timeWidth: t.width, timeMinWidth: t.minWidth,
    };
  }, CARD);
  assert.match(playerCss.pContain, /layout/, 'the player box is layout-contained');
  assert.match(playerCss.pContain, /style/, 'the player box is style-contained');
  assert.match(playerCss.pTransform, /matrix/, 'the player box is GPU-promoted');
  assert.equal(playerCss.pWillChange, 'transform', 'the player box keeps its compositor layer');
  assert.equal(playerCss.pBackface, 'hidden', 'the player box hides its backface');
  assert.equal(playerCss.pPerspective, '1000px', 'the player box owns a 3D context');
  assert.match(playerCss.sContain, /layout/, 'the scrub bar is layout-contained');
  assert.match(playerCss.sContain, /style/, 'the scrub bar is style-contained');
  assert.match(playerCss.sTransform, /matrix/, 'the scrub bar is GPU-promoted');
  assert.equal(playerCss.sOverflow, 'hidden', 'the scrub bar contains its own paint');
  assert.notEqual(playerCss.sRadius, '0px', 'the scrub bar clips with a rounded box');
  assert.equal(playerCss.timeWrap, 'nowrap', 'the time readout can never wrap and resize the player');
  assert.equal(playerCss.timeNumeric, 'tabular-nums', 'the clock uses tabular figures');
  assert.match(playerCss.timeFeatures, /tnum/, 'the clock enables the tabular feature explicitly as well');
  assert.notEqual(playerCss.timeMinWidth, '0px', 'the clock reserves a fixed minimum width');
  assert(Math.abs(parseFloat(playerCss.timeWidth) - parseFloat(playerCss.timeMinWidth)) < 0.5, 'the clock is laid out at its reserved width');
  // Swapping the readout for the widest clock a full preview can show must not
  // move the player by a pixel.
  const textDrift = await playback.evaluate((card) => {
    const time = document.querySelector(card + ' .beat-preview__time');
    const player = document.querySelector(card + ' .beat-preview');
    const rect = el => { const b = el.getBoundingClientRect(); return [b.width, b.height]; };
    const p0 = rect(player), t0 = rect(time);
    time.textContent = '10:00 / 10:00';
    const p1 = rect(player), t1 = rect(time);
    time.textContent = '0:00 / --:--';
    return Math.max(...p0.map((v, i) => Math.abs(v - p1[i])), ...t0.map((v, i) => Math.abs(v - t1[i])));
  }, CARD);
  assert(textDrift < 0.5, `the widest clock leaves the player's box untouched (moved ${textDrift.toFixed(2)}px)`);
  await playback.locator(`${CARD} .beat-preview__toggle`).click();
  await playback.waitForFunction(() => {
    const audio = document.querySelector('#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af audio');
    return !audio.paused && audio.currentTime > 0 && audio.closest('.beat-preview').dataset.state === 'playing';
  }, null, { timeout: 15000 });
  // The playing frame is inert: no sheen pseudo-element, no shadow keyframes and
  // no rotating transform anywhere in the player or its button.
  const activeFx = await playback.evaluate((card) => {
    const p = document.querySelector(card + ' .beat-preview');
    const before = getComputedStyle(p, '::before');
    return {
      previewAnimation: getComputedStyle(p).animationName,
      toggleAnimation: getComputedStyle(p.querySelector('.beat-preview__toggle')).animationName,
      beforeContent: before.content,
      beforeAnimation: before.animationName,
    };
  }, CARD);
  assert.equal(activeFx.previewAnimation, 'none', 'the playing player runs no continuous animation');
  assert.equal(activeFx.toggleAnimation, 'none', 'the play button runs no continuous animation');
  assert.ok(activeFx.beforeContent === 'none' || activeFx.beforeContent === 'normal', 'the player has no sheen pseudo-element');
  assert.equal(activeFx.beforeAnimation, 'none', 'no sheen animation is running');
  // Nothing in the card may move a hair while the timeline advances.
  const drift = await playback.evaluate(async (card) => {
    const root = document.querySelector(card);
    const targets = ['.beat-preview', '.beat-preview__seek', '.beat-preview__time', '.beat-preview__toggle', '.download-actions'];
    const read = () => targets.map(sel => {
      const el = root.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [b.x, b.y, b.width, b.height];
    });
    const first = read();
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const now = read();
      now.forEach((rect, k) => {
        const base = first[k];
        if (!rect || !base) return;
        for (let axis = 0; axis < 4; axis++) worst = Math.max(worst, Math.abs(rect[axis] - base[axis]));
      });
    }
    return worst;
  }, CARD);
  assert(drift < 0.5, `the player holds perfectly still while the timeline advances (max drift ${drift.toFixed(2)}px)`);
  await playback.close();

  // A fast scroll must never wobble the open drawer: its geometry is frozen when
  // it opens and the scroll only writes a compositor transform, so it stays
  // welded to its button seam for the whole gesture — no re-sizing, no flip.
  const drawerScroll = await setupPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await drawerScroll.goto(`${url}/?beat=flesh`);
  await drawerScroll.locator(`${CARD} .download-trigger`).click();
  await drawerScroll.locator('.download-menu.is-open').waitFor();
  const drawerProbe = () => drawerScroll.evaluate((card) => {
    const menu = document.querySelector('.download-menu.is-open');
    const trigger = document.querySelector(card + ' .download-trigger');
    const m = menu.getBoundingClientRect(), t = trigger.getBoundingClientRect();
    const up = menu.classList.contains('download-menu--up');
    return {
      h: m.height,
      up,
      seam: up ? t.top - m.bottom : m.top - t.bottom,
      left: m.left - t.left,
      transform: getComputedStyle(menu).transform,
      position: getComputedStyle(menu).position,
    };
  }, CARD);
  const opened = await drawerProbe();
  assert.equal(opened.position, 'fixed', 'the drawer stays root-anchored while it is being scrolled');
  const frames = [];
  for (let i = 0; i < 24; i++) {
    await drawerScroll.evaluate(() => window.scrollBy(0, 40));
    // Give the scroll handler a frame's worth of headroom before sampling; the
    // transform is still asserted to track every step exactly.
    await drawerScroll.waitForTimeout(40);
    frames.push(await drawerProbe());
  }
  assert(frames.every(f => f.up === opened.up), 'a fast scroll never flips the drawer over mid-gesture');
  assert(Math.max(...frames.map(f => Math.abs(f.h - opened.h))) < 0.5, 'a fast scroll never re-sizes the drawer');
  const worstSeam = Math.max(...frames.map(f => Math.abs(f.seam)));
  assert(worstSeam < 1, `the drawer stays welded to its trigger seam while scrolling (worst ${worstSeam.toFixed(2)}px)`);
  assert(Math.max(...frames.map(f => Math.abs(f.left))) < 0.5, 'the drawer stays horizontally aligned while scrolling');
  assert(frames.some(f => f.transform !== 'none' && f.transform !== opened.transform), 'the scroll is tracked by a compositor transform, not a re-measure');
  await drawerScroll.close();

  // ------------------------------------------------- scheduled second release
  // [FREE 100%] FUTURE TYPE BEAT - THE FLOW is a *scheduled* drop: until its
  // clock lands the catalog tile's action slot holds a standalone countdown pill
  // — no button at all — while its own beat page shows the pill with a dedicated
  // inert LOCKED control beneath it. The label never names a clock hour (just
  // "DROPPING SOON" plus the live HH:MM:SS), so every timezone reads the same
  // thing. The second the clock reaches zero the store swaps itself for the full
  // player and the live drawer, in page, with no reload. The release clock reads
  // the `?now=` override, so the test can stand at any moment without waiting.
  const preDrop = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await preDrop.goto(`${url}/?now=${FLOW_RELEASE - 3600000}`);
  await noOverflow(preDrop);
  await noHue(preDrop, 'the storefront before the drop');
  await noLowercase(preDrop, 'the storefront before the drop');
  assert.equal(await preDrop.locator('#grid .catalog-tile').count(), 8, 'all eight releases sit in the catalog');
  assert.match(await preDrop.locator(`${FLOW_CARD} .drop-countdown__label`).innerText(), /DROPPING SOON/, 'the scheduled drop carries its countdown pill');
  assert.doesNotMatch(await preDrop.locator(`${FLOW_CARD} .drop-countdown__label`).innerText(), /\d/, 'the drop label carries no clock hour');
  assert.match(await preDrop.locator(`${FLOW_CARD} [data-countdown="${FLOW_ID}"]`).innerText(), /^\d{2}:\d{2}:\d{2}$/, 'the pill shows a live HH:MM:SS clock');
  // The catalog tile shows the pill and nothing else: no download button, no
  // redundant LOCKED control, no locked player pane.
  assert.equal(await preDrop.locator(`${FLOW_CARD} .download-trigger`).count(), 0, 'the catalog tile renders no download button');
  assert.equal(await preDrop.locator(`${FLOW_CARD} .download-trigger--locked`).count(), 0, 'the catalog tile renders no LOCKED control');
  assert.equal(await preDrop.locator(`${FLOW_CARD} .drop-locked`).count(), 0, 'the catalog tile renders no locked player pane');
  // Every card contains its own children, and the cards are separated by a
  // generous, explicit row gap (40px at desktop width).
  await noCardBleed(preDrop, 'desktop catalog');
  assert.equal(await preDrop.evaluate(() => getComputedStyle(document.getElementById('grid')).rowGap), '40px', 'the desktop catalog keeps a 40px row gap');
  assert(await preDrop.evaluate((id) => {
    const slot = document.getElementById('card-' + id).querySelector('.catalog-tile__actions');
    return !!slot && slot.querySelectorAll('button').length === 0 && !!slot.querySelector('.drop-countdown');
  }, FLOW_ID), 'the countdown pill is the whole catalog action slot, with no button beside it');
  // A locked drop cannot be opened programmatically either.
  await preDrop.evaluate((id) => window.KYROlll_DOWNLOADS.start(id, 'mp3'), FLOW_ID);
  await preDrop.evaluate((id) => window.KYROlll_DOWNLOADS.openMenu(document.body, id), FLOW_ID);
  assert.equal(await preDrop.locator('.gate-modal').count(), 0, 'a scheduled drop opens no gate');
  assert.equal(await preDrop.locator('.download-menu').count(), 0, 'a scheduled drop opens no drawer');
  // The helper refuses to hand out the unreleased video URL either.
  assert.equal(await preDrop.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), FLOW_ID), 'https://www.youtube.com/@KYROlll00?sub_confirmation=1', 'the helper withholds the unreleased video URL');
  await shot(preDrop, 'store-before-drop');
  await preDrop.close();

  // A cold download link to a drop that has not landed shows the same countdown
  // in the files card (the card must stay visible — hiding it hid the clock) and
  // offers no file rows or license until the clock reaches zero.
  const lockedDownload = await setupPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await lockedDownload.goto(`${url}/download.html?beat=${WHITE_NIGHT_ID}&package=exclusive&now=${WHITE_NIGHT_RELEASE - 3600000}`, { waitUntil: 'domcontentloaded' });
  await lockedDownload.locator('.drop-locked').waitFor();
  assert.equal(await lockedDownload.locator('.drop-locked').isVisible(), true, 'the cold download page paints the scheduled-drop panel');
  assert.match(await lockedDownload.locator('.drop-locked .drop-countdown').innerText(), /DROPPING SOON/, 'the cold download page carries the countdown label');
  assert.match(await lockedDownload.locator('.drop-locked [data-countdown="' + WHITE_NIGHT_ID + '"]').innerText(), /^\d{2}:\d{2}:\d{2}$/, 'the cold download page ticks a live clock');
  assert.equal(await lockedDownload.locator('.download-item').count(), 0, 'a scheduled drop hands over no files early');
  assert.equal(await lockedDownload.locator('#license-panel').isVisible(), false, 'a scheduled drop issues no license early');
  await lockedDownload.close();

  // On a phone the drops stack in one column, so the scheduled card's countdown
  // pill must clear the beat beneath it entirely — that is exactly where the
  // old 44px overflow overlapped THE FLOW's neighbour.
  const preDropPhone = await setupPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await preDropPhone.goto(`${url}/?now=${FLOW_RELEASE - 3600000}`);
  await preDropPhone.locator(`[data-countdown="${FLOW_ID}"]`).waitFor();
  await noOverflow(preDropPhone);
  await noCardBleed(preDropPhone, 'mobile catalog');
  assert.equal(await preDropPhone.evaluate(() => getComputedStyle(document.getElementById('grid')).rowGap), '28px', 'the mobile catalog keeps a ~28px row gap');
  const pillClearance = await preDropPhone.evaluate(({ flowId, fleshId }) => {
    const pill = document.querySelector('#card-' + flowId + ' .drop-countdown').getBoundingClientRect();
    const next = document.getElementById('card-' + fleshId).getBoundingClientRect();
    return next.top - pill.bottom;
  }, { flowId: FLOW_ID, fleshId: BEAT_ID });
  assert(pillClearance >= 16, `the countdown pill clears the next card by ${pillClearance.toFixed(1)}px, with no overlap`);
  await shot(preDropPhone, 'store-before-drop-phone');
  await preDropPhone.close();

  // ------------------------------------------------ mobile title isolation
  // The phone's glass beat card is the worst case for a WebKit re-rasterisation
  // jitter: a backdrop-filtered surface fading in while a live countdown and the
  // delayed vinyl reveal run inside it. The title, its head and the info sheet
  // are permanent compositor layers now, and the countdown readout is tabular
  // and fixed-width. Sample the title's document-space box and computed
  // transform through 60 real animation frames in each phase — the entrance
  // fade, a countdown tick, and the record sliding out — and require exactly
  // 0.00px of drift.
  const titlePhone = await setupPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
  const titleSelector = `${FLOW_CARD} .beat-detail__title`;
  const timerSelector = '[data-release-countdown] .drop-countdown__time';
  await titlePhone.goto(`${url}/?beat=the-flow&now=${FLOW_RELEASE - 3600000}`);
  await titlePhone.locator(titleSelector).waitFor();
  const flowPhoneTitle = await assertCleanTitle(titlePhone, FLOW_CARD, 'THE FLOW phone title');
  assert.match(flowPhoneTitle.text, /\[FREE 100%\] FUTURE TYPE BEAT - THE FLOW/i);

  const identityTransform = value => {
    const match = String(value).match(/^matrix(3d)?\((.+)\)$/);
    if (!match) return false;
    const actual = match[2].split(',').map(Number);
    const identity = match[1]
      ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      : [1, 0, 0, 1, 0, 0];
    return actual.length === identity.length && actual.every((n, i) => Math.abs(n - identity[i]) < 1e-6);
  };

  const layerStyles = await titlePhone.evaluate(() => {
    const read = selector => {
      const cs = getComputedStyle(document.querySelector(selector));
      return {
        transform: cs.transform,
        backfaceVisibility: cs.backfaceVisibility,
        fontSmoothing: cs.getPropertyValue('-webkit-font-smoothing'),
        textRendering: cs.textRendering,
        contain: cs.contain,
        isolation: cs.isolation,
        willChange: cs.willChange,
        textShadow: cs.textShadow,
        filter: cs.filter,
        animationName: cs.animationName,
        fontVariantNumeric: cs.fontVariantNumeric,
        fontFeatureSettings: cs.fontFeatureSettings,
      };
    };
    return {
      info: read('.beat-detail__info'),
      head: read('.beat-detail__head'),
      title: read('.beat-detail__title'),
      countdown: read('[data-release-countdown]'),
      timer: read('[data-release-countdown] .drop-countdown__time'),
    };
  });
  for (const layer of ['info', 'head', 'title']) {
    const style = layerStyles[layer];
    assert(identityTransform(style.transform), `${layer}: the beat-detail layer settles on translate3d(0, 0, 0) (${style.transform})`);
    assert.equal(style.backfaceVisibility, 'hidden', `${layer}: the layer is backface-hidden`);
    assert.equal(style.fontSmoothing, 'antialiased', `${layer}: the layer keeps antialiased text`);
    assert.equal(style.textRendering.toLowerCase(), 'geometricprecision', `${layer}: the layer uses geometric text precision`);
    assert.equal(style.isolation, 'isolate', `${layer}: the layer is isolated`);
    assert.equal(style.willChange, 'transform', `${layer}: the layer is held on its own compositor surface`);
  }
  for (const layer of ['info', 'head']) assert.match(layerStyles[layer].contain, /layout/, `${layer}: layout containment isolates its children`);
  assert.match(layerStyles.info.contain, /style/, 'the info sheet carries style containment too');
  assert.match(layerStyles.head.contain, /style/, 'the title head carries style containment too');
  assert.equal(layerStyles.title.animationName, 'none', 'the title carries no continuous animation');
  assert.equal(layerStyles.title.textShadow, 'none', 'the title carries no text-shadow animation');
  assert.equal(layerStyles.title.filter, 'none', 'the title carries no filter animation');
  assert.equal(layerStyles.countdown.fontVariantNumeric, 'tabular-nums', 'the countdown pill uses tabular figures');
  assert.match(layerStyles.countdown.fontFeatureSettings, /tnum/, 'the countdown pill enables the tnum feature');
  assert.equal(layerStyles.timer.fontVariantNumeric, 'tabular-nums', 'the countdown readout uses tabular figures');
  assert.match(layerStyles.timer.fontFeatureSettings, /tnum/, 'the countdown readout enables the tnum feature');

  const titleFrames = async (phase, frames = 60) => {
    const samples = await titlePhone.evaluate(async count => {
      const title = document.querySelector('.beat-detail__title');
      const card = document.querySelector('.beat-detail');
      const timer = document.querySelector('[data-release-countdown] .drop-countdown__time');
      const pill = document.querySelector('[data-release-countdown]');
      const record = document.querySelector('.vinyl-record');
      const rows = [];
      const read = () => {
        const rect = title.getBoundingClientRect();
        const timerRect = timer && timer.getBoundingClientRect();
        const pillRect = pill && pill.getBoundingClientRect();
        return {
          x: rect.left + scrollX,
          y: rect.top + scrollY,
          width: rect.width,
          height: rect.height,
          transform: getComputedStyle(title).transform,
          cardOpacity: Number(getComputedStyle(card).opacity),
          countdown: timer ? timer.textContent : '',
          timerWidth: timerRect ? timerRect.width : 0,
          pillWidth: pillRect ? pillRect.width : 0,
          recordTransform: record ? getComputedStyle(record).transform : 'none',
        };
      };
      await new Promise(resolve => {
        const step = () => {
          rows.push(read());
          if (rows.length >= count) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return rows;
    }, frames);
    const first = samples[0];
    const worst = Math.max(...samples.flatMap(sample => [
      Math.abs(sample.x - first.x),
      Math.abs(sample.y - first.y),
      Math.abs(sample.width - first.width),
      Math.abs(sample.height - first.height),
    ]));
    assert.equal(Math.round(worst * 100) / 100, 0, `${phase}: the beat title drift is 0.00px (measured ${worst}px)`);
    assert(samples.every(sample => sample.transform === first.transform), `${phase}: the title's computed transform never changes`);
    return samples;
  };

  // 1. The card's entrance fade. Restart it deliberately so all 60 frames cover
  //    the 0.8 s fade instead of racing the page load.
  await titlePhone.evaluate(() => {
    const card = document.querySelector('.beat-detail');
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
  });
  const entranceFrames = await titleFrames('entrance');
  assert(entranceFrames.some(sample => sample.cardOpacity < 0.99), 'the 60-frame sample really covers the entrance fade');
  assert(entranceFrames.some(sample => sample.cardOpacity >= 0.99), 'the entrance fade settles at full opacity');

  // 2. A live countdown tick. Start just after one tick so the 60-frame window
  //    necessarily crosses the next, and prove both the digits and the boxes hold.
  const initialCountdown = await titlePhone.locator(timerSelector).innerText();
  await titlePhone.waitForFunction(
    ([selector, previous]) => document.querySelector(selector)?.textContent !== previous,
    [timerSelector, initialCountdown],
    { timeout: 5000 },
  );
  await titlePhone.waitForTimeout(850);
  /* A wide sample window (150 frames ≈ 2.5 s at 60 fps, and still ≥ 1 s on a
     120 Hz panel) so the window can never close before the next one-second
     tick: the assertion is that the digits change while the boxes do not. */
  const countdownFrames = await titleFrames('countdown tick', 150);
  assert(new Set(countdownFrames.map(sample => sample.countdown)).size >= 2, 'the countdown sample spans at least one real tick');
  assert.equal(new Set(countdownFrames.map(sample => sample.timerWidth)).size, 1, 'the countdown readout width never changes');
  assert.equal(new Set(countdownFrames.map(sample => sample.pillWidth)).size, 1, 'the countdown pill width never changes');

  // 3. The delayed vinyl reveal. Reload so the 60-frame window starts exactly as
  //    `vinyl-open` lands, and prove the record really is moving under it.
  await titlePhone.reload({ waitUntil: 'domcontentloaded' });
  await titlePhone.locator(titleSelector).waitFor();
  await titlePhone.locator(`${FLOW_CARD}.beat-detail.vinyl-open`).waitFor({ timeout: 15000 });
  const vinylFrames = await titleFrames('vinyl slide-out');
  assert(new Set(vinylFrames.map(sample => sample.recordTransform)).size > 1, 'the vinyl sample spans the slide-out transition');
  await titlePhone.close();

  // The beat page before the drop carries no player, a countdown pill and the
  // dedicated inert LOCKED control — and the exact second the clock lands it
  // unlocks itself in place.
  const liveDrop = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await liveDrop.goto(`${url}/?beat=the-flow&now=${FLOW_RELEASE - 20000}`);
  await liveDrop.locator(`[data-countdown="${FLOW_ID}"]`).waitFor();
  assert.equal(await liveDrop.locator(`${FLOW_CARD}.beat-detail`).count(), 1, 'the scheduled beat page renders');
  assert.match(await liveDrop.locator(FLOW_CARD).innerText(), /\[FREE 100%\] FUTURE TYPE BEAT - THE FLOW/i);
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .beat-preview`).count(), 0, 'no player is mounted before the drop');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .drop-locked`).count(), 1, 'the locked player stand-in renders on the beat page');
  assert.match(await liveDrop.locator(`${FLOW_CARD} .card__actions .drop-countdown`).innerText(), /DROPPING SOON/, 'the beat page action slot carries the countdown pill');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .card__actions .download-trigger--locked`).count(), 1, 'the beat page carries the dedicated LOCKED control');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .download-trigger[disabled]`).count(), 1, 'the LOCKED control is inert');
  // The title block is the title and the specs only — no YouTube icon, locked
  // or otherwise, while the drop waits.
  await noYouTubeButton(liveDrop, FLOW_CARD);
  // Clicking the inert control opens nothing at all.
  await liveDrop.evaluate((id) => {
    const locked = document.querySelector('#card-' + id + ' .download-trigger--locked');
    locked.click();
    locked.closest('.card__actions').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, FLOW_ID);
  assert.equal(await liveDrop.locator('.download-menu').count(), 0, 'the LOCKED control opens no drawer');
  assert.equal(await liveDrop.locator('.gate-modal').count(), 0, 'the LOCKED control opens no gate');
  const urlBeforeDrop = liveDrop.url();
  await liveDrop.waitForFunction((id) => {
    const card = document.getElementById('card-' + id);
    return !!(card && card.querySelector('.beat-preview__toggle')
      && card.querySelector('.download-trigger[data-download-trigger]')
      && !card.querySelector('.drop-countdown')
      && !card.querySelector('.download-trigger--locked'));
  }, FLOW_ID, { timeout: 30000 });
  assert.equal(liveDrop.url(), urlBeforeDrop, 'the drop unlocks in page, with no reload');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .download-trigger--locked`).count(), 0, 'the LOCKED control is gone the moment the clock lands');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .download-trigger`).count(), 1, 'the download button is live the moment the clock lands');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .drop-countdown`).count(), 0, 'the countdown is gone once the drop lands');
  // …and the title block stays icon-free after the unlock too.
  await noYouTubeButton(liveDrop, FLOW_CARD);
  assert.equal(await liveDrop.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), FLOW_ID), 'https://www.youtube.com/watch?v=aHMCkzw9Wuo', 'the helper releases the video URL with the clock');
  await liveDrop.close();

  // After the drop it behaves exactly like the first release: the three-package
  // drawer, the gates, and the studio-named hand-over with a fresh PDF serial.
  const flowPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await flowPage.goto(`${url}/?beat=the-flow&now=${FLOW_RELEASE + 1000}`);
  await flowPage.locator(`${FLOW_CARD} .beat-preview__toggle`).waitFor();
  assert.match(await flowPage.locator(FLOW_CARD).innerText(), /\[FREE 100%\] FUTURE TYPE BEAT - THE FLOW/i);
  assert.match(await flowPage.locator(FLOW_CARD).innerText(), /124 BPM \/\/ C#M/i);
  assert.equal(await flowPage.locator(`${FLOW_CARD} .download-trigger`).count(), 1, 'the trigger is live after the drop');
  assert.equal(await flowPage.locator(`${FLOW_CARD} .drop-countdown`).count(), 0, 'the countdown is gone once the drop is live');
  await flowPage.locator(`${FLOW_CARD} .download-trigger`).click();
  await flowPage.locator('.download-menu.is-open').waitFor();
  assert.equal(await flowPage.locator('.download-tier').count(), 3, 'the same three-package drawer');
  await flowPage.locator('.download-tier[data-package="mp3"]').click();
  await flowPage.locator('.gate-modal').waitFor();
  await flowPage.locator('#gate-email').fill('flow-buyer@example.com');
  await flowPage.locator('[data-gate-submit]').click();
  await signLicense(flowPage, 'Flow Buyer');
  await flowPage.waitForURL(/download\.html\?beat=.*package=mp3/);
  assert.equal(await flowPage.locator('.download-item__name').textContent(), 'KYROIII - THE FLOW (124 BPM - C#M).mp3');
  const flowSerial = await flowPage.locator('#license-serial').innerText();
  assert.match(flowSerial, /^KYRO-\d{4}-THE-FLOW-\d{6}$/, 'the serial carries the hyphenated beat slug');
  const [flowPdf] = await Promise.all([
    flowPage.waitForEvent('download'),
    flowPage.locator('[data-license-pdf]').click(),
  ]);
  assert.match(flowPdf.suggestedFilename(), /^KYROIII - LICENSE - THE FLOW \(KYRO-\d{4}-THE-FLOW-\d{6}\)\.pdf$/, 'the license saves under the studio name');
  const flowText = (await readFile(await flowPdf.path())).toString('latin1');
  assert(flowText.includes('PAGE 1 OF 1'), 'the flow license fits one page');
  assert(flowText.includes('FLOW BUYER'), 'the flow license carries its signer');
  assert(flowText.includes('THE FLOW'), 'the flow license names the beat');
  assert.equal((flowText.match(/\/Im1 Do/g) || []).length, 2, 'the flower is drawn twice on the flow license too');
  assert.deepEqual(pdfRuns(flowText).filter(run => /[a-z]/.test(run)), [], 'the flow license is ALL CAPS');
  await shot(flowPage, 'download-flow');
  await flowPage.close();

  // ------------------------------------------ third release: GREEN FLESH (23:00)
  // The third official drop is scheduled for 23:00 Israel time. It follows the
  // same pre-release contract as THE FLOW — a countdown-only tile, a locked
  // detail page, and an in-page unlock — and it wears the identical
  // photographed record with the complete flower logo printed on its label. The studio count
  // must stay at two releases until its clock lands, then become three.
  const greenPre = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await greenPre.goto(`${url}/?now=${GREEN_FLESH_RELEASE - 3600000}`);
  await greenPre.locator(`[data-countdown="${GREEN_FLESH_ID}"]`).waitFor();
  assert.equal(await greenPre.locator('#grid .catalog-tile').count(), 8, 'the third release is in the eight-card catalog');
  assert.equal(await greenPre.locator(`${GREEN_FLESH_CARD} .catalog-tile__link`).count(), 1, 'the GREEN FLESH catalog card renders in the catalog');
  assert.match(await greenPre.locator(`${GREEN_FLESH_CARD} .drop-countdown__label`).innerText(), /DROPPING SOON/, 'GREEN FLESH carries its countdown pill');
  assert.doesNotMatch(await greenPre.locator(`${GREEN_FLESH_CARD} .drop-countdown__label`).innerText(), /\d/, 'the drop label carries no clock hour');
  assert.match(await greenPre.locator(`${GREEN_FLESH_CARD} [data-countdown="${GREEN_FLESH_ID}"]`).innerText(), /^\d{2}:\d{2}:\d{2}$/, 'GREEN FLESH shows a live HH:MM:SS clock');
  assert.equal(await greenPre.locator(`${GREEN_FLESH_CARD} .download-trigger`).count(), 0, 'the GREEN FLESH tile renders no download button before its drop');
  assert.equal(await greenPre.locator(`${GREEN_FLESH_CARD} .download-trigger--locked`).count(), 0, 'the GREEN FLESH tile renders no secondary LOCKED control');
  assert.equal(await greenPre.locator(`${GREEN_FLESH_CARD} .drop-locked`).count(), 0, 'the GREEN FLESH tile renders no locked player pane');
  assert(await greenPre.evaluate((id) => {
    const slot = document.getElementById('card-' + id).querySelector('.catalog-tile__actions');
    return !!slot && slot.querySelectorAll('button').length === 0 && !!slot.querySelector('.drop-countdown');
  }, GREEN_FLESH_ID), 'the countdown pill is the whole GREEN FLESH action slot, with no button beside it');
  assert.match(await greenPre.locator('.marquee-track').innerText(), /2 RELEASES LIVE/, 'the studio count excludes the not-yet-live third release');
  await greenPre.evaluate((id) => window.KYROlll_DOWNLOADS.start(id, 'mp3'), GREEN_FLESH_ID);
  await greenPre.evaluate((id) => window.KYROlll_DOWNLOADS.openMenu(document.body, id), GREEN_FLESH_ID);
  assert.equal(await greenPre.locator('.gate-modal').count(), 0, 'the scheduled GREEN FLESH drop opens no gate');
  assert.equal(await greenPre.locator('.download-menu').count(), 0, 'the scheduled GREEN FLESH drop opens no drawer');
  assert.equal(await greenPre.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), GREEN_FLESH_ID), 'https://www.youtube.com/@KYROlll00?sub_confirmation=1', 'the helper withholds the GREEN FLESH video URL until release');
  await noCardBleed(greenPre, 'GREEN FLESH desktop catalog');
  await greenPre.close();

  const greenLive = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'no-preference' });
  // Leave enough pre-release runway for the locked-state assertions on a slow
  // software-rendered run, and stop at DOM readiness so the 3D flower's first
  // paint cannot spend that runway before the page is inspected.
  await greenLive.goto(`${url}/?beat=green-flesh&now=${GREEN_FLESH_RELEASE - 12000}`, { waitUntil: 'domcontentloaded' });
  await greenLive.locator(`[data-countdown="${GREEN_FLESH_ID}"]`).waitFor();
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD}.beat-detail`).count(), 1, 'the GREEN FLESH beat page renders');
  assert.match(await greenLive.locator(GREEN_FLESH_CARD).innerText(), /\[FREE 100%\] LIL BABY TYPE BEAT - GREEN FLESH/i);
  assert.equal(await greenLive.evaluate(() => window.KYROlll_HELPERS.beatById('steam').slug), 'green-flesh', 'the old STEAM URL still resolves to the renamed beat');
  assert.match(await greenLive.locator(GREEN_FLESH_CARD).innerText(), /138 BPM \/\/ B/i);
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .beat-preview`).count(), 0, 'GREEN FLESH has no player before its drop');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .drop-locked`).count(), 1, 'GREEN FLESH shows the locked player stand-in');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .card__actions .download-trigger--locked`).count(), 1, 'GREEN FLESH shows the dedicated LOCKED control');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .download-trigger[disabled]`).count(), 1, 'the GREEN FLESH LOCKED control is inert');
  await noYouTubeButton(greenLive, GREEN_FLESH_CARD);
  const greenUrlBeforeDrop = greenLive.url();
  await greenLive.waitForFunction((id) => {
    const card = document.getElementById('card-' + id);
    return !!(card && card.querySelector('.beat-preview__toggle')
      && card.querySelector('.download-trigger[data-download-trigger]')
      && !card.querySelector('.drop-countdown')
      && !card.querySelector('.download-trigger--locked'));
  }, GREEN_FLESH_ID, { timeout: 30000 });
  assert.equal(greenLive.url(), greenUrlBeforeDrop, 'GREEN FLESH unlocks in page, with no reload');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .beat-preview`).count(), 1, 'the GREEN FLESH player appears the second the clock lands');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .download-trigger`).count(), 1, 'the GREEN FLESH download button is live at release');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .drop-countdown`).count(), 0, 'the GREEN FLESH countdown is gone at release');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .download-trigger--locked`).count(), 0, 'the GREEN FLESH LOCKED control is gone at release');
  await noYouTubeButton(greenLive, GREEN_FLESH_CARD);
  assert.equal(await greenLive.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), GREEN_FLESH_ID), 'https://www.youtube.com/@KYROlll00', 'the helper releases the GREEN FLESH link with the clock');
  // GREEN FLESH plays the identical photographed pressing.
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD}.beat-detail .vinyl-record`).count(), 1, 'GREEN FLESH renders the photographed pressing');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .vinyl-record__rim`).count(), 0, 'GREEN FLESH paints no synthetic rim');
  assert.equal(await greenLive.locator(`${GREEN_FLESH_CARD} .vinyl-record--white`).count(), 0, 'no retired modifier is reused');
  await assertPressing(greenLive, GREEN_FLESH_CARD, 'GREEN FLESH');
  // The pro package's hand-over names are built from the beat's own metadata.
  assert.deepEqual(await greenLive.evaluate((id) => window.KYROlll_DOWNLOADS.deliverablesFor(id, 'exclusive').map(item => item.name), GREEN_FLESH_ID), [
    'KYROIII - GREEN FLESH (138 BPM - B).mp3',
    'KYROIII - GREEN FLESH (138 BPM - B).wav',
    'KYROIII - GREEN FLESH - TRACKED STEMS.zip',
  ], 'GREEN FLESH hands over the studio MP3, WAV and tracked stems names');
  await shot(greenLive, 'green-flesh-live');
  await greenLive.close();

  // The renamed beat also owns the download page and the license: the page
  // title, every studio filename and the PDF serial all follow GREEN FLESH,
  // while the supplied steam.* asset paths stay untouched.
  const greenDownload = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await greenDownload.goto(`${url}/download.html?beat=${GREEN_FLESH_ID}&package=exclusive&t=greenflesh&sign=Jordan%20Vega&now=${GREEN_FLESH_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await greenDownload.locator('#license-serial').waitFor();
  assert.match(await greenDownload.locator('#download-title').innerText(), /LIL BABY TYPE BEAT - GREEN FLESH/i);
  assert.match(await greenDownload.locator('#license-serial').innerText(), /^KYRO-\d{4}-GREEN-FLESH-\d{6}$/, 'the GREEN FLESH serial carries its renamed slug');
  assert.deepEqual(await greenDownload.locator('.download-item__name').evaluateAll(nodes => nodes.map(node => node.textContent)), [
    'KYROIII - GREEN FLESH (138 BPM - B).mp3',
    'KYROIII - GREEN FLESH (138 BPM - B).wav',
    'KYROIII - GREEN FLESH - TRACKED STEMS.zip',
  ], 'the GREEN FLESH download page lists the renamed studio files');
  const [greenPdf] = await Promise.all([
    greenDownload.waitForEvent('download'),
    greenDownload.locator('[data-license-pdf]').click(),
  ]);
  assert.match(greenPdf.suggestedFilename(), /^KYROIII - LICENSE - GREEN FLESH \(KYRO-\d{4}-GREEN-FLESH-\d{6}\)\.pdf$/, 'the GREEN FLESH license saves under its renamed studio name and serial');
  const greenPdfText = (await readFile(await greenPdf.path())).toString('latin1');
  const greenPdfRuns = pdfRuns(greenPdfText).join(' ');
  assert.match(greenPdfRuns, /\[FREE 100%\] LIL BABY TYPE/, 'the GREEN FLESH license carries the renamed title opening');
  assert.match(greenPdfRuns, /BEAT - GREEN FLESH/, 'the GREEN FLESH license carries the renamed title tail');
  assert.equal(greenPdfText.includes('STEAM'), false, 'the GREEN FLESH license carries no trace of the old title');
  await greenDownload.close();

  const greenAfter = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await greenAfter.goto(`${url}/?now=${GREEN_FLESH_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await greenAfter.locator(`${GREEN_FLESH_CARD} .download-trigger`).waitFor();
  assert.match(await greenAfter.locator('.marquee-track').innerText(), /3 RELEASES LIVE/, 'the studio count becomes three once GREEN FLESH is live');
  await greenAfter.close();

  // ------------------------------------------ fourth release: SQUISH! (23:00)
  // The newest drop follows the same countdown contract and adds the icy
  // silver collector pressing. The studio count must stay at three until its
  // clock lands, then become four.
  const squishPre = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await squishPre.goto(`${url}/?now=${SQUISH_RELEASE - 3600000}`);
  await squishPre.locator(`[data-countdown="${SQUISH_ID}"]`).waitFor();
  assert.equal(await squishPre.locator('#grid .catalog-tile').count(), 8, 'the fourth release is in the eight-card catalog');
  assert.equal(await squishPre.locator('#grid .catalog-tile').first().getAttribute('id'), 'card-' + WHITE_NIGHT_ID, 'the WHITE NIGHT drop leads the catalog as the newest scheduled drop');
  assert.equal(await squishPre.locator('#grid .catalog-tile').nth(1).getAttribute('id'), 'card-' + GUNNA_ID, 'GUNNA follows the newest drop');
  assert.equal(await squishPre.locator('#grid .catalog-tile').nth(2).getAttribute('id'), 'card-adll', 'ADLL follows GUNNA');
  assert.equal(await squishPre.locator('#grid .catalog-tile').nth(3).getAttribute('id'), 'card-just-d0-it', 'JUST D0 IT follows ADLL');
  assert.equal(await squishPre.locator('#grid .catalog-tile').nth(4).getAttribute('id'), 'card-squish', 'SQUISH! follows JUST D0 IT');
  assert.equal(await squishPre.locator(`${SQUISH_CARD} .catalog-tile__link`).count(), 1, 'the SQUISH! catalog card renders in the catalog');
  assert.match(await squishPre.locator(SQUISH_CARD).innerText(), /\[FREE 100%\] LIL GOTIT TYPE BEAT - SQUISH!/i);
  assert.match(await squishPre.locator(`${SQUISH_CARD} .drop-countdown__label`).innerText(), /DROPPING SOON/, 'SQUISH! carries its countdown pill');
  assert.doesNotMatch(await squishPre.locator(`${SQUISH_CARD} .drop-countdown__label`).innerText(), /\d/, 'the SQUISH! label carries no clock hour');
  assert.match(await squishPre.locator(`${SQUISH_CARD} [data-countdown="${SQUISH_ID}"]`).innerText(), /^\d{2}:\d{2}:\d{2}$/, 'SQUISH! shows a live HH:MM:SS clock');
  assert.equal(await squishPre.locator(`${SQUISH_CARD} .download-trigger`).count(), 0, 'the SQUISH! tile renders no download button before its drop');
  assert.equal(await squishPre.locator(`${SQUISH_CARD} .download-trigger--locked`).count(), 0, 'the SQUISH! tile renders no secondary LOCKED control');
  assert.equal(await squishPre.locator(`${SQUISH_CARD} .drop-locked`).count(), 0, 'the SQUISH! tile renders no locked player pane');
  assert(await squishPre.evaluate((id) => {
    const slot = document.getElementById('card-' + id).querySelector('.catalog-tile__actions');
    return !!slot && slot.querySelectorAll('button').length === 0 && !!slot.querySelector('.drop-countdown');
  }, SQUISH_ID), 'the countdown pill is the whole SQUISH! action slot, with no button beside it');
  assert.match(await squishPre.locator('.marquee-track').innerText(), /3 RELEASES LIVE/, 'the studio count excludes the not-yet-live fourth release');
  await squishPre.evaluate((id) => window.KYROlll_DOWNLOADS.start(id, 'mp3'), SQUISH_ID);
  await squishPre.evaluate((id) => window.KYROlll_DOWNLOADS.openMenu(document.body, id), SQUISH_ID);
  assert.equal(await squishPre.locator('.gate-modal').count(), 0, 'the scheduled SQUISH! drop opens no gate');
  assert.equal(await squishPre.locator('.download-menu').count(), 0, 'the scheduled SQUISH! drop opens no drawer');
  assert.equal(await squishPre.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), SQUISH_ID), 'https://www.youtube.com/@KYROlll00?sub_confirmation=1', 'the helper withholds the SQUISH! video URL until release');
  await noCardBleed(squishPre, 'SQUISH! desktop catalog');
  await squishPre.close();

  const squishLive = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'no-preference' });
  await squishLive.goto(`${url}/?beat=squish&now=${SQUISH_RELEASE - 12000}`, { waitUntil: 'domcontentloaded' });
  await squishLive.locator(`[data-countdown="${SQUISH_ID}"]`).waitFor();
  assert.equal(await squishLive.locator(`${SQUISH_CARD}.beat-detail`).count(), 1, 'the SQUISH! beat page renders');
  assert.match(await squishLive.locator(SQUISH_CARD).innerText(), /\[FREE 100%\] LIL GOTIT TYPE BEAT - SQUISH!/i);
  assert.match(await squishLive.locator(SQUISH_CARD).innerText(), /124 BPM \/\/ FM/i);
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .beat-preview`).count(), 0, 'SQUISH! has no player before its drop');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .drop-locked`).count(), 1, 'SQUISH! shows the locked player stand-in');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .card__actions .download-trigger--locked`).count(), 1, 'SQUISH! shows the dedicated LOCKED control');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .download-trigger[disabled]`).count(), 1, 'the SQUISH! LOCKED control is inert');
  await noYouTubeButton(squishLive, SQUISH_CARD);
  const squishUrlBeforeDrop = squishLive.url();
  await squishLive.waitForFunction((id) => {
    const card = document.getElementById('card-' + id);
    return !!(card && card.querySelector('.beat-preview__toggle')
      && card.querySelector('.download-trigger[data-download-trigger]')
      && !card.querySelector('.drop-countdown')
      && !card.querySelector('.download-trigger--locked'));
  }, SQUISH_ID, { timeout: 30000 });
  assert.equal(squishLive.url(), squishUrlBeforeDrop, 'SQUISH! unlocks in page, with no reload');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .beat-preview`).count(), 1, 'the SQUISH! player appears the second the clock lands');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .download-trigger`).count(), 1, 'the SQUISH! download button is live at release');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .drop-countdown`).count(), 0, 'the SQUISH! countdown is gone at release');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .download-trigger--locked`).count(), 0, 'the SQUISH! LOCKED control is gone at release');
  await noYouTubeButton(squishLive, SQUISH_CARD);
  assert.equal(await squishLive.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), SQUISH_ID), 'https://www.youtube.com/@KYROlll00', 'the helper releases the SQUISH! link with the clock');
  // SQUISH! is the pale end of the same engine: its diamond-white cover presses
  // a silver disc with a bright white rim and a near-black label (legacy text, not asserted).
  assert.equal(await squishLive.locator(`${SQUISH_CARD}.beat-detail .vinyl-record`).count(), 1, 'SQUISH! renders the photographed pressing');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .vinyl-record`).count(), 1, 'SQUISH! renders the photographed pressing');
  assert.equal(await squishLive.locator(`${SQUISH_CARD} .vinyl-record--gold-rim`).count(), 0, 'no retired modifier is reused');
  await assertPressing(squishLive, SQUISH_CARD, 'SQUISH!');
  assert.deepEqual(await squishLive.evaluate((id) => window.KYROlll_DOWNLOADS.deliverablesFor(id, 'exclusive').map(item => item.name), SQUISH_ID), [
    'KYROIII - SQUISH! (124 BPM - FM).mp3',
    'KYROIII - SQUISH! (124 BPM - FM).wav',
    'KYROIII - SQUISH! - TRACKED STEMS.zip',
  ], 'SQUISH! hands over the studio MP3, WAV and tracked stems names');
  await shot(squishLive, 'squish-live');
  await squishLive.close();

  const squishDownload = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await squishDownload.goto(`${url}/download.html?beat=${SQUISH_ID}&package=exclusive&t=squishflow&sign=Squish%20Buyer&now=${SQUISH_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await squishDownload.locator('#license-serial').waitFor();
  assert.match(await squishDownload.locator('#download-title').innerText(), /LIL GOTIT TYPE BEAT - SQUISH!/i);
  assert.match(await squishDownload.locator('#license-serial').innerText(), /^KYRO-\d{4}-SQUISH-\d{6}$/, 'the SQUISH! serial carries its slug');
  assert.deepEqual(await squishDownload.locator('.download-item__name').evaluateAll(nodes => nodes.map(node => node.textContent)), [
    'KYROIII - SQUISH! (124 BPM - FM).mp3',
    'KYROIII - SQUISH! (124 BPM - FM).wav',
    'KYROIII - SQUISH! - TRACKED STEMS.zip',
  ], 'the SQUISH! download page lists the studio files');
  const [squishPdf] = await Promise.all([
    squishDownload.waitForEvent('download'),
    squishDownload.locator('[data-license-pdf]').click(),
  ]);
  assert.match(squishPdf.suggestedFilename(), /^KYROIII - LICENSE - SQUISH! \(KYRO-\d{4}-SQUISH-\d{6}\)\.pdf$/, 'the SQUISH! license saves with its exclamation and serial');
  const squishPdfText = (await readFile(await squishPdf.path())).toString('latin1');
  const squishPdfRuns = pdfRuns(squishPdfText).join(' ');
  assert.match(squishPdfRuns, /\[FREE 100%\] LIL GOTIT TYPE/, 'the SQUISH! license carries its title opening');
  assert.match(squishPdfRuns, /BEAT - SQUISH!/, 'the SQUISH! license carries its title tail');
  await squishDownload.close();

  const squishAfter = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await squishAfter.goto(`${url}/?now=${SQUISH_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await squishAfter.locator(`${SQUISH_CARD} .download-trigger`).waitFor();
  assert.match(await squishAfter.locator('.marquee-track').innerText(), /4 RELEASES LIVE/, 'the studio count becomes four once SQUISH! is live');
  await squishAfter.close();

  // ------------------------------------------ fifth release: JUST D0 IT (23:00)
  // The newest drop is scheduled for 23:00 Israel time on 27 October 2026. It
  // follows the same countdown contract and adds the identical photographed
  // record. The studio count must stay at four until its clock
  // lands, then become five.
  const justDoItPre = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await justDoItPre.goto(`${url}/?now=${JUST_DO_IT_RELEASE - 3600000}`);
  await justDoItPre.locator(`[data-countdown="${JUST_DO_IT_ID}"]`).waitFor();
  assert.equal(await justDoItPre.locator('#grid .catalog-tile').count(), 8, 'the fifth release is in the eight-card catalog');
  assert.equal(await justDoItPre.locator('#grid .catalog-tile').first().getAttribute('id'), 'card-' + WHITE_NIGHT_ID, 'the WHITE NIGHT drop leads the catalog as the newest drop');
  assert.equal(await justDoItPre.locator('#grid .catalog-tile').nth(1).getAttribute('id'), 'card-' + GUNNA_ID, 'GUNNA follows the newest drop');
  assert.equal(await justDoItPre.locator('#grid .catalog-tile').nth(2).getAttribute('id'), 'card-adll', 'ADLL follows GUNNA');
  assert.equal(await justDoItPre.locator('#grid .catalog-tile').nth(3).getAttribute('id'), 'card-just-d0-it', 'JUST D0 IT follows ADLL');
  assert.equal(await justDoItPre.locator(`${JUST_DO_IT_CARD} .catalog-tile__link`).count(), 1, 'the JUST D0 IT catalog card renders in the catalog');
  assert.match(await justDoItPre.locator(JUST_DO_IT_CARD).innerText(), /\[FREE 100%\] YEAT TYPE BEAT - JUST D0 IT/i);
  assert.match(await justDoItPre.locator(`${JUST_DO_IT_CARD} .drop-countdown__label`).innerText(), /DROPPING SOON/, 'JUST D0 IT carries its countdown pill');
  assert.doesNotMatch(await justDoItPre.locator(`${JUST_DO_IT_CARD} .drop-countdown__label`).innerText(), /\d/, 'the JUST D0 IT label carries no clock hour');
  assert.match(await justDoItPre.locator(`${JUST_DO_IT_CARD} [data-countdown="${JUST_DO_IT_ID}"]`).innerText(), /^\d{2}:\d{2}:\d{2}$/, 'JUST D0 IT shows a live HH:MM:SS clock');
  assert.equal(await justDoItPre.locator(`${JUST_DO_IT_CARD} .download-trigger`).count(), 0, 'the JUST D0 IT tile renders no download button before its drop');
  assert.equal(await justDoItPre.locator(`${JUST_DO_IT_CARD} .download-trigger--locked`).count(), 0, 'the JUST D0 IT tile renders no secondary LOCKED control');
  assert.equal(await justDoItPre.locator(`${JUST_DO_IT_CARD} .drop-locked`).count(), 0, 'the JUST D0 IT tile renders no locked player pane');
  assert(await justDoItPre.evaluate((id) => {
    const slot = document.getElementById('card-' + id).querySelector('.catalog-tile__actions');
    return !!slot && slot.querySelectorAll('button').length === 0 && !!slot.querySelector('.drop-countdown');
  }, JUST_DO_IT_ID), 'the countdown pill is the whole JUST D0 IT action slot, with no button beside it');
  assert.match(await justDoItPre.locator('.marquee-track').innerText(), /4 RELEASES LIVE/, 'the studio count excludes the not-yet-live fifth release');
  await justDoItPre.evaluate((id) => window.KYROlll_DOWNLOADS.start(id, 'mp3'), JUST_DO_IT_ID);
  await justDoItPre.evaluate((id) => window.KYROlll_DOWNLOADS.openMenu(document.body, id), JUST_DO_IT_ID);
  assert.equal(await justDoItPre.locator('.gate-modal').count(), 0, 'the scheduled JUST D0 IT drop opens no gate');
  assert.equal(await justDoItPre.locator('.download-menu').count(), 0, 'the scheduled JUST D0 IT drop opens no drawer');
  assert.equal(await justDoItPre.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), JUST_DO_IT_ID), 'https://www.youtube.com/@KYROlll00?sub_confirmation=1', 'the helper withholds the JUST D0 IT video URL until release');
  await noCardBleed(justDoItPre, 'JUST D0 IT desktop catalog');
  await justDoItPre.close();

  const justDoItLive = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'no-preference' });
  await justDoItLive.goto(`${url}/?beat=just-d0-it&now=${JUST_DO_IT_RELEASE - 12000}`, { waitUntil: 'domcontentloaded' });
  await justDoItLive.locator(`[data-countdown="${JUST_DO_IT_ID}"]`).waitFor();
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD}.beat-detail`).count(), 1, 'the JUST D0 IT beat page renders');
  assert.match(await justDoItLive.locator(JUST_DO_IT_CARD).innerText(), /\[FREE 100%\] YEAT TYPE BEAT - JUST D0 IT/i);
  const justDoItTitle = await assertCleanTitle(justDoItLive, JUST_DO_IT_CARD, 'JUST D0 IT title');
  assert.match(justDoItTitle.text, /\[FREE 100%\] YEAT TYPE BEAT - JUST D0 IT/i);
  assert.match(await justDoItLive.locator(JUST_DO_IT_CARD).innerText(), /135 BPM \/\/ AM/i);
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .beat-preview`).count(), 0, 'JUST D0 IT has no player before its drop');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .drop-locked`).count(), 1, 'JUST D0 IT shows the locked player stand-in');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .card__actions .download-trigger--locked`).count(), 1, 'JUST D0 IT shows the dedicated LOCKED control');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .download-trigger[disabled]`).count(), 1, 'the JUST D0 IT LOCKED control is inert');
  await noYouTubeButton(justDoItLive, JUST_DO_IT_CARD);
  const justDoItUrlBeforeDrop = justDoItLive.url();
  await justDoItLive.waitForFunction((id) => {
    const card = document.getElementById('card-' + id);
    return !!(card && card.querySelector('.beat-preview__toggle')
      && card.querySelector('.download-trigger[data-download-trigger]')
      && !card.querySelector('.drop-countdown')
      && !card.querySelector('.download-trigger--locked'));
  }, JUST_DO_IT_ID, { timeout: 30000 });
  assert.equal(justDoItLive.url(), justDoItUrlBeforeDrop, 'JUST D0 IT unlocks in page, with no reload');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .beat-preview`).count(), 1, 'the JUST D0 IT player appears the second the clock lands');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .download-trigger`).count(), 1, 'the JUST D0 IT download button is live at release');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .drop-countdown`).count(), 0, 'the JUST D0 IT countdown is gone at release');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .download-trigger--locked`).count(), 0, 'the JUST D0 IT LOCKED control is gone at release');
  await noYouTubeButton(justDoItLive, JUST_DO_IT_CARD);
  assert.equal(await justDoItLive.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), JUST_DO_IT_ID), 'https://www.youtube.com/@KYROlll00', 'the helper releases the JUST D0 IT link with the clock');
  // JUST D0 IT plays the identical photographed pressing.
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD}.beat-detail .vinyl-record`).count(), 1, 'JUST D0 IT renders the photographed pressing');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .vinyl-record`).count(), 1, 'JUST D0 IT renders the photographed pressing');
  assert.equal(await justDoItLive.locator(`${JUST_DO_IT_CARD} .vinyl-record--rage-fire-rim`).count(), 0, 'no retired modifier is reused');
  await assertPressing(justDoItLive, JUST_DO_IT_CARD, 'JUST D0 IT');
  assert.deepEqual(await justDoItLive.evaluate((id) => window.KYROlll_DOWNLOADS.deliverablesFor(id, 'exclusive').map(item => item.name), JUST_DO_IT_ID), [
    'KYROIII - JUST D0 IT (135 BPM - AM).mp3',
    'KYROIII - JUST D0 IT (135 BPM - AM).wav',
    'KYROIII - JUST D0 IT - TRACKED STEMS.zip',
  ], 'JUST D0 IT hands over the studio MP3, WAV and tracked stems names');
  await shot(justDoItLive, 'just-do-it-live');
  await justDoItLive.close();

  // The longest display titles at desktop width. Each must wrap into a balanced
  // block inside the glass card — never one unbroken line, never a clipped one.
  const titleDesktop = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  for (const beat of [
    { id: JUST_DO_IT_ID, card: JUST_DO_IT_CARD, expected: /\[FREE 100%\] YEAT TYPE BEAT - JUST D0 IT/i },
    { id: SQUISH_ID, card: SQUISH_CARD, expected: /\[FREE 100%\] LIL GOTIT TYPE BEAT - SQUISH!/i },
  ]) {
    await titleDesktop.goto(`${url}/?beat=${beat.id}&now=${JUST_DO_IT_RELEASE + 1000}`);
    await titleDesktop.locator(`${beat.card} .beat-detail__title`).waitFor();
    const report = await assertCleanTitle(titleDesktop, beat.card, `${beat.id} 1440px title`);
    assert.match(report.text, beat.expected);
  }
  await titleDesktop.close();

  const justDoItDownload = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await justDoItDownload.goto(`${url}/download.html?beat=${JUST_DO_IT_ID}&package=exclusive&t=justdoit&sign=Just%20Buyer&now=${JUST_DO_IT_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await justDoItDownload.locator('#license-serial').waitFor();
  assert.match(await justDoItDownload.locator('#download-title').innerText(), /YEAT TYPE BEAT - JUST D0 IT/i);
  assert.match(await justDoItDownload.locator('#license-serial').innerText(), /^KYRO-\d{4}-JUST-D0-IT-\d{6}$/, 'the JUST D0 IT serial carries its hyphenated slug');
  assert.deepEqual(await justDoItDownload.locator('.download-item__name').evaluateAll(nodes => nodes.map(node => node.textContent)), [
    'KYROIII - JUST D0 IT (135 BPM - AM).mp3',
    'KYROIII - JUST D0 IT (135 BPM - AM).wav',
    'KYROIII - JUST D0 IT - TRACKED STEMS.zip',
  ], 'the JUST D0 IT download page lists the studio files');
  const [justDoItPdf] = await Promise.all([
    justDoItDownload.waitForEvent('download'),
    justDoItDownload.locator('[data-license-pdf]').click(),
  ]);
  assert.match(justDoItPdf.suggestedFilename(), /^KYROIII - LICENSE - JUST D0 IT \(KYRO-\d{4}-JUST-D0-IT-\d{6}\)\.pdf$/, 'the JUST D0 IT license saves under the studio name');
  const justDoItPdfText = (await readFile(await justDoItPdf.path())).toString('latin1');
  const justDoItPdfRuns = pdfRuns(justDoItPdfText).join(' ');
  assert.match(justDoItPdfRuns, /\[FREE 100%\] YEAT TYPE/, 'the JUST D0 IT license carries its title opening');
  assert.match(justDoItPdfRuns, /JUST D0 IT/, 'the JUST D0 IT license carries its title tail');
  assert(justDoItPdfText.includes('PAGE 1 OF 1'), 'the JUST D0 IT license fits one page');
  await justDoItDownload.close();

  const justDoItAfter = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await justDoItAfter.goto(`${url}/?now=${JUST_DO_IT_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await justDoItAfter.locator(`${JUST_DO_IT_CARD} .download-trigger`).waitFor();
  assert.match(await justDoItAfter.locator('.marquee-track').innerText(), /5 RELEASES LIVE/, 'the studio count becomes five once JUST D0 IT is live');
  await justDoItAfter.close();

  // ----------------------------------------------- sixth release: A.D.L (19:00)
  // The newest drop is scheduled for 19:00 Israel time today, 2 November 2026.
  // It follows the same countdown contract and wears the identical photographed
  // record. The studio count stays at five until its clock
  // lands, then becomes six.
  const adllPre = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await adllPre.goto(`${url}/?now=${ADLL_RELEASE - 3600000}`);
  await adllPre.locator(`[data-countdown="${ADLL_ID}"]`).waitFor();
  assert.equal(await adllPre.locator('#grid .catalog-tile').count(), 8, 'the sixth release is in the eight-card catalog');
  assert.equal(await adllPre.locator('#grid .catalog-tile').first().getAttribute('id'), 'card-' + WHITE_NIGHT_ID, 'the WHITE NIGHT drop leads the catalog as the newest drop');
  assert.equal(await adllPre.locator('#grid .catalog-tile').nth(1).getAttribute('id'), 'card-' + GUNNA_ID, 'GUNNA follows the newest drop');
  assert.equal(await adllPre.locator('#grid .catalog-tile').nth(2).getAttribute('id'), 'card-adll', 'ADLL follows GUNNA');
  assert.equal(await adllPre.locator(`${ADLL_CARD} .catalog-tile__link`).count(), 1, 'the ADLL catalog card renders in the catalog');
  assert.match(await adllPre.locator(ADLL_CARD).innerText(), /\[FREE 100%\] YEAT TYPE BEAT - A\.D\.L/i);
  assert.match(await adllPre.locator(`${ADLL_CARD} .drop-countdown__label`).innerText(), /DROPPING SOON/, 'ADLL carries its countdown pill');
  assert.doesNotMatch(await adllPre.locator(`${ADLL_CARD} .drop-countdown__label`).innerText(), /\d/, 'the ADLL label carries no clock hour');
  assert.match(await adllPre.locator(`${ADLL_CARD} [data-countdown="${ADLL_ID}"]`).innerText(), /^\d{2}:\d{2}:\d{2}$/, 'ADLL shows a live HH:MM:SS clock');
  assert.equal(await adllPre.locator(`${ADLL_CARD} .download-trigger`).count(), 0, 'the ADLL tile renders no download button before its drop');
  assert.equal(await adllPre.locator(`${ADLL_CARD} .download-trigger--locked`).count(), 0, 'the ADLL tile renders no secondary LOCKED control');
  assert.equal(await adllPre.locator(`${ADLL_CARD} .drop-locked`).count(), 0, 'the ADLL tile renders no locked player pane');
  assert(await adllPre.evaluate((id) => {
    const slot = document.getElementById('card-' + id).querySelector('.catalog-tile__actions');
    return !!slot && slot.querySelectorAll('button').length === 0 && !!slot.querySelector('.drop-countdown');
  }, ADLL_ID), 'the countdown pill is the whole ADLL action slot, with no button beside it');
  assert.match(await adllPre.locator('.marquee-track').innerText(), /5 RELEASES LIVE/, 'the studio count excludes the not-yet-live sixth release');
  await adllPre.evaluate((id) => window.KYROlll_DOWNLOADS.start(id, 'mp3'), ADLL_ID);
  await adllPre.evaluate((id) => window.KYROlll_DOWNLOADS.openMenu(document.body, id), ADLL_ID);
  assert.equal(await adllPre.locator('.gate-modal').count(), 0, 'the scheduled ADLL drop opens no gate');
  assert.equal(await adllPre.locator('.download-menu').count(), 0, 'the scheduled ADLL drop opens no drawer');
  assert.equal(await adllPre.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), ADLL_ID), 'https://www.youtube.com/@KYROlll00?sub_confirmation=1', 'the helper withholds the ADLL video URL until release');
  await noCardBleed(adllPre, 'ADLL desktop catalog');
  await adllPre.close();

  const adllLive = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'no-preference' });
  await adllLive.goto(`${url}/?beat=adll&now=${ADLL_RELEASE - 12000}`, { waitUntil: 'domcontentloaded' });
  await adllLive.locator(`[data-countdown="${ADLL_ID}"]`).waitFor();
  assert.equal(await adllLive.locator(`${ADLL_CARD}.beat-detail`).count(), 1, 'the ADLL beat page renders');
  assert.match(await adllLive.locator(ADLL_CARD).innerText(), /\[FREE 100%\] YEAT TYPE BEAT - A\.D\.L/i);
  const adllTitle = await assertCleanTitle(adllLive, ADLL_CARD, 'ADLL title');
  assert.match(adllTitle.text, /\[FREE 100%\] YEAT TYPE BEAT - A\.D\.L/i);
  assert.match(await adllLive.locator(ADLL_CARD).innerText(), /124 BPM \/\/ C#/i);
  assert.equal(await adllLive.locator(`${ADLL_CARD} .beat-preview`).count(), 0, 'ADLL has no player before its drop');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .drop-locked`).count(), 1, 'ADLL shows the locked player stand-in');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .card__actions .download-trigger--locked`).count(), 1, 'ADLL shows the dedicated LOCKED control');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .download-trigger[disabled]`).count(), 1, 'the ADLL LOCKED control is inert');
  await noYouTubeButton(adllLive, ADLL_CARD);
  const adllUrlBeforeDrop = adllLive.url();
  await adllLive.waitForFunction((id) => {
    const card = document.getElementById('card-' + id);
    return !!(card && card.querySelector('.beat-preview__toggle')
      && card.querySelector('.download-trigger[data-download-trigger]')
      && !card.querySelector('.drop-countdown')
      && !card.querySelector('.download-trigger--locked'));
  }, ADLL_ID, { timeout: 30000 });
  assert.equal(adllLive.url(), adllUrlBeforeDrop, 'ADLL unlocks in page, with no reload');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .beat-preview`).count(), 1, 'the ADLL player appears the second the clock lands');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .download-trigger`).count(), 1, 'the ADLL download button is live at release');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .drop-countdown`).count(), 0, 'the ADLL countdown is gone at release');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .download-trigger--locked`).count(), 0, 'the ADLL LOCKED control is gone at release');
  await noYouTubeButton(adllLive, ADLL_CARD);
  assert.equal(await adllLive.evaluate((id) => window.KYROlll_HELPERS.videoFor(id), ADLL_ID), 'https://www.youtube.com/@KYROlll00', 'the helper releases the ADLL link with the clock');
  // ADLL's black-and-white portrait presses a charcoal disc with a silver rim;
  // the white aerosol of its cover lives in the palette's flake field, never in
  // an extra DOM graphic.
  assert.equal(await adllLive.locator(`${ADLL_CARD}.beat-detail .vinyl-record`).count(), 1, 'ADLL renders the photographed pressing');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .vinyl-record`).count(), 1, 'ADLL renders the photographed pressing');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .vinyl-record--graffiti-splatter`).count(), 0, 'no retired modifier is reused');
  await assertPressing(adllLive, ADLL_CARD, 'ADLL');
  assert.deepEqual(await adllLive.evaluate((id) => window.KYROlll_DOWNLOADS.deliverablesFor(id, 'exclusive').map(item => item.name), ADLL_ID), [
    'KYROIII - A.D.L (124 BPM - C#).mp3',
    'KYROIII - A.D.L (124 BPM - C#).wav',
    'KYROIII - A.D.L - TRACKED STEMS.zip',
  ], 'ADLL hands over the studio MP3, WAV and tracked stems names');

  // Exclusive rights: the moment the one exclusive license is claimed the beat
  // is archived. Every lease and the player give way to the secured badge, the
  // professional disclaimer, and an inert state even when the API is called
  // directly. The claim is written to the browser's shared-claims cache (the
  // local preview keeps the live bus off); the test then walks to the catalog
  // without reloading, so the locked tile paints too.
  assert.equal(await adllLive.evaluate((id) => window.KYROlll_HELPERS.lockExclusive(id), ADLL_ID), true, 'the exclusive tier claims ADLL');
  await adllLive.locator(`${ADLL_CARD} .exclusive-badge`).waitFor();
  assert.equal((await adllLive.locator(`${ADLL_CARD} .exclusive-badge__text`).innerText()).trim(), 'OWNED', 'the buyer badge names the private master');
  assert.equal((await adllLive.locator(`${ADLL_CARD} .exclusive-badge__kicker`).innerText()).trim(), 'PRIVATE MASTER // YOURS', 'the buyer badge carries the ownership signature');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .exclusive-badge__seal img`).getAttribute('src'), 'assets/kyrolll-flower-rest.png?v=5', 'the signature badge prints the small flower mark');
  assert.match(await adllLive.locator(`${ADLL_CARD} .card__specs`).innerText(), /OWNED \/ YOURS/, 'the specs announce the ownership state');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .exclusive-art`).count(), 0, 'the cover art is not veiled by an archive overlay');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .exclusive-lock`).count(), 0, 'the player slot is not replaced by a notice');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .download-trigger`).count(), 0, 'a claimed beat offers no lease button');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .exclusive-locked-button`).count(), 0, 'the download area is the badge alone');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .beat-preview`).count(), 1, 'a claimed beat keeps its player');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .vinyl-record`).count(), 1, 'a claimed beat keeps its vinyl record');
  await adllLive.waitForFunction((sel) => !!document.querySelector(sel + '.vinyl-open'), `${ADLL_CARD}.beat-detail`, { timeout: 8000 });
  await adllLive.locator(`${ADLL_CARD} .beat-preview__toggle`).click();
  await adllLive.locator(`${ADLL_CARD} .beat-preview[data-state="playing"]`).waitFor({ timeout: 15000 });
  const ownedLayout = await adllLive.evaluate((id) => {
    const card = document.getElementById('card-' + id);
    const wrap = card.querySelector('.beat-detail__artwork-wrap').getBoundingClientRect();
    const cover = card.querySelector('.beat-detail__artwork').getBoundingClientRect();
    return {
      coverVisible: !!card.querySelector('.beat-detail__artwork img') && cover.width > 200,
      vinyl: !!card.querySelector('.vinyl-record'),
      player: !!card.querySelector('.beat-preview audio'),
      badgeInActions: !!card.querySelector('.card__actions .exclusive-badge'),
      trigger: card.querySelectorAll('.download-trigger').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stage: Math.round(wrap.width),
    };
  }, ADLL_ID);
  assert.equal(ownedLayout.coverVisible, true, 'the owned cover art stays intact and visible');
  assert.equal(ownedLayout.vinyl, true, 'the owned beat keeps the photographed vinyl');
  assert.equal(ownedLayout.player, true, 'the owned beat keeps its interactive audio container');
  assert.equal(ownedLayout.badgeInActions, true, 'the signature badge replaces the download area');
  assert.equal(ownedLayout.trigger, 0, 'no download trigger survives the redesign');
  assert(ownedLayout.stage >= 300, 'the owned stage keeps its normal size');
  assert(ownedLayout.overflow <= 1, 'the owned beat page never overflows horizontally');
  await adllLive.evaluate((id) => window.KYROlll_DOWNLOADS.start(id, 'mp3'), ADLL_ID);
  await adllLive.evaluate((id) => window.KYROlll_DOWNLOADS.openMenu(document.body, id), ADLL_ID);
  assert.equal(await adllLive.locator('.gate-modal').count(), 0, 'a claimed beat opens no gate');
  assert.equal(await adllLive.locator('.download-menu').count(), 0, 'a claimed beat opens no drawer');
  assert.equal(await adllLive.evaluate((id) => window.KYROlll_HELPERS.isExclusiveLocked(id), ADLL_ID), true, 'the claim is recorded on the live entry');
  await adllLive.evaluate(() => {
    history.pushState(null, '', 'index.html');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await adllLive.locator(`${ADLL_CARD}.catalog-tile .exclusive-badge`).waitFor();
  assert.equal((await adllLive.locator(`${ADLL_CARD} .exclusive-badge__text`).innerText()).trim(), 'OWNED', 'the claimed catalog tile carries the buyer signature');
  assert.equal((await adllLive.locator(`${ADLL_CARD} .exclusive-badge__kicker`).innerText()).trim(), 'PRIVATE MASTER // YOURS', 'the claimed tile names the private master');
  assert.match(await adllLive.locator(`${ADLL_CARD} .exclusive-badge`).getAttribute('class'), /exclusive-badge--compact/, 'the tile wears the compact signature plate');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .catalog-tile__art .exclusive-art`).count(), 0, 'the claimed tile cover art is intact');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .download-trigger`).count(), 0, 'the claimed tile offers no lease button');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .exclusive-locked-button`).count(), 0, 'the claimed tile has no disabled control');
  assert.equal(await adllLive.locator(`${ADLL_CARD} .drop-countdown`).count(), 0, 'a claim retires the countdown');
  await noHue(adllLive, 'the secured ADLL catalog tile');
  await shot(adllLive, 'adll-exclusive-locked');
  await adllLive.close();

  const adllDownload = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await adllDownload.goto(`${url}/download.html?beat=${ADLL_ID}&package=exclusive&t=adll&sign=Adll%20Buyer&now=${ADLL_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await adllDownload.locator('#license-serial').waitFor();
  assert.match(await adllDownload.locator('#download-title').innerText(), /YEAT TYPE BEAT - A\.D\.L/i);
  assert.match(await adllDownload.locator('#license-serial').innerText(), /^KYRO-\d{4}-ADLL-\d{6}$/, 'the ADLL serial carries its slug');
  assert.deepEqual(await adllDownload.locator('.download-item__name').evaluateAll(nodes => nodes.map(node => node.textContent)), [
    'KYROIII - A.D.L (124 BPM - C#).mp3',
    'KYROIII - A.D.L (124 BPM - C#).wav',
    'KYROIII - A.D.L - TRACKED STEMS.zip',
  ], 'the ADLL download page lists the studio files');
  const [adllPdf] = await Promise.all([
    adllDownload.waitForEvent('download'),
    adllDownload.locator('[data-license-pdf]').click(),
  ]);
  assert.match(adllPdf.suggestedFilename(), /^KYROIII - LICENSE - A\.D\.L \(KYRO-\d{4}-ADLL-\d{6}\)\.pdf$/, 'the ADLL license saves under the studio name');
  const adllPdfText = (await readFile(await adllPdf.path())).toString('latin1');
  const adllPdfRuns = pdfRuns(adllPdfText).join(' ');
  assert.match(adllPdfRuns, /\[FREE 100%\] YEAT TYPE/, 'the ADLL license carries its title opening');
  assert.match(adllPdfRuns, /A\.D\.L/, 'the ADLL license carries its title tail');
  assert(adllPdfText.includes('PAGE 1 OF 1'), 'the ADLL license fits one page');
  assert(adllPdfText.includes('THIS LICENSE IS EXCLUSIVE'), 'the ADLL exclusive audit grant is printed');
  assert(adllPdfText.includes('EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE'), 'the ADLL exclusive masthead is uniform with every beat');
  assert(pdfRuns(adllPdfText).includes('(PROD. BY KYROIII)'), 'the ADLL license carries the mandatory credit');
  assert.deepEqual(pdfRuns(adllPdfText).filter(run => /[a-z]/.test(run)), [], 'the ADLL license is uppercase too');
  await adllDownload.close();

  const adllAfter = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await adllAfter.goto(`${url}/?now=${ADLL_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await adllAfter.locator(`${ADLL_CARD} .download-trigger`).waitFor();
  assert.match(await adllAfter.locator('.marquee-track').innerText(), /6 RELEASES LIVE/, 'the studio count becomes six once ADLL is live');
  await adllAfter.close();

  // ------------------------------------------- seventh release: GUNNA (22:00)
  // Every record — the newest drop included — carries the original KYROIII
  // flower logo on its centre label. There is no cover-art label and no 3D
  // stage on the record: the label is one plain, static image.
  const gunnaLive = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  await gunnaLive.goto(`${url}/?beat=${GUNNA_ID}&now=${ALL_LIVE_NOW}`, { waitUntil: 'domcontentloaded' });
  await gunnaLive.locator(`${GUNNA_CARD} .vinyl-record`).waitFor();
  await gunnaLive.locator(`${GUNNA_CARD}.vinyl-open`).waitFor();
  await gunnaLive.waitForTimeout(1200);
  const gunnaVinyl = await assertPressing(gunnaLive, GUNNA_CARD, 'THE GUNNA DROP');
  assert.equal(await gunnaLive.locator(`${GUNNA_CARD} .vinyl-record--cover`).count(), 0, 'the record never opts into a cover label');
  assert.equal(await gunnaLive.locator(`${GUNNA_CARD} .vinyl-record__logo--cover`).count(), 0, 'the label image is never cover art');
  assert.equal(await gunnaLive.locator(`${GUNNA_CARD} .vinyl-flower-stage`).count(), 0, 'the record mounts no 3D flower stage');
  assert.equal(await gunnaLive.locator(`${GUNNA_CARD} .vinyl-record__logo`).evaluate(el => el.tagName), 'IMG', 'the label is a plain static image');
  assert.equal(gunnaVinyl.src, 'assets/kyrolll-flower-label.png', 'the newest drop carries the original flower label too');
  assert(gunnaVinyl.frameRatio > 0.29 && gunnaVinyl.frameRatio < 0.31, 'the plate keeps the photographed label\'s size');
  await gunnaLive.close();

  // The secured state is not an ADLL-only skin: every active beat paints the
  // same signature badge on its catalog tile and its beat page, and none of
  // them keeps a lease, a countdown or a download trigger once claimed. The
  // cover, the record and the player stay intact; every claim is written to the
  // browser's exclusive-claims register, so this page (the buyer) wears the
  // private-master signature.
  const lockAll = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await lockAll.goto(`${url}/?now=${ALL_LIVE_NOW}`, { waitUntil: 'domcontentloaded' });
  await lockAll.locator('#grid .catalog-tile').first().waitFor();
  const securedIds = ['flesh', 'the-flow', 'green-flesh', 'squish', 'just-d0-it', 'adll', GUNNA_ID, WHITE_NIGHT_ID];
  for (const id of securedIds) {
    assert.equal(await lockAll.evaluate((beatId) => window.KYROlll_HELPERS.lockExclusive(beatId), id), true,
      `${id}: the exclusive tier claims the beat`);
  }
  await lockAll.locator('#grid .catalog-tile .exclusive-badge').first().waitFor();
  const securedTiles = await lockAll.evaluate(() => [...document.querySelectorAll('#grid .catalog-tile')].map(tile => {
    const badge = tile.querySelector('.exclusive-badge');
    const button = tile.querySelector('.exclusive-locked-button');
    return {
      id: tile.id,
      badge: ((tile.querySelector('.exclusive-badge__text') || {}).textContent || '').trim(),
      kicker: ((tile.querySelector('.exclusive-badge__kicker') || {}).textContent || '').trim(),
      compact: !!badge && badge.classList.contains('exclusive-badge--compact'),
      triggers: tile.querySelectorAll('.download-trigger').length,
      countdown: tile.querySelectorAll('.drop-countdown').length,
      modifier: tile.classList.contains('catalog-tile--exclusive-locked'),
      ownedModifier: tile.classList.contains('catalog-tile--exclusive-owned'),
      button: !!button,
      disabled: !!button && button.disabled,
      buttonText: button ? button.textContent.trim() : '',
    };
  }));
  assert.equal(securedTiles.length, 8, 'all eight beats are painted after their claims');
  securedTiles.forEach(tile => {
    assert.equal(tile.badge, 'OWNED', `${tile.id}: every buyer tile carries the signature line`);
    assert.equal(tile.kicker, 'PRIVATE MASTER // YOURS', `${tile.id}: every buyer tile names the private master`);
    assert.equal(tile.compact, true, `${tile.id}: every tile wears the compact signature plate`);
    assert.equal(tile.triggers, 0, `${tile.id}: a claimed tile offers no lease trigger`);
    assert.equal(tile.countdown, 0, `${tile.id}: a claim retires any countdown`);
    assert.equal(tile.modifier, true, `${tile.id}: the tile carries the secured modifier`);
    assert.equal(tile.ownedModifier, true, `${tile.id}: the tile carries the ownership modifier`);
    assert.equal(tile.button, false, `${tile.id}: the badge replaces the disabled control`);
  });
  await noCardBleed(lockAll, 'the fully secured catalog');
  await noHue(lockAll, 'the fully secured catalog');
  // A second beat's detail view is audited too: same signature badge, same
  // retired specs, intact player/record and no lease.
  await lockAll.evaluate(() => {
    history.pushState(null, '', 'index.html?beat=the-flow');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const flowDetail = '#grid .beat-detail';
  await lockAll.locator(`${flowDetail} .exclusive-badge`).waitFor();
  assert.equal((await lockAll.locator(`${flowDetail} .exclusive-badge__text`).innerText()).trim(),
    'OWNED', 'a second beat page carries the same signature line');
  assert.equal((await lockAll.locator(`${flowDetail} .exclusive-badge__kicker`).innerText()).trim(),
    'PRIVATE MASTER // YOURS', 'a second beat page names the buyer');
  assert.match(await lockAll.locator(`${flowDetail} .card__specs`).innerText(),
    /OWNED \/ YOURS/, 'a second beat page announces the ownership state');
  assert.equal(await lockAll.locator(`${flowDetail} .beat-preview`).count(), 1, 'a second claimed beat keeps its player');
  assert.equal(await lockAll.locator(`${flowDetail} .vinyl-record`).count(), 1, 'a second claimed beat keeps its vinyl');
  assert.equal(await lockAll.locator(`${flowDetail} .download-trigger`).count(), 0, 'a second claimed beat offers no lease');
  assert.equal(await lockAll.locator(`${flowDetail} .download-actions--secured`).count(), 1, 'the secured action slot is the whole control');
  assert.equal(await lockAll.locator(`${flowDetail} .exclusive-locked-button`).count(), 0, 'a second claimed beat keeps no disabled control');
  // Leaving the beat page and returning to the catalog keeps every claim: the
  // record lives on the catalog entries, not on the route.
  await lockAll.evaluate(() => {
    history.pushState(null, '', 'index.html');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await lockAll.locator('#grid .catalog-tile .exclusive-badge').first().waitFor();
  assert.equal(await lockAll.locator('#grid .catalog-tile .exclusive-badge').count(), 8, 'the catalog keeps every claim after the round trip');
  await lockAll.close();

  // A claim made by someone else — seeded into the store's global register —
  // wears the public badge: no ownership signature and no lease, while the
  // artwork, record and player stay exactly as they are.
  const stranger = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await stranger.addInitScript((id) => {
    try {
      localStorage.setItem('kyrolll_exclusive_claims', JSON.stringify({
        version: 2,
        generation: '2026-11-08T09:00:00.000Z',
        buyerId: 'buyer-current-visitor',
        claims: {
          [id]: {
            at: '2026-11-02T19:00:00.000Z',
            ownerId: 'buyer-someone-else',
          },
        },
        outbox: [],
      }));
    } catch (err) { /* the origin may not be ready yet on the first init pass */ }
  }, ADLL_ID);
  await stranger.goto(`${url}/?beat=adll&now=${ADLL_RELEASE + 1000}`, { waitUntil: 'domcontentloaded' });
  await stranger.locator(`${ADLL_CARD} .exclusive-badge`).waitFor();
  assert.equal((await stranger.locator(`${ADLL_CARD} .exclusive-badge__text`).innerText()).trim(),
    'CLAIMED / SOLD OUT', 'a claim by another buyer paints the public sold-out state');
  assert.equal((await stranger.locator(`${ADLL_CARD} .exclusive-badge__kicker`).innerText()).trim(),
    'EXCLUSIVE RIGHTS // ARCHIVED', 'another buyer gets the public archive kicker');
  assert.equal(await stranger.locator(`${ADLL_CARD} .download-trigger`).count(), 0, 'another buyer gets no lease trigger');
  assert.equal(await stranger.locator(`${ADLL_CARD} .beat-preview`).count(), 1, 'another buyer keeps the player intact');
  assert.equal(await stranger.locator(`${ADLL_CARD} .vinyl-record`).count(), 1, 'another buyer keeps the record intact');
  assert.equal(await stranger.locator(`${ADLL_CARD} .exclusive-locked-button`).count(), 0, 'another buyer gets no disabled control');
  assert.match(await stranger.locator(`${ADLL_CARD} .card__specs`).innerText(), /CLAIMED \/ SOLD OUT/, 'the specs carry the public sold-out state');
  await stranger.close();

  // ------------------------------------------------------------ support desk
  // The footer's SUPPORT control no longer opens a mail app: it opens the
  // store's own desk. The desk is three plain fields — an address, a subject,
  // a message, with no category to pick. The test refuses an incomplete
  // submission without contacting Formspree, then proves the one POST carries
  // only the three core fields — no system metadata clutter — and that the
  // dialog reaches its success state.
  const supportPage = await setupPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await supportPage.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
  await supportPage.locator('.footer__support').click();
  const desk = supportPage.locator('.support-modal:not([hidden])');
  await desk.waitFor();
  assert.equal(await supportPage.locator('.support-modal .support-sheet').isVisible(), true, 'the built-in desk is an in-page dialog');
  assert.equal(await supportPage.locator('.support-modal select, .support-modal .support-category, .support-modal .support-categories').count(), 0, 'the desk asks for no category');
  assert.equal(await supportPage.locator('.support-modal #support-email').count(), 1, 'the desk asks for the visitor’s email');
  assert.equal(await supportPage.locator('.support-modal #support-subject').count(), 1, 'the desk asks for a subject');
  assert.equal(await supportPage.locator('.support-modal #support-message').count(), 1, 'the desk asks for the message');
  const supportBase = subscribeRequests.length;
  await supportPage.locator('[data-support-submit]').click();
  assert.equal(await supportPage.locator('[data-support-error]').isVisible(), true, 'an empty ticket is refused inline');
  assert.match(await supportPage.locator('[data-support-error]').innerText(), /EMAIL ADDRESS/, 'the first missing field is the address');
  await supportPage.locator('#support-email').fill('not-an-address');
  await supportPage.locator('#support-subject').fill('STEMS ARCHIVE');
  await supportPage.locator('#support-message').fill('THE TRACKED STEMS ARCHIVE WILL NOT OPEN ON MY MACHINE.');
  await supportPage.locator('[data-support-submit]').click();
  assert.match(await supportPage.locator('[data-support-error]').innerText(), /EMAIL ADDRESS/, 'a malformed address is refused');
  assert.equal(subscribeRequests.length, supportBase, 'nothing is posted while the form is incomplete');
  await supportPage.locator('#support-email').fill('jordan@studio.com');
  await supportPage.locator('[data-support-submit]').click();
  await waitForPostCount(supportBase + 1, 'the desk posts exactly one message');
  const ticket = postJSON(supportBase);
  assert.equal(subscribeRequests[supportBase].url, SUPPORT_PROVIDER, 'the desk posts to the KYROIII — SUPPORT TICKETS form');
  assert.notEqual(subscribeRequests[supportBase].url, PROVIDER, 'the desk never posts into the FREE DOWNLOADS form');
  assert(subscribeRequests.slice(0, supportBase).every(request => request.url === PROVIDER), 'no earlier free-download post was ever sent to the support form');
  assert.equal(subscribeRequests.filter(request => request.url === SUPPORT_PROVIDER).length, 1, 'the desk sends exactly one ticket to its own form');
  assert.match(subscribeRequests[supportBase].headers['content-type'] || '', /application\/json/, 'the desk posts a JSON payload');
  assert.equal(ticket.category, undefined, 'the payload carries no category');
  assert.equal(ticket.email, 'jordan@studio.com', 'the payload carries the visitor’s address');
  assert.equal(ticket.subject, 'STEMS ARCHIVE', 'the payload carries the subject');
  assert.match(ticket.message, /TRACKED STEMS ARCHIVE/, 'the payload carries the full message');
  assert.deepEqual(Object.keys(ticket).sort(), ['email', 'message', 'subject'],
    'the ticket carries only the core fields — nothing else');
  ['form', 'submittedAt', 'page', 'referrer', 'device', 'viewport', 'language', 'category']
    .forEach(field => assert.equal(ticket[field], undefined, `the payload carries no ${field}`));
  const successTitle = supportPage.locator('[data-support-success] .support-success__title');
  await successTitle.waitFor();
  assert.equal(await successTitle.innerText(), 'MESSAGE SENT SUCCESSFULLY // WE WILL GET BACK TO YOU SOON', 'the desk reaches its success state');
  // The dialog has one exit: a stray backdrop tap cannot wipe a written message.
  await supportPage.mouse.click(5, 5);
  assert.equal(await supportPage.locator('.support-modal').isHidden(), false, 'the backdrop never dismisses the desk');
  await supportPage.locator('[data-support-done]').click();
  await supportPage.waitForFunction(() => document.getElementById('support-modal')?.hidden === true, null, { timeout: 5000 });
  assert.equal(await supportPage.evaluate(() => document.body.style.position), '', 'closing the desk restores the page scroll');
  // Re-opening starts from a clean, empty form — nothing is stored.
  await supportPage.locator('.footer__support').click();
  await supportPage.locator('.support-modal:not([hidden])').waitFor();
  assert.equal(await supportPage.locator('#support-email').inputValue(), '', 'the desk never prefills an address');
  assert.equal(await supportPage.locator('#support-subject').inputValue(), '', 'the desk never remembers a subject');
  assert.equal(await supportPage.locator('#support-message').inputValue(), '', 'the desk never remembers a message');
  await supportPage.locator('[data-support-close]').click();
  await supportPage.waitForFunction(() => document.getElementById('support-modal')?.hidden === true, null, { timeout: 5000 });
  // support.html mounts the same desk inline as a dedicated view.
  await supportPage.goto(`${url}/support.html`, { waitUntil: 'domcontentloaded' });
  await supportPage.locator('[data-support-inline] .support-form').waitFor();
  assert.equal(await supportPage.locator('[data-support-inline] #support-email').count(), 1, 'the support page mounts the same email field');
  assert.equal(await supportPage.locator('[data-support-inline] #support-subject').count(), 1, 'the support page mounts the same subject field');
  assert.equal(await supportPage.locator('[data-support-inline] #support-message').count(), 1, 'the support page mounts the same message field');
  assert.equal(await supportPage.locator('[data-support-inline] select, [data-support-inline] .support-category').count(), 0, 'the support page offers no category picker');
  assert.equal(await supportPage.locator('[data-support-inline] a[href^="mailto:"]').count(), 0, 'the support page no longer hands over a mailto link');
  await supportPage.close();

  // Keep the rest of the stylesheet monochrome while expressly checking the
  // isolated green / pink hero accents, the one photographed vinyl disc,
  // the monochrome PDF and the ALL-CAPS rules.
  const cssText = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  const scriptText = await readFile(new URL('./script.js', import.meta.url), 'utf8');
  assert.doesNotMatch(scriptText, /vinyl-record__gold|goldSplash|gold-splatter|sageSplash|sage-blob/, 'the record generates no splash, blob or splatter layer');
  assert.doesNotMatch(cssText, /vinyl-record__gold|gold-splatter|sage-splatter/, 'the stylesheet carries no splash layer or artwork');
  // The vinyl reveal contract: the record's *first* computed state is tucked
  // behind the sleeve (so nothing can flash in the exposed position), and the
  // reveal is a 1 s translate-only slide with the elite easing. The 360° spin it
  // replaced ballooned the square record's box by √2 and overshot the stage, so
  // the opened state must never carry a rotation.
  assert.match(cssText, /\.beat-detail:not\(\.vinyl-open\) \.vinyl-record \{[^}]*transform:\s*translate3d\(0, 0, 0\)/, 'the record starts tucked behind the sleeve');
  assert.match(cssText, /\.vinyl-record \{[^}]*transform:\s*translate3d\(var\(--vinyl-slide\), 0, 0\)/, 'the record rests on a GPU-composited transform');
  assert.match(cssText, /\.vinyl-record \{[^}]*will-change:\s*transform/, 'the record keeps its compositor layer');
  assert.match(cssText, /\.vinyl-record \{[^}]*backface-visibility:\s*hidden/, 'the record hides its backface during the slide');
  assert.match(cssText, /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\.vinyl-record \{[^}]*transition:\s*transform 1s cubic-bezier\(0\.16, 1, 0\.3, 1\)/, 'the record reveal is a 1 s eased slide');
  assert.doesNotMatch(cssText, /\.beat-detail[^{}]*vinyl-open[^{}]*\{[^}]*rotate\(/, 'the record reveal never rotates');
  // The marquee ticker: GPU-promoted container and track, layout/paint-isolated,
  // linear + infinite, and never touched by the reveal's opacity curtain.
  assert.match(cssText, /\.marquee-banner \{[^}]*transform:\s*translateZ\(0\)/, 'the marquee banner is GPU-promoted');
  assert.match(cssText, /\.marquee-banner \{[^}]*will-change:\s*transform/, 'the marquee banner keeps its compositor layer');
  assert.match(cssText, /\.marquee-banner \{[^}]*contain:\s*layout paint/, 'the marquee banner is layout/paint-isolated');
  assert.match(cssText, /\.marquee-track \{[^}]*will-change:\s*transform/, 'the moving track keeps its compositor layer');
  assert.match(cssText, /\.marquee-track \{[^}]*transform:\s*translate3d\(0, 0, 0\)/, 'the moving track is GPU-promoted');
  assert.match(cssText, /\.marquee-banner\.reveal[\s\S]{0,160}?opacity:\s*1/, 'the marquee is exempt from the reveal opacity curtain');
  assert.match(cssText, /\.marquee-track\.is-scrolling \{[^}]*animation:\s*marquee-scroll[^}]*linear infinite/, 'the fallback ticker still loops linearly');
  // The beat-detail head carries no YouTube icon or button any more, in either
  // state, so its selectors are gone from the stylesheet entirely.
  assert.doesNotMatch(cssText, /card__youtube-link/, 'the removed YouTube icon leaves no stylesheet rule behind');
  // The display title is a wrapping block with balanced lines and whole words.
  assert.match(cssText, /\.beat-detail__title \{[^}]*display:\s*block/, 'the beat title wraps as a block, not a single flex line');
  assert.match(cssText, /\.beat-detail__title \{[^}]*text-wrap:\s*balance/, 'the beat title balances its rendered lines');
  assert.match(cssText, /\.beat-detail__title \{[^}]*overflow-wrap:\s*normal/, 'the beat title keeps whole words');
  assert.doesNotMatch(cssText, /\.beat-detail__title \{[^}]*overflow:\s*hidden/, 'the beat title never clips its own text');
  // The mobile player locks its own layout, and the drawer freezes its geometry
  // and keeps `transform` free for the per-scroll tracking translate.
  assert.match(cssText, /\.beat-preview \{[^}]*contain:\s*layout style/, 'the player box is strictly contained');
  assert.match(cssText, /\.beat-preview \{[^}]*transform:\s*translateZ\(0\)/, 'the player box is GPU-promoted');
  assert.match(cssText, /\.beat-preview \{[^}]*backface-visibility:\s*hidden/, 'the player box hides its backface');
  assert.match(cssText, /\.beat-preview \{[^}]*perspective:\s*1000px/, 'the player box owns a 3D context');
  assert.match(cssText, /\.beat-preview \{[^}]*will-change:\s*transform/, 'the player box keeps its compositor layer');
  assert.match(cssText, /\.beat-preview__seek \{[^}]*contain:\s*layout style/, 'the scrub bar is strictly contained');
  assert.match(cssText, /\.beat-preview__seek \{[^}]*overflow:\s*hidden/, 'the scrub bar contains its own paint');
  assert.match(cssText, /\.beat-preview__seek \{[^}]*border-radius:\s*999px/, 'the scrub bar clips with a rounded box');
  assert.match(cssText, /\.beat-preview__details \{[^}]*padding:\s*0 4px/, 'the scrub bar is inset from the player chrome');
  assert.match(cssText, /\.beat-preview__seek::-webkit-slider-thumb \{[^}]*width:\s*8px/, 'the scrub handle is small enough to stay inside the track');
  assert.match(cssText, /\.beat-preview__time \{[^}]*width:\s*13ch/, 'the clock reserves a fixed width');
  assert.match(cssText, /\.beat-preview__time \{[^}]*min-width:\s*13ch/, 'the clock reserves a fixed minimum width');
  assert.match(cssText, /\.beat-preview__time \{[^}]*font-variant-numeric:\s*tabular-nums/, 'the clock uses tabular figures');
  assert.match(cssText, /\.beat-preview__time \{[^}]*font-feature-settings:\s*"tnum"/, 'the clock enables tabular figures explicitly');
  // The frame is completely inert: no sheen pseudo-element, no rotating border,
  // and no continuous shadow keyframes to repaint the backdrop-filtered surface.
  assert.doesNotMatch(cssText, /@keyframes playerSpin/, 'no spinning border keyframe remains');
  assert.doesNotMatch(cssText, /@keyframes playerPulse/, 'the player never animates its shadow');
  assert.doesNotMatch(cssText, /@keyframes togglePulse/, 'the play button never animates its shadow');
  assert.doesNotMatch(cssText, /\.beat-preview::before/, 'the player has no sheen pseudo-element');
  assert.doesNotMatch(cssText, /conic-gradient\(from var\(--sheen-turn/, 'no rotating conic sheen remains');
  assert.match(cssText, /\.download-menu \{[^}]*will-change:\s*transform/, 'the drawer keeps a compositor layer for scroll tracking');
  assert.match(cssText, /\.download-menu \{[^}]*translate:\s*0 -6px/, 'the drawer reveal lives on `translate` so `transform` stays free for scroll tracking');
  const taglineStart = cssText.indexOf('/* Tagline under the wordmark');
  const taglineEnd = cssText.indexOf('\n.logo-stage {', taglineStart);
  assert(taglineStart >= 0 && taglineEnd > taglineStart, 'the tagline palette is isolated in its own stylesheet section');
  const taglineCss = cssText.slice(taglineStart, taglineEnd);
  assert.match(taglineCss, /#39ff8b/i, 'the tagline keeps its original neon-green accent');
  assert.match(taglineCss, /#ff3ea5/i, 'the tagline keeps its original vivid-pink accent');
  assert.match(taglineCss, /#ff2e9a/i, 'the pixel heart keeps its original pink base');
  // Every beat plays one photographed pressing: `assets/vinyl-classic.png` is the
  // disc, and the only layer painted on top of it is the static label plate. No
  // rim, no metallic ring, no cover-derived palette, no per-beat block, and the
  // plate itself is the artwork's own black-and-white — so every colour literal
  // that remains in the stylesheet is an equal-channel grey.
  assert.match(cssText, /\.vinyl-record \{[^}]*url\("assets\/vinyl-classic\.png"\)/, 'the disc is the supplied photograph');
  // The frame's measurement block is the rule that positions it.
  const discStart = cssText.indexOf('.vinyl-record__logo-frame {\n  position: absolute');
  const discEnd = cssText.indexOf('}', discStart);
  assert(discStart >= 0 && discEnd > discStart, 'the flower frame has its own stylesheet block');
  const discCss = cssText.slice(discStart, discEnd);
  assert.match(discCss, /top: 50%/, 'the flower frame is centred vertically on the label');
  assert.match(discCss, /left: 50%/, 'the flower frame is centred horizontally on the label');
  assert.match(discCss, /transform: translate\(-50%, -50%\)/, 'the flower frame is centred on the label');
  assert.match(discCss, /width: 30%/, 'the label plate covers the photographed label');
  assert.match(discCss, /background: #000000/, 'the plate is the logo artwork\'s own solid black');
  assert.match(discCss, /border-radius: 50%/, 'the plate is the label\'s circle');
  assert.match(discCss, /overflow: hidden/, 'the frame crops the artwork to that circle');
  assert.doesNotMatch(cssText, /vinylCenterSpin/, 'the label never spins — the artwork is a static print');
  assert.doesNotMatch(cssText, /\.vinyl-record__logo \{[^}]*filter:/, 'the label takes no colour filter');
  assert.doesNotMatch(cssText, /\.vinyl-record__logo \{[^}]*animation:/, 'the label declares no animation');
  assert.doesNotMatch(cssText, /conic-gradient/, 'no metallic rim ring is painted anywhere');
  assert.doesNotMatch(cssText, /--vinyl-(body|label|marble|vein|flake|groove|rim|sheen)-/, 'the record takes no cover-derived colour');
  assert.doesNotMatch(cssText, /\.vinyl-record__rim/, 'no synthetic rim element is styled');
  assert.doesNotMatch(cssText, /\.vinyl-record--(white|gold-rim|sage-white-rim|ice-silver-rim|rage-fire-rim|graffiti-splatter)/, 'no per-beat pressing block survives');
  assert.doesNotMatch(cssText, /\.vinyl-record__gold|gold-splatter|sage-blob/, 'the pressing generates no splash, blob or artwork layer');
  assert.doesNotMatch(cssText, /radial-gradient\(circle at 50% 42%/, 'the painted brown-gold label is gone: the artwork supplies the plate');
  assert.doesNotMatch(cssText, /\.vinyl-record::(after|(before)(?!:))/, 'no pseudo-element is painted on the record — the plate is a real layer');
  const indexHtml = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(indexHtml, /vinyl-palette/, 'the retired cover-palette module is no longer loaded');
  assert.match(cssText, /\.social-icon \{[^}]*width:\s*52px/, 'the footer social icons keep a real tap target');
  assert.match(cssText, /\.social-icon \{[^}]*background:\s*transparent/, 'the social icons have no tile behind them');
  assert.match(cssText, /\.social-icon \{[^}]*border:\s*0/, 'the social icons draw no box');
  assert.doesNotMatch(cssText, /\.social-icon[^{}]*\{[^}]*filter:\s*drop-shadow/, 'the social icons carry no glow');
  assert.doesNotMatch(indexHtml, /#ff0033|#25f4ee|#fe2c55|kyro-ig-gradient/, 'the footer marks are black and white, not brand colours');
  assert.match(cssText, /\.support-modal \{[^}]*position:\s*fixed/, 'the support desk is a full-screen in-page dialog');
  assert.match(cssText, /\.support-modal \{[^}]*z-index:\s*1000000/, 'the desk paints above the package drawer');
  assert.match(cssText, /\.support-sheet \{[^}]*max-height:\s*90dvh/, 'the desk card is measured in dynamic viewport units');
  assert.match(cssText, /\.support-sheet \{[^}]*overflow-y:\s*auto/, 'the desk card scrolls inside itself');
  // Every authored colour exception is declared between `START`/`END` markers
  // (the hero tagline and the hero's warm bloom). Strip all of them, then
  // insist that everything left is an equal-channel grey.
  const stripMarkedPalettes = (css) => {
    let out = '';
    let i = 0;
    for (;;) {
      const start = css.indexOf('=== THE BRAND', i);
      if (start < 0) return out + css.slice(i);
      out += css.slice(i, start);
      const end = css.indexOf('END === */', start);
      if (end < 0) return out + css.slice(start);
      i = end + 'END === */'.length;
    }
  };
  const auditedCss = stripMarkedPalettes(cssText.slice(0, taglineStart) + cssText.slice(taglineEnd));
  const literal = value => (value.includes(',')
    ? value.split(',').slice(0, 3).map(part => Number(part.trim()))
    : (value.length <= 4 ? value.slice(0, 3).split('').map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16))));
  const cssColours = [
    ...[...auditedCss.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g)].map(m => m[1]),
    ...[...auditedCss.matchAll(/rgba?\(([^)]*)\)/g)].map(m => m[1]),
  ];
  assert(cssColours.length > 100, 'the stylesheet declares a full palette');
  const cssTinted = [...new Set(cssColours)].filter(value => {
    const [r, g, b] = literal(value);
    return !(r === g && g === b);
  });
  assert.deepEqual(cssTinted, [], `every colour literal outside the marked palette sections is an equal-channel grey: ${cssTinted.join(', ')}`);
  assert.match(cssText, /html \{ text-transform: uppercase; \}/, 'the page-wide ALL-CAPS rule');
  assert.match(cssText, /input::placeholder, textarea::placeholder \{ text-transform: uppercase; \}/, 'placeholders are uppercase too');
  assert.equal(/\.gate-input[^}]*text-transform: none/.test(cssText), false, 'no casing opt-out is left on the fields');

  assert(providerRequests.length > 0, 'the flows really contacted Formspree');
  assert(providerRequests.every(request => request.url === PROVIDER || request.url === SUPPORT_PROVIDER),
    'every Formspree request targets one of the two live forms and never a superseded endpoint');
  assert(subscribeRequests.length > 0, 'the flows really posted their analytics');
  assert(subscribeRequests.every(request => request.url === PROVIDER || request.url === SUPPORT_PROVIDER),
    'every analytics POST targets one of the two live forms');
  const supportTickets = subscribeRequests.filter(request => request.url === SUPPORT_PROVIDER);
  const freeDownloadPosts = subscribeRequests.filter(request => request.url === PROVIDER);
  assert.equal(supportTickets.length, 1, 'the support desk posted its one ticket to its own form');
  const ticketBody = JSON.parse(supportTickets[0].body);
  assert.deepEqual(Object.keys(ticketBody).sort(), ['email', 'message', 'subject'],
    'the ticket body is the clean support payload — the three core fields and no system metadata');
  assert(freeDownloadPosts.length >= 5, 'the free-download gates kept posting to the FREE DOWNLOADS form');
  assert(freeDownloadPosts.every(request => JSON.parse(request.body).licenseSerial !== undefined
    && JSON.parse(request.body).deviceType !== undefined),
    'no support ticket bleeds into the free-download form — the download records keep their full tracking payload');
  assert.deepEqual(await supersededFormReferences(), [],
    'no superseded Formspree form id remains anywhere in the repository');

  assert.deepEqual(errors, []);
  console.log('Passed storefront layout, tagged audio preview, and the free-download drawer + all three packages behind one clean two-step gate (email + opt-in only, with no social step, like, follow or subscribe anywhere), the REVIEW & SIGN stage with read-to-the-end terms, a typed full name AND a drawn signature required together in BOTH TYPE and DRAW with a single word or a drawing alone refused even with the disabled attribute stripped, and a re-sign single word refused on the download page — an upright never-flipped signature mark, no flower watermark on the signature sheet / the certificate (the flower now lives in the PDF\'s LICENSOR approval stamp) and a pure-white drawn signature ink, a backdrop that never dismisses the gate or the signature stage, a border-free floating flower and white/silver monochrome PDF borders, a direct studio-named PDF download with its serial, studio filenames with BPM and key, in-page session memory with empty storage, Formspree posts, and the whole flow walked at 390x844 with touch).');
} finally {
  await browser?.close();
  server.close();
}
