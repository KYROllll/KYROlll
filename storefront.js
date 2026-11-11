/* KYROIII — the archive home.
 *
 * The home route is one quiet grid of records. Choosing a cover fades the rest
 * of the archive out and opens a focused view: the record, its preview and the
 * three free packages. The gate itself is never re-implemented here — every
 * package button calls `KYROlll_DOWNLOADS.start`, so the email + license flow,
 * the PDF and the exclusive-claim register stay exactly where they live.
 *
 * The grid and the focus view are home-only. A direct `?beat=` link still
 * renders the full beat card through script.js, untouched.
 */
(function () {
  "use strict";

  const CATALOG = window.KYROlll_CATALOG || [];
  const PACKAGES = window.KYROlll_PACKAGES || [];
  const HELPERS = window.KYROlll_HELPERS || {};
  const grid = document.getElementById("yx-grid");
  const home = document.querySelector(".yx-home");
  const focus = document.getElementById("yx-focus");
  const header = document.querySelector(".site-header");
  const countNode = document.querySelector("[data-yx-count]");
  if (!grid || !focus) return;

  const params = new URLSearchParams(location.search);
  if (params.has("beat")) return;

  const newest = [...CATALOG].sort((a, b) => CATALOG.indexOf(b) - CATALOG.indexOf(a));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    beat: null,
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

  function renderFocus(beat, keepAudio) {
    const { name, type } = splitTitle(beat);
    const locked = isLocked(beat);
    const owned = locked && isOwned(beat);
    const pending = !locked && !isReleased(beat);

    focusArt.src = beat.img;
    focusArt.alt = `${name} cover art`;
    focusIndex.textContent = numberFor(beat);
    focusTitle.textContent = name;
    focusType.textContent = type;
    focusSpecs.textContent = specsFor(beat);

    let status = "";
    if (pending) status = `DROPPING SOON — <b data-focus-countdown>${esc(countdown(beat))}</b>`;
    else if (locked) status = owned ? "PRIVATE MASTER // YOURS" : "CLAIMED / SOLD OUT";
    focusStatus.innerHTML = status;
    focusStatus.hidden = !status;
    focusStatus.classList.toggle("is-locked", locked);

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

  function cardMedia(beat) {
    const card = grid.querySelector(`[data-yx-beat="${CSS.escape(beat.id)}"]`);
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

  function showFocus(beat) {
    const from = cardMedia(beat);
    const seq = ++state.zoomSeq;
    state.beat = beat;
    renderFocus(beat);
    if (from && from.card) from.card.classList.add("is-selected");
    window.clearTimeout(state.zoomTimer);
    syncFocusTop();
    // A close that is still flying home must not tint a freshly opened sheet.
    document.querySelectorAll(".yx-ghost").forEach((node) => node.remove());
    focus.classList.remove("is-leaving");
    // Lay the archive out but take it out of sight: keeping its height means the
    // page never re-scrolls behind the sheet, so the zoom lands back on the tile.
    home.classList.add("is-behind");
    home.inert = true;
    focus.hidden = false;
    focus.scrollTop = 0;
    focus.classList.add("is-open");
    focus.focus({ preventScroll: true });
    if (from && !reduced.matches) zoomIn(from, seq);
  }

  function openBeat(id, push) {
    const beat = newest.find((item) => item.id === id || item.slug === id);
    if (!beat) return;
    if (state.beat && state.beat.id === id) return;
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set("focus", id);
      history.pushState({ focus: id }, "", url.pathname + url.search);
    }
    showFocus(beat);
  }

  function closeFocus(push) {
    if (!state.beat) return;
    const last = state.beat;
    const seq = ++state.zoomSeq;
    state.beat = null;
    window.clearTimeout(state.zoomTimer);
    pauseAudio();
    if (push) {
      const url = new URL(location.href);
      url.searchParams.delete("focus");
      history.replaceState(null, "", url.pathname + url.search);
    }

    const target = cardMedia(last);
    const artRect = focusArtFrame ? focusArtFrame.getBoundingClientRect() : null;
    const canFly = Boolean(target && artRect && artRect.width > 1 && artRect.height > 1 && !reduced.matches);

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

    // Hand the archive back in place: it was only ever visually hidden, so no
    // card is rebuilt, no item reflows and the page keeps its scroll offset.
    home.classList.remove("is-behind");
    home.inert = false;
    grid.hidden = false;
    grid.classList.remove("is-fading");
    grid.inert = false;
    grid.querySelectorAll(".is-selected").forEach((card) => card.classList.remove("is-selected"));
    if (canFly) {
      focus.classList.remove("is-open", "is-zooming");
      focus.classList.add("is-leaving");
    }

    const finish = () => {
      if (ghost) ghost.remove();
      if (seq !== state.zoomSeq) return;
      window.clearTimeout(state.zoomTimer);
      focus.hidden = true;
      focus.classList.remove("is-open", "is-zooming", "is-leaving");
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

  function syncFromUrl() {
    const id = new URLSearchParams(location.search).get("focus");
    if (id) openBeat(id, false);
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
        if (state.beat) renderFocus(state.beat);
      }
    };
    tick();
    state.releaseTimer = window.setInterval(tick, 1000);
  }

  function repaintClaims() {
    if (document.documentElement.classList.contains("gate-open")) return;
    renderGrid();
    if (state.beat) renderFocus(state.beat, true);
  }

  window.addEventListener("kyrolll:exclusive-locked", repaintClaims);
  window.addEventListener("kyrolll:exclusive-claims", repaintClaims);

  /* ----------------------------------------------------------------- wiring */

  grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-yx-beat]");
    if (!card) return;
    openBeat(card.getAttribute("data-yx-beat"), true);
  });

  focusPacks.addEventListener("click", (event) => {
    const button = event.target.closest("[data-yx-pack]");
    if (!button || !state.beat) return;
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
  if (params.get("focus")) openBeat(params.get("focus"), false);

  // Exposed for the smoke check and for the room's old callers, without making
  // any of this a public contract.
  window.KYROlll_ARCHIVE = {
    open: (id) => openBeat(id, true),
    close: () => closeFocus(true),
    get focused() { return state.beat ? state.beat.id : null; },
  };
})();
