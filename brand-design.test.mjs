// Browser integration checks for the updated KYROlll store (BeatStars transactions).
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

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
async function setupPage(options = {}) {
  const page = await browser.newPage(options);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), target = new URL(req.url());
    if (target.origin === url) return route.continue();
    if (target.pathname.startsWith('/assets/')) {
      return route.fulfill({ path: new URL(`.${target.pathname}`, root).pathname });
    }
    await route.continue();
  });
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(tmpdir(), 'opencode', `kyrolll-${name}.png`), fullPage: true });
const noOverflow = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');

try {
  browser = await chromium.launch({ headless: true });
  const desktop = await setupPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await desktop.goto(url);
  await desktop.locator('.logo-stage.is-ready').waitFor();
  await noOverflow(desktop);
  assert.equal(await desktop.locator('#grid .catalog-tile').count(), 1);
  assert.match(await desktop.locator('#card-flesh').innerText(), /FLESH/i);
  await shot(desktop, 'desktop');

  const direct = await setupPage({ viewport: { width: 1024, height: 800 }, reducedMotion: 'reduce' });
  await direct.goto(`${url}/?beat=flesh`);
  assert.match(await direct.title(), /FLESH/);
  assert.equal(await direct.locator('#grid .beat-detail').count(), 1);
  assert.match(await direct.locator('#card-flesh').innerText(), /130 BPM \/\/ AM/i);
  assert.equal(await direct.locator('#card-flesh audio').getAttribute('src'), 'assets/previews/BEAT 1 TAG.wav');
  assert.equal(await direct.locator('#card-flesh .buy-beat-btn').count(), 1);
  assert.match(await direct.locator('#card-flesh .buy-beat-btn').innerText(), /^BUY$/i);
  assert.equal(await direct.locator('#card-flesh .buy-beat-btn').getAttribute('href'), 'https://bsta.rs/GwSz83');
  assert.equal(await direct.locator('#card-flesh .beat-detail__artwork img').count(), 1);
  assert.equal(await direct.locator('#card-flesh .beat-detail__content').count(), 1);
  await shot(direct, 'beat-detail');
  await direct.close();

  const playback = await setupPage({ viewport: { width: 480, height: 800 }, reducedMotion: 'reduce' });
  await playback.goto(`${url}/index.html?beat=flesh`);
  await playback.locator('#card-flesh .beat-preview__toggle').click();
  await playback.waitForFunction(() => {
    const audio = document.querySelector('#card-flesh audio');
    return !audio.paused && audio.currentTime > 0 && audio.closest('.beat-preview').dataset.state === 'playing';
  }, null, { timeout: 15000 });
  await playback.close();

  assert.deepEqual(errors, []);
  console.log('Passed storefront layout, tagged audio preview, and BeatStars buy button checks.');
} finally {
  await browser?.close();
  server.close();
}
