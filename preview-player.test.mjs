import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("./preview-player.js", import.meta.url), "utf8"), context);
const BeatPreviewPlayer = vm.runInContext("BeatPreviewPlayer", context);

test("the fifth release is scheduled, packaged and pointed at the free-download form", () => {
  const window = {};
  const catalogContext = vm.createContext({ window });
  vm.runInContext(readFileSync(new URL("./catalog.js", import.meta.url), "utf8"), catalogContext);
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

test("the sixth release ADLL is scheduled, packaged and pointed at the free-download form", () => {
  const window = {};
  const catalogContext = vm.createContext({ window });
  vm.runInContext(readFileSync(new URL("./catalog.js", import.meta.url), "utf8"), catalogContext);
  const catalog = window.KYROlll_CATALOG;
  assert.equal(catalog.length, 6, "the catalog carries six releases");
  const beat = window.KYROlll_HELPERS.beatById("adll");
  assert.equal(beat.slug, "adll");
  assert.equal(beat.title, "[FREE 100%] YEAT TYPE BEAT - ADLL");
  assert.equal(beat.shortTitle, "ADLL");
  assert.equal(beat.bpm, 124);
  assert.equal(beat.key, "C#");
  assert.equal(beat.vinylVariant, "graffiti-splatter");
  assert.equal(beat.releaseAt, "2026-10-29T22:00:00+02:00");
  const releaseAt = Date.parse("2026-10-29T22:00:00+02:00");
  assert.equal(window.KYROlll_HELPERS.releaseAt(beat), releaseAt);
  assert.equal(window.KYROlll_HELPERS.isReleased(beat, releaseAt - 1), false);
  assert.equal(window.KYROlll_HELPERS.isReleased(beat, releaseAt), true);
  assert.equal(window.KYROlll_SITE.formspreeEndpoint, "https://formspree.io/f/mvkkkoew");
  assert.equal(window.KYROlll_NEWSLETTER.endpoint, "https://formspree.io/f/mvkkkoew");
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.file), [
    "assets/previews/adll.mp3",
    "assets/previews/adll.wav",
    "assets/previews/adll-stems.zip",
  ]);
  assert.deepEqual(Array.from(beat.deliverables.exclusive, (item) => item.name), [
    "KYROIII - ADLL (124 BPM - C#).mp3",
    "KYROIII - ADLL (124 BPM - C#).wav",
    "KYROIII - ADLL - TRACKED STEMS.zip",
  ]);
});

test("the catalog remembers the visitor's scroll position for the trip back", () => {
  const script = readFileSync(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /CATALOG_SCROLL_KEY = "kyrolll_catalog_scroll"/);
  assert.match(script, /sessionStorage\.setItem\(CATALOG_SCROLL_KEY/);
  assert.match(script, /sessionStorage\.getItem\(CATALOG_SCROLL_KEY/);
  assert.match(script, /window\.scrollTo\(\{ top, behavior: "instant" \}\)/);
  assert.match(script, /history\.scrollRestoration = "manual"/);
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
