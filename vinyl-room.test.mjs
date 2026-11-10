// The home route is the vinyl room and nothing else.
//
// These checks prove the new shape of the store: no hero, ticker or catalog
// document below the room; every release on the 3D shelf; the seal tears (and a
// drag can scrub it); the package drawer slides in with the three free tiers and
// the support/profile links; the deck plays a preview and has no pitch control;
// and a phone fits the whole room without sideways scroll.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname } from 'node:path';

const root = new URL('./', import.meta.url);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.zip': 'application/zip',
};

/* Byte ranges matter here: Chromium asks for a range when it reads a preview's
   duration, and a plain 200 for a 4 MB mp3 leaves the deck at `--:--`. */
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = new URL(pathname === '/' ? 'index.html' : `.${pathname}`, root).pathname;
  try {
    const stat = await fs.stat(file);
    const type = types[extname(file)] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? Number(match[1]) : 0;
      const end = match && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const NOW = '2026-11-10T12:00:00Z';

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => {
  if (browser) await browser.close();
  server.close();
});

async function openRoom(options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${url}/?now=${encodeURIComponent(NOW)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('preloader'), null, { timeout: 20000 });
  await page.waitForFunction(() => window.KYROlll_ROOM && window.KYROlll_ROOM.ready, null, { timeout: 20000 });
  return { context, page, errors };
}

test('the home route is the room alone, with every release on the shelf', async () => {
  const { context, page, errors } = await openRoom({ viewport: { width: 1440, height: 900 } });
  const home = await page.evaluate(() => ({
    hero: document.querySelectorAll('.brand-hero').length,
    marquee: document.querySelectorAll('.marquee-banner').length,
    catalog: getComputedStyle(document.querySelector('main')).display,
    canvas: !!document.querySelector('[data-room-stage] canvas'),
    support: !!document.querySelector('.room__utilities [data-support-open]'),
    pitch: !!document.querySelector('[data-deck-pitch]'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    roomHeight: Math.round(document.querySelector('[data-room]').getBoundingClientRect().height),
    viewport: window.innerHeight,
    count: document.querySelector('[data-room-count]').textContent,
  }));
  assert.equal(home.hero, 0, 'the legacy hero is not on the home route');
  assert.equal(home.marquee, 0, 'the legacy ticker is not on the home route');
  assert.equal(home.catalog, 'none', 'the legacy catalog grid is not below the room');
  assert.equal(home.canvas, true, 'the WebGL room owns the screen');
  assert.equal(home.support, true, 'the room carries the support link');
  assert.equal(home.pitch, false, 'the deck has no pitch control');
  assert.equal(home.overflow, 0, 'the room never scrolls sideways');
  assert.equal(home.roomHeight, home.viewport, 'the room fills the viewport');
  assert.match(home.count, /08 RELEASES ON THE SHELF/, 'the shelf carries all eight releases');

  await page.evaluate(() => window.KYROlll_ROOM.select(0));
  await page.waitForFunction(() => !document.querySelector('[data-room-card]').hidden);
  await page.waitForFunction(() => window.KYROlll_ROOM.stats().peeled, null, { timeout: 6000 });
  const card = await page.evaluate(() => ({
    kicker: document.querySelector('[data-card-kicker]').textContent,
    status: document.querySelector('[data-card-status]').textContent,
  }));
  assert.match(card.kicker, /LATEST DROP — UNSEALED/, 'the seal opens when the record is chosen');
  assert.equal(card.status, '', 'the sealed note clears once the tear is done');
  for (const failure of errors) assert.fail(`page error: ${failure}`);
  await context.close();
});

test('the seal can be scrubbed open with a pointer drag', async () => {
  const { context, page } = await openRoom({ viewport: { width: 1440, height: 900 } });
  const point = await page.evaluate(() => {
    window.KYROlll_ROOM.select(0);
    return window.KYROlll_ROOM.screenPoint(0);
  });
  const before = await page.evaluate(() => window.KYROlll_ROOM.stats().wrapT);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y + 60, { steps: 4 });
  const during = await page.evaluate(() => window.KYROlll_ROOM.stats().wrapT);
  await page.mouse.up();
  assert(during > before, 'dragging the film advances the tear');
  await page.waitForFunction(() => window.KYROlll_ROOM.stats().peeled, null, { timeout: 6000 });
  await context.close();
});

test('the package drawer slides in with the tiers and the store links', async () => {
  const { context, page } = await openRoom({ viewport: { width: 1440, height: 900 } });
  await page.evaluate(() => window.KYROlll_ROOM.select(0));
  await page.waitForFunction(() => !document.querySelector('[data-room-card]').hidden);
  await page.locator('[data-room-download]').click();
  await page.waitForFunction(() => {
    const tray = document.querySelector('[data-room-tray]');
    return tray && !tray.hidden && tray.classList.contains('is-open');
  });
  await page.waitForTimeout(700);
  const drawer = await page.evaluate(() => {
    const tray = document.querySelector('[data-room-tray]');
    const rect = tray.getBoundingClientRect();
    return {
      tiers: tray.querySelectorAll('[data-room-pack]').length,
      links: Array.from(tray.querySelectorAll('.room-tray__links a, .room-tray__links button')).map((el) => el.textContent.trim()),
      right: Math.round(rect.right),
      scrim: !document.querySelector('[data-room-scrim]').hidden,
    };
  });
  assert.equal(drawer.tiers, 3, 'MP3, WAV and the exclusive tier are offered');
  assert.deepEqual(drawer.links, ['SUPPORT', 'YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'X'], 'the drawer carries the desk and profiles');
  assert.equal(drawer.right, 1440, 'the drawer is fully on screen');
  assert.equal(drawer.scrim, true, 'the room behind the drawer is dimmed');
  await page.locator('[data-room-tray-close]').first().click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-room-tray]').isHidden(), true, 'CLOSE slides the drawer away');
  await context.close();
});

test('the deck plays the preview with no pitch control', async () => {
  const { context, page } = await openRoom({ viewport: { width: 1440, height: 900 } });
  await page.evaluate(() => window.KYROlll_ROOM.select(0));
  await page.waitForFunction(() => !document.querySelector('[data-room-card]').hidden);
  await page.locator('[data-room-listen]').click();
  await page.waitForFunction(() => window.KYROlll_ROOM.stats().listening);
  await page.waitForFunction(() => window.KYROlll_ROOM.stats().playing, null, { timeout: 10000 });
  await page.waitForFunction(
    () => /\d+:\d\d \/ \d+:\d\d/.test(document.querySelector('[data-deck-time]').textContent),
    null,
    { timeout: 10000 }
  );
  const deck = await page.evaluate(() => ({
    visible: !document.querySelector('[data-room-deck]').hidden,
    packs: document.querySelectorAll('[data-deck-packs] [data-room-pack]').length,
    pitch: !!document.querySelector('[data-deck-pitch]'),
    time: document.querySelector('[data-deck-time]').textContent,
  }));
  assert.equal(deck.visible, true, 'the deck strip is on screen');
  assert.equal(deck.packs, 3, 'the chassis carries the three package buttons');
  assert.equal(deck.pitch, false, 'no pitch fader exists');
  assert.match(deck.time, /^\d+:\d\d \/ \d+:\d\d$/, 'the deck reports its timeline');
  await page.evaluate(() => window.KYROlll_ROOM.eject());
  await page.waitForFunction(() => !window.KYROlll_ROOM.stats().listening);
  await context.close();
});

test('a phone fits the room and its drawer with no sideways scroll', async () => {
  const { context, page } = await openRoom({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.evaluate(() => window.KYROlll_ROOM.select(0));
  await page.waitForFunction(() => !document.querySelector('[data-room-card]').hidden);
  await page.waitForTimeout(1800);
  const card = await page.evaluate(() => {
    const rect = document.querySelector('[data-room-card]').getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, room: document.querySelector('[data-room]').getBoundingClientRect().bottom };
  });
  assert(card.top >= 0 && card.bottom <= card.room, 'the selected card stays inside the room');
  await page.locator('[data-room-download]').click();
  await page.waitForTimeout(700);
  const drawer = await page.evaluate(() => {
    const rect = document.querySelector('[data-room-tray]').getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  assert(drawer.left <= 8, 'the phone drawer spans the content width');
  assert.equal(drawer.right, 390, 'the phone drawer reaches the right edge');
  assert.equal(drawer.overflow, 0, 'the room never scrolls sideways on a phone');
  await context.close();
});
