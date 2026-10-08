// Browser integration checks; requests are local or mocked, never real purchases.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDeliveryMessage } from './worker/src/index.js';

const root = new URL('./', import.meta.url);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    const file = new URL(path === '/' ? 'index.html' : `.${path}`, root);
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file.pathname)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
async function setupPage(options = {}, streamPreview = false) {
  const page = await browser.newPage(options);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), target = new URL(req.url());
    if (streamPreview && ['docs.google.com', 'drive.google.com', 'drive.usercontent.google.com'].includes(target.hostname)) return route.continue();
    if (target.origin === url && !target.pathname.startsWith('/api/')) return route.continue();
    if (target.pathname.startsWith('/assets/')) {
      return route.fulfill({ path: new URL(`.${target.pathname}`, root).pathname });
    }
    let body = {};
    if (target.pathname === '/api/catalog') body = { sold: [] };
    if (target.pathname === '/api/mins') body = { mins: {} };
    if (target.pathname === '/api/checkout') body = { order_id: 'preview', pay_amount: 9.95, pay_currency: 'usdtsol', pay_address: 'PreviewAddressOnly' };
    await route.fulfill({ json: body });
  });
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(tmpdir(), 'opencode', `kyrolll-${name}.png`), fullPage: !/cart|checkout/.test(name) });
const noOverflow = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
async function checkOffer(page) {
  await page.locator('.offer').scrollIntoViewIfNeeded();
  const layout = await page.locator('.offer').evaluate(card => {
    const box = card.getBoundingClientRect();
    return { height: box.height, fits: [...card.querySelectorAll('h3, p, dt, dd')].every(el => {
      const r = el.getBoundingClientRect();
      return r.left >= box.left && r.right <= box.right && r.bottom <= box.bottom;
    }), prices: [...card.querySelectorAll('dd')].map(el => el.textContent) };
  });
  assert(layout.height <= 180 && layout.fits, 'compact offer content must fit without clipping');
  assert.deepEqual(layout.prices, ['$14.95', '$299.95']);
}
async function checkPausedPerks(page) {
  assert.equal(await page.locator('#wallet-btn, #wallet-modal, .perks, #cashback-notice, #t-holder-row').count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /cashback|15% off|token holder|connect wallet/i);
}
async function checkNoClipping(page) {
  const clipped = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('.hero-link, .offer, .card__btn')) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) bad.push(el.className);
    }
    return bad;
  });
  assert.deepEqual(clipped, [], `no element should clip: ${clipped.join(', ')}`);
  const wordmark = await page.locator('.brand-wordmark').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, vw: innerWidth };
  });
  assert(wordmark.left >= -1 && wordmark.right <= wordmark.vw + 1, 'wordmark must stay within viewport');
}
try {
  browser = await chromium.launch({ headless: true });
  const desktop = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await desktop.goto(url);
  await desktop.locator('.logo-stage.is-ready').waitFor();
  await desktop.waitForFunction(() => getComputedStyle(document.querySelector('.logo-fallback')).opacity === '0');
  assert(await desktop.locator('.logo-stage').evaluate(stage => {
    const canvas = stage.querySelector('canvas');
    return Math.abs(canvas.width / Math.min(devicePixelRatio, 2) - stage.getBoundingClientRect().width) < 2;
  }), '3D logo renders at the displayed size before handoff');
  assert.doesNotMatch(await desktop.content(), /Beat Catalog/i);
  assert.equal(await desktop.locator('body > canvas').count(), 1, 'falling-X background canvas');
  const canvasBeforeScroll = await desktop.locator('body > canvas').evaluate(canvas => ({
    position: getComputedStyle(canvas).position,
    top: canvas.getBoundingClientRect().top,
    height: canvas.getBoundingClientRect().height,
    pixels: [...canvas.getContext('2d').getImageData(0, 0, 100, 100).data]
  }));
  assert.equal(canvasBeforeScroll.position, 'absolute');
  assert(canvasBeforeScroll.height > 1000, 'background covers the document, not only the viewport');
  await desktop.evaluate(() => scrollTo(0, 400));
  const canvasAfterScroll = await desktop.locator('body > canvas').evaluate(canvas => ({
    top: canvas.getBoundingClientRect().top,
    pixels: [...canvas.getContext('2d').getImageData(0, 0, 100, 100).data]
  }));
  assert(Math.abs(canvasAfterScroll.top - canvasBeforeScroll.top + 400) < 2, 'marks remain at document coordinates while scrolling');
  assert.deepEqual(canvasAfterScroll.pixels, canvasBeforeScroll.pixels, 'scrolling does not shift the painted marks');
  await desktop.evaluate(() => scrollTo(0, 0));
  assert.equal(await desktop.locator('.background-doodles').count(), 0, 'doodles layer removed');
  assert.equal(await desktop.locator('.motion-toggle').getAttribute('aria-pressed'), 'true');
  const stillA = await desktop.locator('.logo-stage').screenshot();
  await desktop.waitForTimeout(200);
  const stillB = await desktop.locator('.logo-stage').screenshot();
  assert(stillA.equals(stillB), 'reduced-motion logo must be still');
  await noOverflow(desktop);
  await checkOffer(desktop);
  assert.equal(await desktop.locator('#grid .card').count(), 1);
  assert.match(await desktop.locator('#grid .card').first().innerText(), /FLESH.*130 BPM \/\/ Am/is);
  assert.equal(await desktop.locator('#grid .card').first().locator('img').getAttribute('src'), 'assets/flesh.png');
  assert.equal(await desktop.locator('#grid .card').first().locator('audio').getAttribute('src'), 'https://docs.google.com/uc?export=download&id=1cg_0qBDDMu80EqJ90_POL3ekv2k1BJ7Q');
  assert.equal(await desktop.locator('#grid .card').first().locator('audio').getAttribute('data-fallback'), 'assets/previews/flesh.mp3');
  const cover = await desktop.locator('#card-flesh .card__media img').boundingBox();
  assert(cover.width <= 180 && cover.height <= 180, 'desktop artwork stays album-sized');
  const card = await desktop.locator('#card-flesh').boundingBox();
  assert(card.width <= 480, 'one catalog card must not fill the page');
  assert(card.x >= 16 && card.x < 60, 'featured beat starts in the first grid column');
  assert.equal(await desktop.locator('#grid .card').first().locator('.card__btn--mp3').count(), 0);
  assert.equal(await desktop.locator('#grid .card').first().locator('.card__btn--wav').count(), 1);
  await checkPausedPerks(desktop);
  await checkNoClipping(desktop);
  await desktop.evaluate(() => scrollTo(0, 0));
  await shot(desktop, 'desktop');
  await desktop.emulateMedia({ reducedMotion: 'no-preference' });
  const movingA = await desktop.locator('.logo-stage').screenshot();
  await desktop.waitForTimeout(900);
  const movingB = await desktop.locator('.logo-stage').screenshot();
  assert(!movingA.equals(movingB), 'logo should rotate');
  const painted = await desktop.evaluate(() => {
    const c = document.querySelector('body > canvas');
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
  assert(painted > 500, `falling-X canvas should paint pixels (got ${painted})`);
  await desktop.evaluate(() => scrollTo(0, 0));
  await desktop.screenshot({ path: join(tmpdir(), 'opencode', 'kyrolll-motion-bg.png') });
  await desktop.locator('.motion-toggle').click();
  assert.equal(await desktop.locator('.motion-toggle').getAttribute('aria-pressed'), 'true');
  await desktop.evaluate(() => {
    CATALOG.push(...Array.from({ length: 4 }, (_, i) => ({ id: `beat${i + 1}`, title: `BEAT 0${i + 1}`, name: ['STATIC', 'AFTER HOURS', 'NO SIGNAL', 'DUST'][i], img: `assets/beat${i + 1}.jpg`, bpm: 140, key: 'C MIN', leases: 10, left: 8 })));
    rebuildCatalog();
  });
  const desktopCards = await desktop.locator('#grid .card').evaluateAll(cards => cards.map(card => {
    const { x, y, width } = card.getBoundingClientRect(); return { x, y, width };
  }));
  assert.equal(desktopCards.length, 5);
  assert(desktopCards[0].x < desktopCards[1].x && desktopCards[1].x < desktopCards[2].x, 'three columns on desktop');
  assert(desktopCards[3].y > desktopCards[0].y && desktopCards[3].x === desktopCards[0].x, 'later beats wrap to the next row');
  assert(desktopCards.every(card => card.width < 480), 'cards remain compact in the multi-beat grid');
  await shot(desktop, 'catalog');
  await desktop.locator('.card__btn--mp3').first().click();
  await desktop.locator('#cartbar').click();
  await desktop.locator('.drawer--open').waitFor();
  assert.equal(await desktop.locator('#t-total-usd').textContent(), '$9.95');
  await shot(desktop, 'cart');
  await desktop.locator('#email').fill('preview@example.com');
  await desktop.locator('.paygrid__opt').first().click();
  await desktop.locator('#submit-btn').click();
  await desktop.locator('#payscreen-payblock').waitFor();
  await desktop.waitForFunction(() => getComputedStyle(document.querySelector('#payscreen .payscreen__card')).opacity === '1');
  await shot(desktop, 'checkout');
  await desktop.locator('#payscreen-close').click();
  await checkPausedPerks(desktop);
  // The compact offer's instruction must still lead to a real free lease.
  for (let i = 0; i < 3; i++) await desktop.locator('.card__btn--mp3').nth(i).click();
  await desktop.locator('#cartbar').click();
  await desktop.getByRole('button', { name: 'MAKE FREE', exact: true }).first().click();
  assert.equal(await desktop.locator('#t-total-usd').textContent(), '$19.90');
  assert.equal(await desktop.locator('#t-discount').textContent(), '−$9.95');
  await desktop.locator('#close').click();

  const mobile = await setupPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await mobile.goto(url);
  await mobile.locator('.logo-stage.is-ready').waitFor();
  const mobileCover = await mobile.locator('#card-flesh .card__media img').boundingBox();
  assert(mobileCover.width <= 120 && mobileCover.height <= 120, 'mobile artwork stays compact');
  assert(await mobile.locator('#card-flesh .card__title-link').evaluate(link => {
    const title = link.getBoundingClientRect(), card = link.closest('.card').getBoundingClientRect();
    return title.top >= card.top && title.right <= card.right && title.bottom <= card.bottom;
  }), 'beat title stays within the mobile card');
  await noOverflow(mobile);

  const playback = await setupPage({ viewport: { width: 480, height: 800 }, reducedMotion: 'reduce' }, true);
  const audioRequests = [];
  playback.on('requestfailed', req => audioRequests.push(`${req.url()} ${req.failure()?.errorText}`));
  playback.on('response', res => { if (res.url().includes('google.com') || res.url().includes('flesh.mp3')) audioRequests.push(`${res.status()} ${res.url()}`); });
  await playback.goto(url);
  await playback.locator('#card-flesh .beat-preview__toggle').click();
  await playback.waitForFunction(() => {
    const audio = document.querySelector('#card-flesh audio');
    return !audio.paused && audio.currentTime > 0 && audio.closest('.beat-preview').dataset.state === 'playing';
  }, null, { timeout: 15000 }).catch(async error => {
    const media = await playback.locator('#card-flesh audio').evaluate(a => ({ error: a.error?.code, networkState: a.networkState, readyState: a.readyState, src: a.currentSrc }));
    throw new Error(`${error.message}; media=${JSON.stringify(media)}; requests=${audioRequests.join(' | ')}`);
  });
  await playback.close();
  await checkOffer(mobile);
  await mobile.evaluate(() => scrollTo(0, 0));
  await shot(mobile, 'mobile');
  await mobile.setViewportSize({ width: 320, height: 740 });
  await noOverflow(mobile);
  await checkOffer(mobile);
  await shot(mobile, 'offer-320');
  await checkPausedPerks(mobile);
  await checkNoClipping(mobile);
  await mobile.locator('#card-flesh .card__btn--wav').tap();
  await mobile.locator('#cartbar').tap();
  await shot(mobile, 'mobile-cart');
  await noOverflow(mobile);

  for (const vp of [{ width: 360, height: 780 }, { width: 375, height: 812 }, { width: 414, height: 896 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    const p = await setupPage({ viewport: vp, reducedMotion: 'reduce' });
    await p.goto(url);
    await p.locator('.logo-stage.is-ready').waitFor();
    await noOverflow(p);
    await checkPausedPerks(p);
    await checkNoClipping(p);
    if (vp.width === 1024 || vp.width === 375) {
      await p.evaluate(() => {
        CATALOG.push(...[1, 2].map(i => ({ id: `beat${i}`, title: `BEAT 0${i}`, img: `assets/beat${i}.jpg`, bpm: 140, key: 'C MIN', leases: 10, left: 8 })));
        rebuildCatalog();
      });
      const positions = await p.locator('#grid .card').evaluateAll(cards => cards.map(card => {
        const { x, y } = card.getBoundingClientRect(); return { x, y };
      }));
      assert.equal(positions.length, 3);
      if (vp.width === 1024) assert(positions[1].x > positions[0].x && positions[2].y > positions[0].y, 'two columns on tablet');
      else assert(positions[1].y > positions[0].y && positions[1].x === positions[0].x, 'one column on mobile');
      await noOverflow(p);
    }
    await p.close();
  }

  const fallback = await setupPage({ viewport: { width: 390, height: 844 } });
  await fallback.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); }; });
  await fallback.goto(url);
  await fallback.locator('.logo-fallback').waitFor();
  assert(await fallback.locator('.logo-fallback').evaluate(img => img.complete && img.naturalWidth > 0));
  await shot(fallback, 'fallback');

  const originalFetch = globalThis.fetch;
  let receipt;
  try {
    globalThis.fetch = async () => new Response(await readFile(new URL('assets/kyrolll-social.jpg', root)));
    const items = ['mp3', 'wav', 'exclusive'].map((tier, i) => ({ id: `beat${i + 1}`, title: `BEAT 0${i + 1}`, tier, isExclusive: tier === 'exclusive' }));
    receipt = await buildDeliveryMessage({ items, total: 324.85, email: 'preview@example.com', labeled: items.map(i => i.title), updated: Date.now() }, items.map(i => ({ ...i, url: `https://files.example/${i.id}.${i.tier === 'mp3' ? 'mp3' : 'wav'}` })), {}, 'preview');
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(receipt.attachments.length, 6);
  const email = await setupPage({ viewport: { width: 700, height: 1000 } });
  await email.setContent(receipt.html);
  await email.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth));
  await shot(email, 'email');
  await email.setViewportSize({ width: 320, height: 740 });
  await noOverflow(email);
  await shot(email, 'email-mobile');
  assert.deepEqual(errors, []);
  console.log('Passed desktop/mobile layout, 3D motion, reduced motion, WebGL fallback, cart, checkout, paused token messaging, and mixed-license email checks.');
  console.log(`Screenshots: ${join(tmpdir(), 'opencode', 'kyrolll-*.png')}`);
} finally {
  await browser?.close();
  server.close();
}
