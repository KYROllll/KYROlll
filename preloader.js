/* KYROlll — page-load preloader.
 *
 * The fixed veil covers the very first paint, shows the 3D flower (mounted by
 * brand-logo.min.js into its own .logo-stage) and fades out once the flower has
 * painted its first frame. A minimum display time keeps the boot feeling
 * deliberate rather than flickery; a hard cap guarantees the site is never
 * stranded under the veil even if WebGL fails (the static flower image covers
 * that case). After the fade the veil is removed and the preloader flower's
 * render loop is released via the `kyrolll:preloader-done` event.
 *
 * The bar is driven from a single requestAnimationFrame loop that eases a
 * displayed value toward a moving target, so it fills in one continuous motion
 * instead of stepping once per timer tick. The matching `.preloader__progress-bar`
 * carries no CSS width transition on purpose (see style.css): a transition
 * re-started on every tick is what made the old bar stutter and jump.
 */
(function () {
  "use strict";

  const overlay = document.getElementById("preloader");
  if (!overlay) return;
  const bar = document.getElementById("preloader-bar");

  /* The bar is painted with `transform: scaleX()` rather than `width` so the
   * compositor can move it without layout, and so no transition is needed. */
  function setBar(p) {
    if (!bar) return;
    const v = Math.max(0, Math.min(1, p));
    bar.style.transform = "scaleX(" + v + ")";
  }
  function setFlower(p) {
    if (typeof window.KYROLLL_FLOWER_PROGRESS === "function") {
      window.KYROLLL_FLOWER_PROGRESS(p);
    }
  }

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN_MS = reduceMotion ? 450 : 1150; // deliberate minimum on screen
  const HARD_CAP_MS = 6000; // never wait past this for a "ready" signal
  const HOLD_MS = reduceMotion ? 200 : 700; // stable pause once at 100%
  const FADE_MS = 550; // keep in step with .preloader opacity transition
  const CREEP_MAX = 0.9; // where the bar sits while the page is still working
  const CREEP_MS = reduceMotion ? 500 : 1900; // time to ease out to CREEP_MAX
  const EASE = 0.12; // per-60fps-frame approach toward the target

  const started = performance.now();
  let displayed = 0; // what the bar currently shows (0 → 1)
  let target = 0; // where it is heading
  let reachedAt = 0; // when it first hit 100%
  let last = started;
  let raf = 0;
  let dismissing = false;

  setBar(0);

  const flowerReady = () => !!overlay.querySelector(".logo-stage.is-ready");
  const pageSettled = () => document.readyState === "complete";

  /* Smooth, monotonic climb toward 90% that never snaps: a cubic ease-out over
   * CREEP_MS, then a flat hold at CREEP_MAX until the page reports ready. */
  function creepTarget(elapsed) {
    const t = Math.min(1, elapsed / CREEP_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    return CREEP_MAX * eased;
  }

  function dismiss() {
    if (dismissing) return;
    dismissing = true;
    cancelAnimationFrame(raf);
    // Land exactly on 100% before the veil goes, in case the last frame was a
    // hair short (the loop snaps at 99.9%, but be defensive).
    displayed = 1;
    target = 1;
    setBar(1);
    setFlower(1);
    overlay.classList.add("is-done"); // fades out via CSS

    let removed = false;
    const finish = () => {
      if (removed) return;
      removed = true;
      if (overlay.parentNode) overlay.remove();
      document.dispatchEvent(new CustomEvent("kyrolll:preloader-done"));
    };
    // transitionend is the happy path; the timeout guarantees the veil leaves
    // even if the event is missed (element hidden, transition disabled, ...).
    overlay.addEventListener("transitionend", (event) => {
      if (event.target === overlay && event.propertyName === "opacity") finish();
    });
    setTimeout(finish, FADE_MS + 250);
  }

  function frame(now) {
    if (dismissing) return;
    const dt = Math.min(now - last, 100); // clamp across tab stalls
    last = now;
    const elapsed = now - started;

    const ready = flowerReady() || pageSettled() || elapsed >= HARD_CAP_MS;
    const goal = ready ? 1 : creepTarget(elapsed);
    if (goal > target) target = goal; // monotonic: never step backwards

    // Frame-rate independent approach toward the target.
    const k = 1 - Math.pow(1 - EASE, dt / 16.667);
    displayed += (target - displayed) * k;
    if (displayed > 1) displayed = 1;
    if (displayed >= 0.999) displayed = 1; // snap only the last sub-pixel

    setBar(displayed);
    setFlower(displayed);

    if (displayed >= 1 && target >= 1) {
      if (!reachedAt) reachedAt = now;
      // Hold a stable moment at 100% (respecting the minimum display time)
      // before reliably starting the fade-out.
      if (now - reachedAt >= HOLD_MS && elapsed >= MIN_MS) {
        dismiss();
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // Belt and braces: if the render loop is starved (hidden tab, throttled rAF,
  // a thrown error elsewhere), still dismiss well after the hard cap.
  setTimeout(() => {
    if (!dismissing) dismiss();
  }, HARD_CAP_MS + MIN_MS + HOLD_MS + FADE_MS);
})();
