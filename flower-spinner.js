/* KYROIII — branded flower loading indicator.
 *
 * The store never shows a blank grey box while a beat's artwork is arriving:
 * the official flower, turning in three dimensions exactly like the hero's,
 * stands in for the image until it is decoded. The same flower answers a tap on
 * an audio preview (see the `.beat-preview[data-state="loading"]` rules in
 * style.css), so every wait in the store reads as the brand.
 *
 * The indicator is a captured render of the actual 3D flower — the same
 * `kyrolll-flower-rest.png` the hero hands off from — animated on one local CSS
 * transform. It is deliberately not a second WebGL scene: a card's image can
 * spend milliseconds loading, and building a renderer for each one would cost
 * far more than the wait it covers.
 *
 * This helper only adds/removes state on the image's own container. Nothing is
 * fetched, nothing is stored and nothing listens to scroll: the `load`/`error`
 * events (captured at the document, since they do not bubble) are the whole
 * contract. If the script never runs, the images render exactly as before.
 */
(function () {
  "use strict";

  // A container opts in with `data-flower-loader`; the artwork slots the
  // storefront ships are picked up automatically. `.yx-card__media` is the
  // archive grid's cover and `.yx-focus__art` is the focused/zoom view, so both
  // places a beat cover is painted answer a wait with the same flower.
  const CONTAINER = "[data-flower-loader], .catalog-tile__art, .beat-detail__artwork, .yx-card__media, .yx-focus__art";
  const SPINNER = '<span class="flower-spinner" aria-hidden="true"><span class="flower-spinner__flower"></span></span>';
  const bound = new WeakSet();

  function spinnerFor(container) {
    let node = container.querySelector(".flower-spinner");
    if (!node) {
      container.insertAdjacentHTML("beforeend", SPINNER);
      node = container.querySelector(".flower-spinner");
    }
    return node;
  }

  function begin(container) {
    container.classList.remove("is-loaded", "is-failed");
    container.classList.add("is-loading");
    container.setAttribute("aria-busy", "true");
    spinnerFor(container);
  }

  function end(container, failed) {
    if (!container) return;
    container.classList.remove("is-loading");
    container.removeAttribute("aria-busy");
    container.classList.add(failed ? "is-failed" : "is-loaded");
    const node = container.querySelector(".flower-spinner");
    if (!node) return;
    // Fade the indicator out over the image that just arrived, then drop the
    // node so a settled card carries no idle animation at all. The grace is
    // longer than the CSS cross-fade so its last frame is never clipped.
    node.classList.add("is-done");
    window.setTimeout(() => node.remove(), 500);
  }

  /* Resolve one image against its cover slot. `track` is idempotent, so a grid
     that is re-watched never restarts a wait, while the focused cover — whose
     `src` is rewritten on every open — can be re-tracked and start the flower
     again for a cover that is not in the browser's cache yet. */
  function track(img) {
    const container = img.closest(CONTAINER);
    if (!container) return;
    img.classList.add("flower-media");
    // A re-tracked cover (a new src on the same element) starts from a clean
    // slate: the previous indicator and its settled state are dropped first.
    const stale = container.querySelector(".flower-spinner");
    if (stale) stale.remove();
    container.classList.remove("is-loading", "is-loaded", "is-failed");
    container.removeAttribute("aria-busy");
    // An image the browser already holds (a cache hit, or one that finished
    // before this script ran) never needs a spinner.
    if (img.complete && img.naturalWidth > 0) {
      container.classList.add("is-loaded");
      return;
    }
    if (img.complete) {
      container.classList.add("is-failed");
      return;
    }
    begin(container);
  }

  function bind(img) {
    if (!img || bound.has(img) || img.tagName !== "IMG") return;
    /* A decorative image inside a covered slot — the claimed card's flower seal
       — must never drive the cover's loading state: the cover is the thing the
       wait belongs to, and a lazy seal arriving late would otherwise hide an
       already-painted cover behind a spinner. */
    if (img.hasAttribute("data-flower-skip")) return;
    if (!img.closest(CONTAINER)) return;
    bound.add(img);
    track(img);
  }

  /* Re-read an image whose `src` just changed (the focused cover). The element
     is already observed, so this only re-evaluates its current state. */
  function refresh(img) {
    if (!img || img.tagName !== "IMG" || img.hasAttribute("data-flower-skip")) return;
    if (!img.closest(CONTAINER)) return;
    bound.add(img);
    track(img);
  }

  function watch(root) {
    const scope = root && root.nodeType === 1 ? root : document;
    if (scope.matches && scope.matches("img")) bind(scope);
    if (scope.querySelectorAll) scope.querySelectorAll("img").forEach(bind);
  }

  function settle(event, failed) {
    const img = event.target;
    if (!img || img.tagName !== "IMG") return;
    end(img.closest(CONTAINER), failed);
  }

  // `load` and `error` do not bubble, so the document listens in the capture
  // phase. This also catches every image a later grid render inserts.
  document.addEventListener("load", (event) => settle(event, false), true);
  document.addEventListener("error", (event) => settle(event, true), true);

  window.KYROlll_FLOWER_SPINNER = { watch, refresh, markup: SPINNER };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => watch(document), { once: true });
  } else {
    watch(document);
  }
})();
