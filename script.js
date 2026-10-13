// The active release renders under its exact title everywhere on the site.
const ACTIVE_TITLE = "[FREE] DON TOLIVER TYPE BEAT - FLESH";

// The catalog is shared by every page (catalog.js) so the store, the library
// and the checkout all read the same beats, tiers and Storage object paths.
const CATALOG = window.KYROlll_CATALOG || [];

const $ = (id) => document.getElementById(id);

const account = () => window.KYROlll_ACCOUNT;
const esc = (value) => (window.KYROlll_ACCOUNT
  ? window.KYROlll_ACCOUNT.escapeHTML(value)
  : String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])));
const beatById = (id) => CATALOG.find((beat) => beat.id === id) || null;

function unlockScroll() {
  document.body.style.cssText = '';
  document.documentElement.style.cssText = '';
}

const grid = $("grid");
const previewPlayer = new BeatPreviewPlayer(grid);
let vinylTimer = 0;
window.addEventListener("pagehide", () => previewPlayer.stop());

function specLine(beat) {
  return `${beat.bpm} BPM // ${beat.key}`;
}

function youtubeHTML(beat, show) {
  if (!show || !beat.youtube) return "";
  return `<a href="${beat.youtube}" target="_blank" rel="noopener noreferrer" class="card__youtube-link" aria-label="Watch on YouTube" title="Watch on YouTube" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>`;
}

function previewHTML(beat) {
  const attr = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
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

function buyButtonHTML(beat) {
  const attr = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  return `<button type="button" class="buy-beat-btn" data-beat-id="${attr(beat.id)}" aria-haspopup="true" aria-expanded="false">
          BUY<span class="buy-beat-btn__caret" aria-hidden="true">▾</span>
        </button>
        <span class="buy-hint">MP3 · WAV · EXCLUSIVE</span>`;
}

function beatDetailInner(beat) {
  const attr = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  return `
    <section class="beat-detail__content" aria-label="Beat details and purchase">
      <div class="card__meta">
        <div class="card__name">
          <h2 class="card__title-link animate-glow">
              <span>${beat.title}</span>
          </h2>
          ${youtubeHTML(beat, true)}
        </div>
        <div class="card__specs">${specLine(beat)} // TAGGED AUDIO</div>
      </div>
      ${previewHTML(beat)}
      <div class="card__actions">
        ${buyButtonHTML(beat)}
      </div>
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
  grid.innerHTML = "";
  const params = new URLSearchParams(location.search);
  const id = params.get("beat");
  const detail = id !== null;
  const list = detail ? CATALOG.filter((beat) => beat.id === id) : [...CATALOG].sort(byNewest);
  document.documentElement.classList.toggle("beat-page", detail);
  grid.classList.toggle("grid--detail", detail);
  const beatNav = $("beat-navigation");
  if (beatNav) beatNav.hidden = !detail;
  const catalogHeading = $("catalog");
  if (catalogHeading) catalogHeading.hidden = detail;
  grid.setAttribute("aria-label", detail ? "Beat details" : "Available beats");

  document.title = detail && list.length ? `${list[0].title} — KYROlll` : "KYROlll — BEATS & ORIGINAL PRODUCTION";

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
      card.className = "catalog-tile";
      card.innerHTML = `<a class="catalog-tile__link" href="index.html?beat=${encodeURIComponent(beat.id)}" aria-label="View ${beat.title}">
        <span class="catalog-tile__art"><img src="${beat.img}" alt="" loading="lazy" decoding="async"></span>
        <span class="catalog-tile__title">${beat.title}</span>
      </a>`;
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
}

function beatFromAnchor(anchor) {
  const clean = String(anchor || "").replace(/^#/, "");
  const direct = CATALOG.find((beat) => beat.id === clean || `card-${beat.id}` === clean);
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
  // The library now lives on its own page; keep old ?view=library links working.
  if (params.get("view") === "library") {
    window.location.replace("library.html");
    return;
  }
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
  const buy = e.target.closest(".buy-beat-btn");
  if (buy) {
    e.preventDefault();
    const beat = beatById(buy.getAttribute("data-beat-id"));
    if (beat && account()) account().openLicenseMenu(buy, beat);
    return;
  }
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
