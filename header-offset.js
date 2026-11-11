/* The menu bar is `position: fixed`, so it occupies no space in the document.
   Each page carries its height as `--yx-header-h`, and this script measures that
   height instead of assuming it: the bar is one row tall on desktop and two rows
   tall on a phone, and a font swap or a breakpoint can change it.

   The measured value is what `.yx-home` (the archive dock), `.page-main` (the
   utility pages) and the focus sheet's `top` all read, so the catalog always
   meets the bar's bottom edge exactly — no dead band above it, nothing tucked
   behind it — and it survives a resize or a rotation without a reload. */
(function () {
  "use strict";

  var root = document.documentElement;
  var header = document.querySelector(".site-header");
  if (!header) return;

  function sync() {
    var height = header.getBoundingClientRect().height;
    if (!height) return;
    root.style.setProperty("--yx-header-h", height + "px");
  }

  sync();
  window.addEventListener("resize", sync, { passive: true });
  window.addEventListener("orientationchange", sync, { passive: true });
  window.addEventListener("load", sync);
  if (window.ResizeObserver) new ResizeObserver(sync).observe(header);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(sync).catch(function () {});
  }
})();
