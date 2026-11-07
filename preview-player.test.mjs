import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("./preview-player.js", import.meta.url), "utf8"), context);
const BeatPreviewPlayer = vm.runInContext("BeatPreviewPlayer", context);

const catalogContextFor = () => {
  const events = [];
  const window = {
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    dispatchEvent(event) { events.push(event); return true; },
  };
  vm.runInContext(readFileSync(new URL("./catalog.js", import.meta.url), "utf8"), vm.createContext({ window }));
  return { window, events };
};

test("the fifth release is scheduled, packaged and pointed at the free-download form", () => {
  const { window } = catalogContextFor();
  const catalog = window.KYROlll_CATALOG;
  assert.equal(catalog.length, 7, "the catalog carries seven releases");
  const beat = window.KYROlll_HELPERS.beatById("just-d0-it");
  assert.equal(beat.title, "[FREE 100%] YEAT TYPE BEAT - JUST D0 IT");
  assert.equal(beat.shortTitle, "JUST D0 IT");
  assert.equal(beat.bpm, 135);
  assert.equal(beat.key, "Am");
  assert.equal(beat.vinylVariant, undefined, "the pressing is derived from the cover, not hand-assigned");
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
  assert.equal(catalog.length, 7, "the catalog carries seven releases");
  assert.deepEqual(Array.from(catalog, (beat) => beat.slug),
    ["flesh", "the-flow", "green-flesh", "squish", "just-d0-it", "adll", "gunna-type"],
    "the seven beats are intact, in order, with the GUNNA drop as the newest entry");
  const beat = window.KYROlll_HELPERS.beatById("adll");
  assert(beat, "ADLL resolves from its id and slug");
  assert.equal(beat.title, "[FREE 100%] YEAT TYPE BEAT - A.D.L");
  assert.equal(beat.shortTitle, "A.D.L");
  assert.equal(beat.img, "assets/adll.png");
  assert.equal(beat.bpm, 124);
  assert.equal(beat.key, "C#");
  assert.equal(beat.preview, "assets/previews/adll.mp3");
  assert.equal(beat.vinylVariant, undefined, "the pressing is derived from the cover, not hand-assigned");
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
  ["assets/previews/adll.mp3", "assets/previews/adll.wav", "assets/previews/adll-stems.zip", "assets/adll.png"]
    .forEach((asset) => assert(readFileSync(new URL(`./${asset}`, import.meta.url)).length > 0, `${asset} is ingested`));
});

test("the GUNNA drop is scheduled for 22:00 today and every record keeps the flower label", () => {
  const { window } = catalogContextFor();
  const helpers = window.KYROlll_HELPERS;
  const beat = helpers.beatById("gunna-type");
  assert(beat, "the GUNNA drop resolves from its id and slug");
  assert.equal(beat.title, "[FREE 100%] GUNNA TYPE BEAT - VVS MOTION");
  assert.equal(beat.img, "assets/beat-cover.png");
  assert.equal(beat.bpm, 146);
  assert.equal(beat.key, "Fm");
  assert.equal(beat.preview, "assets/previews/gunna-type.mp3");
  assert.equal(beat.vinylVariant, undefined, "the pressing is derived from the cover, not hand-assigned");
  assert.equal(beat.vinylLabel, undefined, "no beat replaces the signature flower with cover art");
  assert.equal(beat.releaseAt, "2026-11-06T22:00:00+02:00", "the drop lands today at exactly 22:00 Israel time");
  const releaseAt = Date.parse("2026-11-06T22:00:00+02:00");
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
  ["assets/beat-cover.png", "assets/previews/gunna-type.mp3", "assets/previews/gunna-type.wav", "assets/previews/gunna-type-stems.zip"]
    .forEach((asset) => assert(readFileSync(new URL(`./${asset}`, import.meta.url)).length > 0, `${asset} is ingested`));

  // Every centre label is the signature KYROIII flower: the 3D WebGL stage is
  // mounted on a div (a canvas cannot host the renderer's own canvas) with the
  // SVG flower as the no-WebGL fallback. The old cover-label path is gone.
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /const VINYL_LABEL_ART = "assets\/kyrolll-flower\.svg"/, "the flower is the one label art");
  assert.doesNotMatch(script, /vinylLabel|vinyl-record--cover/, "no record opts into a cover label");
  assert.match(script, /<div class="logo-stage vinyl-flower-stage"/, "the 3D flower stage is a container, not a canvas");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.vinyl-record--cover/, "the stylesheet carries no cover-label pressing");
  assert.doesNotMatch(css, /url\(assets\/beat-cover\.png\)/, "the stylesheet hard-codes no beat artwork path");
});

test("the exclusive license claims the beat and retires its public leases", () => {
  const { window, events } = catalogContextFor();
  const helpers = window.KYROlll_HELPERS;
  assert.equal(window.KYROlll_EXCLUSIVE_LOCK.label, "[EXCLUSIVE RIGHTS CLAIMED // SECURED]");
  assert.match(window.KYROlll_EXCLUSIVE_LOCK.note, /SECURED WITH EXCLUSIVE RIGHTS AND ARCHIVED FROM PUBLIC RELEASE/);
  assert.equal(helpers.isExclusiveLocked("adll"), false, "a published beat starts unclaimed");
  assert.equal(helpers.lockExclusive("adll"), true, "the exclusive tier claims the beat");
  assert.equal(helpers.isExclusiveLocked("adll"), true);
  assert.equal(window.KYROlll_HELPERS.beatById("adll").exclusiveLocked, true, "the live catalog entry records the claim");
  assert.match(window.KYROlll_HELPERS.beatById("adll").exclusiveLockedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(helpers.lockExclusive("adll"), false, "the exclusive license is issued only once");
  assert.equal(events.length, 1, "the claim is announced once");
  assert.equal(events[0].type, "kyrolll:exclusive-locked");
  assert.equal(events[0].detail.slug, "adll");
  const downloads = readFileSync(new URL("./downloads.js", import.meta.url), "utf8");
  assert.match(downloads, /pack\.id === "exclusive"[\s\S]*?lockExclusive\(beat\.id\)/, "SIGN & UNLOCK claims an exclusive beat");
  assert.match(downloads, /holdExclusiveClaim\(beat\)/, "the download layer refuses a claimed beat");
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /data-exclusive-lock/, "the storefront renders the secured badge");
  assert.match(script, /EXCLUSIVE RIGHTS SECURED/, "the beat page names the secured state");
  assert.match(script, /kyrolll:exclusive-locked/, "the grid repaints when a claim lands");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.exclusive-badge \{[\s\S]*?clip-path: polygon/, "the secured badge wears the cut-corner plate");
  assert.match(css, /\.exclusive-badge::before[\s\S]*?exclusiveScan/, "the badge carries one slow light pass");
  const page = readFileSync(new URL("./download-page.js", import.meta.url), "utf8");
  assert.match(page, /showExclusiveLocked/, "a cold link to a claimed beat shows the secured archive");
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
  assert.match(packages[2].includes.join(" "), /FULL EXCLUSIVE RIGHTS \/ LICENSE/);

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
        assert(readFileSync(new URL(`./${item.file}`, import.meta.url)).length > 0, `${beat.slug}: ${item.file} is present`);
      });
    });
    assert.match(helpers.deliverablesFor(beat.id, "exclusive").map((item) => item.file).join(" "), /stems\.zip$/,
      `${beat.slug}: the exclusive tier hands over its tracked stems`);
  });

  // The certificate's terms are shared: one credit rule, one free commercial
  // grant, and two clearly-labelled grant branches (non-exclusive vs exclusive).
  const pdf = readFileSync(new URL("./license-pdf.js", import.meta.url), "utf8");
  assert.match(pdf, /const CREDIT = "\(Prod\. by KYROIII\)";/, "the mandatory credit is one constant");
  assert.match(pdf, /This beat is 100% free - for NON-PROFIT and COMMERCIAL \/ PROFIT use/, "every license carries the free commercial grant");
  assert.match(pdf, /Upload it, stream it, monetise it/, "streaming and monetisation are granted explicitly");
  assert.match(pdf, /Limits: keep the credit, never resell the beat as a beat or license\./, "the grant names its limit");
  assert.match(pdf, /This license is non-exclusive, worldwide, perpetual and fully paid-up: other artists may/, "the lease is non-exclusive");
  assert.match(pdf, /This license is EXCLUSIVE, worldwide, perpetual and fully paid-up: the beat is retired and/, "the exclusive tier grants exclusive rights and retires the beat");
  assert.match(pdf, /data\.exclusive\s*\n?\s*\? "EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE"/, "the masthead names the exclusive grant");
  assert.match(pdf, /: "NON-EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE"/, "the masthead names the non-exclusive grant");
  assert.match(pdf, /exclusive: pack\.grant/, "the certificate reads the package's grant, so no beat can carry its own terms");

  // The secured state is painted from one place on both surfaces.
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /function exclusiveBadgeHTML\(compact\)[\s\S]*?exclusive-badge--compact/, "the compact tile badge is one renderer");
  assert.match(script, /if \(exclusiveLocked\(beat\)\) \{[\s\S]*?exclusiveBadgeHTML/, "the action slot paints the secured plate for every locked beat");
  assert.match(script, /const locked = exclusiveLocked\(beat\);[\s\S]*?locked \? exclusiveLockedHTML\(\)/, "the beat page replaces the player with the secured notice");
  assert.match(script, /catalog-tile--exclusive-locked/, "the catalog tile carries its own secured modifier");
  assert.match(script, /exclusive-lock__note/, "the secured notice carries the archive disclaimer");
  assert.match(script, /KYROlll_EXCLUSIVE_LOCK/, "the storefront reads the shared lock copy");
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
  assert.equal(beats.length, 7, "the seven pressings come from the seven beats");
  beats.forEach((beat) => {
    assert.equal(beat.vinylVariant, undefined, `${beat.slug}: no hand-assigned variant — the cover is the pressing`);
    assert.match(beat.img, /^assets\/.+\.png$/, `${beat.slug}: the beat carries the cover the palette is read from`);
  });
  const palette = readFileSync(new URL("./vinyl-palette.js", import.meta.url), "utf8");
  assert.match(palette, /beat\.img/, "the palette engine reads the beat's own cover");
  assert.match(palette, /drawImage\(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE\)/, "the cover is sampled on an offscreen canvas");
  assert.match(palette, /--vinyl-body-1/, "the reading becomes the record's body tone");
  assert.match(palette, /--vinyl-label-1/, "the reading becomes the centre-label tone");
  assert.match(palette, /--vinyl-rim-2/, "the reading becomes the foil-rim tone");
  assert.match(palette, /--vinyl-label-size/, "each pressing gets its own seeded label size");
  assert.match(palette, /CACHE\.set\(key, palette\)/, "the palette is cached in memory per cover");
  assert.doesNotMatch(palette, /localStorage|sessionStorage|document\.cookie/, "the palette is never written down");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.vinyl-record--pressing \{[\s\S]*?var\(--vinyl-body-1\)/, "one rule set paints every pressing from the cover palette");
  assert.match(css, /\.vinyl-record__rim \{[\s\S]*?conic-gradient\(\s*from 215deg/, "the foil rim is a masked conic hairline");
  assert.match(css, /\.vinyl-record__logo \{[\s\S]*?animation: vinylCenterSpin 16s linear infinite/, "the pressing logo keeps its 16s linear spin");
  assert.doesNotMatch(css, /\.vinyl-record--(white|gold-rim|sage-white-rim|ice-silver-rim|rage-fire-rim|graffiti-splatter)/,
    "the retired per-beat modifier classes are gone");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="all-beats-link"[^>]*aria-label="Back to all beats"/, "the beat page carries a labelled ALL BEATS control");
  assert.match(html, /<script src="vinyl-palette\.js\?v=\d+"><\/script>/, "the palette module is loaded before the grid renders");
  assert.match(html, /<div class="logo-stage vinyl-flower-stage" data-vinyl-flower="true"/, "the centre label still mounts the live 3D flower");
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /allBeatsLink\.setAttribute\("data-beat-back", ""\)/, "the return control is wired in script.js");
  assert.match(script, /if \(!restoreCatalogScroll\(\)\)/, "the return control restores the saved catalog offset");
});

test("the built-in support desk is wired on every page and posts only the three core fields", () => {
  const support = readFileSync(new URL("./support.js", import.meta.url), "utf8");
  const pages = ["index.html", "download.html", "support.html"]
    .map(name => [name, readFileSync(new URL(`./${name}`, import.meta.url), "utf8")]);
  pages.forEach(([name, html]) => {
    assert.match(html, /class="footer__support"[^>]*data-support-open/, `${name}: SUPPORT opens the in-page desk`);
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

test("the footer carries the four official social marks as large SVG badges", () => {
  ["index.html", "download.html", "support.html"].forEach((name) => {
    const html = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
    const anchors = html.match(/<a class="social-icon social-icon--[a-z]+"[\s\S]*?<\/a>/g) || [];
    assert.equal(anchors.length, 4, `${name}: four official profiles are linked`);
    ["youtube", "instagram", "tiktok", "x"].forEach((network) => {
      assert(anchors.some(anchor => anchor.includes(`social-icon--${network}`)), `${name}: the ${network} badge is present`);
      assert(anchors.some(anchor => anchor.includes(`social-icon--${network}`) && anchor.includes('aria-label="KYROIII on ')), `${name}: the ${network} badge is labelled`);
    });
    anchors.forEach(anchor => assert.match(anchor, /<svg viewBox="0 0 24 24"/, `${name}: every badge is a real SVG mark`));
    assert.match(html, /social-icon--youtube[\s\S]*?fill="#ff0033"/, `${name}: YouTube keeps its red play badge`);
    assert.match(html, /social-icon--instagram[\s\S]*?kyro-ig-gradient/, `${name}: Instagram keeps its gradient mark`);
    assert.match(html, /social-icon--tiktok[\s\S]*?fill="#25f4ee"/, `${name}: TikTok keeps its cyan offset`);
    assert.match(html, /social-icon--x[\s\S]*?fill="#fff"/, `${name}: X keeps its minimalist logo`);
    assert.match(html, /social-icon--instagram" href="https:\/\/www\.instagram\.com\/kyrolll00\/"/, `${name}: Instagram opens @kyrolll00`);
    assert.match(html, /social-icon--tiktok" href="https:\/\/www\.tiktok\.com\/@kyrolll00"/, `${name}: TikTok opens @kyrolll00`);
    assert.match(html, /social-icon--x" href="https:\/\/x\.com\/KYROlll00"/, `${name}: X opens @KYROlll00`);
  });
});

test("every pressing shares one physical finish — a solid body, a lead-in band and one room light", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.equal((css.match(/transparent 0 96\.2%/g) || []).length, 2,
    "the base disc and the shared pressing rule carry the unrecorded lead-in band");
  assert.equal((css.match(/linear-gradient\(118deg/g) || []).length, 2,
    "the base disc and the shared pressing take the same fixed room-light sheen");
  const block = css.slice(css.indexOf('.vinyl-record--pressing {'), css.indexOf('.vinyl-record--pressing::before'));
  assert.match(block, /var\(--vinyl-lip\)/, "the lead-in band tone comes from the pressing");
  assert.match(block, /var\(--vinyl-sheen-1\)/, "the room light comes from the pressing");
  assert.match(block, /radial-gradient\(circle at 50% 50%, var\(--vinyl-body-1\)/, "the pressing body is one opaque cover-derived fill");
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
