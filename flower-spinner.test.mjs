// Browser checks for the branded flower loading indicator.
//
// The store answers every wait with the official KYROIII flower: a beat's cover
// art and its audio preview both report "loading" by turning the same flower the
// hero shows. These tests hold an image and an audio file mid-fetch, prove the
// indicator is present and turning, then release the file and prove it steps
// aside cleanly. The heavy 3D bundles are stubbed (the indicator is independent
// of WebGL), which also keeps the checks fast and deterministic.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const rootPath = fileURLToPath(root);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = new URL(pathname === '/' ? 'index.html' : `.${pathname}`, root);
  const type = types[extname(file.pathname)] || 'application/octet-stream';
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
after(async () => {
  await browser.close();
  server.close();
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const errors = [];
async function newPage(options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  // The indicator does not need the WebGL flower or the falling-X canvas; an
  // empty module is a valid stub and keeps the run quick.
  for (const bundle of ['brand-logo.min.js', 'background-x.min.js']) {
    await page.route(`**/assets/${bundle}*`, (route) =>
      route.fulfill({ contentType: 'text/javascript', body: '' }));
  }
  return { context, page };
}

// The veil is irrelevant to a loading indicator; lift it as soon as the markup
// is parsed so the card and its spinner are observable without waiting on the
// (stubbed) flower's hard cap.
async function open(page, path = '/') {
  await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.getElementById('preloader')?.remove());
}

async function readArtLoading(art) {
  return art.evaluate((el) => {
    const img = el.querySelector('img');
    const flower = el.querySelector('.flower-spinner__flower');
    const style = flower ? getComputedStyle(flower) : null;
    return {
      loading: el.classList.contains('is-loading'),
      busy: el.getAttribute('aria-busy'),
      spinner: !!el.querySelector('.flower-spinner'),
      imgOpacity: img ? Number(getComputedStyle(img).opacity) : null,
      animation: style ? style.animationName : null,
      duration: style ? style.animationDuration : null,
      background: style ? style.backgroundImage : null,
    };
  });
}

test('a beat cover turns the branded flower while its artwork loads', async () => {
  const { context, page } = await newPage();
  const gate = deferred();
  await page.route('**/assets/beat-cover.png*', async (route) => {
    await gate.promise;
    await route.fulfill({ path: join(rootPath, 'assets/beat-cover.png'), contentType: 'image/png' });
  });

  await open(page, '/?beat=gunna-type');
  const art = page.locator('.beat-detail__artwork').first();
  await art.waitFor();
  await page.waitForFunction(() => document.querySelector('.beat-detail__artwork')?.classList.contains('is-loading'));
  await page.waitForTimeout(450); // let the cover fade behind the indicator

  const loading = await readArtLoading(art);
  assert.equal(loading.loading, true, 'the cover container reports its loading state');
  assert.equal(loading.busy, 'true', 'the container is marked busy to assistive tech');
  assert.equal(loading.spinner, true, 'the branded indicator is mounted on the cover');
  assert.equal(loading.imgOpacity, 0, 'the not-yet-painted cover stays hidden beneath the flower');
  assert.equal(loading.animation, 'flowerSpinnerTurn', 'the flower turns in three dimensions');
  assert.equal(loading.duration, '3s', 'the turn rides the shared 3s indicator clock');
  assert.match(loading.background, /kyrolll-flower-rest\.png/, 'the indicator is the official flower render');

  gate.resolve();
  await page.waitForFunction(() => document.querySelector('.beat-detail__artwork')?.classList.contains('is-loaded'));
  await page.waitForFunction(() => !document.querySelector('.beat-detail__artwork .flower-spinner'));
  const settled = await readArtLoading(art);
  assert.equal(settled.loading, false, 'the loading state clears when the cover arrives');
  assert.equal(settled.spinner, false, 'a settled card carries no idle animation');
  assert.equal(settled.imgOpacity, 1, 'the cover is fully painted');
  await context.close();
});

test('an audio preview turns the branded flower while it buffers', async () => {
  const { context, page } = await newPage();
  const gate = deferred();
  await page.route('**/assets/previews/the-flow.mp3*', async (route) => {
    await gate.promise;
    await route.fulfill({ path: join(rootPath, 'assets/previews/the-flow.mp3'), contentType: 'audio/mpeg' });
  });

  await open(page, '/?beat=the-flow');
  const player = page.locator('.beat-preview').first();
  await player.waitFor();
  await player.locator('.beat-preview__toggle').click();
  await page.waitForFunction(() => document.querySelector('.beat-preview')?.dataset.state === 'loading');
  await page.waitForTimeout(300); // the glyph→flower swap fades in over .18s

  const loading = await player.evaluate((el) => {
    const button = el.querySelector('.beat-preview__toggle');
    const glyph = button.querySelector('svg');
    const spinner = getComputedStyle(button, '::after');
    return {
      state: el.dataset.state,
      status: el.querySelector('.beat-preview__status').textContent,
      glyphOpacity: Number(getComputedStyle(glyph).opacity),
      spinnerOpacity: Number(spinner.opacity),
      spinnerVisibility: spinner.visibility,
      spinnerAnimation: spinner.animationName,
      spinnerBackground: spinner.backgroundImage,
    };
  });
  assert.equal(loading.state, 'loading', 'the player reports that it is loading');
  assert.match(loading.status, /LOADING PREVIEW/, 'the status line names the wait');
  assert.equal(loading.glyphOpacity, 0, 'the play glyph steps aside for the indicator');
  assert.equal(loading.spinnerOpacity, 1, 'the flower is visible in the control');
  assert.equal(loading.spinnerVisibility, 'visible', 'the flower is not merely transparent');
  assert.equal(loading.spinnerAnimation, 'flowerSpinnerTurn', 'the flower turns while buffering');
  assert.match(loading.spinnerBackground, /kyrolll-flower-rest\.png/, 'the audio indicator is the official flower');

  gate.resolve();
  await page.waitForFunction(() => document.querySelector('.beat-preview')?.dataset.state === 'playing', null, { timeout: 15000 });
  const playing = await player.evaluate((el) => {
    const button = el.querySelector('.beat-preview__toggle');
    return {
      glyphOpacity: Number(getComputedStyle(button.querySelector('svg')).opacity),
      spinnerVisibility: getComputedStyle(button, '::after').visibility,
    };
  });
  assert.equal(playing.glyphOpacity, 1, 'the pause glyph returns once playback starts');
  assert.equal(playing.spinnerVisibility, 'hidden', 'the indicator leaves the control');
  await player.locator('.beat-preview__toggle').click();
  await context.close();
});

test('reduced motion freezes the indicator instead of spinning it', async () => {
  const { context, page } = await newPage({ reducedMotion: 'reduce' });
  const gate = deferred();
  await page.route('**/assets/beat-cover.png*', async (route) => {
    await gate.promise;
    await route.fulfill({ path: join(rootPath, 'assets/beat-cover.png'), contentType: 'image/png' });
  });

  await open(page, '/?beat=gunna-type');
  await page.waitForFunction(() => document.querySelector('.beat-detail__artwork')?.classList.contains('is-loading'));
  const animation = await page.locator('.beat-detail__artwork').first()
    .locator('.flower-spinner__flower').evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(animation, 'none', 'the flower holds its resting pose under reduced motion');
  gate.resolve();
  await context.close();
});

test('the spinner contract is wired into the storefront and its stylesheet', async () => {
  const read = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');
  const [html, script, css, helper] = await Promise.all([
    read('index.html'), read('script.js'), read('style.css'), read('flower-spinner.js'),
  ]);
  assert.match(html, /<script src="flower-spinner\.js\?v=\d+"><\/script>/, 'the storefront loads the indicator');
  assert.match(script, /KYROlll_FLOWER_SPINNER.*watch\(grid\)/s, 'every grid render hands its new images to the indicator');
  assert.match(helper, /\.catalog-tile__art, \.beat-detail__artwork/, 'the beat cover containers are watched');
  assert.match(helper, /document\.addEventListener\("load", \(event\) => settle\(event, false\), true\)/, 'image load is caught in the capture phase');
  assert.match(helper, /document\.addEventListener\("error", \(event\) => settle\(event, true\), true\)/, 'a failed image clears the wait');
  assert.match(css, /@keyframes flowerSpinnerTurn/, 'the 3D turn is a shared keyframe');
  assert.match(css, /\.beat-preview\[data-state="loading"\] \.beat-preview__toggle::after/, 'the audio control wears the same indicator');
  assert.match(css, /\.motion-paused \.flower-spinner__flower/, 'the page motion toggle freezes the indicator too');
  for (const failure of errors) assert.fail(`page error: ${failure}`);
});
