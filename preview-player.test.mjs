import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("./preview-player.js", import.meta.url), "utf8"), context);
const BeatPreviewPlayer = vm.runInContext("BeatPreviewPlayer", context);

const catalogContextFor = (sharedStorage) => {
  const events = [];
  const store = sharedStorage || new Map();
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
  const window = {
    localStorage,
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    dispatchEvent(event) { events.push(event); return true; },
  };
  vm.runInContext(readFileSync(new URL("./catalog.js", import.meta.url), "utf8"), vm.createContext({ window }));
  return { window, events, storage: store };
};

test("the fifth release is scheduled, packaged and pointed at the free-download form", () => {
  const { window } = catalogContextFor();
  const catalog = window.KYROlll_CATALOG;
  assert.equal(catalog.length, 8, "the catalog carries eight releases");
  const beat = window.KYROlll_HELPERS.beatById("just-d0-it");
  assert.equal(beat.title, "[FREE 100%] YEAT TYPE BEAT - JUST D0 IT");
  assert.equal(beat.shortTitle, "JUST D0 IT");
  assert.equal(beat.bpm, 135);
  assert.equal(beat.key, "Am");
  assert.equal(beat.vinylVariant, undefined, "every record is the same pressing, not hand-assigned");
  assert.equal(beat.releaseAt, "2026-10-27T23:00:00+02:00");
  const releaseAt = Date.parse("2026-10-27T23:00:00+02:00");
  assert.equal(window.KYROlll_HELPERS.releaseAt(beat), releaseAt);
  assert.equal(window.KYROlll_HELPERS.isReleased(beat, releaseAt - 1), false);
  assert.equal(window.KYROlll_HELPERS.isReleased(beat, releaseAt), true);
  assert.equal(window.KYROlll_SITE.formspreeEndpoint, "https://formspree.io/f/mvkkkoew");
  assert.equal(window.KYROlll_NEWSLETTER.endpoint, "https://formspree.io/f/mvkkkoew");
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.file), [
    "assets/previews/just-do-it.mp3",
    "assets/previews/just-do-it.wav",
    "assets/previews/just-do-it-stems.zip",
  ]);
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.name), [
    "KYROIII - JUST D0 IT (135 BPM - AM).mp3",
    "KYROIII - JUST D0 IT (135 BPM - AM).wav",
    "KYROIII - JUST D0 IT - TRACKED STEMS.zip",
  ]);
});

test("the re-ingested ADLL beat is scheduled for today at 19:00 with its graffiti-splatter pressing", () => {
  const { window } = catalogContextFor();
  const catalog = window.KYROlll_CATALOG;
  assert.equal(catalog.length, 8, "the catalog carries eight releases");
  assert.deepEqual(Array.from(catalog, (beat) => beat.slug),
    ["flesh", "the-flow", "green-flesh", "squish", "just-d0-it", "adll", "gunna-type", "white-night"],
    "the eight beats are intact, in order, with the WHITE NIGHT drop as the newest entry");
  const beat = window.KYROlll_HELPERS.beatById("adll");
  assert(beat, "ADLL resolves from its id and slug");
  assert.equal(beat.title, "[FREE 100%] YEAT TYPE BEAT - A.D.L");
  assert.equal(beat.shortTitle, "A.D.L");
  assert.equal(beat.img, "assets/adll.png");
  assert.equal(beat.bpm, 124);
  assert.equal(beat.key, "C#");
  assert.equal(beat.preview, "assets/previews/adll.mp3");
  assert.equal(beat.vinylVariant, undefined, "every record is the same pressing, not hand-assigned");
  assert.equal(beat.releaseAt, "2026-11-02T19:00:00+02:00", "ADLL drops today at 19:00 Israel time");
  const releaseAt = Date.parse("2026-11-02T19:00:00+02:00");
  assert.equal(window.KYROlll_HELPERS.releaseAt(beat), releaseAt);
  assert.equal(window.KYROlll_HELPERS.isReleased(beat, releaseAt - 1), false, "the beat stays scheduled until 19:00");
  assert.equal(window.KYROlll_HELPERS.isReleased(beat, releaseAt), true, "the beat unlocks on the clock");
  assert.equal(beat.exclusiveLocked, undefined, "ADLL ships free, not pre-claimed");
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.file), [
    "assets/previews/adll.mp3",
    "assets/previews/adll.wav",
    "assets/previews/adll-stems.zip",
  ]);
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.name), [
    "KYROIII - A.D.L (124 BPM - C#).mp3",
    "KYROIII - A.D.L (124 BPM - C#).wav",
    "KYROIII - A.D.L - TRACKED STEMS.zip",
  ]);
  const marquee = readFileSync(new URL("./marquee-items.js", import.meta.url), "utf8");
  assert.match(marquee, /YEAT TYPE BEAT - A\.D\.L/, "the ticker announces the ADLL drop");
  [
    "assets/previews/adll.mp3",
    "assets/previews/adll.wav",
    "assets/previews/adll-stems.zip",
    "assets/adll.png",
  ]
    .forEach((asset) => assert(readFileSync(new URL(`./${asset}`, import.meta.url)).length > 0, `${asset} is ingested`));
});

test("the GUNNA drop is scheduled for 22:00 today and every record keeps the original flower logo label", () => {
  const { window } = catalogContextFor();
  const helpers = window.KYROlll_HELPERS;
  const beat = helpers.beatById("gunna-type");
  assert(beat, "the GUNNA drop resolves from its id and slug");
  assert.equal(beat.title, "[FREE 100%] GUNNA TYPE BEAT - VVS MOTION");
  assert.equal(beat.img, "assets/beat-cover.png");
  assert.equal(beat.bpm, 146);
  assert.equal(beat.key, "Fm");
  assert.equal(beat.preview, "assets/previews/gunna-type.mp3");
  assert.equal(beat.vinylVariant, undefined, "every record is the same pressing, not hand-assigned");
  assert.equal(beat.vinylLabel, undefined, "no beat replaces the signature flower logo with cover art");
  assert.equal(beat.releaseAt, "2026-11-07T22:00:00+02:00", "the drop lands today at exactly 22:00 Israel time");
  const releaseAt = Date.parse("2026-11-07T22:00:00+02:00");
  assert.equal(helpers.releaseAt(beat), releaseAt);
  assert.equal(helpers.isReleased(beat, releaseAt - 1), false, "the beat stays scheduled until 22:00");
  assert.equal(helpers.isReleased(beat, releaseAt), true, "the beat unlocks on the clock");
  assert.equal(helpers.formatCountdown(59 * 60 * 1000 + 36 * 1000), "00:59:36", "the countdown reads a real HH:MM:SS");
  assert.equal(helpers.formatCountdown(3661 * 1000), "01:01:01", "the countdown rolls over hours, minutes and seconds separately");
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.file), [
    "assets/previews/gunna-type.mp3",
    "assets/previews/gunna-type.wav",
    "assets/previews/gunna-type-stems.zip",
  ]);
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.name), [
    "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM).mp3",
    "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM).wav",
    "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM) - TRACKED STEMS.zip",
  ]);
  [
    "assets/beat-cover.png",
    "assets/previews/gunna-type.mp3",
    "assets/previews/gunna-type.wav",
    "assets/previews/gunna-type-stems.zip",
  ]
    .forEach((asset) => assert(readFileSync(new URL(`./${asset}`, import.meta.url)).length > 0, `${asset} is ingested`));

  // Every centre label is the original KYROIII logo art — the white flower on
  // its own black plate. The 3D WebGL stage is gone from the record, the mark
  // is a static PNG, and the old cover-label path is gone.
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /const VINYL_LABEL_ART = "assets\/kyrolll-flower-label\.png"/, "the original flower logo is the one label art");
  assert.doesNotMatch(script, /vinylLabel|vinyl-record--cover/, "no record opts into a cover label");
  assert.doesNotMatch(script, /data-vinyl-flower="true"/, "the vinyl record no longer mounts the live 3D flower stage");
  assert.doesNotMatch(script, /<div class="logo-stage vinyl-flower-stage"/, "the 3D flower stage is not rendered on the record");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.vinyl-record--cover/, "the stylesheet carries no cover-label pressing");
  assert.doesNotMatch(css, /url\(assets\/beat-cover\.png\)/, "the stylesheet hard-codes no beat artwork path");
});

test("the WHITE NIGHT drop is scheduled for 20:00 today with its cover, MP3, WAV and tracked stems", () => {
  const { window } = catalogContextFor();
  const helpers = window.KYROlll_HELPERS;
  const beat = helpers.beatById("white-night");
  assert(beat, "the WHITE NIGHT drop resolves from its id and slug");
  assert.equal(beat.title, "[FREE 100%] FUTURE TYPE BEAT - WHITE NIGHT");
  assert.equal(beat.shortTitle, "WHITE NIGHT");
  assert.equal(beat.img, "assets/white-night.jpg");
  assert.equal(beat.bpm, 142);
  assert.equal(beat.key, "A");
  assert.equal(beat.preview, "assets/previews/white-night.mp3");
  assert.equal(beat.vinylVariant, undefined, "every record is the same pressing, not hand-assigned");
  assert.equal(beat.releaseAt, "2026-11-09T20:00:00+02:00", "the drop lands today at exactly 20:00 Israel time");
  const releaseAt = Date.parse("2026-11-09T20:00:00+02:00");
  assert.equal(helpers.releaseAt(beat), releaseAt);
  assert.equal(helpers.isReleased(beat, releaseAt - 1), false, "the beat stays scheduled until 20:00");
  assert.equal(helpers.isReleased(beat, releaseAt), true, "the beat unlocks on the clock");
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.file), [
    "assets/previews/white-night.mp3",
    "assets/previews/white-night.wav",
    "assets/previews/white-night-stems.zip",
  ]);
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.name), [
    "KYROIII - WHITE NIGHT (142 BPM - A).mp3",
    "KYROIII - WHITE NIGHT (142 BPM - A).wav",
    "KYROIII - WHITE NIGHT (142 BPM - A) - TRACKED STEMS.zip",
  ]);
  [
    "assets/white-night.jpg",
    "assets/previews/white-night.mp3",
    "assets/previews/white-night.wav",
    "assets/previews/white-night-stems.zip",
  ]
    .forEach((asset) => assert(readFileSync(new URL(`./${asset}`, import.meta.url)).length > 0, `${asset} is ingested`));
});

test("the exclusive license claims the beat globally and retires its public leases", () => {
  const storage = new Map();
  const { window, events } = catalogContextFor(storage);
  const helpers = window.KYROlll_HELPERS;
  assert.equal(window.KYROlll_EXCLUSIVE_LOCK.label, "[CLAIMED / SOLD OUT]");
  assert.equal(window.KYROlll_EXCLUSIVE_LOCK.ownedLabel, "[OWNED / YOURS]");
  assert.match(window.KYROlll_EXCLUSIVE_LOCK.note, /SECURED WITH EXCLUSIVE RIGHTS AND ARCHIVED FROM PUBLIC RELEASE/);
  assert.match(window.KYROlll_EXCLUSIVE_LOCK.ownedNote, /YOU HOLD THE EXCLUSIVE RIGHTS/);
  assert.equal(helpers.isExclusiveLocked("adll"), false, "a published beat starts unclaimed");
  assert.equal(helpers.isExclusiveOwned("adll"), false, "no buyer is recorded yet");
  assert.equal(helpers.lockExclusive("adll"), true, "the exclusive tier claims the beat");
  assert.equal(helpers.isExclusiveLocked("adll"), true);
  assert.equal(helpers.isExclusiveOwned("adll"), true, "the claim is recorded to this browser's buyer");
  assert.equal(window.KYROlll_HELPERS.beatById("adll").exclusiveLocked, true, "the live catalog entry records the claim");
  assert.match(window.KYROlll_HELPERS.beatById("adll").exclusiveLockedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(helpers.lockExclusive("adll"), false, "the exclusive license is issued only once");
  assert.equal(events.length, 1, "the claim is announced once");
  assert.equal(events[0].type, "kyrolll:exclusive-locked");
  assert.equal(events[0].detail.slug, "adll");
  assert.equal(events[0].detail.owned, true);
  // The claim is durable: a new page on the same browser reads the same record
  // and recognises the same buyer. A fresh browser (fresh storage) starts clean.
  assert.equal(storage.has(window.KYROlll_EXCLUSIVE_LOCK.storageKey), true, "the claim is written to localStorage");
  const revisit = catalogContextFor(storage).window.KYROlll_HELPERS;
  assert.equal(revisit.isExclusiveLocked("adll"), true, "the claim survives a new page");
  assert.equal(revisit.isExclusiveOwned("adll"), true, "the buyer keeps ownership across sessions");
  const stranger = catalogContextFor().window.KYROlll_HELPERS;
  assert.equal(stranger.isExclusiveLocked("adll"), false, "a browser with no claim starts unclaimed");
  const downloads = readFileSync(new URL("./downloads.js", import.meta.url), "utf8");
  assert.match(downloads, /syncExclusiveClaims\(\{ force: true \}\)\.then\(finish, finish\)/, "SIGN & UNLOCK refreshes the shared register before it claims an exclusive beat");
  assert.match(downloads, /pack\.id === "exclusive"[\s\S]*?lockExclusive\(beat\.id\)/, "SIGN & UNLOCK claims the exclusive beat only once");
  assert.match(downloads, /holdExclusiveClaim\(beat\)/, "the download layer refuses a claimed beat");
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /data-exclusive-lock/, "the storefront renders the signature badge");
  assert.match(script, /PRIVATE MASTER \/\/ YOURS/, "the buyer's badge names the private master");
  assert.match(script, /CLAIMED \/ SOLD OUT/, "the beat page names the sold-out state");
  assert.match(script, /const label = owned \? "OWNED" :/, "the buyer gets an ownership line");
  assert.doesNotMatch(script, /exclusive-art/, "the cover art is never veiled by an archive overlay");
  assert.doesNotMatch(script, /exclusive-locked-button/, "a claimed beat renders no inert control");
  assert.match(script, /kyrolll:exclusive-locked/, "the grid repaints when a claim lands");
  assert.match(script, /kyrolll:exclusive-claims/, "the grid repaints when the shared register changes");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.exclusive-art\s*\{/, "the claimed cover carries no archive veil");
  assert.match(css, /\.exclusive-badge \{[\s\S]*?display: flex[\s\S]*?exclusive-badge__seal/, "the badge is a flower-and-copy signature plate");
  assert.match(css, /\.exclusive-badge__seal \{[\s\S]*?object-fit: contain/, "the signature plate carries the small flower mark");
  assert.match(css, /\.download-actions--secured \.exclusive-badge \{[\s\S]*?justify-content: center/, "the beat page centers its signature badge");
  assert.match(css, /\.exclusive-locked-button \{[\s\S]*?cursor: not-allowed/, "the download page's secured control is visibly inert");
  const page = readFileSync(new URL("./download-page.js", import.meta.url), "utf8");
  assert.match(page, /showExclusiveLocked/, "a cold link to a claimed beat shows the secured archive");
  assert.match(page, /isExclusiveOwned/, "a returning buyer sees the ownership marker");
  assert.match(page, /exclusive-lock__stamp/, "the download page's secured archive carries the same flower seal");
});

test("the old local-only register is retired and a local reset reopens the beat", () => {
  const stale = new Map();
  stale.set("kyrolll_exclusive_claims", JSON.stringify({
    version: 1,
    buyerId: "buyer-old",
    claims: { adll: { at: "2026-11-02T19:00:00.000Z", ownerId: "buyer-old" } },
  }));
  const retired = catalogContextFor(stale).window.KYROlll_HELPERS;
  assert.equal(retired.isExclusiveLocked("adll"), false, "the version-1 test claim is retired");
  assert.equal(retired.isExclusiveOwned("adll"), false, "the old buyer marker is retired too");
  assert.equal(stale.has("kyrolll_exclusive_claims"), false, "the stale local register is removed");

  const storage = new Map();
  const helpers = catalogContextFor(storage).window.KYROlll_HELPERS;
  assert.equal(helpers.lockExclusive("adll"), true);
  assert.equal(helpers.isExclusiveLocked("adll"), true);
  assert.equal(helpers.resetExclusiveClaims(), true, "the developer reset clears this browser's cache");
  assert.equal(helpers.isExclusiveLocked("adll"), false, "the beat is open again after a reset");
});

test("every beat is audited for one uniform license, package set and secured lock state", () => {
  const { window } = catalogContextFor();
  const catalog = window.KYROlll_CATALOG;
  const helpers = window.KYROlll_HELPERS;
  const packages = window.KYROlll_PACKAGES;

  // The store's package set is the licensing contract: it may not vary by beat.
  assert.deepEqual(Array.from(packages, (pack) => pack.id), ["mp3", "wav", "exclusive"]);
  assert.deepEqual(Array.from(packages, (pack) => pack.grant), ["non-exclusive", "non-exclusive", "exclusive"],
    "MP3 and WAV are non-exclusive leases; only the exclusive tier grants exclusive rights");
  assert.deepEqual(Array.from(packages, (pack) => pack.gate), ["email", "email", "email"],
    "every package uses the same email + license gate; no social step exists");
  assert(packages.every((pack) => pack.name && pack.blurb && pack.includes.length > 0), "every package carries its own copy and includes");
  assert.match(packages[0].includes.join(" "), /NON-EXCLUSIVE LICENSE/);
  assert.match(packages[1].includes.join(" "), /NON-EXCLUSIVE LICENSE/);
  assert.match(packages[2].includes.join(" "), /FULL EXCLUSIVE RIGHTS — RESELL, RE-LICENSE & TRADE/);

  const ids = new Set();
  const slugs = new Set();
  catalog.forEach((beat) => {
    assert.match(beat.title, /^\[FREE 100%\] /, `${beat.slug}: every release is free`);
    assert(beat.id && beat.slug && beat.img && beat.preview, `${beat.slug}: a beat carries its identity and media`);
    assert(beat.bpm > 0 && beat.key, `${beat.slug}: a beat carries tempo and key`);
    assert(!ids.has(beat.id) && !slugs.has(beat.slug), `${beat.slug}: ids and slugs are unique`);
    ids.add(beat.id);
    slugs.add(beat.slug);
    assert.equal(beat.exclusiveLocked, undefined, `${beat.slug}: no beat ships pre-claimed`);
    ["mp3", "wav", "exclusive"].forEach((packageId) => {
      const files = helpers.deliverablesFor(beat.id, packageId);
      assert(files.length > 0, `${beat.slug}: ${packageId} hands over at least one file`);
      files.forEach((item) => {
        assert.match(item.file, /^assets\//, `${beat.slug}: ${packageId} hands over a same-origin file`);
        const fpath = new URL(`./${item.file}`, import.meta.url).pathname;
        assert(readFileSync(fpath).length > 0, `${beat.slug}: ${item.file} is present`);
      });
    });
    assert.match(helpers.deliverablesFor(beat.id, "exclusive").map((item) => item.file).join(" "), /stems\.zip$/,
      `${beat.slug}: the exclusive tier hands over its tracked stems`);
  });

  // The certificate's terms are shared: one credit rule, one free commercial
  // grant, and two clearly-labelled grant branches (non-exclusive vs exclusive).
  const pdf = readFileSync(new URL("./license-pdf.js", import.meta.url), "utf8");
  assert.match(pdf, /const CREDIT = "\(Prod\. by KYROIII\)";/, "the mandatory credit is one constant");
  assert.match(pdf, /This beat is 100% free for NON-PROFIT and COMMERCIAL \/ PROFIT use/, "the exclusive certificate carries the free commercial grant");
  assert.match(pdf, /This beat is 100% free - for NON-PROFIT and COMMERCIAL \/ PROFIT use/, "the lease carries the free commercial grant");
  assert.match(pdf, /Upload it, stream it, monetise it/, "streaming and monetisation are granted explicitly");
  assert.match(pdf, /Limits: keep the credit, never resell the beat as a/, "a non-exclusive lease names its one limit");
  assert.match(pdf, /This license is non-exclusive, worldwide, perpetual and fully paid-up:/, "the lease is non-exclusive");
  assert.match(pdf, /This license is EXCLUSIVE,/, "the exclusive tier grants exclusive rights");
  assert.match(pdf, /the beat is retired and never licensed again/, "the exclusive tier retires the beat");
  assert.match(pdf, /You may resell, re-license, transfer or trade it/, "the exclusive certificate grants resale and re-licensing freedom");

  assert.match(pdf, /data\.exclusive\s*\n?\s*\? "EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE"/, "the masthead names the exclusive grant");
  assert.match(pdf, /: "NON-EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE"/, "the masthead names the non-exclusive grant");
  assert.match(pdf, /exclusive: pack\.grant/, "the certificate reads the package's grant, so no beat can carry its own terms");

  // The secured state is painted from one place on both surfaces.
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /function exclusiveBadgeHTML\(compact, owned\)[\s\S]*?exclusive-badge--compact/, "the compact tile badge is one renderer");
  assert.match(script, /if \(exclusiveLocked\(beat\)\) \{[\s\S]*?exclusiveBadgeHTML/, "the action slot paints the signature badge for every locked beat");
  assert.match(script, /const pending = !locked && releasePending\(beat\);[\s\S]*?\$\{pending \? dropLockedHTML\(\) : previewHTML\(beat\)\}/, "a claimed beat keeps its player");
  assert.match(script, /<div class="vinyl-record" aria-hidden="true">/, "a claimed beat keeps its vinyl record");
  assert.match(script, /detailCard\.querySelector\('\.vinyl-record'\)/, "the record reveal runs on every beat page");
  assert.match(script, /catalog-tile--exclusive-locked/, "the catalog tile carries its own secured modifier");
});

test("the catalog remembers the visitor's scroll position for the trip back", () => {
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /CATALOG_SCROLL_KEY = "kyrolll_catalog_scroll"/);
  assert.match(script, /sessionStorage\.setItem\(CATALOG_SCROLL_KEY/);
  assert.match(script, /sessionStorage\.getItem\(CATALOG_SCROLL_KEY/);
  assert.match(script, /window\.scrollTo\(\{ top, behavior: "instant" \}\)/);
  assert.match(script, /history\.scrollRestoration = "manual"/);
});

test("every beat is pressed from its own cover, and the beat page keeps a sticky way back", () => {
  const window = {};
  const catalogContext = vm.createContext({ window });
  vm.runInContext(readFileSync(new URL("./catalog.js", import.meta.url), "utf8"), catalogContext);
  const beats = window.KYROlll_CATALOG;
  assert.equal(beats.length, 8, "the eight pressings come from the eight beats");
  beats.forEach((beat) => {
    assert.equal(beat.vinylVariant, undefined, `${beat.slug}: no hand-assigned variant — the cover is the pressing`);
    assert.match(beat.img, /^assets\/.+\.(?:png|jpe?g)$/, `${beat.slug}: the beat carries the cover the palette is read from`);
  });
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.vinyl-record \{[^}]*url\("assets\/vinyl-classic\.png"\)/, "every record paints the photographed pressing");
  assert.match(css, /\.vinyl-record \{[^}]*center \/ contain no-repeat/, "the photographed disc fills its square box");
  assert.match(css, /\.vinyl-record__logo-frame \{[^}]*left: 50%/, "the logo frame is centred on the label");
  assert.match(css, /\.vinyl-record__logo-frame \{[^}]*transform: translate\(-50%, -50%\)/, "the logo frame is centred on the label");
  assert.match(css, /\.vinyl-record__logo-frame \{[^}]*width: 30%/, "the label plate covers the photographed label");
  assert.doesNotMatch(css, /animation: vinylCenterSpin|@keyframes vinylCenterSpin/, "the centre label is a static print, never a spinning logo");
  assert.doesNotMatch(css, /\.vinyl-record__rim|--vinyl-rim-|conic-gradient\(\s*from 215deg/, "no synthetic rim or rim palette remains");
  assert.doesNotMatch(css, /--vinyl-(body|label|marble|vein|flake|groove)-/, "the record takes no cover-derived colour");
  assert.doesNotMatch(css, /\.vinyl-record--(white|gold-rim|sage-white-rim|ice-silver-rim|rage-fire-rim|graffiti-splatter)/,
    "the retired per-beat modifier classes are gone");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="all-beats-link"[^>]*aria-label="Back to all beats"/, "the beat page carries a labelled ALL BEATS control");
  assert.doesNotMatch(html, /vinyl-palette/, "the retired palette module is no longer loaded");
  assert.match(html, /class="site-header__flower"[^>]*>[\s\S]{0,160}?kyrolll-flower-rest\.png/, "the site header carries the spinning flower");
  assert.doesNotMatch(html, /class="yx-focus__flower/, "the focused record adds no second flower");
  assert.doesNotMatch(html, /petals\.js|yx-petals/, "the ambient petal canvas is gone");
  assert.doesNotMatch(html, /class="logo-stage"/, "the archive no longer mounts a second WebGL flower");
  assert.doesNotMatch(html, /<div class="logo-stage[^>]*data-vinyl-flower="true"/, "the centre label no longer mounts the live 3D flower");
  assert.match(html, /<img class="vinyl-record__logo"[^>]*src="assets\/kyrolll-flower-label\.png"/, "the beat card's record shows the original flower logo as a plain image");
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  // The label is the beat page's own artwork, so it is fetched on the spot and
  // decoded synchronously: lazy + async decoding left the plate blank until the
  // flower's decode landed, which is the "logo disappears" the store shipped.
  for (const [name, markup] of [["index.html", html], ["script.js", script]]) {
    assert.match(markup, /class="vinyl-record__logo"[^>]*fetchpriority="high"[^>]*decoding="sync"/,
      `${name}: the label is high priority and decoded synchronously`);
    assert.doesNotMatch(markup, /class="vinyl-record__logo"[^>]*loading="lazy"/,
      `${name}: the label is never lazy-loaded`);
  }
  // The reveal moves the record and nothing else — a disc that faded in left the
  // print arriving semi-transparent, so the tuck suppresses paint instead.
  assert.doesNotMatch(css, /\.vinyl-record \{[^}]*transition:[^}]*opacity/,
    "the disc's reveal never transitions its opacity");
  assert.match(css, /\.js \.beat-detail:not\(\.vinyl-open\) \.vinyl-record \{[^}]*visibility: hidden/,
    "a tucked disc suppresses its paint, gated on the script that will release it");
  assert.doesNotMatch(css, /\.beat-detail:not\(\.vinyl-open\) \.vinyl-record \{[^}]*opacity: 0/,
    "the label print is never faded in");
  assert.match(css, /\.vinyl-record__logo \{[^}]*opacity: 1/,
    "the label print is pinned opaque whatever the disc is doing");
  assert.match(script, /allBeatsLink\.setAttribute\("data-beat-back", ""\)/, "the return control is wired in script.js");
  assert.match(script, /if \(!restoreCatalogScroll\(\)\)/, "the return control restores the saved catalog offset");
});

test("the built-in support desk is wired on every page and posts only the three core fields", () => {
  const support = readFileSync(new URL("./support.js", import.meta.url), "utf8");
  const pages = ["index.html", "download.html", "support.html"]
    .map(name => [name, readFileSync(new URL(`./${name}`, import.meta.url), "utf8")]);
  pages.forEach(([name, html]) => {
    assert.match(html, /class="(?:footer__support|site-footer__support)"[^>]*data-support-open/, `${name}: SUPPORT opens the in-page desk`);
    assert.doesNotMatch(html, /href="mailto:/, `${name}: the footer never hands over a mail app`);
    assert.match(html, /<script src="support\.js\?v=\d+"><\/script>/, `${name}: the desk script is loaded`);
  });
  assert.match(pages[2][1], /data-support-inline/, "support.html mounts the desk inline");
  assert.match(support, /var SUPPORT_ENDPOINT = "https:\/\/formspree\.io\/f\/mrpplrlg"/, "the desk posts to the KYROIII — SUPPORT TICKETS form");
  assert.doesNotMatch(support, /mvkkkoew/, "the desk never contacts the free-download form");
  const catalog = readFileSync(new URL("./catalog.js", import.meta.url), "utf8");
  const downloads = readFileSync(new URL("./downloads.js", import.meta.url), "utf8");
  assert.match(catalog, /https:\/\/formspree\.io\/f\/mvkkkoew/, "free downloads stay on the FREE DOWNLOADS form");
  assert.doesNotMatch(catalog, /mrpplrlg/, "the download config never reaches the support form");
  assert.doesNotMatch(downloads, /mrpplrlg/, "the download layer never reaches the support form");
  assert.match(support, /"Accept": "application\/json", "Content-Type": "application\/json"/, "the desk posts JSON");
  ["email", "subject", "message"]
    .forEach(field => assert.match(support, new RegExp(`\\b${field}:`), `the payload carries ${field}`));
  ["form", "submittedAt", "page", "referrer", "device", "viewport", "language"]
    .forEach(field => assert.doesNotMatch(support, new RegExp(`\\b${field}:`), `the payload drops the ${field} metadata`));
  assert.match(support, /MESSAGE SENT SUCCESSFULLY \/\/ WE WILL GET BACK TO YOU SOON/, "the desk confirms the send professionally");
  assert.doesNotMatch(support, /support-categor|<select/i, "the desk offers no category dropdown");
  ["support-email", "support-subject", "support-message"]
    .forEach(field => assert(support.includes(field), `the desk renders the ${field} field`));
});

test("the footer carries the four official profiles as quiet text links", () => {
  ["index.html", "download.html", "support.html"].forEach((name) => {
    const html = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    const anchors = html.match(/<a href="https:\/\/[^"]+"[^>]*target="_blank"[^>]*>[^<]+<\/a>/g) || [];
    assert.equal(anchors.length, 4, `${name}: four official profiles are linked`);
    ["youtube", "instagram", "tiktok", "x"].forEach((network) => {
      assert(anchors.some(anchor => anchor.includes(`${network}.com`)), `${name}: the ${network} link is present`);
    });
    anchors.forEach(anchor => {
      assert.match(anchor, /rel="noopener noreferrer"/, `${name}: every profile opens safely`);
      assert.doesNotMatch(anchor, /#ff0033|#25f4ee|#fe2c55|kyro-ig-gradient/, `${name}: no brand colour survives in the footer`);
    });
    assert.match(html, /href="https:\/\/www\.instagram\.com\/kyrolll00\/"[^>]*>INSTAGRAM<\/a>/, `${name}: Instagram opens @kyrolll00`);
    assert.match(html, /href="https:\/\/www\.tiktok\.com\/@kyrolll00"[^>]*>TIKTOK<\/a>/, `${name}: TikTok opens @kyrolll00`);
    assert.match(html, /href="https:\/\/x\.com\/KYROlll00"[^>]*>X<\/a>/, `${name}: X opens @KYROlll00`);
  });
});

test("every record is the same photographed pressing with the original flower logo dead centre", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.vinyl-record \{[^}]*url\("assets\/vinyl-classic\.png"\) center \/ contain no-repeat/,
    "the disc is the supplied photograph, cut to the disc");
  assert.doesNotMatch(css, /transparent 0 96\.2%|linear-gradient\(118deg/,
    "no synthetic lead-in band or room-light sheen is painted over the photograph");
  const frame = css.slice(css.indexOf('.vinyl-record__logo-frame {'), css.indexOf('.vinyl-record__logo-frame .logo-stage {'));
  assert.match(frame, /top: 50%/, "the flower frame is centred vertically on the label");
  assert.match(frame, /left: 50%/, "the flower frame is centred horizontally on the label");
  assert.match(frame, /transform: translate\(-50%, -50%\)/, "the flower frame is centred on the label");
  assert.match(frame, /width: 30%/, "the label plate covers the photographed label");
  assert.match(frame, /background: #000000/, "the plate is the logo's own solid black");
  assert.match(frame, /border-radius: 50%/, "the plate is the label's circle");
  assert.match(frame, /overflow: hidden/, "the frame crops the artwork to the circle");
  assert.doesNotMatch(css, /vinylCenterSpin|filter: drop-shadow\(0 0 4px rgba\(122/, "the label takes no spin and no colour filter");
  assert.doesNotMatch(css, /\.vinyl-record__rim|--vinyl-rim-|conic-gradient/, "no synthetic rim palette survives");
});

test("a beat link lands with the return rail already pinned at the top", () => {
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /const target = Math\.max\(0, top\);[\s\S]*?window\.scrollTo\(\{ top: target, behavior: "instant" \}\)/, "the beat page landing is an instant window.scrollTo");
  assert.match(script, /const navHeight = nav && !nav\.hidden \? nav\.getBoundingClientRect\(\)\.height : 0/, "the landing offsets by the pinned rail");
  assert.doesNotMatch(script, /card\.scrollIntoView/, "the landing no longer defers to scrollIntoView");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.beat-navigation \{[^}]*position:\s*sticky/, "the rail is sticky");
  assert.match(css, /\.beat-navigation \{[^}]*top:\s*0/, "the rail pins to the very top");
});

function setup() {
  const listeners = new Map();
  const root = {
    addEventListener: (type, callback) => listeners.set(type, callback),
    emit: (type, target) => listeners.get(type)?.({ target })
  };
  const controller = new BeatPreviewPlayer(root);
  function track(title) {
    const element = () => ({
      attributes: {}, style: { setProperty() {} },
      setAttribute(name, value) { this.attributes[name] = value; }
    });
    const button = element(), seek = element(), time = element(), status = element();
    const player = {
      dataset: { title, state: "idle" },
      querySelector: (selector) => ({
        audio, ".beat-preview__toggle": button, ".beat-preview__seek": seek,
        ".beat-preview__time": time, ".beat-preview__status": status
      })[selector]
    };
    const audio = {
      paused: true, ended: false, duration: NaN, currentTime: 0, dataset: {},
      matches: (selector) => selector === ".beat-preview__audio",
      closest: () => player,
      pause() { this.paused = true; root.emit("pause", this); },
      load() { this.error = null; },
      play() {
        this.paused = false;
        root.emit("play", this);
        return new Promise((resolve, reject) => {
          this.resolve = () => { root.emit("playing", this); resolve(); };
          this.reject = reject;
        });
      }
    };
    button.closest = () => player;
    seek.closest = () => player;
    seek.matches = (selector) => selector === ".beat-preview__seek";
    return { audio, button, seek, time, status, player };
  }
  return { root, controller, track };
}

test("switching previews pauses pending playback and ignores its late rejection", async () => {
  const { controller, track } = setup();
  const first = track("First"), second = track("Second");
  const pendingFirst = controller.toggle(first.audio);
  assert.equal(first.button.attributes["aria-pressed"], "true");
  const pendingSecond = controller.toggle(second.audio);
  assert.equal(first.audio.paused, true);
  assert.equal(first.button.attributes["aria-pressed"], "false");
  first.audio.reject(new Error("Interrupted"));
  second.audio.resolve();
  await Promise.all([pendingFirst, pendingSecond]);
  assert.equal(controller.active, second.audio);
  assert.equal(second.player.dataset.state, "playing");
  assert.equal(first.player.dataset.state, "idle");
  await controller.toggle(second.audio);
  assert.equal(second.audio.paused, true);
  assert.equal(controller.active, null);
});

test("progress, seeking, completion and replay follow the actual audio timeline", async () => {
  const { root, controller, track } = setup();
  const item = track("Timeline");
  const pending = controller.toggle(item.audio);
  item.audio.resolve();
  await pending;
  item.audio.duration = 80;
  item.audio.currentTime = 20;
  root.emit("loadedmetadata", item.audio);
  assert.equal(item.seek.disabled, false);
  assert.equal(item.seek.value, 25);
  assert.equal(item.time.textContent, "0:20 / 1:20");
  item.seek.value = 75;
  root.emit("input", item.seek);
  assert.equal(item.audio.currentTime, 60);
  item.audio.currentTime = 80;
  item.audio.ended = true;
  item.audio.paused = true;
  root.emit("ended", item.audio);
  assert.equal(controller.active, null);
  assert.equal(item.button.attributes["aria-pressed"], "false");
  const replay = controller.toggle(item.audio);
  assert.equal(item.audio.currentTime, 0);
  item.audio.resolve();
  await replay;
});

test("failed files remain retryable, and stopping cancels a late playback event", async () => {
  const { root, controller, track } = setup();
  const item = track("Missing file");
  const pending = controller.toggle(item.audio);
  item.audio.reject(new Error("Unsupported file"));
  await pending;
  assert.equal(controller.active, null);
  assert.match(item.status.textContent, /UNAVAILABLE/);
  item.audio.error = { code: 4 };
  const retry = controller.toggle(item.audio);
  assert.equal(item.audio.error, null);
  controller.stop();
  item.audio.resolve();
  await retry;
  assert.equal(item.audio.paused, true);
  assert.equal(item.button.attributes["aria-pressed"], "false");
  root.emit("error", item.audio);
  assert.equal(item.player.dataset.state, "error");
});
