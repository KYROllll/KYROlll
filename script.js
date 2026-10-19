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

const grid = $("grid");
const previewPlayer = new BeatPreviewPlayer(grid);
let vinylTimer = 0;
window.addEventListener("pagehide", () => previewPlayer.stop());

function specLine(beat) {
  return `${beat.bpm} BPM // ${String(beat.key).toUpperCase()}`;
}

/* The scheduled-release clock lives in catalog.js: a beat with a future
   `releaseAt` is a *scheduled drop*. Until it lands the store paints the card
   with a live countdown and locks the player and the download trigger; the
   second the clock reaches zero `refreshReleaseWatch` rebuilds the grid in
   place, so the full player and the drawer appear with no reload. */
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
  return (h && h.releaseLabel && h.releaseLabel(beat)) || "DROPPING TODAY AT 20:00";
}
/* The luxury countdown pill: the drop label plus a timer that ticks in place. */
function countdownBadgeHTML(beat, large) {
  return `<span class="drop-countdown${large ? " drop-countdown--lg" : ""}" role="timer" aria-live="off">
          <span class="drop-countdown__dot" aria-hidden="true"></span>
          <span class="drop-countdown__label">${attr(releaseLabel(beat))}</span>
          <span class="drop-countdown__time" data-countdown="${attr(beat.id)}">${countdownText(beat)}</span>
        </span>`;
}
/* What stands in for the player on a scheduled drop's own page. */
function dropLockedHTML(beat) {
  return `<div class="drop-locked" data-state="locked">
        ${countdownBadgeHTML(beat, true)}
        <p class="drop-locked__note">THE FULL PLAYER AND EVERY FREE PACKAGE UNLOCK AUTOMATICALLY THE SECOND THE CLOCK HITS ZERO — NO RELOAD NEEDED.</p>
      </div>`;
}

function youtubeHTML(beat, show) {
  if (!show || !beat.youtube) return "";
  return `<a href="${beat.youtube}" target="_blank" rel="noopener noreferrer" class="card__youtube-link" aria-label="Watch on YouTube" title="Watch on YouTube" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>`;
}

function previewHTML(beat) {
  if (!beat.preview) return beat.youtube
    ? `<a class="beat-preview__unavailable" href="${attr(beat.youtube)}" target="_blank" rel="noopener noreferrer">PREVIEW ON YOUTUBE ↗</a>`
    : '<p class="beat-preview__unavailable">PREVIEW COMING SOON</p>';
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
// downloads.js). `compact` is the trimmed catalog-tile variant. A scheduled drop
// renders it locked — a real `disabled` control, so no click, no keyboard and no
// drawer until the clock reaches zero.
function downloadTriggerHTML(beat, compact, pending) {
  const locked = pending ? ' disabled aria-disabled="true" data-release-pending="true"' : "";
  const label = pending ? "LOCKED" : "DOWNLOAD FREE";
  const caret = pending ? "" : '<span class="download-trigger__caret" aria-hidden="true">▾</span>';
  return `<button type="button" class="download-trigger${compact ? " download-trigger--compact" : ""}" data-download-trigger data-beat-id="${attr(beat.id)}" aria-haspopup="menu" aria-expanded="false"${locked}>
        <span class="download-trigger__label">${label}</span>${caret}
      </button>`;
}

function downloadActionsHTML(beat, compact, pending) {
  if (compact) return `<div class="catalog-tile__actions">${pending ? countdownBadgeHTML(beat) : ""}${downloadTriggerHTML(beat, true, pending)}</div>`;
  return `<div class="download-actions">${downloadTriggerHTML(beat, false, pending)}</div>
        <p class="download-hint">EVERY BEAT IS FREE · MP3, WAV &amp; STEMS · LEAVE AN EMAIL TO UNLOCK</p>`;
}

function beatDetailInner(beat) {
  const pending = releasePending(beat);
  const meta = pending
    ? `<div class="card__specs">${specLine(beat)} // ${attr(releaseLabel(beat))}</div>`
    : `<div class="card__specs">${specLine(beat)} // TAGGED AUDIO</div>`;
  const actions = pending
    ? `<div class="card__actions">
        <div class="download-actions">${downloadTriggerHTML(beat, false, true)}</div>
        <p class="download-hint">SCHEDULED DROP · THE FREE DOWNLOAD UNLOCKS AT DROP TIME</p>
      </div>`
    : `<div class="card__actions">
        ${downloadActionsHTML(beat, false)}
      </div>`;
  return `
    <section class="beat-detail__content" aria-label="Beat details and free downloads">
      <div class="card__meta">
        <div class="card__name">
          <h2 class="card__title-link animate-glow">
              <span>${beat.title}</span>
          </h2>
          ${youtubeHTML(beat, true)}
        </div>
        ${meta}
      </div>
      ${pending ? dropLockedHTML(beat) : previewHTML(beat)}
      ${actions}
    </section>
    <div class="beat-detail__artwork-wrap">
      <div class="vinyl-record" aria-hidden="true">
        <img class="vinyl-record__label" src="assets/kyrolll-flower.svg" alt="" width="300" height="300" loading="lazy">
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
      ${downloadActionsHTML(beat, true, pending)}`;
    }
    grid.appendChild(card);
  });
  if (detail) {
    // The record slides out of the sleeve a few seconds after the page settles
    // and stays locked in its open position (CSS drives the movement).
    const detailCard = grid.querySelector('.beat-detail');
    if (detailCard) {
      clearTimeout(vinylTimer);
      vinylTimer = setTimeout(() => detailCard.classList.add('vinyl-open'), 2400);
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
  unlockScroll();
  rebuildCatalog();
});
handleDeepHash();

grid.addEventListener("click", (e) => {
  // The download trigger is delegated globally in downloads.js (the menu is
  // rendered on <body>), so only the tile link is handled here.
  const link = e.target.closest(".catalog-tile__link");
  if (link) {
    e.preventDefault();
    unlockScroll();
    history.pushState(null, "", link.href);
    rebuildCatalog();
    return;
  }
});

const allBeatsLink = $("all-beats-link");
if (allBeatsLink) {
  allBeatsLink.addEventListener("click", (e) => {
    e.preventDefault();
    unlockScroll();
    history.pushState(null, "", e.currentTarget.href);
    rebuildCatalog();
    $("grid").scrollIntoView({ block: "start" });
  });
}
