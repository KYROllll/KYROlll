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

// Every gate now closes with the REVIEW & SIGN stage: the terms have to be read
// to the end AND a signature captured before SIGN & UNLOCK comes alive.
const signStage = (page) => page.locator('.gate-modal__card--sign');
async function readTerms(page) {
  await page.locator('[data-sign-terms]').evaluate(el => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });
}
// Type a signature, read the terms and unlock.
async function signLicense(page, name) {
  await signStage(page).waitFor();
  await page.locator('#sign-name').fill(name);
  await readTerms(page);
  await page.locator('[data-sign-submit]').click();
}
// Ink a two-stroke signature on the pad with real pointer input.
async function drawSignature(page) {
  await page.locator('[data-sign-mode="draw"]').click();
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

// A YouTube step is not a click-through: it only counts once its hold has run, so
// the bypass (click, bounce, submit) is refused.
async function openSteps(page) {
  await page.locator('[data-gate-step="0"]').click();
  await page.locator('[data-gate-step="1"]').click();
  assert.equal(await page.locator('.gate-step.is-done').count(), 0, 'a step is not done the moment it is clicked');
  assert.equal(await page.locator('.gate-step.is-verifying').count(), 2, 'both held steps report they are verifying');
  assert.match(await page.locator('[data-gate-step="0"] .gate-step__go').innerText(), /VERIFYING/);
  await page.locator('.gate-step.is-done').first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.gate-step.is-done').length === 2, null, { timeout: 15000 });
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
  await mp3Page.locator('#sign-name').fill('Jordan Vega');
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), true, 'a signature alone never unlocks — the terms must be read too');
  await readTerms(mp3Page);
  assert(await mp3Page.locator('[data-sign-terms]').evaluate(el => el.scrollTop > 0), 'the terms pane really scrolled to the end');
  assert.equal(await mp3Page.locator('.gate-modal__card--sign .gate-field.is-valid').count(), 1, 'a signature ticks its field');
  assert.match(await mp3Page.locator('[data-sign-stamp]').innerText(), /JORDAN VEGA/, 'the stamp previews exactly what the PDF will print');
  assert.equal(await mp3Page.locator('[data-sign-submit]').isDisabled(), false, 'read terms + a signature unlocks SIGN & UNLOCK');
  await mp3Page.locator('[data-sign-submit]').click();
  await mp3Page.waitForURL(/download\.html\?beat=.*&package=mp3/);
  assert.match(mp3Page.url(), /sign=Jordan(%20|\+)Vega/, 'the signature is handed forward in the flow URL');
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
  // The hand-over is named the way an engineer reads it: the beat, its tempo and
  // its key, straight off the filename.
  // The value handed to the download (and shown on the page) is exactly the
  // studio name; only its rendering is uppercased by the stylesheet.
  assert.equal(await mp3Page.locator('.download-item__name').textContent(), 'KYROIII - FLESH (130 BPM - AM).mp3');
  assert.match(await mp3Page.locator('#license-stamp').innerText(), /JORDAN VEGA/, 'the signature captured in the gate is stamped on the page too');
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
  assert.equal(drawnPaths(pdfText).length, 0, 'a typed license carries no drawn strokes');
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

  // Re-signing on the download page still re-stamps the next PDF live, and the
  // ALL-CAPS rule holds over the new name.
  await mp3Page.locator('#license-signature').fill('Matan Kaplan');
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

  // Package 2 — Standard WAV Lease: the YouTube gate. Both steps must be opened
  // before the unlock enables, then the page lists the MP3 + WAV.
  const wavPage = await setupPage({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  await pickPackage(wavPage, 'wav');
  await wavPage.locator('.gate-modal').waitFor();
  assert.equal(await wavPage.locator('.gate-step').count(), 2);
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), true);
  // Each step has to be genuinely opened — and held — before it counts.
  await openSteps(wavPage);
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), true, 'the two steps alone never unlock — the email is still required');
  await wavPage.locator('#gate-email').fill('wav-buyer@example.com');
  assert.equal(await wavPage.locator('[data-gate-submit]').isDisabled(), false);
  await wavPage.locator('[data-gate-submit]').click();
  await signLicense(wavPage, 'Wav Buyer');
  await wavPage.waitForURL(/package=wav/);
  assert.equal(subscribeRequests.length, 2, 'the WAV gate posts its address too');
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
  await openSteps(proPage);
  // Each completed step draws its own tick and still cannot unlock alone.
  assert.equal(await proPage.locator('.gate-step.is-done .gate-step__tick').count(), 2, 'both steps show their tick');
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
  await drawSignature(proPage);
  assert.match(await proPage.locator('[data-sign-stamp]').innerText(), /SIGNATURE CAPTURED/, 'the drawn signature is captured');
  assert.equal(await proPage.locator('[data-sign-submit]').isDisabled(), true, 'a drawing still cannot skip reading the terms');
  await readTerms(proPage);
  assert.equal(await proPage.locator('[data-sign-submit]').isDisabled(), false);
  await proPage.locator('[data-sign-submit]').click();
  await proPage.waitForURL(/package=exclusive/);
  assert.match(proPage.url(), /sig=/, 'the drawing is handed forward, packed into the flow URL');
  assert(await proPage.locator('.license-cert__mark path').count() >= 2, 'the download page replays the drawn signature');
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
  assert(proText.includes('PAGE 1 OF 1'), 'the exclusive package still fits one page');
  // The hand-drawn signature reaches the PDF as real vector strokes, inside the
  // LICENSEE column, and the document stays monochrome and uppercase.
  const ink = drawnPaths(proText);
  assert(ink.length >= 2, `the drawn signature is stamped into the PDF as vector strokes: ${ink.length}`);
  const inkX = ink.flatMap(path => path.map(point => Number(String(point).split(' ')[0])));
  assert(Math.max(...inkX) < 300, 'the drawn strokes sit inside the LICENSEE column');
  assert.equal(drawnPaths(proText).length, ink.length, 'the signs are stable');
  assert.deepEqual(pdfRuns(proText).filter(run => /[a-z]/.test(run)), [], 'the hand-signed license is uppercase too');

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
  await openSteps(coldPage);
  await coldPage.locator('#gate-email').fill('cold-entrant@example.com');
  await coldPage.locator('[data-gate-submit]').click();
  await signLicense(coldPage, 'Cold Entrant');
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
  console.log('Passed storefront layout, tagged audio preview, and the free-download menu + all three gates (held YouTube steps, the REVIEW & SIGN stage with read-to-the-end terms and a typed or hand-drawn signature stamped into the single-page ALL-CAPS monochrome PDF license, studio filenames with BPM and key, in-page session memory with empty storage, Formspree posts).');
} finally {
  await browser?.close();
  server.close();
}
