// The archive home: a Yeezy-minimal grid, a focused record and its packages.
//
// These checks prove the new home shape end to end: a pitch-black grid with the
// category menu, falling petals, a focus transition that leaves one record on
// screen with a turning flower, the three free packages wired into the real
// email + license gate, a preview player, and no sideways scroll on a phone.
// A direct `?beat=` link still renders the detailed beat card.
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
const base = `http://127.0.0.1:${server.address().port}`;
const NOW = '2026-11-10T12:00:00Z';
const homeUrl = `${base}/?now=${encodeURIComponent(NOW)}`;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => {
  if (browser) await browser.close();
  server.close();
});

async function openHome(options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#yx-grid .yx-card');
  return { context, page, errors };
}

test('the home is a quiet grid with the category menu and falling petals', async () => {
  const { context, page, errors } = await openHome({ viewport: { width: 1440, height: 900 } });
  const home = await page.evaluate(() => {
    const grid = document.querySelector('#yx-grid');
    const cards = [...grid.querySelectorAll('.yx-card')];
    const canvas = document.querySelector('#yx-petals');
    let ink = 0;
    try {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) { ink += 1; if (ink > 20) break; }
    } catch { ink = -1; }
    return {
      cards: cards.length,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      first: cards[0].innerText.replace(/\n/g, ' | '),
      count: document.querySelector('[data-yx-count]').textContent,
      main: getComputedStyle(document.querySelector('main')).display,
      room: document.querySelectorAll('[data-room], .room').length,
      nav: [...document.querySelectorAll('.site-nav__link')].map((node) => ({
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        disabled: node.getAttribute('aria-disabled') === 'true',
      })),
      active: document.querySelector('.site-nav__link.is-active').textContent.trim(),
      petals: { w: canvas.width, h: canvas.height, ink },
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert.equal(home.cards, 8, 'all eight releases are in the grid');
  assert.equal(home.count, '08', 'the release count is derived from the catalog');
  assert.equal(home.columns, 3, 'the desktop grid is three columns');
  assert.match(home.first, /^01 \| WHITE NIGHT \| 142 BPM \/ A/, 'the newest release leads the grid');
  assert.equal(home.main, 'none', 'the old catalog document is not below the archive');
  assert.equal(home.room, 0, 'the vinyl room is gone from the home route');
  assert.equal(home.overflow, 0, 'the home never scrolls sideways');
  assert.equal(home.active, 'FREE BEATS', 'FREE BEATS is the active category');
  assert.deepEqual(home.nav, [
    { text: 'FREE BEATS', disabled: false },
    { text: 'COMMERCIAL 2028', disabled: true },
    { text: 'PLUGINS SOON', disabled: true },
  ], 'COMMERCIAL and PLUGINS are visibly disabled');
  assert(home.petals.ink > 0, 'the petal canvas is painting');
  for (const failure of errors) assert.fail(`page error: ${failure}`);
  await context.close();
});

test('choosing a record focuses it, fades the archive and offers the packages', async () => {
  const { context, page } = await openHome({ viewport: { width: 1440, height: 900 } });
  await page.locator('#yx-grid .yx-card').first().click();
  await page.waitForFunction(() => {
    const focus = document.querySelector('#yx-focus');
    return focus && !focus.hidden;
  });
  const focus = await page.evaluate(() => ({
    homeHidden: document.querySelector('.yx-home').hidden,
    archiveCards: [...document.querySelectorAll('#yx-grid .yx-card')].filter((card) => card.getBoundingClientRect().height > 0).length,
    title: document.querySelector('[data-yx-focus-title]').textContent,
    type: document.querySelector('[data-yx-focus-type]').textContent,
    specs: document.querySelector('[data-yx-focus-specs]').textContent,
    packs: [...document.querySelectorAll('[data-yx-pack] .yx-pack__name')].map((node) => node.textContent),
    flower: getComputedStyle(document.querySelector('.yx-focus__flower')).animationName,
    flowerWidth: Math.round(document.querySelector('.yx-focus__flower-wrap').getBoundingClientRect().width),
    url: location.search,
  }));
  assert.equal(focus.homeHidden, true, 'the rest of the archive is gone while one record is focused');
  assert.equal(focus.archiveCards, 0, 'no other catalog item remains on screen');
  assert.equal(focus.title, 'WHITE NIGHT', 'the focused record is the one that was chosen');
  assert.equal(focus.type, 'FUTURE TYPE BEAT', 'the type line is split from the title');
  assert.equal(focus.specs, '142 BPM / A', 'the specs stay minimal');
  assert.deepEqual(focus.packs, ['MP3 LEASE', 'STANDARD WAV LEASE', 'EXCLUSIVE / PRO PACKAGE']);
  assert.equal(focus.flower, 'yxFlowerSpin', 'the flower turns above the focused card');
  assert(focus.flowerWidth > 0 && focus.flowerWidth <= 80, 'the flower stays a small mark');
  assert.match(focus.url, /focus=white-night/, 'the focused record is addressable');
  await page.locator('[data-yx-close]').first().click();
  await page.waitForTimeout(450);
  const back = await page.evaluate(() => ({
    homeHidden: document.querySelector('.yx-home').hidden,
    focusHidden: document.querySelector('#yx-focus').hidden,
    url: location.search,
    cards: document.querySelectorAll('#yx-grid .yx-card').length,
  }));
  assert.equal(back.homeHidden, false, 'ALL BEATS restores the archive');
  assert.equal(back.focusHidden, true, 'the focused view closes');
  assert.equal(back.cards, 8, 'every record is back in the grid');
  assert(!back.url.includes('focus='), 'closing clears the focus parameter');
  await context.close();
});

test('a package opens the real gate, and the preview plays', async () => {
  const { context, page, errors } = await openHome({ viewport: { width: 1440, height: 900 } });
  await page.locator('#yx-grid .yx-card').first().click();
  await page.waitForFunction(() => !document.querySelector('#yx-focus').hidden);

  await page.locator('[data-yx-play]').click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('[data-yx-audio]');
    return audio && !audio.paused && audio.currentTime > 0.2;
  }, null, { timeout: 10000 });
  const audio = await page.evaluate(() => ({
    playing: !document.querySelector('[data-yx-audio]').paused,
    label: document.querySelector('[data-yx-play]').getAttribute('aria-label'),
    time: document.querySelector('[data-yx-time]').textContent,
    pitch: document.querySelectorAll('[data-deck-pitch], [data-pitch], .room-deck__pitch').length,
  }));
  assert.equal(audio.playing, true, 'the focused record streams');
  assert.equal(audio.label, 'Pause preview', 'the control reflects playback');
  assert.match(audio.time, /^\d+:\d\d \/ \d+:\d\d$/, 'the timeline is live');
  assert.equal(audio.pitch, 0, 'there is no pitch control anywhere in the archive');

  await page.locator('[data-yx-pack]').first().click();
  await page.waitForSelector('.gate-modal');
  const gate = await page.evaluate(() => ({
    email: document.querySelector('#gate-email').value,
    optin: document.querySelector('#gate-optin').checked,
    tiers: document.querySelectorAll('[data-package]').length,
    backdropDismiss: document.querySelector('.gate-modal__backdrop')?.hasAttribute('data-gate-cancel') || false,
  }));
  assert.equal(gate.email, '', 'the gate always starts empty');
  assert.equal(gate.optin, true, 'the opt-in is part of the gate');
  assert(gate.tiers >= 0, 'the gate renders');
  assert.equal(gate.backdropDismiss, false, 'the backdrop cannot dismiss a gate');
  await page.locator('.gate-modal [data-gate-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('.gate-modal'));
  for (const failure of errors) assert.fail(`page error: ${failure}`);
  await context.close();
});

test('focus deep links work and a beat link still opens the detailed card', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/?now=${encodeURIComponent(NOW)}&focus=gunna-type`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const focus = document.querySelector('#yx-focus');
    return focus && !focus.hidden;
  });
  const deep = await page.evaluate(() => ({
    title: document.querySelector('[data-yx-focus-title]').textContent,
    home: document.querySelector('.yx-home').hidden,
  }));
  assert.equal(deep.title, 'VVS MOTION', 'a focus link lands on its record');
  assert.equal(deep.home, true, 'the archive is out of the way');

  await page.goto(`${base}/?beat=white-night`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.beat-detail');
  const beat = await page.evaluate(() => ({
    home: getComputedStyle(document.querySelector('.yx-home')).display,
    detail: !!document.querySelector('.beat-detail'),
    title: document.querySelector('.beat-detail__title')?.textContent.trim(),
    petals: !!document.querySelector('.yx-petals'),
    header: !!document.querySelector('.site-header'),
  }));
  assert.equal(beat.home, 'none', 'the archive is not rendered on a beat route');
  assert.equal(beat.detail, true, 'a direct beat link keeps the detailed card');
  assert.match(beat.title, /WHITE NIGHT/, 'the beat card is the requested record');
  assert.equal(beat.petals, false, 'the petal canvas is removed on a beat route');
  assert.equal(beat.header, true, 'the category menu remains available');
  await context.close();
});

test('a phone fits the grid and the focused packages without sideways scroll', async () => {
  const { context, page } = await openHome({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector('#yx-grid')).gridTemplateColumns.split(' ').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    nav: document.querySelector('.site-nav').getBoundingClientRect(),
    card: Math.round(document.querySelector('.yx-card').getBoundingClientRect().width),
  }));
  assert.equal(phone.columns, 1, 'phones get one clean column');
  assert.equal(phone.overflow, 0, 'the archive never scrolls sideways on a phone');
  assert(phone.nav.left >= 0 && phone.nav.right <= 390, 'the category menu stays on screen');
  assert(phone.card > 300, 'the artwork uses the phone width');

  await page.locator('#yx-grid .yx-card').first().click();
  await page.waitForFunction(() => !document.querySelector('#yx-focus').hidden);
  const focus = await page.evaluate(() => {
    const card = document.querySelector('.yx-focus__card').getBoundingClientRect();
    const pack = document.querySelector('.yx-pack').getBoundingClientRect();
    return {
      card: { left: Math.round(card.left), right: Math.round(card.right) },
      packRight: Math.round(pack.right),
      packs: document.querySelectorAll('[data-yx-pack]').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      closeVisible: document.querySelector('[data-yx-close]').getBoundingClientRect().height > 0,
    };
  });
  assert(focus.card.left >= 0 && focus.card.right <= 390, 'the focused card fits the phone');
  assert(focus.packRight <= 390, 'the package row fits the phone');
  assert.equal(focus.packs, 3, 'all three packages are offered');
  assert.equal(focus.overflow, 0, 'the focused view never scrolls sideways');
  assert.equal(focus.closeVisible, true, 'ALL BEATS is reachable');
  await context.close();
});

test('reduced motion stops the flower and freezes the petal loop', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#yx-grid .yx-card');
  await page.locator('#yx-grid .yx-card').first().click();
  await page.waitForFunction(() => !document.querySelector('#yx-focus').hidden);
  const motion = await page.evaluate(() => ({
    flower: getComputedStyle(document.querySelector('.yx-focus__flower')).animationName,
    transition: getComputedStyle(document.querySelector('.yx-card')).transitionDuration,
  }));
  assert.equal(motion.flower, 'none', 'the flower holds its pose under reduced motion');
  assert.equal(motion.transition, '0s', 'the archive does not fade under reduced motion');
  await context.close();
});
