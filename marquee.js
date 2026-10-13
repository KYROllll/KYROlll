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
 * The strip keeps its seamless double-copy scroll. Every CYCLE_MS it quietly
 * fades, cycles the headline order and re-renders, so the feed reads as a
 * newsroom ticker that rotates through the latest news.
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
    return drops.concat(studio, news);
  }

  function restartAnimation() {
    // Used only for the very first paint: toggle the stylesheet animation off
    // and back on so it starts from a clean translateX(0).
    track.style.animation = "none";
    void track.offsetWidth; // force reflow
    track.style.animation = "";
  }

  let rotation = 0;

  // One "copy" of the ticker: the LIVE badge plus every headline. The track is
  // exactly two copies, so translateX(-50%) lands on the start of the second
  // copy and the loop is seamless. Spacing lives on the children (style.css)
  // rather than a flex `gap`: a gap would leave the two halves a half-gap
  // apart and pop at the wrap — the old visible reset point.
  function copyHTML() {
    const items = headlineItems();
    if (!items.length) return "<span>KYROlll — ORIGINAL SOUND</span>";
    const ordered = items.map((_, index) => items[(index + rotation) % items.length]);
    return '<span class="marquee-live"><span class="marquee-live__dot"></span>LIVE FEED</span>' +
      ordered.map((text) => "<span>" + esc(text) + "</span>").join("");
  }

  function paint(animate) {
    const copy = copyHTML();
    track.innerHTML = copy + copy;
    if (animate) restartAnimation();
  }

  paint(true);

  // Rotate the headline order exactly as a cycle completes. There the track is
  // back at translateX(0), so swapping the copy is invisible: the feed keeps
  // rolling with no jump, no reset and no re-triggered animation.
  track.addEventListener("animationiteration", () => {
    const count = headlineItems().length;
    if (count > 1) rotation = (rotation + 1) % count;
    const copy = copyHTML();
    track.innerHTML = copy + copy;
  });
})();