// The archive home: a Yeezy-minimal grid, a focused record and its packages.
//
// These checks prove the home shape end to end: a solid pitch-black page with
// a compact grid and the category menu, a fixed spinning flower in the header,
// an in-place zoom focus sheet carrying the preview player and the three free
// packages wired into the real email + license gate, and no sideways scroll on
// a phone. A direct `?beat=` link still renders the detailed beat card.
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
  const { art = false, ...contextOptions } = options;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (art) {
    // The shipped register is empty on purpose (no artwork until the first
    // official upload). Register one piece for this check so the gallery, the
    // live nav link and the collector focus zoom are exercised end to end.
    await page.route('**/catalog.js*', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const body = source.replace(
        'window.KYROlll_ARTWORKS = [];',
        'window.KYROlll_ARTWORKS = [{ id: "pink-study-01", title: "PINK STUDY 01", beatId: "white-night", year: 2026, src: "assets/artwork/pink-study-01.svg", medium: "INK & MARKER ON PAPER" }];'
      );
      assert.notEqual(body, source, 'the test can register an artwork in the catalog');
      await route.fulfill({ response, body });
    });
  }
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#yx-grid .yx-card');
  return { context, page, errors };
}

test('the home is a solid black compact grid with the category menu', async () => {
  const { context, page, errors } = await openHome({ viewport: { width: 1440, height: 900 } });
  const home = await page.evaluate(() => {
    const grid = document.querySelector('#yx-grid');
    const cards = [...grid.querySelectorAll('.yx-card')];
    const flower = document.querySelector('.site-header__flower img');
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
      canvas: document.querySelectorAll('canvas').length,
      flower: flower && {
        animation: getComputedStyle(flower).animationName,
        box: flower.parentElement.getBoundingClientRect(),
        src: flower.getAttribute('src'),
      },
      bg: getComputedStyle(document.body).backgroundColor,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert.equal(home.cards, 8, 'all eight releases are in the grid');
  assert.equal(home.count, '08', 'the release count is derived from the catalog');
  assert.equal(home.columns, 4, 'the desktop grid is four compact columns');
  assert.equal(home.canvas, 0, 'the falling-petal canvas is gone');
  assert.equal(home.bg, 'rgb(0, 0, 0)', 'the page sits on solid pitch black');
  assert.match(home.first, /^01 \| WHITE NIGHT \| 142 BPM \/ A/, 'the newest release leads the grid');
  assert.equal(home.main, 'none', 'the old catalog document is not below the archive');
  assert.equal(home.room, 0, 'the vinyl room is gone from the home route');
  assert.equal(home.overflow, 0, 'the home never scrolls sideways');
  assert.equal(home.active, 'FREE BEATS', 'FREE BEATS is the active category');
  assert.deepEqual(home.nav, [
    { text: 'FREE BEATS', disabled: false },
    { text: 'ARTWORK 2028', disabled: true },
    { text: 'APPAREL 2030', disabled: true },
  ], 'free beats are the only live category; artwork awaits its first drop and apparel is 2030');

  // With no registered artwork the collection is absent, not an empty shell.
  const locked = await page.evaluate(() => ({
    galleryHidden: document.querySelector('#yx-artwork').hidden,
    cards: document.querySelectorAll('#yx-art-grid .yx-art-card').length,
    artDisabled: document.querySelector('[data-yx-nav-art]').getAttribute('aria-disabled'),
    artBadge: document.querySelector('[data-yx-nav-art]').textContent.replace(/\s+/g, ' ').trim(),
  }));
  assert.equal(locked.galleryHidden, true, 'the artwork view stays hidden until the first drop');
  assert.equal(locked.cards, 0, 'no artwork card and no placeholder is rendered');
  assert.equal(locked.artDisabled, 'true', 'the artwork link is locked');
  assert.equal(locked.artBadge, 'ARTWORK 2028', 'the lock wears the 2028 badge');

  // A locked link is inert even to a forced click (Playwright itself refuses it).
  await page.evaluate(() => document.querySelector('[data-yx-nav-art]').click());
  await page.waitForTimeout(120);
  const afterLockedClick = await page.evaluate(() => ({
    url: location.search,
    active: document.querySelector('.site-nav__link.is-active').textContent.trim(),
    beatsVisible: !document.querySelector('#catalog').hidden,
  }));
  assert(!/view=artwork/.test(afterLockedClick.url), 'a locked artwork link does not navigate');
  assert.equal(afterLockedClick.active, 'FREE BEATS', 'the archive stays the active category');
  assert.equal(afterLockedClick.beatsVisible, true, 'the archive stays on screen');
  assert.match(home.flower.src, /kyrolll-flower-rest\.png/, 'the header wears the flower mark');
  assert(home.flower.box.right > 1300, 'the flower sits in the top-right corner');
  assert(home.flower.box.width <= 26, 'the header flower stays a small mark');
  assert.equal(home.flower.animation, 'yxFlowerSpin', 'the header flower turns');

  // The bar is locked to the viewport: it stays whole and on top while the archive scrolls.
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(120);
  const pinned = await page.evaluate(() => {
    const header = document.querySelector('.site-header');
    const box = header.getBoundingClientRect();
    const flower = document.querySelector('.site-header__flower').getBoundingClientRect();
    const brand = document.querySelector('.site-brand').getBoundingClientRect();
    return {
      scrollY: Math.round(scrollY),
      position: getComputedStyle(header).position,
      top: Math.round(box.top),
      height: Math.round(box.height),
      flowerRight: Math.round(innerWidth - flower.right),
      flowerTop: Math.round(flower.top),
      brandTop: Math.round(brand.top),
      z: Number(getComputedStyle(header).zIndex),
    };
  });
  assert(pinned.scrollY > 300, 'the archive really scrolled under the bar');
  assert.equal(pinned.position, 'sticky', 'the header is a sticky bar, not a scrolled row');
  assert.equal(pinned.top, 0, 'the header stays locked to the viewport top');
  assert(pinned.height >= 60, 'the whole bar stays on screen, not a sliver');
  assert(pinned.flowerRight >= 0 && pinned.flowerRight <= 56, 'the flower stays pinned in the top-right corner');
  assert(pinned.flowerTop >= 0 && pinned.flowerTop < pinned.height, 'the flower stays inside the bar');
  assert(pinned.brandTop >= 0 && pinned.brandTop < pinned.height, 'the wordmark stays inside the bar');
  assert(pinned.z >= 50, 'the bar paints above the archive');

  for (const failure of errors) assert.fail(`page error: ${failure}`);
  await context.close();
});

test('choosing a record zooms it open in place and offers the packages', async () => {
  const { context, page } = await openHome({ viewport: { width: 1440, height: 900 } });
  await page.evaluate(() => window.scrollTo(0, 200));
  const archive = await page.evaluate(() => {
    const media = [...document.querySelectorAll('#yx-grid .yx-card__media')].map((node) => {
      const rect = node.getBoundingClientRect();
      return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width)];
    });
    return { scrollY: Math.round(scrollY), media, cards: document.querySelectorAll('#yx-grid .yx-card').length };
  });
  const cover = await page.locator('#yx-grid .yx-card__media').first().boundingBox();
  await page.locator('#yx-grid .yx-card').first().click();
  await page.waitForFunction(() => {
    const focus = document.querySelector('#yx-focus');
    return focus && !focus.hidden;
  });
  const focus = await page.evaluate(() => {
    const sheet = document.querySelector('#yx-focus');
    const art = document.querySelector('.yx-focus__art');
    return {
      homeHidden: document.querySelector('.yx-home').classList.contains('is-behind'),
      homeVisibility: getComputedStyle(document.querySelector('.yx-home')).visibility,
      title: document.querySelector('[data-yx-focus-title]').textContent,
      type: document.querySelector('[data-yx-focus-type]').textContent,
      specs: document.querySelector('[data-yx-focus-specs]').textContent,
      packs: [...document.querySelectorAll('[data-yx-pack] .yx-pack__name')].map((node) => node.textContent),
      flower: document.querySelectorAll('.yx-focus__flower, .yx-focus__flower-wrap').length,
      sheet: { position: getComputedStyle(sheet).position, top: Math.round(sheet.getBoundingClientRect().top) },
      zooming: sheet.classList.contains('is-zooming'),
      artTransition: getComputedStyle(art).transitionProperty,
      artBox: Math.round(art.getBoundingClientRect().width),
      url: location.search,
    };
  });
  assert.equal(focus.homeHidden, true, 'the archive is out of the way while one record is focused');
  assert.equal(focus.homeVisibility, 'hidden', 'the archive is unseen but keeps its place in the page');
  assert.equal(focus.title, 'WHITE NIGHT', 'the focused record is the one that was chosen');
  assert.equal(focus.type, 'FUTURE TYPE BEAT', 'the type line is split from the title');
  assert.equal(focus.specs, '142 BPM / A', 'the specs stay minimal');
  assert.deepEqual(focus.packs, ['MP3 LEASE', 'STANDARD WAV LEASE', 'EXCLUSIVE / PRO PACKAGE']);
  assert.equal(focus.flower, 0, 'the focus view carries no extra flower');
  assert.equal(focus.sheet.position, 'fixed', 'the focused record is an in-place sheet, not a page');
  assert(focus.sheet.top > 0, 'the sheet starts under the sticky header');
  assert.equal(focus.zooming, true, 'the cover arrives by zooming from the chosen tile');
  assert.match(focus.artTransition, /transform/, 'the cover owns the zoom transition');
  assert(focus.artBox > cover.width, 'the focused cover is larger than the grid tile');
  assert.match(focus.url, /focus=white-night/, 'the focused record is addressable');
  await page.locator('[data-yx-close]').first().click();
  await page.waitForTimeout(60);
  const flight = await page.evaluate(() => {
    const ghost = document.querySelector('.yx-ghost');
    const sheet = document.querySelector('#yx-focus');
    const box = ghost && ghost.getBoundingClientRect();
    const header = document.querySelector('.site-header').getBoundingClientRect();
    return {
      ghost: Boolean(ghost) && Boolean(ghost.querySelector('img')),
      cover: ghost && ghost.querySelector('img').getAttribute('src'),
      box: box && [Math.round(box.width), Math.round(box.height)],
      homeHidden: document.querySelector('.yx-home').classList.contains('is-behind'),
      homeVisibility: getComputedStyle(document.querySelector('.yx-home')).visibility,
      leaving: sheet.classList.contains('is-leaving'),
      sheetFading: Number(getComputedStyle(sheet).opacity) < 1,
      scrollY: Math.round(scrollY),
      headerTop: Math.round(header.top),
    };
  });
  assert.equal(flight.ghost, true, 'closing flies a real cover home instead of cutting');
  assert.match(flight.cover, /white-night/i, 'the flying cover is the focused record\'s art');
  assert.equal(flight.homeHidden, false, 'the archive is back in sight for the landing');
  assert.equal(flight.homeVisibility, 'visible', 'the landing tile is already in its grid slot');
  assert.equal(flight.leaving, true, 'the sheet dissolves under the flying cover');
  assert.equal(flight.sheetFading, true, 'the sheet is already fading, not blinking away');
  assert.equal(flight.scrollY, archive.scrollY, 'closing never rescrolls the archive');
  assert.equal(flight.headerTop, 0, 'the header stays locked during the close transition');

  await page.waitForFunction(() => document.querySelector('#yx-focus').hidden);
  await page.waitForFunction(() => !document.querySelector('.yx-ghost'));
  const back = await page.evaluate(() => ({
    homeHidden: document.querySelector('.yx-home').classList.contains('is-behind'),
    url: location.search,
    cards: document.querySelectorAll('#yx-grid .yx-card').length,
    scrollY: Math.round(scrollY),
    media: [...document.querySelectorAll('#yx-grid .yx-card__media')].map((node) => {
      const rect = node.getBoundingClientRect();
      return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width)];
    }),
    focused: document.activeElement && document.activeElement.classList.contains('yx-card'),
  }));
  assert.equal(back.homeHidden, false, 'ALL BEATS restores the archive');
  assert.equal(back.cards, 8, 'every record is back in the grid');
  assert.equal(back.scrollY, archive.scrollY, 'the archive keeps its place after the landing');
  assert.deepEqual(back.media, archive.media, 'no card reflowed or moved during open and close');
  assert.equal(back.focused, true, 'focus returns to the card that was chosen');
  assert(!back.url.includes('focus='), 'closing clears the focus parameter');
  await context.close();
});

test('the artwork collection opens in place as locked collector pieces', async () => {
  const { context, page, errors } = await openHome({ viewport: { width: 1440, height: 900 }, art: true });
  await page.locator('[data-yx-view="artwork"]').click();
  await page.waitForTimeout(150);
  const gallery = await page.evaluate(() => {
    const section = document.querySelector('#yx-artwork');
    const cards = [...section.querySelectorAll('.yx-art-card')];
    return {
      url: location.search,
      active: document.querySelector('.site-nav__link.is-active').textContent.trim(),
      plugins: [...document.querySelectorAll('.site-nav__link')].some((node) => /PLUGINS/.test(node.textContent)),
      homeDisplay: getComputedStyle(document.querySelector('#catalog')).display,
      artDisplay: getComputedStyle(section).display,
      title: document.querySelector('#yx-art-title').textContent,
      cards: cards.length,
      pieces: cards.filter((node) => node.hasAttribute('data-yx-art')).length,
      placeholders: cards.filter((node) => node.classList.contains('is-placeholder')).length,
      columns: getComputedStyle(document.querySelector('#yx-art-grid')).gridTemplateColumns.split(' ').length,
      badge: cards[0].querySelector('.yx-art-card__badge').textContent.replace(/\s+/g, ' ').trim(),
      window: cards[0].querySelector('.yx-art-card__window').textContent,
      covers: cards.map((node) => node.querySelector('.yx-card__media img')?.getAttribute('src') || null),
      beatCards: section.querySelectorAll('[data-yx-beat]').length,
      count: document.querySelector('[data-yx-art-count]').textContent,
      slots: section.querySelector('[data-yx-art-slots]'),
      emptyCopy: /COMING SOON|ORIGINAL ARTWORK DROP|RESERVED/.test(section.innerText),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert.match(gallery.url, /view=artwork/, 'the collection is addressable');
  assert.equal(gallery.active, 'ARTWORK', 'ARTWORK becomes the active category');
  assert.equal(gallery.plugins, false, 'the plugins category is gone from the menu');
  assert.equal(gallery.homeDisplay, 'none', 'the beats grid yields to the collection');
  assert.equal(gallery.artDisplay, 'block', 'the collection is the page, not a new route');
  assert.equal(gallery.title, 'ARTWORK');
  assert.equal(gallery.cards, 1, 'the gallery holds only the drawn pieces');
  assert.equal(gallery.pieces, 1, 'the single registered hand-drawn piece is the whole gallery');
  assert.equal(gallery.placeholders, 0, 'no coming-soon placeholder slots survive');
  assert.equal(gallery.columns, 1, 'a single 1-of-1 is shown as one centred column');
  assert.equal(gallery.badge, 'COLLECTOR — LOCKED', 'the piece is a locked collector item');
  assert.match(gallery.window, /PRINTS · DROPS · APPAREL 2028–2029/, 'the badge names the 2028–2029 window');
  assert.deepEqual(
    gallery.covers,
    ['assets/artwork/pink-study-01.svg'],
    'the collection carries the original drawing and nothing else'
  );
  assert.equal(gallery.beatCards, 0, 'the gallery never borrows a beat card');
  assert.equal(gallery.count, '01');
  assert.equal(gallery.slots, null, 'the reserved-slot counter is gone');
  assert.equal(gallery.emptyCopy, false, 'nothing in the gallery reads coming soon or reserved');
  assert.equal(gallery.overflow, 0, 'the collection never scrolls sideways');

  const before = await page.evaluate(() => ({
    scrollY: Math.round(scrollY),
    media: [...document.querySelectorAll('#yx-art-grid .yx-card__media')].map((node) => {
      const rect = node.getBoundingClientRect();
      return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width)];
    }),
  }));
  const cover = await page.locator('#yx-art-grid [data-yx-art] .yx-card__media').boundingBox();
  await page.locator('#yx-art-grid .yx-art-card').first().click();
  await page.waitForFunction(() => !document.querySelector('#yx-focus').hidden);
  const focus = await page.evaluate(() => {
    const sheet = document.querySelector('#yx-focus');
    return {
      url: location.search,
      title: document.querySelector('[data-yx-focus-title]').textContent,
      type: document.querySelector('[data-yx-focus-type]').textContent,
      specs: document.querySelector('[data-yx-focus-specs]').textContent,
      art: document.querySelector('[data-yx-focus-art]').getAttribute('src'),
      kicker: document.querySelector('[data-yx-focus-kicker]').textContent,
      back: document.querySelector('[data-yx-focus-back]').textContent,
      isArt: sheet.classList.contains('is-art'),
      collector: document.querySelector('[data-yx-collector]'),
      collectorHidden: document.querySelector('[data-yx-collector]').hidden,
      badge: document.querySelector('.yx-collector__badge').textContent.replace(/\s+/g, ' ').trim(),
      note: document.querySelector('.yx-collector__note').textContent,
      rows: [...document.querySelectorAll('.yx-collector__rows div')].map((node) => node.innerText.replace(/\n/g, ' / ')),
      player: getComputedStyle(document.querySelector('.yx-player')).display,
      packs: document.querySelectorAll('[data-yx-pack]').length,
      behind: document.querySelector('#yx-artwork').classList.contains('is-behind'),
      visibility: getComputedStyle(document.querySelector('#yx-artwork')).visibility,
      zooming: sheet.classList.contains('is-zooming'),
      artBox: Math.round(document.querySelector('.yx-focus__art').offsetWidth),
      headerTop: Math.round(document.querySelector('.site-header').getBoundingClientRect().top),
      sheetTop: Math.round(sheet.getBoundingClientRect().top),
    };
  });
  assert.match(focus.url, /artwork=pink-study-01/, 'the piece is addressable without leaving the page');
  assert.equal(focus.title, 'PINK STUDY 01');
  assert.equal(focus.type, 'ORIGINAL HAND-DRAWN COVER — WHITE NIGHT');
  assert.equal(focus.specs, 'ORIGINAL 1 / 1');
  assert.equal(focus.art, 'assets/artwork/pink-study-01.svg', 'the sheet shows the drawing, not the beat cover');
  assert.equal(focus.kicker, 'COLLECTOR PIECE');
  assert.equal(focus.back, 'ALL ARTWORK', 'the return control names the collection');
  assert.equal(focus.isArt, true, 'the same sheet carries the artwork state');
  assert.equal(focus.collectorHidden, false, 'the collector record replaces the player and packages');
  assert.equal(focus.badge, 'COLLECTOR PIECE — LOCKED');
  assert.match(focus.note, /PHYSICAL PRINTS, LIMITED DROPS AND APPAREL INTEGRATION OPEN IN 2028–2029/);
  assert.deepEqual(focus.rows, [
    'EDITION / ORIGINAL 1 / 1',
    'MEDIUM / INK & MARKER ON PAPER',
    'ACCESS / LOCKED — 2028–2029',
  ]);
  assert.equal(focus.player, 'none', 'a locked print offers no preview');
  assert.equal(focus.packs, 0, 'a locked print offers no packages');
  assert.equal(focus.behind, true, 'the collection stays laid out behind the sheet');
  assert.equal(focus.visibility, 'hidden');
  assert.equal(focus.zooming, true, 'the cover zooms from the gallery tile');
  assert(focus.artBox > cover.width, 'the focused artwork is larger than its tile');
  assert.equal(focus.headerTop, 0);
  assert(focus.sheetTop > 0, 'the sheet still docks under the pinned header');

  await page.locator('[data-yx-close]').first().click();
  await page.waitForTimeout(60);
  const flight = await page.evaluate(() => ({
    ghost: Boolean(document.querySelector('.yx-ghost')),
    cover: document.querySelector('.yx-ghost img')?.getAttribute('src'),
    visibility: getComputedStyle(document.querySelector('#yx-artwork')).visibility,
    leaving: document.querySelector('#yx-focus').classList.contains('is-leaving'),
    url: location.search,
  }));
  assert.equal(flight.ghost, true, 'closing flies the artwork home instead of cutting');
  assert.match(flight.cover, /assets\/artwork\/pink-study-01\.svg/);
  assert.equal(flight.visibility, 'visible', 'the collection is already back in place for the landing');
  assert.equal(flight.leaving, true);
  assert.match(flight.url, /view=artwork/, 'closing returns to the collection, not the beats grid');

  await page.waitForFunction(() => document.querySelector('#yx-focus').hidden);
  await page.waitForFunction(() => !document.querySelector('.yx-ghost'));
  const landed = await page.evaluate(() => ({
    url: location.search,
    active: document.querySelector('.site-nav__link.is-active').textContent.trim(),
    homeDisplay: getComputedStyle(document.querySelector('#catalog')).display,
    artDisplay: getComputedStyle(document.querySelector('#yx-artwork')).display,
    scrollY: Math.round(scrollY),
    media: [...document.querySelectorAll('#yx-art-grid .yx-card__media')].map((node) => {
      const rect = node.getBoundingClientRect();
      return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width)];
    }),
    focusedCard: Boolean(document.activeElement && document.activeElement.classList.contains('yx-art-card')),
  }));
  assert.equal(landed.active, 'ARTWORK', 'the collection stays the active category');
  assert.equal(landed.homeDisplay, 'none', 'the beats grid did not replace the collection');
  assert.equal(landed.artDisplay, 'block');
  assert.equal(landed.scrollY, before.scrollY, 'closing never rescrolls the collection');
  assert.deepEqual(landed.media, before.media, 'no artwork tile reflowed during open and close');
  assert.equal(landed.focusedCard, true, 'focus returns to the chosen piece');
  assert(!/artwork=/.test(landed.url), 'closing clears the focused piece');

  await page.locator('[data-yx-view="beats"]').click();
  await page.waitForTimeout(100);
  const beats = await page.evaluate(() => ({
    url: location.search,
    active: document.querySelector('.site-nav__link.is-active').textContent.trim(),
    cards: document.querySelectorAll('#yx-grid .yx-card').length,
    artHidden: document.querySelector('#yx-artwork').hidden,
  }));
  assert.equal(beats.active, 'FREE BEATS');
  assert.equal(beats.cards, 8);
  assert.equal(beats.artHidden, true);
  assert(!/view=artwork/.test(beats.url), 'the menu switches back to the beats archive');

  for (const failure of errors) assert.fail(`page error: ${failure}`);
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
    home: document.querySelector('.yx-home').classList.contains('is-behind'),
  }));
  assert.equal(deep.title, 'VVS MOTION', 'a focus link lands on its record');
  assert.equal(deep.home, true, 'the archive is out of the way');

  await page.goto(`${base}/?beat=white-night`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.beat-detail');
  const beat = await page.evaluate(() => ({
    home: getComputedStyle(document.querySelector('.yx-home')).display,
    detail: !!document.querySelector('.beat-detail'),
    title: document.querySelector('.beat-detail__title')?.textContent.trim(),
    canvas: document.querySelectorAll('canvas').length,
    header: !!document.querySelector('.site-header'),
    flower: !!document.querySelector('.site-header__flower img'),
  }));
  assert.equal(beat.home, 'none', 'the archive is not rendered on a beat route');
  assert.equal(beat.detail, true, 'a direct beat link keeps the detailed card');
  assert.match(beat.title, /WHITE NIGHT/, 'the beat card is the requested record');
  assert.equal(beat.canvas, 0, 'the falling-petal canvas is gone from every route');
  assert.equal(beat.header, true, 'the category menu remains available');
  assert.equal(beat.flower, true, 'the spinning flower persists across the whole site');
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
  assert.equal(phone.columns, 2, 'phones get two compact columns');
  assert.equal(phone.overflow, 0, 'the archive never scrolls sideways on a phone');
  assert(phone.nav.left >= 0 && phone.nav.right <= 390, 'the category menu stays on screen');
  assert(phone.card > 150 && phone.card < 200, 'the covers stay compact on a phone');

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

test('reduced motion holds the flower and skips the zoom', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#yx-grid .yx-card');
  await page.locator('#yx-grid .yx-card').first().click();
  await page.waitForFunction(() => !document.querySelector('#yx-focus').hidden);
  const motion = await page.evaluate(() => ({
    flower: getComputedStyle(document.querySelector('.site-header__flower img')).animationName,
    zoom: document.querySelector('#yx-focus').classList.contains('is-zooming'),
    artTransition: getComputedStyle(document.querySelector('.yx-focus__art')).transitionDuration,
    transition: getComputedStyle(document.querySelector('.yx-card')).transitionDuration,
  }));
  assert.equal(motion.flower, 'none', 'the flower holds its pose under reduced motion');
  assert.equal(motion.zoom, false, 'the cover does not zoom under reduced motion');
  assert.equal(motion.artTransition, '0s', 'the cover never animates under reduced motion');
  assert.equal(motion.transition, '0s', 'the archive does not fade under reduced motion');
  await context.close();
});
