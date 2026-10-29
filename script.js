// The catalog is shared by every page (catalog.js) so the store and the
// download layer all read the same beats, packages and file paths.
const CATALOG = window.KYROlll_CATALOG || [];

const $ = (id) => document.getElementById(id);

const attr = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

// A navigation can happen while a gate is still mounted (a deep link, the back
// button), and the scroll lock belongs to `downloads.js`: it is released by
// closing the dialog, which also resets the offset it pinned. Wiping the inline
// styles from here instead left the document unpinned while `gate-open` was
// still set — a frozen page with a dialog on it.
function unlockScroll() {
  const downloads = window.KYROlll_DOWNLOADS;
  if (downloads && downloads.closeGate) downloads.closeGate();
  document.body.style.cssText = '';
  document.documentElement.style.cssText = '';
}

/* ------------------------------------------------------- catalog scroll memory
   The store is a single page: opening a beat rewrites the URL and rebuilds the
   grid, and going back would otherwise dump the visitor at the top of a long
   catalog. The offset is remembered in `sessionStorage` (this tab only, gone
   when the tab closes) the moment a tile is opened, and restored — not smoothed
   — when the catalog comes back. `history.scrollRestoration = "manual"` keeps
   the browser's own idea of the entry's scroll from fighting the restore. This
   is the only thing the storefront writes down; no gate state or address is
   ever stored. */
const CATALOG_SCROLL_KEY = "kyrolll_catalog_scroll";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

function readCatalogScroll() {
  try {
    const raw = sessionStorage.getItem(CATALOG_SCROLL_KEY);
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch (err) {
    return null;
  }
}

function rememberCatalogScroll() {
  if (new URLSearchParams(location.search).has("beat")) return;
  try {
    sessionStorage.setItem(CATALOG_SCROLL_KEY, String(Math.max(0, Math.round(window.scrollY))));
  } catch (err) {
    /* Private modes can refuse storage; the store still works without memory. */
  }
}

/* Land on the remembered offset immediately (never a smooth scroll — the
   visitor asked to go back, not to watch the page travel), then reapply on the
   next frame in case the freshly rebuilt grid settled after the first write. */
function restoreCatalogScroll() {
  const top = readCatalogScroll();
  if (top === null) return false;
  const apply = () => window.scrollTo({ top, behavior: "instant" });
  apply();
  requestAnimationFrame(apply);
  return true;
}

const grid = $("grid");
const previewPlayer = new BeatPreviewPlayer(grid);
/* The vinyl reveal: the record stays tucked behind the sleeve for this long (the
   beat card's own 0.8 s fade finishes well inside it), then style.css transitions
   it out over 1 s. Under reduced motion the tuck is skipped entirely (see the
   media query), so adding the class is a harmless no-op there. */
const VINYL_REVEAL_DELAY_MS = 1350;
let vinylTimer = 0;
window.addEventListener("pagehide", () => previewPlayer.stop());

function specLine(beat) {
  return `${beat.bpm} BPM // ${String(beat.key).toUpperCase()}`;
}

/* Each beat owns a pressing: FLESH is pearl white, THE FLOW is a deep matte
   black disc with a single fine gold rim, GREEN FLESH is a smoky grey-green disc
   with a delicate white outer hairline, SQUISH! is an icy silver collector disc
   with a pure-white perimeter rim, JUST D0 IT is a deep matte black disc with
   one fiery red/orange hairline, and ADLL is a deep matte black disc scattered
   with white graffiti paint. The old "gold" value still resolves to the refined
   "gold-rim" pressing, so a stale link or cached catalog can never render an
   unstyled disc. Anything unknown keeps the white standard. */
function vinylVariantFor(beat) {
  if (beat && beat.vinylVariant === "sage-white-rim") return "sage-white-rim";
  if (beat && beat.vinylVariant === "ice-silver-rim") return "ice-silver-rim";
  if (beat && beat.vinylVariant === "rage-fire-rim") return "rage-fire-rim";
  if (beat && beat.vinylVariant === "graffiti-splatter") return "graffiti-splatter";
  if (beat && (beat.vinylVariant === "gold-rim" || beat.vinylVariant === "gold")) return "gold-rim";
  if (beat && beat.vinylVariant === "black") return "black";
  return "white";
}
function vinylModifier(variant) {
  if (variant === "white") return " vinyl-record--white";
  if (variant === "gold-rim") return " vinyl-record--gold-rim";
  if (variant === "sage-white-rim") return " vinyl-record--sage-white-rim";
  if (variant === "ice-silver-rim") return " vinyl-record--ice-silver-rim";
  if (variant === "rage-fire-rim") return " vinyl-record--rage-fire-rim";
  if (variant === "graffiti-splatter") return " vinyl-record--graffiti-splatter";
  return "";
}

/* The scheduled-release clock lives in catalog.js: a beat with a future
   `releaseAt` is a *scheduled drop*. Until it lands the store paints the tile
   with a live countdown pill where the button sits, and the beat page with no
   player plus an inert LOCKED control; the second the clock reaches zero
   `refreshReleaseWatch` rebuilds the grid in place, so the full player and the
   drawer appear with no reload. */
function releasePending(beat) {
  const h = window.KYROlll_HELPERS;
  return !!(h && h.isReleased && !h.isReleased(beat));
}
function countdownText(beat) {
  const h = window.KYROlll_HELPERS;
  return (h && h.msUntilRelease && h.formatCountdown) ? h.formatCountdown(h.msUntilRelease(beat)) : "00:00:00";
}
function releaseLabel(beat) {
  const h = window.KYROlll_HELPERS;
  return (h && h.releaseLabel && h.releaseLabel(beat)) || "DROPPING SOON";
}
/* The countdown pill: one universal label plus a timer that ticks in place.
   The label never carries a clock hour — the live HH:MM:SS beside it is the only
   time shown, so a visitor in any timezone reads the same thing. On the catalog
   tile the pill is the whole action slot; on the beat page it sits above the
   inert LOCKED control (`lockedButtonHTML`). */
function countdownBadgeHTML(beat, large) {
  return `<span class="drop-countdown${large ? " drop-countdown--lg" : ""}" data-release-countdown role="timer" aria-live="off">
          <span class="drop-countdown__dot" aria-hidden="true"></span>
          <span class="drop-countdown__label">${attr(releaseLabel(beat))}</span>
          <span class="drop-countdown__time" data-countdown="${attr(beat.id)}">${countdownText(beat)}</span>
        </span>`;
}
/* The player slot on a scheduled drop's own page: a quiet locked pane. The
   countdown itself lives in the action slot (see `actionsSlotHTML`), so it is
   never repeated up here. */
function dropLockedHTML() {
  return `<div class="drop-locked" data-state="locked">
        <p class="drop-locked__note">THE FULL PLAYER UNLOCKS AUTOMATICALLY THE SECOND THE CLOCK HITS ZERO — NO RELOAD NEEDED.</p>
      </div>`;
}

function previewHTML(beat) {
  if (!beat.preview) return '<p class="beat-preview__unavailable">PREVIEW COMING SOON</p>';
  const title = attr(beat.title);
  return `<div class="beat-preview" data-title="${title}" data-state="idle">
    <audio class="beat-preview__audio" src="${attr(beat.preview)}" preload="none"></audio>
    <button type="button" class="beat-preview__toggle" aria-label="Play preview: ${title}" aria-pressed="false">
      <svg class="beat-preview__play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
      <svg class="beat-preview__pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
    </button>
    <div class="beat-preview__details">
      <input class="beat-preview__seek" type="range" min="0" max="100" step="0.1" value="0" disabled aria-label="Seek preview: ${title}">
      <span class="beat-preview__time">0:00 / --:--</span>
    </div>
    <span class="beat-preview__status" role="status">AUDIO PREVIEW</span>
  </div>`;
}

// One "DOWNLOAD FREE" trigger per beat; it opens the three-package menu (see
// downloads.js). `compact` is the trimmed catalog-tile variant.
function downloadTriggerHTML(beat, compact) {
  return `<button type="button" class="download-trigger${compact ? " download-trigger--compact" : ""}" data-download-trigger data-beat-id="${attr(beat.id)}" aria-haspopup="menu" aria-expanded="false">
        <span class="download-trigger__label">DOWNLOAD FREE</span><span class="download-trigger__caret" aria-hidden="true">▾</span>
      </button>`;
}

/* The inert "LOCKED" control that stands in for the button on a scheduled drop's
   own page. It carries no `data-download-trigger`, so the delegated drawer
   listener ignores it entirely — the packages are unreachable until the clock
   lands and the card is rebuilt. The catalog tile never renders it: there the
   countdown pill is the action slot on its own (see `actionsSlotHTML`). */
function lockedButtonHTML(beat) {
  return `<button type="button" class="download-trigger download-trigger--locked" data-release-pending="true" data-beat-id="${attr(beat.id)}" aria-disabled="true" disabled>
        <span class="download-trigger__label">LOCKED</span>
      </button>`;
}

function downloadActionsHTML(beat, compact) {
  if (compact) return `<div class="catalog-tile__actions">${downloadTriggerHTML(beat, true)}</div>`;
  return `<div class="download-actions">${downloadTriggerHTML(beat, false)}</div>
        <p class="download-hint">EVERY BEAT IS FREE · MP3, WAV &amp; STEMS · LEAVE AN EMAIL TO UNLOCK</p>`;
}

/* The action slot, where the "DOWNLOAD FREE" button normally sits. While a drop
   counts down a catalog tile shows the countdown pill alone, and the beat page
   shows the pill with the inert LOCKED control beneath it; the moment the clock
   lands the slot becomes the live trigger. */
function actionsSlotHTML(beat, compact) {
  if (releasePending(beat)) {
    const pill = countdownBadgeHTML(beat, !compact);
    return compact
      ? `<div class="catalog-tile__actions">${pill}</div>`
      : `<div class="download-actions">${pill}</div>
        ${lockedButtonHTML(beat)}`;
  }
  return downloadActionsHTML(beat, compact);
}

function beatDetailInner(beat) {
  const pending = releasePending(beat);
  const vinylVariant = vinylVariantFor(beat);
  const outerRim = vinylVariant === "gold-rim" || vinylVariant === "sage-white-rim"
    || vinylVariant === "ice-silver-rim" || vinylVariant === "rage-fire-rim"
    ? `<span class="vinyl-record__rim" aria-hidden="true"></span>`
    : "";
  const meta = pending
    ? `<div class="card__specs">${specLine(beat)} // SCHEDULED DROP</div>`
    : `<div class="card__specs">${specLine(beat)} // TAGGED AUDIO</div>`;
  return `
    <section class="beat-detail__content beat-detail__info" aria-label="Beat details and free downloads">
      <div class="card__meta beat-detail__head">
        <div class="card__name">
          <h2 class="card__title-link beat-detail__title">
              <span>${beat.title}</span>
          </h2>
        </div>
        ${meta}
      </div>
      ${pending ? dropLockedHTML() : previewHTML(beat)}
      <div class="card__actions">
        ${actionsSlotHTML(beat, false)}
      </div>
    </section>
    <div class="beat-detail__artwork-wrap">
      <div class="vinyl-record${vinylModifier(vinylVariant)}" data-vinyl="${vinylVariant}" aria-hidden="true">
        ${outerRim}
        <span class="vinyl-record__logo-frame" aria-hidden="true">
          <img class="vinyl-record__logo" src="assets/kyrolll-flower.svg" alt="" width="300" height="300" loading="lazy">
        </span>
      </div>
      <figure class="beat-detail__artwork">
        <img src="${attr(beat.img)}" alt="${attr(beat.title)} cover art" decoding="async" fetchpriority="high">
      </figure>
    </div>`;
}

const byNewest = (a, b) => CATALOG.indexOf(b) - CATALOG.indexOf(a);

function scrollToBeatDetail() {
  const card = grid.querySelector(".beat-detail");
  if (card) card.scrollIntoView({ block: "start", behavior: "auto" });
}

// Content above the card (lazy artwork, fonts) can still be settling right
// after render, so keep re-aligning while the page grows, then stop.
function landOnBeatDetail() {
  scrollToBeatDetail();
  requestAnimationFrame(scrollToBeatDetail);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => scrollToBeatDetail());
    observer.observe(document.body);
    setTimeout(() => observer.disconnect(), 3000);
  } else {
    [120, 350, 700].forEach((delay) => setTimeout(scrollToBeatDetail, delay));
  }
}

function buildGrid() {
  previewPlayer.stop();
  clearTimeout(vinylTimer);
  clearReleaseWatch();
  /* The package drawer lives on `<body>` (see downloads.js), so replacing the
     grid would no longer take it with it: close it before the re-render, or a
     back/forward that rebuilds the catalog could leave a stale drawer on screen. */
  if (window.KYROlll_DOWNLOADS) window.KYROlll_DOWNLOADS.closeMenu();
  grid.innerHTML = "";
  const params = new URLSearchParams(location.search);
  const id = params.get("beat");
  const detail = id !== null;
  const list = detail ? CATALOG.filter((beat) => beat.id === id || beat.slug === id) : [...CATALOG].sort(byNewest);
  document.documentElement.classList.toggle("beat-page", detail);
  grid.classList.toggle("grid--detail", detail);
  const beatNav = $("beat-navigation");
  if (beatNav) beatNav.hidden = !detail;
  const catalogHeading = $("catalog");
  if (catalogHeading) catalogHeading.hidden = detail;
  grid.setAttribute("aria-label", detail ? "Beat details" : "Available beats");

  document.title = detail && list.length ? `${list[0].title} — KYROIII` : "KYROIII — FREE BEATS & ORIGINAL PRODUCTION";

  if (!list.length) {
    const panel = document.createElement("article");
    panel.className = "grid-closed";
    panel.innerHTML = detail
      ? '<div class="grid-closed__box"><div class="grid-closed__title">BEAT NOT FOUND</div><p><a href="index.html#catalog">VIEW ALL BEATS →</a></p></div>'
      : '<div class="grid-closed__box"><div class="grid-closed__title">NO BEATS AVAILABLE</div><p>CHECK BACK FOR NEW BEATS.</p></div>';
    grid.appendChild(panel);
    return;
  }

  list.forEach((beat) => {
    const card = document.createElement("article");
    card.id = "card-" + beat.id;
    card.setAttribute("data-vinyl", vinylVariantFor(beat));
    if (detail) {
      card.className = "beat-detail";
      card.innerHTML = beatDetailInner(beat);
    } else {
      const pending = releasePending(beat);
      card.className = "catalog-tile" + (pending ? " catalog-tile--pending" : "");
      card.innerHTML = `<a class="catalog-tile__link" href="index.html?beat=${encodeURIComponent(beat.id)}" aria-label="View ${attr(beat.title)}">
        <span class="catalog-tile__art"><img src="${attr(beat.img)}" alt="" loading="lazy" decoding="async"></span>
        <span class="catalog-tile__title">${beat.title}</span>
      </a>
      ${actionsSlotHTML(beat, true)}`;
    }
    grid.appendChild(card);
  });
  if (detail) {
    // The card fades in first; a beat later the record slides out from behind
    // the sleeve. The class only ever *adds* the exposed state — the tucked
    // state is the element's initial one, so there is no pre-render flash.
    const detailCard = grid.querySelector('.beat-detail');
    if (detailCard) {
      clearTimeout(vinylTimer);
      vinylTimer = setTimeout(() => detailCard.classList.add('vinyl-open'), VINYL_REVEAL_DELAY_MS);
    }
    // Land directly on the beat card instead of the top of the page.
    landOnBeatDetail();
  }
  refreshReleaseWatch();
}

/* --------------------------------------------------------------- the drop watch
   A scheduled drop counts down in place. One interval ticks every countdown in
   the grid; a precise timeout aimed at the earliest release rebuilds the catalog
   the moment that instant passes, so the full player and the download drawer
   appear live — no reload, no redeploy. `buildGrid` calls this last, and a
   rebuild with nothing left pending simply leaves the watch off. */
let releaseInterval = 0;
let releaseTimeout = 0;
function clearReleaseWatch() {
  clearInterval(releaseInterval);
  clearTimeout(releaseTimeout);
  releaseInterval = 0;
  releaseTimeout = 0;
}
function refreshReleaseWatch() {
  clearReleaseWatch();
  const h = window.KYROlll_HELPERS;
  if (!h || !h.isReleased) return;
  const pending = CATALOG.filter((beat) => !h.isReleased(beat));
  if (!pending.length) return;
  const tick = () => {
    let due = false;
    grid.querySelectorAll("[data-countdown]").forEach((el) => {
      const beat = h.beatById(el.getAttribute("data-countdown"));
      if (!beat) return;
      if (h.isReleased(beat)) { due = true; return; }
      el.textContent = h.formatCountdown(h.msUntilRelease(beat));
    });
    if (due) rebuildCatalog();
  };
  tick();
  releaseInterval = setInterval(tick, 1000);
  const waits = pending.map((beat) => h.msUntilRelease(beat));
  releaseTimeout = setTimeout(() => rebuildCatalog(), Math.max(0, Math.min.apply(null, waits)) + 50);
}

function beatFromAnchor(anchor) {
  const clean = String(anchor || "").replace(/^#/, "");
  const direct = CATALOG.find((beat) => beat.id === clean || beat.slug === clean || `card-${beat.id}` === clean);
  if (direct) return direct.id;
  return null;
}

function handleDeepHash() {
  if (new URLSearchParams(location.search).has("beat")) return;
  const id = beatFromAnchor(location.hash);
  if (id && CATALOG.some((beat) => beat.id === id)) {
    unlockScroll();
    location.replace(`index.html?beat=${encodeURIComponent(id)}`);
  }
}

function rebuildCatalog() {
  const params = new URLSearchParams(location.search);
  const isHome = !params.has("beat");
  if (isHome) {
    unlockScroll();
  }
  buildGrid();
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    rebuildCatalog();
  } catch (err) {
    console.error("Catalog init error:", err);
    buildGrid();
  }
});
window.addEventListener("load", () => {
  if (new URLSearchParams(location.search).has("beat")) landOnBeatDetail();
});
window.addEventListener("hashchange", handleDeepHash);
window.addEventListener("popstate", () => {
  /* Capture the route before rebuilding: a back/forward from a beat detail to
     the catalog is exactly the trip that should land on the remembered offset. */
  const wasDetail = document.documentElement.classList.contains("beat-page");
  unlockScroll();
  rebuildCatalog();
  if (wasDetail && !document.documentElement.classList.contains("beat-page")) {
    restoreCatalogScroll();
  }
});
handleDeepHash();

grid.addEventListener("click", (e) => {
  // The download trigger is delegated globally in downloads.js (the menu is
  // rendered on <body>), so only the tile link is handled here.
  const link = e.target.closest(".catalog-tile__link");
  if (link) {
    e.preventDefault();
    rememberCatalogScroll();
    unlockScroll();
    history.pushState(null, "", link.href);
    rebuildCatalog();
    return;
  }
});

const allBeatsLink = $("all-beats-link");
if (allBeatsLink) {
  /* The return control (`#all-beats-link`, the sticky ALL BEATS rail above the
     beat card) is the second way out of a beat page, and it is the one a visitor
     can reach at any scroll depth. It restores the saved catalog offset instead
     of dropping them at the top of the grid; a deep link with no saved offset
     falls back to the top of the catalog. */
  allBeatsLink.setAttribute("data-beat-back", "");
  allBeatsLink.addEventListener("click", (e) => {
    e.preventDefault();
    unlockScroll();
    history.pushState(null, "", e.currentTarget.href);
    rebuildCatalog();
    if (!restoreCatalogScroll()) $("grid").scrollIntoView({ block: "start", behavior: "auto" });
  });
}
