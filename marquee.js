/* KYROlll — live marquee ticker.
 *
 * Renders the white announcement strip under the hero from two sources:
 *   1. Every catalog beat (newest first) is turned into a "NEW BEAT DROP — …"
 *      headline automatically — add a beat to catalog.js and it appears here.
 *   2. The hand-written updates in marquee-items.js (window.KYROLLL_MARQUEE).
 *
 * The strip keeps its seamless double-copy scroll. Every CYCLE_MS it quietly
 * fades, cycles the headline order and re-renders, so the feed reads as a
 * newsroom ticker that rotates through the latest news.
 */
(function () {
  "use strict";

  const CYCLE_MS = 24000;

  const banner = document.querySelector(".marquee-banner");
  const track = document.querySelector(".marquee-track");
  if (!banner || !track) return;

  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  // Newest catalog beat first; older releases follow in reverse catalog order.
  function headlineItems() {
    const catalog = window.KYROLLL_CATALOG || [];
    const drops = catalog.slice().reverse().map((beat) =>
      "NEW BEAT DROP — " + beat.title + " — " + beat.bpm + " BPM // " + beat.key
    );
    const news = (window.KYROLLL_MARQUEE || []).filter((item) => item && item.trim());
    return drops.concat(news);
  }

  function restartAnimation() {
    // Toggle the stylesheet animation off and back on so the seamless loop
    // restarts from a fresh -50% cycle instead of jumping from the old layout.
    track.style.animation = "none";
    void track.offsetWidth; // force reflow
    track.style.animation = "";
  }

  let rotation = 0;
  function render() {
    const items = headlineItems();
    if (!items.length) {
      track.innerHTML = "<span>KYROlll — ORIGINAL SOUND</span>";
      return;
    }
    // Cycle the headline order (first item moves to the back) so the strip and
    // the "latest" slot keep rotating through the feed.
    const ordered = items.map((_, index) => items[(index + rotation) % items.length]);
    const spans = ordered.concat(ordered).map((text) => "<span>" + esc(text) + "</span>");
    track.innerHTML =
      '<span class="marquee-live"><span class="marquee-live__dot"></span>LIVE FEED</span>' + spans.join("");
    restartAnimation();
  }

  let fading = false;
  function refresh() {
    if (fading) return;
    fading = true;
    // A quick dim-and-back reads as the ticker fetching the next batch of
    // headlines rather than content silently swapping out from under the reader.
    banner.classList.add("is-rotating");
    setTimeout(() => {
      rotation = (rotation + 1) % Math.max(1, headlineItems().length);
      render();
      banner.classList.remove("is-rotating");
      fading = false;
    }, 220);
  }

  render();
  setInterval(refresh, CYCLE_MS);
})();