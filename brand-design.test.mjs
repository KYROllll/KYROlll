// Browser integration checks for the free-download KYROIII store.
// Covers the storefront layout, the tagged audio preview, the "DOWNLOAD FREE"
// package menu and all three unlock paths (instant MP3, YouTube gate, email gate).
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
const CARD = '#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af';
const BEAT_ID = '6c56eda2-df4a-45b0-b9b7-68f8efdbb1af';
const PROVIDER = 'https://formspree.io/f/xgaoppwo';

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
  // The panel becomes a scroller on short viewports; every tier must keep its
  // natural height (a shrunk flex child is exactly the clipping bug this guards)
  // and the panel must stay on screen.
  assert(await page.evaluate(() => {
    const menu = document.querySelector('.download-menu');
    const list = menu && menu.querySelector('.download-menu__list');
    if (!list) return false;
    const tiers = Array.from(menu.querySelectorAll('.download-tier'));
    const squished = tiers.some(tier => tier.scrollHeight > tier.clientHeight + 1);
    const natural = tiers.reduce((sum, tier) => sum + tier.getBoundingClientRect().height, 0) + 8 * (tiers.length - 1);
    const box = menu.getBoundingClientRect();
    return !squished && list.clientHeight + 1 >= natural && box.left >= -1 && box.right <= innerWidth + 1;
  }), 'package menu renders every tier without clipping');
  await page.locator(`.download-tier[data-package="${packageId}"]`).click();
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
  assert.equal(await desktop.locator('#grid .catalog-tile').count(), 1);
  assert.match(await desktop.locator(CARD).innerText(), /FLESH/i);
  await shot(desktop, 'desktop');

  // Direct beat link: the card carries one "DOWNLOAD FREE" trigger.
  const direct = await setupPage({ viewport: { width: 1024, height: 800 }, reducedMotion: 'reduce', acceptDownloads: true });
  await direct.goto(`${url}/?beat=flesh`);
  assert.match(await direct.title(), /FLESH/);
  assert.equal(await direct.locator('#grid .beat-detail').count(), 1);
  assert.match(await direct.locator(CARD).innerText(), /130 BPM \/\/ AM/i);
  assert.equal(await direct.locator(`${CARD} audio`).getAttribute('src'), 'assets/previews/BEAT 1 TAG.wav');
  assert.equal(await direct.locator(`${CARD} .download-trigger`).count(), 1);
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
  await mp3Page.waitForURL(/download\.html\?beat=.*&package=mp3/);
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
  assert.equal(await mp3Page.locator('[data-license-pdf]').count(), 1);
  const serial = await mp3Page.locator('#license-serial').innerText();
  assert.match(serial, /^KYRO-\d{4}-FLESH-\d{6}$/);
  serials.push(serial);
  const [mp3] = await Promise.all([
    mp3Page.waitForEvent('download'),
    mp3Page.locator('[data-file-index="0"]').click(),
  ]);
  assert.match(mp3.suggestedFilename(), /\.mp3$/i);
  // The luxury PDF license: a real file, not a viewer, with a valid PDF header,
  // the serial on the page and in the document, and the whole deal in the copy.
  const [pdf] = await Promise.all([
    mp3Page.waitForEvent('download'),
    mp3Page.locator('[data-license-pdf]').click(),
  ]);
  assert.match(pdf.suggestedFilename(), /\.pdf$/i);
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
  assert(pdfText.includes('PAGE 1 OF 1'), 'document-control footer, one page for every package');
  // Strict ALL CAPS branding: no lowercase letter survives anywhere in the doc.
  assert.deepEqual(pdfRuns(pdfText).filter(run => /[a-z]/.test(run)), [], 'every PDF string is uppercase');
  // Immaculate signatures: both sides pre-filled, the licensee with the address
  // submitted at the gate. (Parentheses are escaped by the PDF writer.)
  assert(pdfText.includes('MP3-BUYER@EXAMPLE.COM'), 'the LICENSEE signature carries the submitted address');
  assert(pdfText.includes('LICENSOR \\(KYROIII\\)'), 'the LICENSOR signature block');
  assert(pdfText.includes('SIGNED '), 'the licensee block is dated');
  // Monochromatic cyberpunk palette: matte black #0B0B0B, white type and
  // silver #888888 rules — and no blue channel anywhere.
  assert(pdfText.includes('0.043 0.043 0.043 rg'), 'deep matte black field (#0B0B0B)');
  assert(pdfText.includes('0.533 0.533 0.533'), 'silver frame (#888888)');
  // `x y z rg` for fills, `x y z width RG` for strokes.
  const colors = [...pdfText.matchAll(/(?:([\d.]+) ([\d.]+) ([\d.]+) rg)|(?:([\d.]+) ([\d.]+) ([\d.]+) [\d.]+ RG)/g)]
    .map(m => [m[1] ?? m[4], m[2] ?? m[5], m[3] ?? m[6]]);
  assert(colors.length > 0, 'the document paints its own colors');
  const tinted = colors.filter(c => c[0] !== c[1] || c[1] !== c[2]);
  assert.equal(tinted.length, 0, `every color is an equal-channel grey (zero blue): ${JSON.stringify(tinted)}`);
  // Clean footer: vector barcode + the official store link, uppercase.
  assert(pdfText.includes('HTTPS://KYROILL.STORE'), 'the store link is printed in the footer');
  assert(/1 1 1 rg\n[\d.]+ [\d.]+ [\d.]+ [\d.]+ re f/.test(pdfText), 'vector barcode drawn in the footer');

  // The interactive signature: what the visitor types is stamped live into the
  // LICENSEE block of the next PDF, and the ALL-CAPS rule still holds over it.
  await mp3Page.locator('#license-signature').fill('Jordan Vega');
  await mp3Page.waitForFunction(() => {
    const stamp = document.getElementById('license-stamp');
    return stamp && stamp.dataset.stamped === 'true' && /JORDAN VEGA/.test(stamp.textContent || '');
  }, null, { timeout: 5000 });
  const [signedPdf] = await Promise.all([
    mp3Page.waitForEvent('download'),
    mp3Page.locator('[data-license-pdf]').click(),
  ]);
  const signedText = (await readFile(await signedPdf.path())).toString('latin1');
  assert(signedText.includes('JORDAN VEGA'), 'the typed signature is stamped into the LICENSEE block');
  assert(!signedText.includes('Jordan Vega'), 'the signature is stamped in caps, exactly as the PDF is');
  assert.equal(signedText.includes(serial), true, 'the signed copy keeps this issuance serial');
  assert.deepEqual(pdfRuns(signedText).filter(run => /[a-z]/.test(run)), [], 'the signed license is uppercase too');
  await shot(mp3Page, 'download-mp3');
  await mp3Page.close();

  // Package 2 — Standard WAV Lease: the YouTube gate. Both steps must be opened
  // before the unlock enables, then the page lists the MP3 + WAV.
  const wavPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await pickPackage(wavPage, 'wav');
  await wavPage.locator('.gate-modal').waitFor();
  assert.equal(await wavPage.locator('.gate-step').count(), 2);
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), true);
  await wavPage.locator('[data-gate-step="0"]').click();
  await wavPage.locator('[data-gate-step="1"]').click();
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), true, 'the two steps alone never unlock — the email is still required');
  await wavPage.locator('#gate-email').fill('wav-buyer@example.com');
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), false);
  await wavPage.locator('[data-gate-submit]').click();
  await wavPage.waitForURL(/package=wav/);
  assert.equal(subscribeRequests.length, 2, 'the WAV gate posts its address too');
  assert.match(await wavPage.locator('#download-list').innerText(), /HIGH-QUALITY WAV/i);
  assert.equal(await wavPage.locator('.download-item').count(), 2); // tagged MP3 + high-quality WAV
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
  assert(wavText.includes('WAV-BUYER@EXAMPLE.COM'), 'the WAV license carries its own licensee');
  assert.deepEqual(pdfRuns(wavText).filter(run => /[a-z]/.test(run)), [], 'the WAV license is uppercase too');
  await shot(wavPage, 'download-wav');
  await wavPage.close();

  // Package 3 — Exclusive / Pro: the same two YouTube steps as the WAV package
  // (there is no comment step any more), then the email gate. A malformed
  // address is refused (and the opt-in is on by default); a valid one unlocks
  // the stems package and is posted to the configured newsletter provider.
  const proPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await proPage.goto(`${url}/?beat=flesh`);
  const endpoint = await proPage.evaluate(() => window.KYROlll_NEWSLETTER && window.KYROlll_NEWSLETTER.endpoint);
  assert.match(endpoint, /^https:\/\//, 'a newsletter provider endpoint is configured');
  assert.equal(endpoint, PROVIDER, 'the Formspree endpoint the gate posts to');
  await proPage.locator(`${CARD} .download-trigger`).click();
  await proPage.locator('.download-menu.is-open').waitFor();
  await proPage.locator('.download-tier[data-package="exclusive"]').click();
  await proPage.locator('.gate-modal').waitFor();
  assert.equal(await proPage.locator('#gate-optin').isChecked(), true);
  // The email gate is a real <form> pointing at that provider endpoint.
  assert.equal(await proPage.locator('[data-gate-form]').getAttribute('action'), endpoint);
  assert.equal(await proPage.locator('[data-gate-form]').getAttribute('method'), 'post');
  assert.equal(await proPage.locator('.gate-step').count(), 2, 'the Pro gate carries no comment step');
  assert.equal(await proPage.locator('#gate-comment').count(), 0, 'the comment step is gone');
  assert.equal(await proPage.locator('[data-gate-submit]').isDisabled(), true);
  await proPage.locator('[data-gate-step="0"]').click();
  await proPage.locator('[data-gate-step="1"]').click();
  // Each completed step draws its own tick and still cannot unlock alone.
  assert.equal(await proPage.locator('.gate-step.is-done .gate-step__tick').count(), 2, 'both steps show their tick');
  assert.equal(await proPage.locator('[data-gate-submit]').isDisabled(), true, 'the steps alone never unlock');
  await proPage.locator('#gate-email').fill('not-an-email');
  await proPage.locator('#gate-email').press('Enter');
  assert.equal(await proPage.locator('#gate-error').isVisible(), true);
  assert.equal(subscribeRequests.length, 2, 'a malformed address is never sent to the provider');
  await proPage.locator('#gate-email').fill('producer@example.com');
  await proPage.locator('[data-gate-submit]').click();
  await proPage.waitForURL(/package=exclusive/);
  assert.equal(subscribeRequests.length, 3, 'the valid address is posted to the newsletter provider');
  assert.equal(subscribeRequests[2].url, endpoint, 'posted to the configured provider endpoint');
  assert.match(subscribeRequests[2].body, /email=producer%40example\.com/);
  assert.match(subscribeRequests[2].body, /embed=1/);
  assert.match(await proPage.locator('#download-list').innerText(), /TRACKED STEMS/i);
  assert.equal(await proPage.locator('.download-item').count(), 3); // MP3 + WAV + stems (license is its own panel)
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
  assert(proText.includes('PRODUCER@EXAMPLE.COM'), 'the exclusive license is signed with the submitted address');
  assert(proText.includes('PAGE 1 OF 1'), 'the exclusive package still fits one page');

  // Fresh state every time: the very browser that just unlocked this package is
  // asked again, from scratch, with nothing remembered and nothing written.
  await proPage.goto(`${url}/?beat=flesh`);
  await proPage.locator(`${CARD} .download-trigger`).click();
  await proPage.locator('.download-menu.is-open').waitFor();
  await proPage.locator('.download-tier[data-package="exclusive"]').click();
  await proPage.locator('.gate-modal').waitFor();
  assert.equal(await proPage.locator('#gate-email').inputValue(), '', 'the address is never remembered');
  assert.equal(await proPage.locator('#gate-comment').count(), 0, 'there is no comment step at all');
  assert.equal(await proPage.locator('.gate-step.is-done').count(), 0, 'the steps start unopened again');
  assert.equal(await proPage.locator('[data-gate-submit]').isDisabled(), true, 'the gate starts closed again');
  assert.equal(subscribeRequests.length, 3, 're-opening a gate posts nothing');
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

  // Smart session memory: once the gate is passed in this view the package is
  // remembered in-page, so the same package is not asked for twice — while the
  // browser still stores nothing at all.
  await coldPage.locator('[data-gate-step="0"]').click();
  await coldPage.locator('[data-gate-step="1"]').click();
  await coldPage.locator('#gate-email').fill('cold-entrant@example.com');
  await coldPage.locator('[data-gate-submit]').click();
  // The success beat holds ~1.4 s and then the page paints its file rows.
  await coldPage.locator('.download-item').first().waitFor({ timeout: 15000 });
  assert.match(await coldPage.locator('#download-list').innerText(), /TRACKED STEMS/i);
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), true, 'the pass is remembered for this view');
  await noGateMemory(coldPage, 'after a gate passed on the download page itself');
  const postsBeforeMemory = subscribeRequests.length;
  await coldPage.evaluate(id => { window.KYROlll_DOWNLOADS.start(id, 'exclusive'); }, BEAT_ID);
  await coldPage.waitForFunction(() => new URLSearchParams(location.search).has('t') && !!window.KYROlll_DOWNLOADS);
  assert.equal(await coldPage.locator('.gate-modal').count(), 0, 'a remembered grant never re-opens the gate');
  assert.equal(subscribeRequests.length, postsBeforeMemory, 'a remembered grant posts nothing');
  assert.equal(await coldPage.evaluate(id => window.KYROlll_DOWNLOADS.isUnlocked(id, 'exclusive'), BEAT_ID), false, 'the memory does not outlive the page');
  await coldPage.close();

  // A gate closes on Escape wherever focus sits (the YouTube gate focuses
  // nothing), and the page is released back to the storefront.
  const escPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' });
  await pickPackage(escPage, 'exclusive');
  await escPage.locator('.gate-modal').waitFor();
  await escPage.keyboard.press('Escape');
  await escPage.locator('.gate-modal').waitFor({ state: 'detached' });
  assert.equal(await escPage.evaluate(() => document.documentElement.classList.contains('gate-open')), false);
  await escPage.close();

  const playback = await setupPage({ viewport: { width: 480, height: 800 }, reducedMotion: 'reduce' });
  await playback.goto(`${url}/index.html?beat=flesh`);
  await playback.locator(`${CARD} .beat-preview__toggle`).click();
  await playback.waitForFunction(() => {
    const audio = document.querySelector('#card-6c56eda2-df4a-45b0-b9b7-68f8efdbb1af audio');
    return !audio.paused && audio.currentTime > 0 && audio.closest('.beat-preview').dataset.state === 'playing';
  }, null, { timeout: 15000 });
  await playback.close();

  assert.deepEqual(errors, []);
  console.log('Passed storefront layout, tagged audio preview, and the free-download menu + all three gates (two-step Pro gate, in-page session memory with empty storage, Formspree posts, a typed signature stamped into an ALL-CAPS monochrome PDF license).');
} finally {
  await browser?.close();
  server.close();
}
