/* KYROlll — page-load preloader.
 *
 * The fixed veil covers the very first paint, shows the 3D flower (mounted by
 * brand-logo.min.js into its own .logo-stage) and does not lift until the
 * page's own flower reports that it is **ready** (its first frame has painted
 * behind the still image), **built** (every petal has been revealed) and a
 * settle beat has passed. The veil is opaque and the page behind it is frozen
 * (`html.preloader-armed`), so the hero can never pop in half-drawn: nothing is
 * revealed until the flower is whole. After the fade the veil is removed and the
 * preloader flower's render loop is released via the `kyrolll:preloader-done`
 * event.
 *
 * A minimum display time keeps the boot feeling deliberate rather than flickery;
 * a hard cap guarantees the site is never stranded under the veil even if WebGL
 * fails (the static flower image covers that case, and brand-logo marks a failed
 * stage `failed` so the veil can lift at once).
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
    if (typeof window.KYROlll_FLOWER_PROGRESS === "function") {
      window.KYROlll_FLOWER_PROGRESS(p);
    }
  }

  // The stage the veil is really waiting for: the page's own flower when it has
  // one (the hero on the storefront, the login flower on auth), otherwise the
  // preloader's own display flower (utility pages that carry only the veil).
  // brand-logo.js publishes lifecycle onto each stage:
  //   - `is-ready`        — the WebGL canvas has painted its first frame
  //   - `is-built`        — every petal is on screen and a frame has settled
  //   - `dataset.flower`  — "built" / "failed", so plain DOM reads work too
  const stages = Array.from(document.querySelectorAll(".logo-stage"));
  const heroStage = stages.find((stage) => !stage.closest("#preloader")) || stages[0] || null;
  const stageReady = () => !heroStage || heroStage.dataset.flower === "failed" ||
    heroStage.classList.contains("is-ready");
  const stageBuilt = () => !heroStage || heroStage.dataset.flower === "failed" ||
    heroStage.dataset.flower === "built" || heroStage.classList.contains("is-built");

  // The sign-in page is a utility screen: its form has to be usable the instant
  // it has painted, so its veil lifts on DOM-ready and only lingers for a beat.
  const fastPage = !!document.getElementById("auth-page");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN_MS = fastPage ? (reduceMotion ? 250 : 320) : (reduceMotion ? 450 : 1150);
  const HARD_CAP_MS = fastPage ? 2400 : 6000; // never wait past this for a "ready" signal
  const HOLD_MS = fastPage ? 120 : (reduceMotion ? 200 : 700); // stable pause once at 100%
  const FADE_MS = 550; // keep in step with .preloader opacity transition
  const CREEP_MAX = 0.9; // where the bar sits while the page is still working
  const CREEP_MS = reduceMotion ? 500 : 1900; // time to ease out to CREEP_MAX
  const EASE = 0.12; // per-60fps-frame approach toward the target
  // The still → canvas cross-fade in .logo-stage is .4s. Hold the veil past it
  // so the hand-off from image to render is never seen by the visitor. Reduced
  // motion cancels that transition, and the fast pages skip the wait entirely.
  const SETTLE_MS = fastPage || reduceMotion ? 0 : 480;

  const started = performance.now();
  let displayed = 0; // what the bar currently shows (0 → 1)
  let target = 0; // where it is heading
  let readyAt = 0; // when the page's flower first reported ready
  let reachedAt = 0; // when it first hit 100%
  let last = started;
  let raf = 0;
  let dismissing = false;

  setBar(0);

  const pageSettled = () => document.readyState === "complete" || (fastPage && document.readyState !== "loading");
  const timedOut = () => performance.now() - started >= HARD_CAP_MS;

  /* The page's work is done once its flower has painted (or a failed flower has
   * been written off, or there is no flower at all). The hard cap is the only
   * escape hatch — without it a WebGL-less browser would hold the veil forever. */
  const workReady = () => fastPage ? pageSettled() : (!heroStage ? pageSettled() : stageReady() || timedOut());
  const fullyBuilt = () => fastPage || !heroStage || stageBuilt() || timedOut();

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
      document.documentElement.classList.remove("preloader-armed");
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

    // The bar is allowed to finish exactly when the page's flower is ready; it
    // eases there — and easing the bar to 1 is what drives the flower's own
    // progress to 1, which is what marks it "built". No early `pageSettled`
    // shortcut: document "complete" routinely fires before the 3D flower has
    // even started drawing, and lifting the veil then is the pop-in artifact.
    const ready = workReady();
    const goal = ready ? 1 : creepTarget(elapsed);
    if (goal > target) target = goal; // monotonic: never step backwards
    if (ready && !readyAt) readyAt = now;

    // Frame-rate independent approach toward the target.
    const k = 1 - Math.pow(1 - EASE, dt / 16.667);
    displayed += (target - displayed) * k;
    if (displayed > 1) displayed = 1;
    if (displayed >= 0.999) displayed = 1; // snap only the last sub-pixel

    setBar(displayed);
    setFlower(displayed);

    if (displayed >= 1 && target >= 1 && fullyBuilt() && readyAt && now - readyAt >= SETTLE_MS) {
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
  }, HARD_CAP_MS + MIN_MS + HOLD_MS + FADE_MS + SETTLE_MS);
})();
