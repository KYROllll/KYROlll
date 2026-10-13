/* KYROlll — live marquee ticker.
 *
 * Renders the white announcement strip under the hero from live sources:
 *   1. Every catalog beat (newest first) is turned into a "NEW DROP — …"
 *      headline automatically — add a beat to catalog.js and it appears here.
 *   2. Studio intelligence derived from the same catalog: how many releases are
 *      live and which one is freshest out the workshop, so the feed stays
 *      accurate with no manual editing.
 *   3. The hand-written updates in marquee-items.js (window.KYROlll_MARQUEE).
 *
 * Motion is driven here, not by a CSS percentage keyframe. The strip is two
 * identical copies of one measured unit and the scroll is an exact pixel
 * translate handed to the Web Animations API, so it runs on the compositor
 * thread at a true 60fps even while the main thread is busy building the 3D
 * flower. `translateX(-50%)` had to be re-resolved from the element's width
 * every single frame and could land on a fractional device pixel, which is what
 * made the old strip shimmer and pop a hair at every wrap. Constant px/s speed
 * also means a longer feed rolls for longer instead of racing past.
 *
 * The headline order only rotates while the strip is off-screen: rebuilding the
 * track is the one operation that could drop a frame, so it is always done
 * where nobody can see it.
 */
(function () {
  "use strict";

  const banner = document.querySelector(".marquee-banner");
  const track = document.querySelector(".marquee-track");
  if (!banner || !track) return;

  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  // Newest catalog beat first; older releases follow in reverse catalog order.
  function headlineItems() {
    const catalog = window.KYROlll_CATALOG || [];
    const drops = catalog.slice().reverse().map((beat) =>
      "NEW DROP — " + beat.title + " — " + beat.bpm + " BPM // " + beat.key + " — IN THE CRATE"
    );
    // Studio intelligence, computed from the catalog so the ticker never drifts
    // from what the shop actually holds: the live release count plus the single
    // freshest beat, worded like a studio note rather than a stock counter.
    const studio = [];
    if (catalog.length) {
      studio.push(
        "STUDIO UPDATE — " + catalog.length + (catalog.length === 1 ? " RELEASE LIVE" : " RELEASES LIVE") +
        " — MASTERS & LEASES READY"
      );
      const newest = catalog[catalog.length - 1];
      if (newest) {
        studio.push("FRESHEST OUT THE STUDIO — " + newest.title + " — " + newest.bpm + " BPM // " + newest.key);
      }
    }
    const news = (window.KYROlll_MARQUEE || []).filter((item) => item && item.trim());
    const items = drops.concat(studio, news);
    return items.length ? items : ["KYROlll — ORIGINAL SOUND"];
  }

  // Linear travel speed in CSS pixels per second — constant no matter how many
  // headlines the feed holds.
  const SPEED = 64;
  const MAX_REPEATS = 4; // fill very wide viewports without an absurd DOM
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  let rotation = 0;
  let copyWidth = 0;
  let cycleMs = 0;
  let animation = null;
  let rotateTimer = 0;
  let resizeFrame = 0;
  let visible = true;
  let manuallyPaused = false;

  // One copy of the ticker: the LIVE badge plus the rotated headline set,
  // repeated `repeats` times. Spacing lives on the children (style.css) rather
  // than a flex `gap`, so a copy is self-contained and the seam between the two
  // copies is flush.
  function copyHTML(repeats) {
    const items = headlineItems();
    const ordered = items.map((_, index) => items[(index + rotation) % items.length]);
    const headlines = ordered.map((text) => "<span>" + esc(text) + "</span>").join("");
    return '<span class="marquee-copy">' +
      '<span class="marquee-live"><span class="marquee-live__dot"></span>LIVE FEED</span>' +
      headlines.repeat(repeats) +
      "</span>";
  }

  function measure() {
    const copy = track.firstElementChild;
    // Round to whole CSS pixels so the wrap lands on a stable pixel instead of a
    // sub-pixel the compositor has to resample.
    copyWidth = copy ? Math.round(copy.getBoundingClientRect().width) : 0;
  }

  // Build two identical copies, widening the unit until a single copy spans the
  // banner so a wrap can never reveal a gap on an ultra-wide display.
  function renderContent() {
    let repeats = 1;
    track.innerHTML = copyHTML(repeats) + copyHTML(repeats);
    while (track.children[0].getBoundingClientRect().width < banner.clientWidth && repeats < MAX_REPEATS) {
      repeats += 1;
      track.innerHTML = copyHTML(repeats) + copyHTML(repeats);
    }
    measure();
  }

  function stopAnimation() {
    if (animation) {
      try { animation.cancel(); } catch (error) { /* ignore */ }
      animation = null;
    }
    track.classList.remove("is-scrolling");
    track.style.removeProperty("--marquee-shift");
    track.style.removeProperty("--marquee-duration");
  }

  // Fraction is the position within a cycle (0 → 1) worth resuming from, kept
  // across a rebuild so a resize or rotation never snaps the ticker to zero.
  function startAnimation(fraction) {
    stopAnimation();
    if (reduceMotion.matches || copyWidth <= 0) return;
    cycleMs = Math.max(6000, (copyWidth / SPEED) * 1000);
    if (typeof track.animate === "function") {
      // Explicit pixel keyframes keep the animation on the compositor thread.
      animation = track.animate(
        [{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(" + (-copyWidth) + "px, 0, 0)" }],
        { duration: cycleMs, iterations: Infinity, easing: "linear" }
      );
    } else {
      // Fallback for engines without the Web Animations API: the same measured
      // shift, applied through a plain keyframe animation.
      track.style.setProperty("--marquee-shift", (-copyWidth) + "px");
      track.style.setProperty("--marquee-duration", cycleMs + "ms");
      track.classList.add("is-scrolling");
    }
    if (animation && fraction) animation.currentTime = (fraction % 1) * cycleMs;
    applyPlayState();
  }

  function applyPlayState() {
    if (!animation) return;
    if (reduceMotion.matches || manuallyPaused || !visible || document.hidden) animation.pause();
    else animation.play();
  }

  function refresh() {
    const fraction = animation && cycleMs
      ? ((Number(animation.currentTime) || 0) % cycleMs) / cycleMs
      : 0;
    renderContent();
    startAnimation(fraction);
    scheduleRotation();
  }

  // Cycle the headline order after each full loop — but only while the strip is
  // off-screen, where rebuilding the track cannot be seen. If it is on screen we
  // simply wait and try again, so the scroll never visibly hitches.
  function scheduleRotation() {
    clearTimeout(rotateTimer);
    if (reduceMotion.matches) return;
    rotateTimer = setTimeout(() => {
      if (visible) { scheduleRotation(); return; }
      rotation += 1;
      refresh();
    }, Math.max(1000, cycleMs));
  }

  renderContent();
  startAnimation(0);
  scheduleRotation();

  // Watch visibility so the rebuild-while-hidden rule can be honoured, and so an
  // off-screen strip stops burning compositor time while the page is busy.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      applyPlayState();
    }).observe(banner);
  }

  addEventListener("resize", () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; refresh(); });
  }, { passive: true });

  // Web fonts change the measured width; re-measure once they have landed.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refresh());

  document.addEventListener("visibilitychange", applyPlayState);
  document.addEventListener("motion-toggle", (event) => {
    manuallyPaused = !!(event.detail && event.detail.paused);
    applyPlayState();
  });
  reduceMotion.addEventListener("change", () => refresh());
})();
