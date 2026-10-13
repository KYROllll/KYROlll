/* KYROlll — page-load preloader.
 *
 * The fixed veil covers the very first paint, shows the 3D flower (mounted by
 * brand-logo.min.js into its own .logo-stage) and fades out once the flower has
 * painted its first frame. A minimum display time keeps the boot feeling
 * deliberate rather than flickery; a hard cap guarantees the site is never
 * stranded under the veil even if WebGL fails (the static flower image covers
 * that case). After the fade the veil is removed and the preloader flower's
 * render loop is released via the `kyrolll:preloader-done` event.
 */
(function () {
  "use strict";

  const overlay = document.getElementById("preloader");
  if (!overlay) return;
  const bar = document.getElementById("preloader-bar");
  function setBar(p) { if (bar) bar.style.width = Math.round(Math.max(0, Math.min(100, p * 100))) + "%"; }

  setBar(0);
  const started = performance.now();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN_MS = reduceMotion ? 450 : 1150;
  const HARD_CAP_MS = 6000;
  let done = false;
  let timer = 0;

  const flowerReady = () => !!overlay.querySelector(".logo-stage.is-ready");
  const pageSettled = () => document.readyState === "complete";

  function finish() {
    if (done) return;
    done = true;
    clearInterval(timer);
    setBar(1);
    if (typeof window.KYROLLL_FLOWER_PROGRESS === 'function') window.KYROLLL_FLOWER_PROGRESS(1);
    overlay.classList.add("is-done"); // fades out via CSS
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("kyrolll:preloader-done"));
      overlay.remove();
    }, 650);
  }

  function check() {
    if (done) return;
    const elapsed = performance.now() - started;
    if (elapsed < MIN_MS) return;
    // Drive a smooth bottom-up build for the preloader flower. Start from 0 and
    // creep toward completion as the page settles, hitting 1.0 at finish.
    if (typeof window.KYROLLL_FLOWER_PROGRESS === 'function') {
      const t = Math.min(1, (elapsed - MIN_MS) / Math.max(900, HARD_CAP_MS * 0.5));
      const p = Math.min(0.98, t * 0.9);
      window.KYROLLL_FLOWER_PROGRESS(p);
      setBar(p);
    }
    // Hide once the flower has painted its first frame (the scene build is the
    // last heavy thing the page boots), or once every resource has loaded, and
    // never wait past the hard cap.
    if (flowerReady() || pageSettled() || elapsed > HARD_CAP_MS) {
      setBar(1);
      if (typeof window.KYROLLL_FLOWER_PROGRESS === 'function') window.KYROLLL_FLOWER_PROGRESS(1);
      finish();
    }
  }

  const stage = overlay.querySelector(".logo-stage");
  if (stage && "MutationObserver" in window) {
    new MutationObserver(check).observe(stage, { attributes: true, attributeFilter: ["class"] });
  }
  window.addEventListener("load", check);
  document.addEventListener("DOMContentLoaded", check);
  window.addEventListener("pageshow", (event) => { if (event.persisted) check(); });
  timer = setInterval(check, 160);
})();