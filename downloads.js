/* KYROIII — the free-download layer.
 *
 * Unifies the "DOWNLOAD FREE" package menu, the lightweight gates (YouTube +
 * email) and the actual browser downloads. No cart, no checkout, no backend.
 *
 * SMART SESSION MEMORY — nothing is ever written down:
 * - no `localStorage`, no `sessionStorage`, no cookie and no unlock set;
 * - a package unlocked in this view is remembered in one plain in-page Map
 *   (`grants`), so the visitor is never made to pass the same gate twice in
 *   one session — and the memory evaporates with the page.
 * A reload, a new tab, a bookmark or a shared link always re-opens the gate from
 * scratch, and the address is never prefilled.
 *
 * STRICT GATING — each package asks for exactly what its own listing promises:
 * - MP3 LEASE (gate: email): EMAIL + MANDATORY OPT-IN → REVIEW & SIGN → FILES + PDF.
 * - STANDARD WAV LEASE (gate: youtube): SUBSCRIBE to the channel → EMAIL + OPT-IN →
 *   REVIEW & SIGN.
 * - EXCLUSIVE / PRO PACKAGE (gate: exclusive): SUBSCRIBE + LIKE this beat's own
 *   video → EMAIL + OPT-IN → REVIEW & SIGN (STEMS + MP3 + WAV + PDF).
 *
 * Two rules make those steps real rather than a click-through. A YouTube step
 * only counts after a genuine gesture AND a minimum hold (`STEP_HOLD_MS`), so
 * opening it and bouncing straight back cannot mark it done; and the REVIEW &
 * SIGN stage that closes every gate only unlocks once the terms have actually
 * been read to the end and a signature — a FULL NAME (first and last) typed, or
 * a real drawing on the pad — has been captured. A single word, a blank line and
 * a token dot are all refused (`isFullName` / `hasSignature`), so there is no
 * bypass to the files. That signature is what the PDF license prints in its
 * LICENSEE block (see `license-pdf.js`), over the flower watermark that ties the
 * signature sheet to the store's mark.
 *
 * Files are handed over under their professional studio names —
 * `KYROIII - <BEAT> (<BPM> BPM - <KEY>).<ext>` — built from the beat's own
 * metadata, so an engineer can read the tempo and key off the filename.
 *
 * The only outbound request is the address itself: a real `fetch` POST to the
 * newsletter provider (Formspree) with `Accept: application/json`, so every
 * submitted address lands in the provider's dashboard. A failed post never
 * blocks the files — they are free — it is logged and the unlock continues.
 *
 * The address the visitor just typed is carried forward to `download.html` in
 * that one flow's query string (see `downloadUrl`), never stored.
 */
(function () {
  "use strict";

  try {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function helpers() { return window.KYROlll_HELPERS || null; }
  function newsletterEndpoint() {
    const h = helpers();
    return h && h.newsletterEndpoint ? h.newsletterEndpoint() : "";
  }

  /* ------------------------------------------------------ low-level download */
  /* A same-origin file gets `dl`/`name` appended so the server can answer with
     `Content-Disposition: attachment` — the only reliable way to make a phone
     save an audio file instead of playing it inline. */
  function downloadHref(file, name) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(file)) return file;
    const query = "dl=1" + (name ? "&name=" + encodeURIComponent(name) : "");
    return file + (file.indexOf("?") === -1 ? "?" : "&") + query;
  }
  function triggerDownload(href, name) {
    const link = document.createElement("a");
    link.href = downloadHref(href, name);
    if (name) link.download = name;
    link.rel = "noopener noreferrer";
    link.target = "_self";
    link.style.display = "none";
    document.body.appendChild(link);
    try { link.click(); } catch (err) { /* ignore */ }
    link.remove();
  }
  function downloadItem(item) {
    if (!item || !item.file) { showToast("DOWNLOAD UNAVAILABLE"); return; }
    triggerDownload(item.file, item.name || "");
    showToast("DOWNLOAD STARTED — CHECK YOUR DOWNLOADS");
  }

  /* ------------------------------------------------- professional file names
     A studio engineer should be able to read the tempo and the key straight
     off the filename, so every hand-over is renamed on the way out:
     `KYROIII - FLESH (130 BPM - AM).mp3`. Audio files take that convention
     exactly; the tracked-stems archive carries the same stem plus its own
     label, so a zip is never mistaken for a take. Only the extension stays
     lowercase — everything else is in the store's ALL-CAPS voice. */
  const AUDIO_EXT = /^\.(mp3|wav|m4a|aac|aiff|aif|flac|ogg)$/i;
  function callName(beat) {
    const title = String((beat && beat.title) || "").trim();
    const tail = title.split(/\s+-\s+/).pop() || "";
    return String(tail || (beat && beat.slug) || (beat && beat.id) || "BEAT").toUpperCase();
  }
  function proFileName(beat, item) {
    if (!beat || !item || !item.file) return (item && item.name) || "";
    const ext = (String(item.file).match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
    const stem = "KYROIII - " + callName(beat) + " (" + beat.bpm + " BPM - " +
      String(beat.key || "").toUpperCase() + ")";
    if (AUDIO_EXT.test(ext)) return stem + ext;
    const label = String(item.label || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    return (label ? stem + " - " + label : stem) + ext;
  }
  /* The files a package hands over, named for the studio. */
  function deliverablesFor(beatId, packageId) {
    const h = helpers();
    if (!h || !h.deliverablesFor) return [];
    const beat = h.beatById ? h.beatById(beatId) : null;
    return h.deliverablesFor(beatId, packageId).map((item) => {
      const name = proFileName(beat, item);
      return name ? Object.assign({}, item, { name: name }) : item;
    });
  }

  /* -------------------------------------------------------------- the flow */
  /* A one-shot token handed from a passed gate to `download.html`. It is not
     stored anywhere: it only says "this browser passed the gate in this flow a
     moment ago", so the download page does not ask a second time. Loading the
     same URL cold (no token) re-opens the gate, which is the whole point. */
  function grantToken() {
    const bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, (b) => ("0" + b.toString(16)).slice(-2)).join("");
  }
  function downloadUrl(beatId, packageId, email) {
    let url = "download.html?beat=" + encodeURIComponent(beatId) +
      "&package=" + encodeURIComponent(packageId) + "&t=" + grantToken();
    const address = String(email == null ? "" : email).trim();
    if (address) url += "&email=" + encodeURIComponent(address);
    /* The signature captured in the REVIEW & SIGN stage rides along too: the
       typed name as `?sign=`, a drawing packed as `?sig=`. Like the address it
       is never stored — losing the URL loses the signature. */
    const payload = signaturePayload();
    if (payload.name) url += "&sign=" + encodeURIComponent(payload.name);
    const packed = encodeStrokes(payload.strokes);
    if (packed) url += "&sig=" + encodeURIComponent(packed);
    return url;
  }
  function goToDownload(beat, pack, email) {
    window.location.assign(downloadUrl(beat.id, pack.id, email));
  }
  /* ------------------------------------------------------ session memory
     One unlocked package per beat, remembered only for the life of this page.
     It is a plain Map — no `localStorage`, no `sessionStorage`, no cookie and
     no server — so the store keeps asking on the next visit and the browser
     keeps nothing. */
  const grants = new Map();
  function grantKey(beatId, packageId) { return String(beatId) + "::" + String(packageId); }
  function grantedEmail(beatId, packageId) {
    const key = grantKey(beatId, packageId);
    return grants.has(key) ? grants.get(key) : null;
  }
  function rememberGrant(beatId, packageId, email) {
    grants.set(grantKey(beatId, packageId), String(email == null ? "" : email).trim());
  }
  /* True only while this page view holds a grant for that package. */
  function isUnlocked(beatId, packageId) {
    return !!beatId && !!packageId && grants.has(grantKey(beatId, packageId));
  }

  /* --------------------------------------------------- the licensee identity
     The LICENSEE block of the license carries the signature captured in the
     gate's REVIEW & SIGN stage: a typed name, or a drawing made on the pad.
     When neither is given it falls back to the address this flow submitted at
     the gate (carried in `?email=…`), so a license can never go out blank.
     Everything about "who this flow is" lives here and none of it is stored:
     the signature is handed forward in the flow's URL exactly like the
     address is (`downloadUrl`), and `license-pdf.js` only reads the result. */
  const SIGN_PAD = { w: 600, h: 220 };   // the pad's canvas, so a drawing keeps its aspect
  const SIGN_POINTS = 320;               // per stroke and in total — a URL, not a canvas dump
  const SIGN_INK_MIN = 8;                // points a real drawing needs before it counts
  const SIGN_SPAN_MIN = 0.3;             // of the pad's width + height, so a dot cannot sign

  /* A name that signs a license is a FULL name: two to four name parts, each of
     them a word (letters, with an optional hyphen/apostrophe inside) at least
     two letters long, and nothing else in the string. A single word (`MADONNA`),
     a lone initial (`J V`), a line of spaces and a row of digits are all refused
     — so the unlock button cannot be reached without a genuine first AND last
     name. */
  function isFullName(value) {
    const parts = String(value == null ? "" : value).trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) return false;
    return parts.every((part) =>
      /^[A-Za-z][A-Za-z'\u2019.\-]*$/.test(part) && part.replace(/[^A-Za-z]/g, "").length >= 2);
  }

  let signature = "";
  let drawnStrokes = null;
  function setSignature(value) {
    signature = String(value == null ? "" : value).trim().slice(0, 64);
    if (signature) drawnStrokes = null;  // a typed name replaces a drawing
    return signature;
  }
  function getSignature() { return signature; }
  /* Keep a drawn signature. An empty array clears it (the visitor switched
     back to typing), which is why the length is checked before assigning. */
  function setDrawnSignature(strokes) {
    drawnStrokes = Array.isArray(strokes) && strokes.length
      ? strokes
        .map((stroke) => (Array.isArray(stroke) ? stroke : [])
          .map((point) => [Number(point && point[0]) || 0, Number(point && point[1]) || 0])
          .slice(0, SIGN_POINTS))
        .filter((stroke) => stroke.length > 1)
        .slice(0, 12)
      : null;
    if (drawnStrokes && drawnStrokes.length) signature = "";
    return drawnStrokes;
  }
  function signatureStrokes() { return drawnStrokes; }
  /* The typed name, or the address this flow submitted at the gate. */
  function licenseeName(fallback) {
    const typed = signature || String(fallback == null ? "" : fallback).trim();
    return String(typed || "").trim();
  }
  /* What `license-pdf.js` stamps into the LICENSEE block. */
  function signaturePayload() {
    return { name: signature, strokes: drawnStrokes, pad: drawnStrokes ? SIGN_PAD : null };
  }
  /* The drawing, packed small enough to ride in the flow's URL: each point is
     hundredths of the pad box, strokes separated by `~`. */
  function encodeStrokes(strokes) {
    if (!strokes || !strokes.length) return "";
    const hundred = (value) => String(Math.round(Math.min(Math.max(Number(value) || 0, 0), 1) * 100));
    return strokes.map((stroke) => stroke.slice(0, SIGN_POINTS)
      .map((point) => hundred(point[0]) + ":" + hundred(point[1])).join(","))
      .filter(Boolean).join("~");
  }
  function decodeStrokes(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return null;
    const strokes = text.split("~").map((stroke) => stroke.split(",").map((point) => {
      const pair = String(point).split(":");
      const x = Number(pair[0]), y = Number(pair[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? [x / 100, y / 100] : null;
    }).filter(Boolean)).filter((stroke) => stroke.length > 1);
    return strokes.length ? strokes : null;
  }
  /* Take the signature the sign stage handed forward. */
  function adoptSignature(name, packedStrokes) {
    if (packedStrokes) setDrawnSignature(decodeStrokes(packedStrokes));
    if (name) setSignature(name);
    return signaturePayload();
  }

  function start(beatId, packageId) {
    const catalog = helpers();
    const beat = catalog && catalog.beatById(beatId);
    const pack = catalog && catalog.packageById(packageId);
    if (!beat || !pack) { showToast("BEAT OR PACKAGE NOT FOUND"); return; }
    const remembered = grantedEmail(beat.id, pack.id);
    if (remembered !== null) {
      showToast("ALREADY UNLOCKED THIS SESSION");
      goToDownload(beat, pack, remembered);
      return;
    }
    if (pack.gate === "instant") { goToDownload(beat, pack, ""); return; }
    openGate(beat, pack, (b, p, email) => { goToDownload(b, p, email); });
  }

  /* ------------------------------------------------------ menu */
  let activeMenu = null;
  /* The viewport the drawer must fit inside. On a phone the visual viewport is
     the honest measurement — it shrinks with the keyboard and moves with the
     pinch — so the drawer is only ever clamped to what the visitor can see. */
  function viewportBox() {
    const vv = window.visualViewport;
    const w = (vv && vv.width) || window.innerWidth;
    const h = (vv && vv.height) || window.innerHeight;
    return { w: w || window.innerWidth, h: h || window.innerHeight };
  }
  /* The drawer is rendered inside the trigger's own container, so it is part of
     the same element as the button instead of a panel floating over the page:
     it spans exactly the button's width and butts straight onto its edge. */
  function menuHost(trigger) {
    return (trigger && trigger.parentElement) || document.body;
  }
  function openMenu(trigger, beatId) {
    closeMenu();
    const catalog = helpers();
    const beat = catalog && catalog.beatById(beatId);
    if (!beat) { showToast("BEAT NOT FOUND"); return; }
    const host = menuHost(trigger);
    const tile = trigger.closest ? trigger.closest(".catalog-tile") : null;
    /* The detail card's sleeve is a positioned sibling painted after the copy
       column, so the column that owns the trigger is lifted while its drawer is
       open — otherwise the cover art sits on top of the open drawer and swallows
       its taps (seen in the phone run: the tier was covered by `flesh.png`). */
    const stage = trigger.closest ? trigger.closest(".beat-detail") : null;
    const menu = document.createElement("div");
    menu.className = "download-menu";
    menu.setAttribute("role", "menu");
    const packs = (window.KYROlll_PACKAGES || []).map((pack, i) => {
      return '<button type="button" class="download-tier" role="menuitem" data-package="' + escapeHTML(pack.id) + '" style="--tier-i:' + i + '">' +
        '<span class="download-tier__top"><span class="download-tier__name">' + escapeHTML(pack.name) + '</span>' +
        '<span class="download-tier__tag">' + escapeHTML(pack.tag || "") + '</span></span>' +
        '<span class="download-tier__blurb">' + escapeHTML(pack.blurb || "") + '</span>' +
      '</button>';
    }).join("");
    menu.innerHTML = '<div class="download-menu__head">' +
        '<span class="download-menu__kicker">DOWNLOAD FREE</span>' +
        '<span class="download-menu__beat">' + escapeHTML(beat.title) + '</span>' +
      '</div>' +
      '<div class="download-menu__list">' + packs + '</div>';
    host.appendChild(menu);
    /* `is-menu-open` on the container lights the ambient bloom that pours out of
       the button into the drawer; the tile guard drops the catalog tile's 3D
       hover transform so the open drawer is never rendered on a tilted plane. */
    host.classList.add("is-menu-open");
    if (tile) tile.classList.add("is-menu-open");
    if (stage) stage.classList.add("is-menu-open");
    activeMenu = { el: menu, anchor: trigger, host: host, tile: tile, stage: stage };
    menu.querySelectorAll(".download-tier").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeMenu();
        start(beat.id, btn.getAttribute("data-package"));
      });
    });
    trigger.setAttribute("aria-expanded", "true");
    positionMenu();
    /* The drawer travels with its button, so page scrolling needs no repositioning
       at all — no listener, nothing to drift or lag behind a swipe. The only thing
       that is watched is the *visible* viewport (the keyboard, a pinch, the mobile
       URL bar), and that is one reposition per frame. */
    window.addEventListener("resize", guardMenuScroll, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", guardMenuScroll);
      window.visualViewport.addEventListener("scroll", guardMenuScroll);
    }
    document.addEventListener("keydown", handleMenuKey);
    document.addEventListener("click", handleMenuOutside, true);
    /* The panel is appended closed and opened on the next frame, so its reveal
       actually animates instead of landing already-expanded. */
    requestAnimationFrame(() => {
      if (activeMenu && activeMenu.el === menu) {
        menu.classList.add("is-open");
        positionMenu();
      }
    });
  }
  let menuFrame = 0;
  function guardMenuScroll() {
    if (menuFrame) return;
    menuFrame = requestAnimationFrame(() => { menuFrame = 0; positionMenu(); });
  }
  function handleMenuOutside(e) {
    if (activeMenu && !activeMenu.el.contains(e.target) && !activeMenu.anchor.contains(e.target)) closeMenu();
  }
  function handleMenuKey(e) { if (e.key === "Escape") closeMenu(); }
  function closeMenu() {
    if (!activeMenu) return;
    const { el, anchor, host, tile, stage } = activeMenu;
    if (anchor) anchor.setAttribute("aria-expanded", "false");
    if (el) { el.classList.remove("is-open"); el.remove(); }
    if (host) host.classList.remove("is-menu-open");
    if (tile) tile.classList.remove("is-menu-open");
    if (stage) stage.classList.remove("is-menu-open");
    activeMenu = null;
    if (menuFrame) { cancelAnimationFrame(menuFrame); menuFrame = 0; }
    window.removeEventListener("resize", guardMenuScroll, true);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", guardMenuScroll);
      window.visualViewport.removeEventListener("scroll", guardMenuScroll);
    }
    document.removeEventListener("keydown", handleMenuKey);
    document.removeEventListener("click", handleMenuOutside, true);
  }
  /* The drawer only ever makes two decisions: which way it unfolds (down, or up
     when the space below is the cramped side) and how tall it may grow — never a
     pixel wider than its button, never taller than the visible viewport, and
     scrolling inside itself when a short screen cannot show every tier at once.
     Both edges and the seam are taken straight off the trigger's own box, so the
     pair is welded together in every container (the detail card's action column
     and a catalog tile's padded footer alike). */
  function positionMenu() {
    if (!activeMenu) return;
    const { el, anchor } = activeMenu;
    const host = menuHost(anchor);
    const box = viewportBox();
    const rect = anchor.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const edge = 12;
    /* Exactly the button's box: same left edge, same right edge, and a seam with
       no gap whoever the container is. */
    el.style.left = (rect.left - hostRect.left) + "px";
    el.style.right = (hostRect.right - rect.right) + "px";
    /* Measure the panel's own height before capping it. */
    el.style.maxHeight = "none";
    const natural = el.getBoundingClientRect().height;
    const below = box.h - rect.bottom - edge;
    const above = rect.top - edge;
    const up = below < Math.min(natural, 200) && above > below;
    el.classList.toggle("download-menu--up", up);
    if (up) {
      el.style.top = "auto";
      el.style.bottom = (hostRect.bottom - rect.top) + "px";
    } else {
      el.style.bottom = "auto";
      el.style.top = (rect.bottom - hostRect.top) + "px";
    }
    const room = Math.max(120, up ? above : below);
    el.style.maxHeight = Math.min(natural || room, room) + "px";
  }

  /* escapeHTML for gate body rendering */
  function escapeHTML(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ 
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" 
    }[c]));
  }

  /* gates */
  let gate = null;
  let gateKeyHandler = null;

  /* The page behind an open gate is locked the way a phone respects: a plain
     `overflow: hidden` alone makes iOS jump to the top, so the scroll offset is
     pinned on the body and restored when the gate closes. Nothing is stored —
     it lives for the length of the dialog. */
  let pageLocked = false;
  let lockedAt = 0;
  function lockPage() {
    document.documentElement.classList.add("gate-open");
    if (pageLocked) return;
    pageLocked = true;
    lockedAt = window.pageYOffset || document.documentElement.scrollTop || 0;
    document.body.style.position = "fixed";
    document.body.style.top = -lockedAt + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }
  function unlockPage() {
    document.documentElement.classList.remove("gate-open");
    if (!pageLocked) return;
    pageLocked = false;
    const y = lockedAt;
    lockedAt = 0;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, y);
  }

  /* One outside-click handler for the life of the page. It used to be installed
     per gate and only removed on Escape, so every gate left another listener
     behind and each tap ran over the whole stack — the mobile freeze. */
  function handleGateOutside(event) {
    if (gate && !gate.contains(event.target)) closeGate();
  }
  document.addEventListener("click", handleGateOutside, true);

  function closeGate() {
    if (!gate) return;
    const node = gate;
    gate = null;
    clearStepTimers();
    if (gateKeyHandler) { document.removeEventListener("keydown", gateKeyHandler); gateKeyHandler = null; }
    node.classList.remove("is-visible");
    unlockPage();
    setTimeout(() => node.remove(), 260);
  }

  /* Every stage of a gate is rendered into the same card, so the CANCEL and
     backdrop controls are (re)bound after each render — `stageTitle` keeps the
     beat in the heading, `kicker` names the package. */
  function wireGateDismiss(modal) {
    modal.querySelectorAll("[data-gate-cancel]").forEach((el) => {
      el.removeEventListener("click", closeGate);
      el.addEventListener("click", closeGate);
    });
  }

  function gateShell(pack, beat, stageTitle, body) {
    const titleText = stageTitle ? (escapeHTML(stageTitle) + ' — ' + escapeHTML(beat.title)) : escapeHTML(beat.title);
    return '<div class="gate-modal__backdrop" data-gate-cancel></div>' +
      '<div class="gate-modal__card" role="dialog" aria-modal="true" aria-labelledby="gate-title">' +
        '<span class="gate-modal__kicker">' + escapeHTML(pack.name) + '</span>' +
        '<h2 class="gate-modal__title" id="gate-title">' + titleText + '</h2>' + body + '</div>';
  }

  /* The animated tick used by every completed step (and by the email field once
     the address is valid). The path draws itself on `.is-done` / `.is-valid`. */
  function tickSVG() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 12.7 9.7 17.6 19.4 6.9"/></svg>';
  }

  /* The email form used by every gate: one address field, the mandatory opt-in
     checkbox (required and pre-ticked, so it must be deliberately kept) and a
     real POST action so the form also works with scripting out of the way. */
  function emailFormHTML(optin) {
    const endpoint = newsletterEndpoint();
    return '<form class="gate-form" data-gate-form novalidate' +
        (endpoint ? ' action="' + escapeHTML(endpoint) + '" method="post"' : '') + '>' +
        '<label class="gate-field" data-gate-field><span class="gate-field__label">EMAIL' +
          '<span class="gate-field__tick" aria-hidden="true">' + tickSVG() + '</span></span>' +
          '<input class="gate-input" id="gate-email" name="email" type="email" inputmode="email" autocomplete="off" spellcheck="false" placeholder="you@email.com" required>' +
        '</label>' +
        '<label class="gate-optin"><input type="checkbox" id="gate-optin" name="opt_in" checked required><span>' + (optin || "EMAIL ME FUTURE BEAT DROPS &amp; UPDATES") + '</span></label>' +
        '<input type="hidden" name="embed" value="1">' +
        '<input type="hidden" name="tag" value="beat-download">' +
        '<input type="hidden" name="_subject" value="KYROIII BEAT DOWNLOAD">' +
      '</form>';
  }

  /* The address field turns into a satisfied tick the moment it is well formed. */
  function setFieldValid(modal, ok) {
    const field = modal.querySelector("[data-gate-field]");
    if (field) field.classList.toggle("is-valid", !!ok);
  }

  /* Email gate body — the gate every package passes through. `opts.hint: false`
     suppresses its own hint line, because a gate that already shows numbered
     steps carries a richer hint of its own (and two #gate-hint nodes in one
     dialog would be a duplicate id). */
  function emailGateBody(pack, opts) {
    const label = (opts && opts.submit) || "UNLOCK DOWNLOAD";
    return '<p class="gate-modal__copy">ENTER YOUR EMAIL TO UNLOCK THE ' + escapeHTML(pack.name) + '.</p>' +
      emailFormHTML(opts && opts.optin) +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-modal__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-gate-submit disabled>' + escapeHTML(label) + '</button>' +
      '</div>' +
      ((opts && opts.hint === false) ? '' : '<p class="gate-modal__hint" id="gate-hint">ENTER EMAIL, TICK THE BOX AND SUBMIT</p>');
  }

  /* The YouTube step rows, in the order the packages ask for them: every gated
     package subscribes to the channel, and only the Pro package also likes this
     beat's own video — which is exactly what the two listings promise. Each row
     carries the tick that draws itself once it has been opened. */
  function youtubeSteps(channel, video, count) {
    const step = (n, href, title, meta) =>
      '<a class="gate-step" href="' + escapeHTML(href) + '" target="_blank" rel="noopener noreferrer" data-gate-step="' + n + '">' +
        '<span class="gate-step__num"><span>' + (n + 1) + '</span><span class="gate-step__tick" aria-hidden="true">' + tickSVG() + '</span></span>' +
        '<span class="gate-step__body"><span class="gate-step__title">' + title + '</span><span class="gate-step__meta">' + meta + '</span></span>' +
        '<span class="gate-step__go">OPEN ↗</span>' +
      '</a>';
    const rows = [step(0, channel, "SUBSCRIBE", "TO THE KYROIII CHANNEL")];
    if (count > 1) rows.push(step(1, video, "LIKE THIS VIDEO", "THE BEAT YOU ARE GRABBING"));
    return rows.join("");
  }

  /* ------------------------------------------------- STRICT STEP VERIFICATION
     A YouTube step is not a click-through any more. It counts only after
     1) a genuine gesture — a trusted click, not a scripted one, and
     2) a real visit: the row holds in a VERIFYING state for `STEP_HOLD_MS` and
        cannot be marked done before that, so opening the tab and bouncing
        straight back (the quick-bounce bypass) leaves the gate shut.
     If the page actually lost focus to the opened tab during the hold — the
     strongest evidence of a real visit — the hold is allowed to finish early
     (never before `STEP_QUICK_MS`). A blocked popup still completes on the
     full hold, so a real visitor is never trapped.
     Re-clicking a step while it verifies does nothing at all: no second tab and
     no shortened hold. */
  const STEP_HOLD_MS = 3500;
  const STEP_QUICK_MS = 1200;
  const stepTimers = new Set();
  let lastLeftAt = 0;
  let leftWatch = false;
  function watchDeparture() {
    if (leftWatch) return;
    leftWatch = true;
    const mark = () => { lastLeftAt = Date.now(); };
    document.addEventListener("visibilitychange", () => { if (document.hidden) mark(); });
    window.addEventListener("blur", mark);
  }
  function clearStepTimers() {
    stepTimers.forEach((timer) => clearTimeout(timer));
    stepTimers.clear();
  }
  function wireYouTubeSteps(modal, done, refresh) {
    function verify(step, index) {
      const start = Date.now();
      const go = step.querySelector(".gate-step__go");
      step.dataset.verifying = "on";
      step.classList.add("is-verifying");
      step.setAttribute("aria-busy", "true");
      if (go) go.textContent = "VERIFYING";
      watchDeparture();
      const update = () => {
        const elapsed = Date.now() - start;
        const need = lastLeftAt >= start ? STEP_QUICK_MS : STEP_HOLD_MS;
        if (elapsed < need) {
          if (go) go.textContent = "VERIFYING " + Math.max(1, Math.ceil((need - elapsed) / 1000));
          const next = setTimeout(update, 200);
          stepTimers.delete(timer);
          timer = next;
          stepTimers.add(timer);
          return;
        }
        clearTimeout(timer);
        stepTimers.delete(timer);
        step.dataset.verifying = "";
        step.classList.remove("is-verifying");
        step.removeAttribute("aria-busy");
        done[index] = true;
        step.classList.add("is-done");
        if (go) go.textContent = "OPENED";
        refresh();
      };
      let timer = setTimeout(update, 200);
      stepTimers.add(timer);
    }
    Array.prototype.slice.call(modal.querySelectorAll("[data-gate-step]")).forEach((step) => {
      step.addEventListener("click", (event) => {
        const index = Number(step.getAttribute("data-gate-step"));
        if (!Number.isFinite(index) || index < 0 || index >= done.length) return;
        if (done[index] || step.dataset.verifying === "on") { event.preventDefault(); return; }
        if (event && event.isTrusted === false) { event.preventDefault(); return; }
        verify(step, index);
      });
    });
  }

  /* Standard WAV lease: subscribe to the channel → email. One step, because that
     is all the listing asks for. */
  function youtubeGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    return '<p class="gate-modal__copy">SUBSCRIBE, THEN YOUR EMAIL, TO UNLOCK THE ' + escapeHTML(pack.name) + '.</p>' +
      '<div class="gate-steps">' + youtubeSteps(channel, video, 1) + '</div>' +
      emailGateBody(pack, { hint: false }) +
      '<p class="gate-modal__hint" id="gate-hint">OPEN THE STEP, THEN THE EMAIL</p>';
  }

  /* Exclusive / Pro package: subscribe AND like this beat's video, then the
     email. There is no comment step. */
  function exclusiveGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    return '<p class="gate-modal__copy">SUBSCRIBE, LIKE THE BEAT, THEN YOUR EMAIL, TO UNLOCK THE ' + escapeHTML(pack.name) + '.</p>' +
      '<div class="gate-steps">' + youtubeSteps(channel, video, 2) + '</div>' +
      emailGateBody(pack, { hint: false, submit: "UNLOCK EXCLUSIVE" }) +
      '<p class="gate-modal__hint" id="gate-hint">OPEN BOTH STEPS, THEN THE EMAIL</p>';
  }

  function showSuccessModal() {
    const modal = document.createElement("div");
    modal.className = "gate-modal gate-modal--success";
    modal.innerHTML =
      '<div class="gate-modal__backdrop gate-modal__backdrop--static"></div>' +
      '<div class="gate-modal__card gate-modal__card--success" role="dialog" aria-modal="true" aria-live="polite">' +
        '<div class="checkmark" aria-hidden="true">' +
          '<svg class="checkmark__svg" viewBox="0 0 52 52"><circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/><path class="checkmark__path" fill="none" d="M14 27 21 34 38 17"/></svg>' +
        '</div>' +
        '<h3 class="gate-modal__title">ALL SET</h3>' +
        '<p class="gate-modal__copy">GATE PASSED. UNLOCKING YOUR DOWNLOAD PAGE…</p>' +
      '</div>';
    document.body.appendChild(modal);
    lockPage();
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    return modal;
  }

  /* ---------------------------------------------- REVIEW & SIGN (the last step)
     Every gate now ends here instead of jumping straight to the download page:
     the modal turns into the license itself — the terms to read, then a
     signature to capture (typed, or drawn on the pad with mouse or finger).
     Only when the terms have been read to the end and a signature exists does
     SIGN & UNLOCK come alive; it is that signature which is stamped into the
     LICENSEE block of the PDF. Nothing is stored — the signature is handed
     forward in the download URL, exactly like the address. */
  function termsHTML(beat, pack) {
    const includes = (pack.includes || []).map((line) =>
      '<li>' + escapeHTML(line) + '</li>').join("");
    return '<p class="sign-terms__lead">A FREE, NON-EXCLUSIVE, WORLDWIDE, PERPETUAL LICENSE TO ' +
        escapeHTML(beat.title) + ' — THE ' + escapeHTML(pack.name) + '.</p>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">1.0</span>100% FREE FOR NON-PROFIT AND ' +
        'COMMERCIAL / PROFIT USE. RELEASE IT ON SPOTIFY, APPLE MUSIC, YOUTUBE OR ANYWHERE. NO ROYALTIES, ' +
        'NO HIDDEN FEES, NO CATCH.</p>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">2.0</span>THE ONLY RULE — CREDIT ' +
        '(PROD. BY KYROIII) IN THE SONG TITLE OR DESCRIPTION.</p>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">3.0</span>WHAT THIS PACKAGE INCLUDES:</p>' +
      '<ul class="sign-terms__list">' + includes + '</ul>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">4.0</span>YOUR SIGNATURE IS STAMPED INTO ' +
        'THE LICENSEE BLOCK OF THE PDF CERTIFICATE, WHICH CARRIES ITS OWN UNIQUE SERIAL AND THIS BEAT\'S ' +
        'TEMPO AND KEY. NOTHING IS SAVED TO YOUR DEVICE.</p>' +
      '<p class="sign-terms__end">END OF TERMS</p>';
  }

  function showSignStage(beat, pack, email, onUnlocked) {
    const modal = gate;
    const card = modal && modal.querySelector(".gate-modal__card");
    if (!modal || !card) return;
    card.className = "gate-modal__card gate-modal__card--sign";
    card.innerHTML =
      '<span class="gate-modal__kicker">' + escapeHTML(pack.name) + '</span>' +
      '<h2 class="gate-modal__title" id="gate-title">LICENSE REVIEW &amp; SIGNATURE</h2>' +
      '<p class="gate-modal__copy">READ THE TERMS, SIGN YOUR FULL NAME, AND YOUR FILES UNLOCK.</p>' +
      '<div class="sign-terms" data-sign-terms role="region" tabindex="0" aria-label="License terms">' +
        termsHTML(beat, pack) +
      '</div>' +
      '<div class="sign-modes" role="group" aria-label="Signature style">' +
        '<button type="button" class="sign-mode is-active" data-sign-mode="type">TYPE</button>' +
        '<button type="button" class="sign-mode" data-sign-mode="draw">DRAW</button>' +
      '</div>' +
      /* The signature sheet: the flower watermark sits behind whatever is signed,
         so the mark that brands the store also closes the license. */
      '<div class="sign-sheet">' +
        '<span class="sign-watermark" aria-hidden="true">' +
          '<img src="assets/kyrolll-flower-rest.png?v=1" alt="" loading="lazy" decoding="async">' +
        '</span>' +
        '<label class="gate-field" data-sign-field for="sign-name">' +
          '<span class="gate-field__label">FULL NAME — FIRST AND LAST' +
            '<span class="gate-field__tick" aria-hidden="true">' + tickSVG() + '</span></span>' +
          '<input class="gate-input" id="sign-name" name="signature" type="text" autocomplete="off" ' +
            'autocapitalize="characters" enterkeyhint="done" spellcheck="false" maxlength="48" ' +
            'placeholder="TYPE YOUR FULL NAME">' +
        '</label>' +
        '<div class="sign-pad" data-sign-pad hidden>' +
          '<canvas class="sign-pad__canvas" data-sign-canvas width="' + SIGN_PAD.w + '" height="' + SIGN_PAD.h + '"></canvas>' +
          '<div class="sign-pad__row"><span class="sign-pad__hint">DRAG TO SIGN — MOUSE OR FINGER</span>' +
            '<button type="button" class="sign-pad__clear" data-sign-clear>CLEAR</button></div>' +
        '</div>' +
        '<span class="license-cert__stamp" data-sign-stamp data-stamped="false"></span>' +
      '</div>' +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-modal__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-sign-submit disabled>SIGN &amp; UNLOCK</button>' +
      '</div>' +
      /* The initial hint already states the required order, so the card reads
         correctly in the frame before the first `refresh()`. */
      '<p class="gate-modal__hint" id="gate-hint">SCROLL THROUGH THE TERMS TO THE END</p>';
    wireGateDismiss(modal);

    const terms = card.querySelector("[data-sign-terms]");
    const field = card.querySelector("[data-sign-field]");
    const nameInput = card.querySelector("#sign-name");
    const pad = card.querySelector("[data-sign-pad]");
    const canvas = card.querySelector("[data-sign-canvas]");
    const stamp = card.querySelector("[data-sign-stamp]");
    const errEl = card.querySelector("#gate-error");
    const hint = card.querySelector("#gate-hint");
    const submitBtn = card.querySelector("[data-sign-submit]");

    let mode = "type";
    let strokes = [];
    let current = null;
    const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;

    /* A crisp pen on a retina phone: the bitmap is scaled by the device pixel
       ratio (capped at 2×) while the strokes stay normalised 0..1, so the ink is
       sharp on any screen and the drawing — and the payload it travels in — is
       identical everywhere. */
    if (canvas && ctx) {
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      if (dpr > 1) {
        canvas.width = Math.round(SIGN_PAD.w * dpr);
        canvas.height = Math.round(SIGN_PAD.h * dpr);
      }
    }

    /* Terms read to the end (or short enough to fit without scrolling). */
    function termsRead() {
      if (!terms) return true;
      return terms.scrollHeight <= terms.clientHeight + 4 ||
        terms.scrollTop + terms.clientHeight >= terms.scrollHeight - 6;
    }
    function typedName() { return String(nameInput && nameInput.value || "").trim(); }
    function drawPoints() { return strokes.reduce((sum, stroke) => sum + stroke.length, 0); }
    /* How much of the pad the drawing actually covers: a tap, a dot or a two-point
       flick fails this, so the pad cannot be satisfied with a stray mark. */
    function strokeSpan() {
      if (!strokes.length) return 0;
      let minX = 1, maxX = 0, minY = 1, maxY = 0;
      strokes.forEach((stroke) => stroke.forEach((point) => {
        minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
      }));
      return (maxX - minX) + (maxY - minY);
    }
    function drawingValid() {
      return strokes.length > 0 && drawPoints() >= SIGN_INK_MIN && strokeSpan() >= SIGN_SPAN_MIN;
    }
    /* The one gate on the unlock button: a FULL name typed, or a real drawing.
       Nothing weaker can enable it. */
    function hasSignature() { return mode === "draw" ? drawingValid() : isFullName(typedName()); }
    function nameProblem() {
      const value = typedName();
      if (!value) return "ENTER YOUR FULL NAME — FIRST AND LAST";
      if (!isFullName(value)) return "FIRST AND LAST NAME REQUIRED — A SINGLE WORD CANNOT SIGN";
      return "";
    }
    function refresh() {
      const read = termsRead();
      const signed = hasSignature();
      const ready = read && signed;
      if (submitBtn) submitBtn.disabled = !ready;
      if (field) field.classList.toggle("is-valid", mode === "type" && isFullName(typedName()));
      if (stamp) {
        let label = "NOTHING SIGNED YET";
        if (mode === "draw") {
          if (drawingValid()) label = "SIGNATURE CAPTURED — " + strokes.length + " STROKE" + (strokes.length === 1 ? "" : "S");
          else if (strokes.length) label = "KEEP DRAWING — SIGN YOUR FULL NAME";
        } else if (typedName()) {
          label = typedName().toUpperCase();
        }
        stamp.textContent = label;
        stamp.dataset.stamped = hasSignature() ? "true" : "false";
      }
      if (hint) {
        hint.textContent = ready ? "ALL SET — SIGN & UNLOCK"
          : (!read ? "SCROLL THROUGH THE TERMS TO THE END"
            : (mode === "draw" ? "SIGN YOUR FULL NAME ON THE PAD" : nameProblem()));
      }
      if (errEl) hideGateError(errEl);
    }

    /* ----------------------------------------------------------- the pad */
    function paint() {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.6 * (canvas.width / SIGN_PAD.w);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      strokes.forEach((stroke) => {
        ctx.beginPath();
        stroke.forEach((point, i) => {
          const x = point[0] * canvas.width, y = point[1] * canvas.height;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke();
      });
    }
    function pointAt(event) {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / (rect.width || 1);
      const y = (event.clientY - rect.top) / (rect.height || 1);
      return [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
    }
    if (canvas) {
      canvas.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (canvas.setPointerCapture) { try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ } }
        current = [pointAt(event)];
        strokes.push(current);
        paint();
        refresh();
      });
      canvas.addEventListener("pointermove", (event) => {
        if (!current) return;
        event.preventDefault();
        const point = pointAt(event);
        const last = current[current.length - 1];
        /* Thin the trail: a point is only kept when the pen really moved, which
           keeps both the drawing and its URL payload small. */
        if (current.length >= SIGN_POINTS) return;
        if (Math.abs(point[0] - last[0]) + Math.abs(point[1] - last[1]) < 0.004) return;
        current.push(point);
        paint();
        refresh();
      });
      /* A stroke ends when the pen lifts. On touch it must NOT end because the
         finger slid past an edge (the pointer is captured, so the drawing keeps
         going) — a dropped stroke is exactly the "had to sign it twice" bug. */
      ["pointerup", "pointercancel"].forEach((type) =>
        canvas.addEventListener(type, () => { current = null; }));
      canvas.addEventListener("pointerleave", (event) => {
        if (event && event.pointerType !== "mouse") return;
        current = null;
      });
      /* No long-press menu / text selection while signing on a phone. */
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    }
    const clearBtn = card.querySelector("[data-sign-clear]");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      strokes = [];
      current = null;
      paint();
      refresh();
    });

    /* ------------------------------------------------------- the mode tabs */
    card.querySelectorAll("[data-sign-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("data-sign-mode") === "draw" ? "draw" : "type";
        if (next === mode) return;
        mode = next;
        card.querySelectorAll("[data-sign-mode]").forEach((other) =>
          other.classList.toggle("is-active", other === btn));
        if (field) field.hidden = mode !== "type";
        if (pad) pad.hidden = mode !== "draw";
        setDrawnSignature([]);
        setSignature("");
        if (mode === "draw" && canvas) { canvas.focus && canvas.focus(); }
        else if (nameInput) { try { nameInput.focus(); } catch (err) { /* ignore */ } }
        refresh();
      });
    });

    if (nameInput) {
      nameInput.addEventListener("input", refresh);
      nameInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        submitBtn && submitBtn.click();
      });
      setTimeout(() => { try { nameInput.focus(); } catch (err) { /* ignore */ } }, 60);
    }
    if (terms) terms.addEventListener("scroll", refresh, { passive: true });
    requestAnimationFrame(refresh);

    if (submitBtn) submitBtn.addEventListener("click", () => {
      if (!termsRead()) { showGateError(errEl, "READ THE TERMS TO THE END FIRST"); return; }
      if (!hasSignature()) {
        showGateError(errEl, mode === "draw"
          ? "DRAW YOUR FULL SIGNATURE ON THE PAD TO UNLOCK"
          : (nameProblem() || "TYPE YOUR FULL NAME TO UNLOCK"));
        return;
      }
      /* Capture the signature — typed or drawn — and hand it to the flow. */
      if (mode === "draw") setDrawnSignature(strokes);
      else { setDrawnSignature([]); setSignature(typedName()); }
      submitBtn.disabled = true;
      if (hint) hint.textContent = "SIGNED — UNLOCKING YOUR FILES…";
      closeGate();
      finalizeGate(beat, pack, onUnlocked, email);
    });
  }

  /* Common completion: show the success beat, remember the grant for this page
     view only, then proceed and hand the just-submitted address to the next
     step. Nothing is ever written down. */
  function finalizeGate(beat, pack, onUnlocked, email) {
    rememberGrant(beat.id, pack.id, email);
    const sm = showSuccessModal();
    setTimeout(() => {
      if (sm && sm.parentNode) sm.remove();
      unlockPage();
      if (onUnlocked) onUnlocked(beat, pack, email || "");
    }, 1400);
  }

  /* ------------------------------------------------------------ gate errors */
  function showGateError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }
  function hideGateError(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  /* ------------------------------------------------------- the one submission
     Every gate funnels through here: validate, POST the address, unlock. The
     button is only ever enabled once the whole form is valid, so this is also
     the Enter-key and defensive path. */
  function submitGate(beat, pack, modal, onUnlocked, read) {
    const errEl = modal.querySelector("#gate-error");
    const submit = modal.querySelector("[data-gate-submit]");
    const input = modal.querySelector("#gate-email");
    const state = (read && read()) || {};
    if (!EMAIL_RE.test(String(state.email || ""))) {
      showGateError(errEl, "ENTER A VALID EMAIL ADDRESS");
      try { if (input) input.focus(); } catch (err) { /* ignore */ }
      return;
    }
    if (!state.optin) {
      showGateError(errEl, "TICK THE BOX TO UNLOCK YOUR DOWNLOAD");
      return;
    }
    if (!state.stepsOk) {
      showGateError(errEl, "COMPLETE THE STEPS ABOVE TO UNLOCK");
      return;
    }
    hideGateError(errEl);
    if (submit) submit.disabled = true;
    const hint = modal.querySelector("#gate-hint");
    if (hint) hint.textContent = "RECORDING YOUR EMAIL...";
    postSubscribe(state.email).then((res) => {
      if (!res.ok && typeof console !== "undefined") console.warn("KYROIII newsletter post failed:", res.error);
      /* The address is recorded; the gate now hands over to the REVIEW & SIGN
         stage, which is what actually unlocks the files. */
      showSignStage(beat, pack, state.email, onUnlocked);
    });
  }

  /* ---------------------------------------------------------- openGate dispatcher */
  function openGate(beat, pack, onUnlocked) {
    closeGate();
    /* Session memory, consulted first: a package already unlocked during this
       view never asks again (and this page's memory is all it is — see
       `grants`). A reload or a new tab has no memory and asks from scratch. */
    const remembered = grantedEmail(beat.id, pack.id);
    if (remembered !== null) {
      showToast("ALREADY UNLOCKED THIS SESSION");
      if (onUnlocked) onUnlocked(beat, pack, remembered);
      return;
    }
    const modal = document.createElement("div");
    modal.className = "gate-modal";
    
    // Build gate body based on gate type
    let body;
    if (pack.gate === "youtube") {
      body = youtubeGateBody(pack, beat);
    } else if (pack.gate === "exclusive") {
      body = exclusiveGateBody(pack, beat);
    } else {
      // email gate — the first stop for the MP3 lease
      body = emailGateBody(pack, {});
    }
    modal.innerHTML = gateShell(pack, beat, null, body);
    document.body.appendChild(modal);
    gate = modal;
    lockPage();
    requestAnimationFrame(() => modal.classList.add("is-visible"));

    const submit = modal.querySelector("[data-gate-submit]");

    // --- EMAIL GATE (MP3) — email + mandatory opt-in, nothing remembered ---
    if (pack.gate === "email") {
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      const form = modal.querySelector("[data-gate-form]");
      const errEl = modal.querySelector("#gate-error");
      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());
      setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);

      // The email itself never prefills and the box never checks itself later
      // than this render: a fresh gate is always a fresh gate.
      const hint = modal.querySelector("#gate-hint");
      function refresh() {
        const email = String(input && input.value || "").trim();
        const emailOk = EMAIL_RE.test(email);
        const ready = emailOk && !!(optin && optin.checked);
        submit.disabled = !ready;
        setFieldValid(modal, emailOk);
        hideGateError(errEl);
        if (hint) hint.textContent = ready ? "ALL SET — UNLOCK YOUR DOWNLOAD" : "ENTER EMAIL, TICK THE BOX AND SUBMIT";
      }
      refresh();
      const readState = () => ({
        email: String(input && input.value || "").trim(),
        optin: !!(optin && optin.checked),
        stepsOk: true
      });
      input && input.addEventListener("input", refresh);
      optin && optin.addEventListener("change", refresh);
      input && input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        submitGate(beat, pack, modal, onUnlocked, readState);
      });
      submit.addEventListener("click", () => submitGate(beat, pack, modal, onUnlocked, readState));
    }

    // --- YOUTUBE GATE (WAV) --- one subscribe step (`done` has one slot), then
    // the email. The step must be genuinely opened and held before it counts —
    // see `wireYouTubeSteps`.
    if (pack.gate === "youtube") {
      const done = [false];
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const errEl = modal.querySelector("#gate-error");
      const optin = modal.querySelector("#gate-optin");
      const hint = modal.querySelector("#gate-hint");
      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());

      wireYouTubeSteps(modal, done, refreshSubmit);
      const stepsOk = () => done.every(Boolean);

      function refreshSubmit() {
        const emailOk = EMAIL_RE.test(String(input && input.value || "").trim());
        const checked = optin ? optin.checked : false;
        const all = stepsOk() && emailOk && checked;
        submit.disabled = !all;
        setFieldValid(modal, emailOk);
        hideGateError(errEl);
        if (hint) hint.textContent = all ? "ALL SET — REVIEW & SIGN" : "OPEN THE STEP, THEN THE EMAIL";
      }

      // Initialize submit disabled until all conditions met
      submit.disabled = true;
      input && input.addEventListener("input", refreshSubmit);
      optin && optin.addEventListener("change", refreshSubmit);

      const readState = () => ({
        email: String(input && input.value || "").trim(),
        optin: !!(optin && optin.checked),
        stepsOk: stepsOk()
      });
      submit.addEventListener("click", () => submitGate(beat, pack, modal, onUnlocked, readState));
      input && input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        submitGate(beat, pack, modal, onUnlocked, readState);
      });
    }

    // --- EXCLUSIVE GATE (Pro) --- subscribe + like this beat's video, then the
    // email form. There is no comment step.
    if (pack.gate === "exclusive") {
      const done = [false, false];
      const hint = modal.querySelector("#gate-hint");
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      const errEl = modal.querySelector("#gate-error");

      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());

      // Step click handlers for the two YouTube steps — genuinely opened and
      // held before they count (see `wireYouTubeSteps`).
      wireYouTubeSteps(modal, done, checkExclusive);

      if (optin) optin.addEventListener("change", () => { checkExclusive(); });
      if (input) input.addEventListener("input", () => { checkExclusive(); });

      // Unlocked once both steps are opened, the address is valid and the
      // mandatory opt-in is still ticked.
      function checkExclusive() {
        const emailOk = EMAIL_RE.test(String(input && input.value || "").trim());
        const optOk = optin ? optin.checked : false;
        const all = done.every(Boolean) && emailOk && optOk;
        submit.disabled = !all;
        setFieldValid(modal, emailOk);
        hideGateError(errEl);
        if (hint) hint.textContent = all ? "ALL SET — REVIEW & SIGN" : "OPEN BOTH STEPS, THEN THE EMAIL";
      }

      // Initial state
      checkExclusive();

      const readState = () => ({
        email: String(input && input.value || "").trim(),
        optin: !!(optin && optin.checked),
        stepsOk: done.every(Boolean)
      });
      submit.addEventListener("click", () => submitGate(beat, pack, modal, onUnlocked, readState));
      input && input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        submitGate(beat, pack, modal, onUnlocked, readState);
      });
    }

    // Cancel + Escape. The outside-click handler is installed once at module
    // load (`handleGateOutside`), so no gate can leave another one behind.
    wireGateDismiss(modal);
    gateKeyHandler = (ev) => { if (ev.key === "Escape") closeGate(); };
    document.addEventListener("keydown", gateKeyHandler);
  }

  /* --------------------------------------------------- newsletter submission
     A real AJAX POST to the configured provider (Formspree), with
     `Accept: application/json` so the provider answers JSON instead of a
     redirect and the address lands in the dashboard. The body is
     form-urlencoded — a CORS-safelisted content type, so no preflight — which
     is the same shape the provider's own form sends. The promise never
     rejects; a failure is reported to the caller and the free files still
     unlock. */
  function postSubscribe(email) {
    const endpoint = newsletterEndpoint();
    if (!endpoint) return Promise.resolve({ ok: false, error: "no newsletter endpoint configured" });
    const body = new URLSearchParams();
    body.set("email", String(email || "").trim());
    body.set("opt_in", "yes");
    body.set("embed", "1");
    body.set("tag", "beat-download");
    body.set("_subject", "KYROIII BEAT DOWNLOAD");
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: body.toString()
    }).then((res) => {
      if (!res || !res.ok) return { ok: false, error: "HTTP " + (res ? res.status : "0") };
      return { ok: true };
    }).catch((err) => ({ ok: false, error: (err && err.message) || "network error" }));
  }

  /* toast */
  let toastTimer = 0;
  function showToast(message) {
    let toast = document.querySelector(".kyrolll-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "kyrolll-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  // Foolproof global listener — handles any download trigger across the page.
  document.addEventListener("click", (event) => {
    try {
      const target = event.target;
      if (!target || !target.closest) return;
      /* A tap inside the open drawer belongs to the drawer, never to the button. */
      if (target.closest(".download-menu")) return;
      const btn = target.closest(".download-btn, .download-dropdown-toggle, .download-trigger, [data-download-trigger]");
      /* The button is the whole control: a tap that lands on the strip it lives in
         (a catalog tile's footer is padding around a slim button, and a finger is
         not a pixel) is the same intent, so the nearest trigger inside that
         container is opened. Without this a tap that missed the button by a couple
         of pixels did nothing but follow the tile's own link. */
      const host = btn ? null : target.closest(".download-actions, .catalog-tile__actions");
      const trigger = btn
        ? (btn.closest("[data-download-trigger]") || btn)
        : (host ? host.querySelector("[data-download-trigger]") : null);
      if (!trigger || !trigger.getAttribute) return;
      event.preventDefault();
      event.stopPropagation();
      const beatId = trigger.getAttribute("data-beat-id");
      if (beatId) {
        openMenu(trigger, beatId);
      }
    } catch (e) { /* ignore */ }
  }, true);

  /* The only memory in this module is the in-page `grants` Map: no storage
     write, no cookie, no unlock set that outlives the page and no remembered
     address. `isUnlocked` answers from that Map alone, so it is false on every
     fresh load, and the address a visitor typed only travels forward inside the
     current flow's URL. */
  window.KYROlll_DOWNLOADS = {
    PACKAGES: window.KYROlll_PACKAGES || [],
    isUnlocked: isUnlocked,
    setSignature: setSignature,
    getSignature: getSignature,
    setDrawnSignature: setDrawnSignature,
    signatureStrokes: signatureStrokes,
    signaturePayload: signaturePayload,
    adoptSignature: adoptSignature,
    encodeStrokes: encodeStrokes,
    licenseeName: licenseeName,
    downloadUrl, start, goToDownload, openMenu, closeMenu, openGate, closeGate,
    deliverablesFor: deliverablesFor,
    proFileName: proFileName,
    newsletterEndpoint, postSubscribe,
    downloadItem, showToast
  };
  } catch (e) { /* ignore top-level errors */ }
})();