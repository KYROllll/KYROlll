/* KYROIII — the archive home and the artwork collection.
 *
 * The home route is one quiet grid of records. Choosing a cover fades the rest
 * of the archive out and opens a focused view: the record, its preview and the
 * three free packages. The gate itself is never re-implemented here — every
 * package button calls `KYROlll_DOWNLOADS.start`, so the email + license flow,
 * the PDF and the exclusive-claim registry stay exactly where they live.
 *
 * ARTWORK is the second view of the same page: the covers drawn for the beats,
 * shown as locked collector pieces. It reuses the focus sheet, the FLIP zoom and
 * the flying-cover close, but swaps the player and packages for the collector
 * record (prints, drops and apparel open in 2028–2029).
 *
 * Both views are home-only. A direct `?beat=` link still renders the full beat
 * card through script.js, untouched.
 */
(function () {
  "use strict";

  const CATALOG = window.KYROlll_CATALOG || [];
  const PACKAGES = window.KYROlll_PACKAGES || [];
  const HELPERS = window.KYROlll_HELPERS || {};
  const grid = document.getElementById("yx-grid");
  const home = document.querySelector(".yx-home:not(.yx-art)");
  const artView = document.getElementById("yx-artwork");
  const artGrid = document.getElementById("yx-art-grid");
  const artCount = document.querySelector("[data-yx-art-count]");
  const focus = document.getElementById("yx-focus");
  const header = document.querySelector(".site-header");
  const countNode = document.querySelector("[data-yx-count]");
  const navLinks = [...document.querySelectorAll("[data-yx-view]")];
  if (!grid || !focus) return;

  const params = new URLSearchParams(location.search);
  if (params.has("beat")) return;

  const newest = [...CATALOG].sort((a, b) => CATALOG.indexOf(b) - CATALOG.indexOf(a));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    beat: null,
    kind: null,
    view: "beats",
    zoomTimer: 0,
    zoomSeq: 0,
    releaseTimer: 0,
    audio: focus.querySelector("[data-yx-audio]"),
    play: focus.querySelector("[data-yx-play]"),
    seek: focus.querySelector("[data-yx-seek]"),
    time: focus.querySelector("[data-yx-time]"),
  };

  const focusArt = focus.querySelector("[data-yx-focus-art]");
  const focusArtFrame = focus.querySelector(".yx-focus__art");
  const focusIndex = focus.querySelector("[data-yx-focus-index]");
  const focusTitle = focus.querySelector("[data-yx-focus-title]");
  const focusType = focus.querySelector("[data-yx-focus-type]");
  const focusSpecs = focus.querySelector("[data-yx-focus-specs]");
  const focusStatus = focus.querySelector("[data-yx-focus-status]");
  const focusPacks = focus.querySelector("[data-yx-focus-packs]");
  const focusBack = focus.querySelector("[data-yx-focus-back]");
  const focusKicker = focus.querySelector("[data-yx-focus-kicker]");
  const collector = focus.querySelector("[data-yx-collector]");

  const LOCK_SVG = '<svg class="yx-lock" viewBox="0 0 10 12" aria-hidden="true" focusable="false">'
    + '<path d="M2.5 5V3.6a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" stroke-width="1"/>'
    + '<rect x="1" y="5" width="8" height="6.2" rx=".6" fill="currentColor"/></svg>';

  const isReleased = (beat) => !HELPERS.isReleased || HELPERS.isReleased(beat);
  const isLocked = (beat) => !!(HELPERS.isExclusiveLocked && HELPERS.isExclusiveLocked(beat.id));
  const isOwned = (beat) => !!(HELPERS.isExclusiveOwned && HELPERS.isExclusiveOwned(beat.id));
  const countdown = (beat) => (HELPERS.msUntilRelease && HELPERS.formatCountdown)
    ? HELPERS.formatCountdown(HELPERS.msUntilRelease(beat))
    : "";

  function splitTitle(beat) {
    const clean = String(beat.title || "").replace(/^\[FREE 100%\]\s*/i, "").trim();
    const parts = clean.split(/\s+-\s+/);
    if (parts.length < 2) return { name: clean, type: "ORIGINAL PRODUCTION" };
    return { name: parts[parts.length - 1], type: parts.slice(0, -1).join(" - ") };
  }

  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));

  const numberFor = (beat) => String(newest.indexOf(beat) + 1).padStart(2, "0");
  const specsFor = (beat) => `${beat.bpm} BPM / ${String(beat.key || "").toUpperCase()}`;
  const gridFor = (kind) => (kind === "art" ? artGrid : grid);
  const viewFor = (kind) => (kind === "art" ? artView : home);

  /* ------------------------------------------------------------------- grid */

  function cardHTML(beat, index) {
    const { name, type } = splitTitle(beat);
    const locked = isLocked(beat);
    const pending = !locked && !isReleased(beat);
    const flags = locked ? " is-locked" : pending ? " is-pending" : "";
    let flag = "";
    if (pending) {
      flag = `<span class="yx-card__flag">DROPPING SOON <b data-countdown="${esc(beat.id)}">${esc(countdown(beat))}</b></span>`;
    } else if (locked) {
      flag = `<span class="yx-card__flag">${isOwned(beat) ? "OWNED / YOURS" : "CLAIMED / SOLD OUT"}</span>`;
    }
    return `<button class="yx-card${flags}" type="button" data-yx-beat="${esc(beat.id)}" aria-label="Focus ${esc(name)}">
      <span class="yx-card__media">
        <img src="${esc(beat.img)}" alt="${esc(name)} cover art" width="1024" height="1024" ${index < 3 ? "" : 'loading="lazy"'} decoding="async">
      </span>
      <span class="yx-card__row">
        <span class="yx-card__index">${String(index + 1).padStart(2, "0")}</span>
        <span class="yx-card__name">${esc(name)}</span>
        <span class="yx-card__specs">${esc(specsFor(beat))}</span>
      </span>
      <span class="yx-card__type">${esc(type)}</span>
      ${flag}
    </button>`;
  }

  function artCardHTML(beat, index) {
    const { name, type } = splitTitle(beat);
    return `<button class="yx-card yx-art-card is-locked" type="button" data-yx-beat="${esc(beat.id)}" aria-label="Focus artwork for ${esc(name)} — locked until 2028">
      <span class="yx-card__media">
        <img src="${esc(beat.img)}" alt="${esc(name)} original cover artwork" width="1024" height="1024" ${index < 3 ? "" : 'loading="lazy"'} decoding="async">
      </span>
      <span class="yx-art-card__badge">
        ${LOCK_SVG}
        <span>COLLECTOR — LOCKED</span>
      </span>
      <span class="yx-card__row">
        <span class="yx-card__index">${String(index + 1).padStart(2, "0")}</span>
        <span class="yx-card__name">${esc(name)}</span>
        <span class="yx-card__specs">1 / 1</span>
      </span>
      <span class="yx-card__type">${esc(type)}</span>
      <span class="yx-art-card__window">PRINTS · DROPS · APPAREL 2028–2029</span>
    </button>`;
  }

  function renderGrid() {
    if (countNode) countNode.textContent = String(newest.length).padStart(2, "0");
    grid.innerHTML = newest.length
      ? newest.map(cardHTML).join("")
      : '<p class="yx-grid__empty">NO RELEASES IN THE ARCHIVE YET.</p>';
    grid.inert = false;
    grid.hidden = false;
    grid.classList.remove("is-fading");
    watchCountdowns();
  }

  function renderArtGrid() {
    if (!artGrid) return;
    if (artCount) artCount.textContent = String(newest.length).padStart(2, "0");
    artGrid.innerHTML = newest.length
      ? newest.map(artCardHTML).join("")
      : '<p class="yx-grid__empty">NO ARTWORK IN THE COLLECTION YET.</p>';
    artGrid.inert = false;
  }

  /* ------------------------------------------------------------ focus view */

  function packHTML(pack) {
    const includes = Array.isArray(pack.includes) ? pack.includes.join(" · ") : "";
    return `<button class="yx-pack" type="button" data-yx-pack="${esc(pack.id)}">
      <span class="yx-pack__name">${esc(pack.name)}</span>
      <span class="yx-pack__includes">${esc(includes)}</span>
      <span class="yx-pack__tag">FREE</span>
      <span class="yx-pack__arrow" aria-hidden="true">↗</span>
    </button>`;
  }

  function renderFocus(beat, keepAudio, kind) {
    const { name, type } = splitTitle(beat);
    const isArt = kind === "art";
    const locked = isLocked(beat);
    const owned = locked && isOwned(beat);
    const pending = !locked && !isReleased(beat);

    focusArt.src = beat.img;
    focusArt.alt = `${name} ${isArt ? "original cover artwork" : "cover art"}`;
    focusIndex.textContent = numberFor(beat);
    focusTitle.textContent = name;
    focusType.textContent = isArt ? "ORIGINAL COVER ARTWORK" : type;
    focusSpecs.textContent = isArt ? "ORIGINAL 1 / 1" : specsFor(beat);
    focus.classList.toggle("is-art", isArt);
    if (focusKicker) focusKicker.textContent = isArt ? "COLLECTOR PIECE" : "FOCUSED SELECTION";
    if (focusBack) focusBack.textContent = isArt ? "ALL ARTWORK" : "ALL BEATS";
    if (collector) collector.hidden = !isArt;

    let status = "";
    if (!isArt) {
      if (pending) status = `DROPPING SOON — <b data-focus-countdown>${esc(countdown(beat))}</b>`;
      else if (locked) status = owned ? "PRIVATE MASTER // YOURS" : "CLAIMED / SOLD OUT";
    }
    focusStatus.innerHTML = status;
    focusStatus.hidden = !status;
    focusStatus.classList.toggle("is-locked", locked);

    if (isArt) {
      focusPacks.innerHTML = "";
      if (!keepAudio) pauseAudio();
      return;
    }

    if (locked) {
      focusPacks.innerHTML = `<p class="yx-focus__closed">${owned
        ? "THIS RECORD IS YOURS. THE FILES ARE IN YOUR DOWNLOAD HISTORY."
        : "THE EXCLUSIVE RIGHTS TO THIS RECORD HAVE BEEN CLAIMED. NO FURTHER LEASES ARE ISSUED."}</p>`;
    } else if (pending) {
      focusPacks.innerHTML = '<p class="yx-focus__closed">THE PACKAGES OPEN THE MOMENT THIS RECORD LANDS.</p>';
    } else {
      focusPacks.innerHTML = PACKAGES.map(packHTML).join("");
    }

    if (!keepAudio) loadAudio(beat);
    watchCountdowns();
  }

  /* The focused record is a sheet pinned under the header, and the cover is a
     FLIP layer: it starts on the chosen tile's box and settles into the sheet,
     so the record zooms open in place. Nothing is navigated, nothing fades the
     page away, and the player and package rows are already rendered underneath. */

  function syncFocusTop() {
    if (!header) return;
    const height = Math.round(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--yx-header-h", `${height}px`);
  }

  function cardMedia(id, kind) {
    const scope = gridFor(kind);
    if (!scope) return null;
    const card = scope.querySelector(`[data-yx-beat="${CSS.escape(id)}"]`);
    const media = card && card.querySelector(".yx-card__media");
    return media ? { card, media, rect: media.getBoundingClientRect() } : null;
  }

  function zoomIn(from, seq) {
    if (!focusArtFrame || !from.rect.width) return;
    const to = focusArtFrame.getBoundingClientRect();
    if (!to.width || !to.height) return;
    focus.classList.add("is-zooming");
    focusArtFrame.style.transition = "none";
    focusArtFrame.style.transform = `translate(${from.rect.left - to.left}px, ${from.rect.top - to.top}px)`
      + ` scale(${from.rect.width / to.width}, ${from.rect.height / to.height})`;
    // Commit the start pose for one frame, then let the CSS curve carry it in.
    void focusArtFrame.offsetWidth;
    requestAnimationFrame(() => {
      if (seq !== state.zoomSeq || !state.beat || focus.hidden) return;
      focusArtFrame.style.transition = "";
      focusArtFrame.style.transform = "translate(0, 0) scale(1, 1)";
      window.clearTimeout(state.zoomTimer);
      state.zoomTimer = window.setTimeout(() => {
        if (seq === state.zoomSeq) focus.classList.remove("is-zooming");
      }, 520);
    });
  }

  function showFocus(beat, kind) {
    const from = cardMedia(beat.id, kind);
    const seq = ++state.zoomSeq;
    state.beat = beat;
    state.kind = kind;
    renderFocus(beat, false, kind);
    if (from && from.card) from.card.classList.add("is-selected");
    window.clearTimeout(state.zoomTimer);
    syncFocusTop();
    // A close that is still flying home must not tint a freshly opened sheet.
    document.querySelectorAll(".yx-ghost").forEach((node) => node.remove());
    focus.classList.remove("is-leaving");
    // Lay the active view out but take it out of sight: keeping its height means
    // the page never re-scrolls behind the sheet, so the zoom lands back on the tile.
    const view = viewFor(kind);
    if (view) {
      view.classList.add("is-behind");
      view.inert = true;
    }
    focus.hidden = false;
    focus.scrollTop = 0;
    focus.classList.add("is-open");
    focus.focus({ preventScroll: true });
    if (from && !reduced.matches) zoomIn(from, seq);
  }

  function openItem(id, kind, push) {
    const beat = newest.find((item) => item.id === id || item.slug === id);
    if (!beat) return;
    if (state.beat && state.beat.id === beat.id) return;
    if (state.view !== normalizeView(kind)) setView(kind, false, false);
    if (push) {
      const url = new URL(location.href);
      if (kind === "art") {
        url.searchParams.set("view", "artwork");
        url.searchParams.set("artwork", beat.slug || beat.id);
        url.searchParams.delete("focus");
      } else {
        url.searchParams.delete("view");
        url.searchParams.delete("artwork");
        url.searchParams.set("focus", id);
      }
      history.pushState({ focus: id, view: kind }, "", url.pathname + url.search);
    }
    showFocus(beat, kind);
  }

  function closeFocus(push, instant) {
    if (!state.beat) return;
    const last = state.beat;
    const kind = state.kind || "beat";
    const seq = ++state.zoomSeq;
    state.beat = null;
    state.kind = null;
    window.clearTimeout(state.zoomTimer);
    pauseAudio();
    if (push) {
      const url = new URL(location.href);
      if (kind === "art") url.searchParams.delete("artwork");
      else url.searchParams.delete("focus");
      history.replaceState({ view: state.view }, "", url.pathname + url.search);
    }

    const target = cardMedia(last.id, kind);
    const artRect = focusArtFrame ? focusArtFrame.getBoundingClientRect() : null;
    const canFly = !instant && Boolean(target && artRect && artRect.width > 1 && artRect.height > 1 && !reduced.matches);

    // A detached cover carries the eye home: it starts exactly on the sheet's
    // cover, so replacing the sheet with the archive in this one frame is
    // invisible, and the grid is already at its resting layout underneath.
    let ghost = null;
    if (canFly) {
      ghost = document.createElement("div");
      ghost.className = "yx-ghost";
      ghost.setAttribute("aria-hidden", "true");
      const img = document.createElement("img");
      img.src = focusArt.currentSrc || focusArt.src;
      img.alt = "";
      ghost.appendChild(img);
      ghost.style.left = `${artRect.left}px`;
      ghost.style.top = `${artRect.top}px`;
      ghost.style.width = `${artRect.width}px`;
      ghost.style.height = `${artRect.height}px`;
      document.body.appendChild(ghost);
    }

    // Hand the active view back in place: it was only ever visually hidden, so no
    // card is rebuilt, no item reflows and the page keeps its scroll offset.
    const view = viewFor(kind);
    if (view) {
      view.classList.remove("is-behind");
      view.inert = false;
    }
    const scope = gridFor(kind);
    if (scope) {
      scope.hidden = false;
      scope.classList.remove("is-fading");
      scope.inert = false;
      scope.querySelectorAll(".is-selected").forEach((card) => card.classList.remove("is-selected"));
    }
    if (canFly) {
      focus.classList.remove("is-open", "is-zooming");
      focus.classList.add("is-leaving");
    }

    const finish = () => {
      if (ghost) ghost.remove();
      if (seq !== state.zoomSeq) return;
      window.clearTimeout(state.zoomTimer);
      focus.hidden = true;
      focus.classList.remove("is-open", "is-zooming", "is-leaving", "is-art");
      if (focusArtFrame) {
        focusArtFrame.style.transition = "";
        focusArtFrame.style.transform = "";
      }
      if (target && target.card) target.card.focus({ preventScroll: true });
    };

    if (!canFly) {
      finish();
      return;
    }

    // Measure the tile after the archive is back in sight, then glide onto it.
    const to = target.media.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (seq !== state.zoomSeq || !ghost) return;
      ghost.style.transform = `translate(${to.left - artRect.left}px, ${to.top - artRect.top}px)`
        + ` scale(${to.width / artRect.width}, ${to.height / artRect.height})`;
      state.zoomTimer = window.setTimeout(finish, 480);
    });
  }

  /* ------------------------------------------------------------------ views */

  const normalizeView = (kind) => (kind === "art" || kind === "artwork" ? "art" : "beats");

  function setView(kind, push, scroll) {
    const next = normalizeView(kind);
    if (state.kind) closeFocus(false, true);
    state.view = next;
    document.documentElement.classList.toggle("view-artwork", next === "art");
    if (home) {
      home.hidden = next !== "beats";
      home.inert = next !== "beats";
    }
    if (artView) {
      artView.hidden = next !== "art";
      artView.inert = next !== "art";
    }
    navLinks.forEach((link) => {
      const active = normalizeView(link.getAttribute("data-yx-view")) === next;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (push) {
      const url = new URL(location.href);
      if (next === "art") {
        url.searchParams.set("view", "artwork");
        url.searchParams.delete("focus");
      } else {
        url.searchParams.delete("view");
        url.searchParams.delete("artwork");
        url.searchParams.delete("focus");
      }
      history.pushState({ view: next }, "", url.pathname + url.search);
    }
    if (scroll !== false) window.scrollTo(0, 0);
  }

  function syncFromUrl() {
    const query = new URLSearchParams(location.search);
    const artId = query.get("artwork");
    const inArt = Boolean(artId) || query.get("view") === "artwork";
    if (inArt) {
      if (state.beat && state.kind !== "art") closeFocus(false, true);
      if (state.view !== "art") setView("art", false, false);
      if (artId) openItem(artId, "art", false);
      else if (state.beat) closeFocus(false);
      return;
    }
    if (state.beat && state.kind === "art") closeFocus(false, true);
    if (state.view !== "beats") setView("beats", false, false);
    const id = query.get("focus");
    if (id) openItem(id, "beat", false);
    else if (state.beat) closeFocus(false);
  }

  /* ---------------------------------------------------------------- preview */

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function paintAudio() {
    const audio = state.audio;
    if (!audio || !state.beat) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
    state.seek.value = String(ratio * 100);
    state.seek.style.setProperty("--p", `${ratio * 100}%`);
    state.seek.disabled = !duration;
    state.time.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    const playing = !audio.paused && !audio.ended;
    state.play.dataset.playing = playing ? "true" : "false";
    state.play.setAttribute("aria-pressed", playing ? "true" : "false");
    state.play.setAttribute("aria-label", playing ? "Pause preview" : "Play preview");
  }

  function pauseAudio() {
    if (!state.audio) return;
    state.audio.pause();
    state.audio.removeAttribute("src");
    state.audio.load();
    if (state.play) {
      state.play.dataset.playing = "false";
      state.play.setAttribute("aria-pressed", "false");
      state.play.setAttribute("aria-label", "Play preview");
    }
    if (state.seek) {
      state.seek.value = "0";
      state.seek.style.setProperty("--p", "0%");
      state.seek.disabled = true;
    }
    if (state.time) state.time.textContent = "0:00 / --:--";
  }

  function loadAudio(beat) {
    if (!state.audio) return;
    pauseAudio();
    if (!beat.preview) {
      state.time.textContent = "PREVIEW UNAVAILABLE";
      state.play.disabled = true;
      return;
    }
    state.play.disabled = false;
    state.audio.preload = "auto";
    state.audio.src = beat.preview;
    state.audio.load();
  }

  if (state.audio) {
    state.audio.addEventListener("loadedmetadata", paintAudio);
    state.audio.addEventListener("durationchange", paintAudio);
    state.audio.addEventListener("timeupdate", paintAudio);
    state.audio.addEventListener("play", paintAudio);
    state.audio.addEventListener("pause", paintAudio);
    state.audio.addEventListener("ended", () => {
      state.audio.currentTime = 0;
      paintAudio();
    });
    state.audio.addEventListener("error", () => {
      if (state.time) state.time.textContent = "PREVIEW UNAVAILABLE";
      if (state.play) state.play.disabled = true;
    });
  }

  if (state.play) {
    state.play.addEventListener("click", () => {
      if (!state.audio || !state.audio.src) return;
      if (state.audio.paused) {
        const attempt = state.audio.play();
        if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
      } else {
        state.audio.pause();
      }
    });
  }

  if (state.seek) {
    state.seek.addEventListener("input", () => {
      if (!state.audio || !Number.isFinite(state.audio.duration)) return;
      state.audio.currentTime = (Number(state.seek.value) / 100) * state.audio.duration;
      paintAudio();
    });
  }

  /* --------------------------------------------------------- release + claims */

  function watchCountdowns() {
    clearInterval(state.releaseTimer);
    if (!HELPERS.isReleased) return;
    const pending = newest.filter((beat) => !isReleased(beat));
    if (!pending.length) return;
    const tick = () => {
      let due = false;
      grid.querySelectorAll("[data-countdown]").forEach((node) => {
        const beat = HELPERS.beatById && HELPERS.beatById(node.getAttribute("data-countdown"));
        if (!beat) return;
        if (isReleased(beat)) { due = true; return; }
        node.textContent = countdown(beat);
      });
      const focusCount = focus.querySelector("[data-focus-countdown]");
      if (focusCount && state.beat) {
        if (isReleased(state.beat)) due = true;
        else focusCount.textContent = countdown(state.beat);
      }
      if (due) {
        renderGrid();
        if (state.beat) renderFocus(state.beat, true, state.kind);
      }
    };
    tick();
    state.releaseTimer = window.setInterval(tick, 1000);
  }

  function repaintClaims() {
    if (document.documentElement.classList.contains("gate-open")) return;
    renderGrid();
    if (state.beat && state.kind === "beat") renderFocus(state.beat, true, "beat");
  }

  window.addEventListener("kyrolll:exclusive-locked", repaintClaims);
  window.addEventListener("kyrolll:exclusive-claims", repaintClaims);

  /* ----------------------------------------------------------------- wiring */

  grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-yx-beat]");
    if (!card) return;
    openItem(card.getAttribute("data-yx-beat"), "beat", true);
  });

  if (artGrid) {
    artGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-yx-beat]");
      if (!card) return;
      openItem(card.getAttribute("data-yx-beat"), "art", true);
    });
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      setView(link.getAttribute("data-yx-view"), true);
    });
  });

  focusPacks.addEventListener("click", (event) => {
    const button = event.target.closest("[data-yx-pack]");
    if (!button || !state.beat || state.kind === "art") return;
    if (isLocked(state.beat) || !isReleased(state.beat)) return;
    if (!window.KYROlll_DOWNLOADS || !window.KYROlll_DOWNLOADS.start) return;
    window.KYROlll_DOWNLOADS.start(state.beat.id, button.getAttribute("data-yx-pack"));
  });

  focus.querySelectorAll("[data-yx-close]").forEach((button) => {
    button.addEventListener("click", () => closeFocus(true));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.beat) return;
    if (document.documentElement.classList.contains("gate-open")) return;
    closeFocus(true);
  });

  window.addEventListener("popstate", () => syncFromUrl(false));

  syncFocusTop();
  window.addEventListener("resize", syncFocusTop);

  renderGrid();
  renderArtGrid();
  const startInArt = params.get("view") === "artwork" || params.has("artwork");
  setView(startInArt ? "art" : "beats", false, false);
  if (startInArt && params.get("artwork")) openItem(params.get("artwork"), "art", false);
  else if (!startInArt && params.get("focus")) openItem(params.get("focus"), "beat", false);

  // Exposed for the smoke check and for the room's old callers, without making
  // any of this a public contract.
  window.KYROlll_ARCHIVE = {
    open: (id) => openItem(id, "beat", true),
    openArtwork: (id) => openItem(id, "art", true),
    view: (name) => setView(name, true),
    close: () => closeFocus(true),
    get focused() { return state.beat ? state.beat.id : null; },
    get currentView() { return state.view; },
  };
})();
