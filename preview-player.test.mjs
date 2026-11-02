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
  assert.equal(catalog.length, 6, "the catalog carries six releases");
  const beat = window.KYROlll_HELPERS.beatById("just-d0-it");
  assert.equal(beat.title, "[FREE 100%] YEAT TYPE BEAT - JUST D0 IT");
  assert.equal(beat.shortTitle, "JUST D0 IT");
  assert.equal(beat.bpm, 135);
  assert.equal(beat.key, "Am");
  assert.equal(beat.vinylVariant, "rage-fire-rim");
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
  assert.equal(catalog.length, 6, "the catalog carries six releases");
  assert.deepEqual(Array.from(catalog, (beat) => beat.slug),
    ["flesh", "the-flow", "green-flesh", "squish", "just-d0-it", "adll"],
    "the six beats are intact, in order, with ADLL as the newest entry");
  const beat = window.KYROlll_HELPERS.beatById("adll");
  assert(beat, "ADLL resolves from its id and slug");
  assert.equal(beat.title, "[FREE 100%] YEAT TYPE BEAT - A.D.L");
  assert.equal(beat.shortTitle, "A.D.L");
  assert.equal(beat.img, "assets/adll.png");
  assert.equal(beat.bpm, 124);
  assert.equal(beat.key, "C#");
  assert.equal(beat.preview, "assets/previews/adll.mp3");
  assert.equal(beat.vinylVariant, "graffiti-splatter");
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

test("the catalog remembers the visitor's scroll position for the trip back", () => {
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /CATALOG_SCROLL_KEY = "kyrolll_catalog_scroll"/);
  assert.match(script, /sessionStorage\.setItem\(CATALOG_SCROLL_KEY/);
  assert.match(script, /sessionStorage\.getItem\(CATALOG_SCROLL_KEY/);
  assert.match(script, /window\.scrollTo\(\{ top, behavior: "instant" \}\)/);
  assert.match(script, /history\.scrollRestoration = "manual"/);
});

test("every beat keeps its own bespoke pressing, and the beat page keeps a sticky way back", () => {
  const window = {};
  const catalogContext = vm.createContext({ window });
  vm.runInContext(readFileSync(new URL("./catalog.js", import.meta.url), "utf8"), catalogContext);
  const pressings = Object.fromEntries(window.KYROlll_CATALOG.map((beat) => [beat.slug, beat.vinylVariant]));
  assert.deepEqual(pressings, {
    flesh: "white",
    "the-flow": "gold-rim",
    "green-flesh": "sage-white-rim",
    squish: "ice-silver-rim",
    "just-d0-it": "rage-fire-rim",
    adll: "graffiti-splatter",
  }, "each release keeps its own collector pressing");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /\.vinyl-record--white \{[\s\S]*?rgba\(38, 38, 38, 0\.38\)/, "FLESH is a charcoal-marbled pearl disc");
  assert.match(css, /\.vinyl-record--gold-rim::before \{[\s\S]*?rgba\(212, 175, 55, 0\.55\)/, "THE FLOW suspends gold flake dust");
  assert.match(css, /\.vinyl-record--sage-white-rim \{[\s\S]*?rgba\(214, 230, 221, 0\.24\)/, "GREEN FLESH is a marbled sage disc");
  assert.match(css, /\.vinyl-record--ice-silver-rim \{[\s\S]*?linear-gradient\(116deg/, "SQUISH! is a diamond-cut silver disc");
  assert.match(css, /\.vinyl-record--graffiti-splatter \{[\s\S]*?rgba\(255, 255, 255, 0\.72\)/, "ADLL is a deep matte black disc dusted with white aerosol");
  assert.match(css, /\.vinyl-record__logo \{[\s\S]*?animation: vinylCenterSpin 16s linear infinite/, "the pressing logo keeps its 16s linear spin");
  assert.match(css, /\.beat-navigation \{[^}]*position:\s*sticky/, "the ALL BEATS rail is sticky");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="all-beats-link"[^>]*aria-label="Back to all beats"/, "the beat page carries a labelled ALL BEATS control");
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

test("all six pressings share a solid body, a lead-in band and one room light", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const leadIn = (css.match(/transparent 0 96\.2%/g) || []).length;
  const sheen = (css.match(/linear-gradient\(118deg/g) || []).length;
  assert.equal(leadIn, 7, "the base disc and all six pressings carry the unrecorded lead-in band");
  assert.equal(sheen, 7, "the base disc and all six pressings take the same fixed room-light sheen");
});

test("a beat link lands with the return rail already pinned at the top", () => {
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /window\.scrollTo\(\{ top: Math\.max\(0, top\), behavior: "instant" \}\)/, "the beat page landing is an instant window.scrollTo");
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
