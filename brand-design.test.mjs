// Browser integration checks for the free-download KYROIII store.
// Covers the storefront layout, the tagged audio preview, the "DOWNLOAD FREE"
// drawer (welded to its trigger, with the ambient glow) and all three
// package-specific unlock paths (email-only MP3, subscribe + like + Instagram
// WAV, and all five social steps for Pro), ending on the download page and its
// PDF license.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

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
// Every POST the email gate makes to the newsletter provider.
const subscribeRequests = [];
async function setupPage(options = {}) {
  const context = await browser.newContext(options);
  // Keep the run hermetic: same-origin files come from the test server, bundled
  // assets are read from disk, and anything external (the YouTube gate's
  // subscribe/like links) never leaves the machine.
  await context.route('**/*', async route => {
    const req = route.request(), target = new URL(req.url());
    if (target.origin === url) return route.continue();
    // The email gate posts the address to whatever provider `catalog.js`
    // configures (Formspree today). Record it and answer with a tiny page so the
    // hidden iframe's load handler fires, exactly as the real provider would.
    if (req.method() === 'POST') {
      subscribeRequests.push({ url: req.url(), body: req.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>subscribed</title>' });
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
const noOverflow = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');

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

// Every rendered colour except the hero tagline's intentional green / pink
// glitch palette must be an equal-channel grey.
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
const PROVIDER = 'https://formspree.io/f/xgaoppwo';
// The scheduled second release, [FREE 100%] FUTURE TYPE BEAT - THE FLOW.
const FLOW_ID = '5f9bbcab-e010-4efe-b459-9c9182e1d85b';
const FLOW_CARD = '#card-5f9bbcab-e010-4efe-b459-9c9182e1d85b';
const FLOW_RELEASE = Date.parse('2026-10-19T23:00:00+03:00');

// Nothing about a gate may be remembered: the storefront writes no gate state
// at all (no unlock set, no remembered address).
const noGateMemory = async (page, label) => {
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  assert.deepEqual(storage.local, [], `${label}: localStorage stays empty`);
  assert.deepEqual(storage.session, [], `${label}: sessionStorage stays empty`);
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

// A social step is not a click-through: it only counts once its hold has run, so
// the bypass (click, bounce, submit) is refused. Each package carries exactly the
// steps its listing promises: the Standard WAV lease three (subscribe + like this
// beat's video + Instagram), the Pro package all five (those plus TikTok and X).
async function openSteps(page, count) {
  assert.equal(await page.locator('.gate-step').count(), count, `the gate carries ${count} step(s)`);
  // Watch the first step from the very click: it must report VERIFYING and must
  // not be done in that same frame. The rest are then opened in turn; their
  // holds run in parallel and the gate only unlocks when all of them have run.
  await page.locator('[data-gate-step="0"]').click();
  assert.equal(await page.locator('[data-gate-step="0"]').evaluate(el => el.classList.contains('is-done')), false, 'a step is not done the moment it is clicked');
  assert.equal(await page.locator('[data-gate-step="0"]').evaluate(el => el.classList.contains('is-verifying')), true, 'the held step reports it is verifying');
  assert.match(await page.locator('[data-gate-step="0"] .gate-step__go').innerText(), /VERIFYING/);
  for (let i = 1; i < count; i += 1) await page.locator(`[data-gate-step="${i}"]`).click();
  await page.waitForFunction(n => document.querySelectorAll('.gate-step.is-done').length === n, count, { timeout: 20000 });
}

try {
  browser = await chromium.launch({ headless: true });
  const desktop = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await desktop.goto(url);
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
  assert.deepEqual(await desktop.locator('.footer__social a').evaluateAll(nodes => nodes.map(node => ({
    text: node.textContent.trim(),
    href: node.getAttribute('href')
  }))), [
    { text: 'YOUTUBE', href: 'https://www.youtube.com/@KYROlll00' },
    { text: 'INSTAGRAM', href: 'https://www.instagram.com/kyroill00' },
    { text: 'TIKTOK', href: 'https://www.tiktok.com/@kyroill00' },
    { text: 'X', href: 'https://x.com/KYROlllll' }
  ], 'the footer links every official social profile');
  assert.equal(await desktop.locator('.brand-tagline__text').textContent(), 'THAT MY FAVORITE');
  assert.equal(await desktop.locator('.brand-tagline__heart svg').count(), 1);
  assert.deepEqual(await desktop.locator('.brand-tagline__text').evaluate(el => ({
    green: getComputedStyle(el, '::before').color,
    pink: getComputedStyle(el, '::after').color,
  })), { green: 'rgb(57, 255, 139)', pink: 'rgb(255, 62, 165)' });
  assert.equal(await desktop.locator('#grid .catalog-tile').count(), 2);
  assert.match(await desktop.locator(CARD).innerText(), /\[FREE 100%\] DON TOLIVER TYPE BEAT - FLESH/i);
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
  assert.equal(await direct.locator(`${CARD} audio`).getAttribute('src'), 'assets/previews/BEAT 1 TAG.wav');
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
  await shot(direct, 'beat-detail');
  await direct.close();

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
  assert.equal(subscribeRequests.length, 1, 'the valid address is posted to the provider');
  assert.equal(subscribeRequests[0].url, PROVIDER, 'posted to the configured Formspree endpoint');
  assert.match(subscribeRequests[0].body, /email=mp3-buyer%40example\.com/);
  assert.match(subscribeRequests[0].body, /opt_in=yes/);
  assert.match(subscribeRequests[0].body, /embed=1/);
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

  // Package 2 — Standard WAV Lease: subscribe, like this beat's own video and
  // follow on Instagram — three mandatory social steps — then the email. The
  // unlock enables only once every step really ran, and the page then lists the
  // MP3 + WAV.
  const wavPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await pickPackage(wavPage, 'wav');
  await wavPage.locator('.gate-modal').waitFor();
  const wavPack = await wavPage.evaluate(() => window.KYROlll_PACKAGES.find(item => item.id === 'wav'));
  assert.equal(wavPack.tag, 'SUBSCRIBE + LIKE + IG', 'the WAV package badge names its three steps');
  assert.equal(wavPack.blurb, 'TAGGED MP3 + HIGH-QUALITY WAV + LICENSE. SUBSCRIBE, LIKE THE BEAT, FOLLOW ON INSTAGRAM, AND ENTER YOUR EMAIL TO UNLOCK.', 'the WAV package describes its three steps');
  assert.match(await wavPage.locator('.gate-modal__copy').first().innerText(), /SUBSCRIBE, LIKE THE BEAT, FOLLOW ON INSTAGRAM, AND ENTER YOUR EMAIL TO UNLOCK/, 'the WAV gate states all three requirements');
  assert.equal(await wavPage.locator('.gate-step').count(), 3, 'the WAV lease asks for subscribe, like and Instagram');
  assert.deepEqual(await wavPage.locator('.gate-step').evaluateAll(nodes => nodes.map(node => node.dataset.gateAction)), ['sub', 'like', 'ig'], 'the WAV gate carries exactly the three promised steps');
  assert.match(await wavPage.locator('[data-gate-action="sub"]').innerText(), /SUBSCRIBE/);
  assert.match(await wavPage.locator('[data-gate-action="sub"]').innerText(), /TO THE KYROIII YOUTUBE CHANNEL/);
  assert.match(await wavPage.locator('[data-gate-action="like"]').innerText(), /LIKE THIS BEAT/);
  assert.match(await wavPage.locator('[data-gate-action="like"]').innerText(), /ON YOUTUBE \(DIRECT BEAT VIDEO\)/);
  assert.match(await wavPage.locator('[data-gate-action="ig"]').innerText(), /FOLLOW ON INSTAGRAM/);
  assert.match(await wavPage.locator('[data-gate-action="ig"]').innerText(), /@KYROILL00/);
  assert.equal(await wavPage.locator('[data-gate-action="sub"]').getAttribute('href'), 'https://www.youtube.com/@KYROlll00?sub_confirmation=1', 'the subscribe step opens the official channel with its confirmation prompt');
  const wavLikeHref = await wavPage.locator('[data-gate-action="like"]').getAttribute('href');
  assert.equal(wavLikeHref, 'https://www.youtube.com/watch?v=8OhRJQn2YCU', 'the like step opens FLESH\'s exact official video');
  assert.equal(wavLikeHref, await wavPage.evaluate(id => window.KYROlll_HELPERS.videoFor(id), BEAT_ID), 'the gate and videoFor agree on the beat video');
  assert.equal(await wavPage.locator(`${CARD} a.card__youtube-link`).getAttribute('href'), wavLikeHref, 'the like step matches the YouTube icon beside the title');
  assert.equal(await wavPage.locator('[data-gate-action="ig"]').getAttribute('href'), 'https://www.instagram.com/kyroill00', 'the Instagram step opens the official profile');
  assert.equal(await wavPage.locator('[data-gate-action="tt"]').count(), 0, 'the WAV lease carries no TikTok step');
  assert.equal(await wavPage.locator('[data-gate-action="x"]').count(), 0, 'the WAV lease carries no X step');
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), true);
  // The steps have to be genuinely opened — and held — before they count.
  await openSteps(wavPage, 3);
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), true, 'the step alone never unlocks — the email is still required');
  await wavPage.locator('#gate-email').fill('wav-buyer@example.com');
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), false);
  await wavPage.locator('[data-gate-submit]').click();
  await signLicense(wavPage, 'Wav Buyer');
  await wavPage.waitForURL(/package=wav/);
  assert.equal(subscribeRequests.length, 2, 'the WAV gate posts its address too');
  assert.match(await wavPage.locator('#download-sub').innerText(), /SUBSCRIBE, LIKE THE BEAT, FOLLOW ON INSTAGRAM, AND ENTER YOUR EMAIL TO UNLOCK/i, 'the download page records the WAV gate requirements');
  assert.match(await wavPage.locator('#download-meta').innerText(), /SUBSCRIBE \+ LIKE \+ IG/i, 'the download page carries the package badge');
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
  assert.deepEqual(pdfRuns(wavText).filter(run => /[a-z]/.test(run)), [], 'the WAV license is uppercase too');
  await shot(wavPage, 'download-wav');
  await wavPage.close();

  // Package 3 — Exclusive / Pro: all five social steps (subscribe, like this
  // beat, Instagram, TikTok and X — there is still no comment step), then the
  // email gate. A malformed address is refused (and the opt-in is on by
  // default); a valid one unlocks the stems package and is posted to the
  // configured newsletter provider.
  const proPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await proPage.goto(`${url}/?beat=flesh`);
  const endpoint = await proPage.evaluate(() => window.KYROlll_NEWSLETTER && window.KYROlll_NEWSLETTER.endpoint);
  assert.match(endpoint, /^https:\/\//, 'a newsletter provider endpoint is configured');
  assert.equal(endpoint, PROVIDER, 'the Formspree endpoint the gate posts to');
  await proPage.locator(`${CARD} .download-trigger`).click();
  await proPage.locator('.download-menu.is-open').waitFor();
  await proPage.locator('.download-tier[data-package="exclusive"]').click();
  await proPage.locator('.gate-modal').waitFor();
  const proPack = await proPage.evaluate(() => window.KYROlll_PACKAGES.find(item => item.id === 'exclusive'));
  assert.equal(proPack.tag, 'ALL 5 SOCIAL STEPS', 'the Pro package badge names its five steps');
  assert.equal(proPack.blurb, 'FULL STEMS + MP3 + WAV + LICENSE. COMPLETE ALL SOCIAL STEPS AND ENTER YOUR EMAIL TO UNLOCK.', 'the Pro package describes every social step');
  assert.match(await proPage.locator('.gate-modal__copy').first().innerText(), /COMPLETE ALL SOCIAL STEPS AND ENTER YOUR EMAIL TO UNLOCK/, 'the Pro gate states that every social step is required');
  assert.equal(await proPage.locator('#gate-optin').isChecked(), true);
  // The email gate is a real <form> pointing at that provider endpoint.
  assert.equal(await proPage.locator('[data-gate-form]').getAttribute('action'), endpoint);
  assert.equal(await proPage.locator('[data-gate-form]').getAttribute('method'), 'post');
  // Subscribe, like this beat's own video, then Instagram, TikTok and X — all
  // five mandatory steps, and still no comment step.
  assert.equal(await proPage.locator('.gate-step').count(), 5, 'the Pro gate carries all five social steps');
  assert.deepEqual(await proPage.locator('.gate-step').evaluateAll(nodes => nodes.map(node => node.dataset.gateAction)), ['sub', 'like', 'ig', 'tt', 'x'], 'the Pro gate carries the five promised steps in order');
  assert.match(await proPage.locator('[data-gate-action="sub"]').innerText(), /SUBSCRIBE/);
  assert.match(await proPage.locator('[data-gate-action="sub"]').innerText(), /TO THE KYROIII YOUTUBE CHANNEL/);
  assert.match(await proPage.locator('[data-gate-action="like"]').innerText(), /LIKE THIS BEAT/);
  assert.match(await proPage.locator('[data-gate-action="like"]').innerText(), /ON YOUTUBE \(DIRECT BEAT VIDEO\)/);
  assert.match(await proPage.locator('[data-gate-action="ig"]').innerText(), /FOLLOW ON INSTAGRAM/);
  assert.match(await proPage.locator('[data-gate-action="ig"]').innerText(), /@KYROILL00/);
  assert.match(await proPage.locator('[data-gate-action="tt"]').innerText(), /FOLLOW ON TIKTOK/);
  assert.match(await proPage.locator('[data-gate-action="tt"]').innerText(), /@KYROILL00/);
  assert.match(await proPage.locator('[data-gate-action="x"]').innerText(), /FOLLOW ON X/);
  assert.match(await proPage.locator('[data-gate-action="x"]').innerText(), /@KYROIIIII/);
  assert.equal(await proPage.locator('[data-gate-action="sub"]').getAttribute('href'), 'https://www.youtube.com/@KYROlll00?sub_confirmation=1', 'the subscribe step opens the official channel with its confirmation prompt');
  const proLikeHref = await proPage.locator('[data-gate-action="like"]').getAttribute('href');
  assert.equal(proLikeHref, 'https://www.youtube.com/watch?v=8OhRJQn2YCU', 'the like step opens FLESH\'s exact official video');
  assert.equal(proLikeHref, await proPage.evaluate(id => window.KYROlll_HELPERS.videoFor(id), BEAT_ID), 'the gate and videoFor agree on the beat video');
  assert.equal(await proPage.locator(`${CARD} a.card__youtube-link`).getAttribute('href'), proLikeHref, 'the like step matches the YouTube icon beside the title');
  assert.equal(await proPage.locator('[data-gate-action="ig"]').getAttribute('href'), 'https://www.instagram.com/kyroill00', 'the Instagram step opens the official profile');
  assert.equal(await proPage.locator('[data-gate-action="tt"]').getAttribute('href'), 'https://www.tiktok.com/@kyroill00', 'the TikTok step opens the official profile');
  assert.equal(await proPage.locator('[data-gate-action="x"]').getAttribute('href'), 'https://x.com/KYROlllll', 'the X step opens the official profile');
  assert.equal(await proPage.locator('#gate-comment').count(), 0, 'the comment step is gone');
  assert.equal(await proPage.locator('[data-gate-submit]').isDisabled(), true);
  await openSteps(proPage, 5);
  // Each completed step draws its own tick and still cannot unlock alone.
  assert.equal(await proPage.locator('.gate-step.is-done .gate-step__tick').count(), 5, 'all five steps show their tick');
  assert.equal(await proPage.locator('[data-gate-submit]').isDisabled(), true, 'the steps alone never unlock');
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
  await proPage.waitForURL(/package=exclusive/);
  assert.match(await proPage.locator('#download-sub').innerText(), /COMPLETE ALL SOCIAL STEPS AND ENTER YOUR EMAIL TO UNLOCK/i, 'the download page records the Pro gate requirements');
  assert.match(await proPage.locator('#download-meta').innerText(), /ALL 5 SOCIAL STEPS/i, 'the download page carries the Pro package badge');
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
  assert.equal(subscribeRequests.length, 3, 'the valid address is posted to the newsletter provider');
  assert.equal(subscribeRequests[2].url, endpoint, 'posted to the configured provider endpoint');
  assert.match(subscribeRequests[2].body, /email=producer%40example\.com/);
  assert.match(subscribeRequests[2].body, /embed=1/);
  assert.match(await proPage.locator('#download-list').innerText(), /TRACKED STEMS/i);
  assert.equal(await proPage.locator('.download-item').count(), 3); // MP3 + WAV + stems (license is its own panel)
  assert.deepEqual(await proPage.locator('.download-item__name').allTextContents(), [
    'KYROIII - FLESH (130 BPM - AM).mp3',
    'KYROIII - FLESH (130 BPM - AM).wav',
    'KYROIII - FLESH (130 BPM - AM) - TRACKED STEMS.zip',
  ]);
  const proSerial = await proPage.locator('#license-serial').innerText();
  assert.match(proSerial, /^KYRO-\d{4}-FLESH-\d{6}$/);
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

  // Fresh state every time — and no session shortcut: selecting ANY package
  // re-opens the full gate from scratch, with nothing remembered or prefilled,
  // and the REVIEW & SIGNATURE stage is never auto-opened. The signature step is
  // mandatory on every selection.
  await proPage.goto(`${url}/?beat=flesh`);
  for (const pkg of ['mp3', 'wav', 'exclusive']) {
    await proPage.locator(`${CARD} .download-trigger`).click();
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

  // A passed gate is recorded for this view, but the record NEVER skips a later
  // selection: selecting the package again re-opens the full gate, starts the
  // signature stage empty and locked, and posts nothing until the visitor submits.
  await openSteps(coldPage, 5);
  await coldPage.locator('#gate-email').fill('cold-entrant@example.com');
  await coldPage.locator('[data-gate-submit]').click();
  await signLicense(coldPage, 'Cold Entrant');
  // The success beat holds ~1.4 s and then the page paints its file rows.
  await coldPage.locator('.download-item').first().waitFor({ timeout: 15000 });
  assert.match(await coldPage.locator('#download-list').innerText(), /TRACKED STEMS/i);
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), true, 'the pass is recorded for this view');
  await noGateMemory(coldPage, 'after a gate passed on the download page itself');
  const postsBeforeMemory = subscribeRequests.length;
  await coldPage.evaluate(id => { window.KYROlll_DOWNLOADS.start(id, 'exclusive'); }, BEAT_ID);
  await coldPage.locator('.gate-modal').waitFor();
  assert.equal(await coldPage.locator('#gate-email').inputValue(), '', 'a remembered grant still asks for the address');
  assert.equal(await coldPage.locator('[data-gate-submit]').isDisabled(), true, 'a remembered grant cannot skip the gate');
  assert.equal(await coldPage.locator('.gate-modal__card--sign').count(), 0, 'a remembered grant never auto-opens the sign step');
  assert.equal(await coldPage.locator('#sign-name').count(), 0, 'a remembered grant never prefills a signature');
  assert.equal(await coldPage.locator('.gate-step.is-done').count(), 0, 'the steps start unopened again');
  assert.equal(subscribeRequests.length, postsBeforeMemory, 're-opening a gate posts nothing');
  await coldPage.locator('.gate-modal__card [data-gate-cancel]').click();
  await coldPage.locator('.gate-modal').waitFor({ state: 'detached' });
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), true, 'the pass stays recorded for this view');
  await coldPage.reload();
  await coldPage.waitForFunction(() => !!window.KYROlll_DOWNLOADS);
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), false, 'the record does not outlive the page');
  await coldPage.close();

  // A phone is where the store is used most — and where a dialog that measures
  // itself in `100vh` hides its own unlock button behind the browser chrome. The
  // whole flow is walked at 390×844 with touch on: the menu and the card inside
  // the visible viewport, the steps answering on the first tap, the pad owning
  // the gesture, and the unlock button reachable by scrolling the dialog itself.
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
  assert.equal(await phone.locator('.gate-step').first().evaluate(el => getComputedStyle(el).touchAction), 'manipulation', 'a step answers on the first tap');
  assert(parseFloat(await phone.locator('#gate-email').evaluate(el => getComputedStyle(el).fontSize)) >= 16, 'the field is large enough that iOS does not zoom the page');
  await openSteps(phone, 5);
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
  assert.equal(await preDrop.locator('#grid .catalog-tile').count(), 2, 'both releases sit in the catalog');
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

  // The beat page before the drop carries no player, a countdown pill and the
  // dedicated inert LOCKED control — and the exact second the clock lands it
  // unlocks itself in place.
  const liveDrop = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await liveDrop.goto(`${url}/?beat=the-flow&now=${FLOW_RELEASE - 8000}`);
  await liveDrop.locator(`[data-countdown="${FLOW_ID}"]`).waitFor();
  assert.equal(await liveDrop.locator(`${FLOW_CARD}.beat-detail`).count(), 1, 'the scheduled beat page renders');
  assert.match(await liveDrop.locator(FLOW_CARD).innerText(), /\[FREE 100%\] FUTURE TYPE BEAT - THE FLOW/i);
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .beat-preview`).count(), 0, 'no player is mounted before the drop');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .drop-locked`).count(), 1, 'the locked player stand-in renders on the beat page');
  assert.match(await liveDrop.locator(`${FLOW_CARD} .card__actions .drop-countdown`).innerText(), /DROPPING SOON/, 'the beat page action slot carries the countdown pill');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .card__actions .download-trigger--locked`).count(), 1, 'the beat page carries the dedicated LOCKED control');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .download-trigger[disabled]`).count(), 1, 'the LOCKED control is inert');
  // The YouTube icon is locked too: it is not an anchor, carries no URL, cannot
  // be clicked and is dimmed — the official video stays unreachable until release.
  assert.equal(await liveDrop.locator(`${FLOW_CARD} a.card__youtube-link`).count(), 0, 'no live YouTube link before the drop');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .card__youtube-link--locked`).count(), 1, 'the YouTube icon is shown locked');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .card__youtube-link--locked`).getAttribute('href'), null, 'the locked icon carries no URL');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .card__youtube-link--locked`).evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'the locked icon is not clickable');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .card__youtube-link--locked`).evaluate(el => el.tagName), 'SPAN', 'the locked icon is not an anchor');
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
  }, FLOW_ID, { timeout: 20000 });
  assert.equal(liveDrop.url(), urlBeforeDrop, 'the drop unlocks in page, with no reload');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .download-trigger--locked`).count(), 0, 'the LOCKED control is gone the moment the clock lands');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .download-trigger`).count(), 1, 'the download button is live the moment the clock lands');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .drop-countdown`).count(), 0, 'the countdown is gone once the drop lands');
  // …and the YouTube icon is now the real, fully clickable official link.
  const liveYoutube = liveDrop.locator(`${FLOW_CARD} a.card__youtube-link`);
  assert.equal(await liveYoutube.count(), 1, 'the YouTube link appears the moment the drop lands');
  assert.equal(await liveYoutube.getAttribute('href'), 'https://www.youtube.com/watch?v=aHMCkzw9Wuo', 'the live link points at the official video');
  assert.equal(await liveYoutube.evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'the live link is clickable');
  assert.equal(await liveDrop.locator(`${FLOW_CARD} .card__youtube-link--locked`).count(), 0, 'the locked icon is gone at release');
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

  // Keep the rest of the stylesheet monochrome while expressly checking the
  // isolated original green / pink hero accents and ALL-CAPS rules.
  const cssText = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  // The vinyl reveal contract: the record's *first* computed state is tucked
  // behind the sleeve (so nothing can flash in the exposed position), and the
  // reveal is a 1 s translate-only slide with the elite easing. The 360° spin it
  // replaced ballooned the square record's box by √2 and overshot the stage, so
  // the opened state must never carry a rotation.
  assert.match(cssText, /\.beat-detail:not\(\.vinyl-open\) \.vinyl-record \{[^}]*transform:\s*translateX\(0\)/, 'the record starts tucked behind the sleeve');
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
  const auditedCss = cssText.slice(0, taglineStart) + cssText.slice(taglineEnd);
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
  assert.deepEqual(cssTinted, [], `every colour literal outside the tagline section is an equal-channel grey: ${cssTinted.join(', ')}`);
  assert.match(cssText, /html \{ text-transform: uppercase; \}/, 'the page-wide ALL-CAPS rule');
  assert.match(cssText, /input::placeholder, textarea::placeholder \{ text-transform: uppercase; \}/, 'placeholders are uppercase too');
  assert.equal(/\.gate-input[^}]*text-transform: none/.test(cssText), false, 'no casing opt-out is left on the fields');

  assert.deepEqual(errors, []);
  console.log('Passed storefront layout, tagged audio preview, and the free-download drawer + all three package-specific gates (email + opt-in only for the MP3 lease, subscribe + like the beat + Instagram for the WAV lease, and those plus TikTok and X for the Pro package, the REVIEW & SIGN stage with read-to-the-end terms, a typed full name AND a drawn signature required together in BOTH TYPE and DRAW with a single word or a drawing alone refused even with the disabled attribute stripped, and a re-sign single word refused on the download page — an upright never-flipped signature mark, no flower watermark on the signature sheet / the certificate (the flower now lives in the PDF\'s LICENSOR approval stamp) and a pure-white drawn signature ink, a backdrop that never dismisses the gate or the signature stage, a border-free floating flower and white/silver monochrome PDF borders, a direct studio-named PDF download with its serial, studio filenames with BPM and key, in-page session memory with empty storage, Formspree posts, and the whole flow walked at 390x844 with touch).');
} finally {
  await browser?.close();
  server.close();
}
