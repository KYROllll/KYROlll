/* KYROIII — the free-download layer.
 *
 * Unifies the "DOWNLOAD FREE" package menu, the two-step gate (email + license
 * agreement) and the actual browser downloads. No cart, no checkout, no backend.
 *
 * SESSION RECORD — nothing is ever written down:
 * - no `localStorage`, no `sessionStorage`, no cookie and no unlock set;
 * - a package passed in this view is recorded in one plain in-page Map
 *   (`grants`), purely so callers can ask `isUnlocked`; the record is NEVER
 *   consulted to skip a step, and it evaporates with the page.
 * Every selection — including one this view already passed — re-opens the full
 * gate and re-requires REVIEW & SIGN; a reload, a new tab, a bookmark or a shared
 * link asks from scratch, and the address is never prefilled.
 *
 * THE DIALOG HAS ONE EXIT — its CANCEL button. The backdrop is inert and Escape
 * does nothing, so a stray tap or key can never close a gate mid-step or wipe a
 * signature in progress.
 *
 * STRICT GATING — every package uses the same friction-free two-step gate, and
 * no package asks for a social like, follow or subscribe:
 *   step 1  EMAIL + MANDATORY OPT-IN → submit
 *   step 2  REVIEW & SIGN: read the license terms, type a full name and sign
 *           → SIGN & UNLOCK → FILES + PDF.
 *
 * The REVIEW & SIGN stage only unlocks once the terms have actually been read to
 * the end AND the visitor has both typed a FULL NAME (first and last) and drawn
 * a genuine signature on the pad. TYPE and DRAW are one shared readiness state —
 * the full name is never a substitute for the drawing and the drawing is never a
 * substitute for the name — so switching tabs can neither skip the name nor
 * bypass the pad. A single word, a blank line and a token dot are all refused
 * (`isFullName` / `drawingValid`), so there is no bypass to the files. The typed
 * full name always travels with the flow alongside the drawn strokes, and both
 * are what the PDF license stamps in its LICENSEE block (see `license-pdf.js`);
 * the customer signs on a clean field, never over the brand's flower.
 *
 * Files are handed over under their professional studio names —
 * `KYROIII - <BEAT> (<BPM> BPM - <KEY>).<ext>` — built from the beat's own
 * metadata, so an engineer can read the tempo and key off the filename.
 *
 * The only outbound request is the single analytics POST at SIGN & UNLOCK: a
 * real `fetch` POST to the configured provider (Formspree) with
 * `Accept: application/json` and a JSON body, so every complete download record
 * lands in the provider's dashboard. A failed post never blocks the files — they
 * are free — it is logged and the unlock continues.
 *
 * The address the visitor just typed, the signature and the exact license serial
 * minted at SIGN & UNLOCK are carried forward to `download.html` in that one
 * flow's query string (see `downloadUrl`), never stored.
 */
(function () {
  "use strict";

  try {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  // The authoritative free-download form. `catalog.js` exposes the same URL as
  // `KYROlll_SITE.formspreeEndpoint`; this hardcoded fallback keeps every free
  // download on the `KYROIII — FREE DOWNLOADS` form even if a page ships without
  // that config, and a future paid form can live beside it without ever catching
  // a free beat by accident.
  const FREE_FORMSPREE_ENDPOINT = "https://formspree.io/f/mvkkkoew";
  function helpers() { return window.KYROlll_HELPERS || null; }
  function newsletterEndpoint() {
    const h = helpers();
    const configured = h && h.newsletterEndpoint ? h.newsletterEndpoint() : "";
    const site = window.KYROlll_SITE || {};
    return String(configured || site.formspreeEndpoint || FREE_FORMSPREE_ENDPOINT);
  }

  /* The one human-readable record of what the gate asked for. Every package
     uses the same two steps, so every free-download record says the same thing. */
  const GATE_STEP_SUMMARY = "EMAIL + LICENSE AGREEMENT";

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
     exactly; a non-audio hand-over (the tracked-stems archive) uses the
     explicit studio name authored in `catalog.js`, so a zip is never mistaken
     for a take. Only the extension stays lowercase — everything else is in the
     store's ALL-CAPS voice. */
  const AUDIO_EXT = /^\.(mp3|wav|m4a|aac|aiff|aif|flac|ogg)$/i;
  function callName(beat) {
    const short = String((beat && beat.shortTitle) || "").trim();
    if (short) return short.toUpperCase();
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
    const explicit = String(item.name || "").trim();
    if (explicit) return explicit;
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

  /* A compact, human-readable summary of the files unlocked by a package — the
     same shape the license promises: "MP3 + WAV + TRACKED STEMS + PDF LICENSE". */
  function packageFileSummary(beat, pack) {
    const files = deliverablesFor(beat.id, pack.id);
    const labels = files.map((item) => {
      const file = String((item && item.file) || "");
      if (/\.mp3$/i.test(file)) return "MP3";
      if (/\.wav$/i.test(file)) return "WAV";
      if (/\.zip$/i.test(file)) return "TRACKED STEMS";
      return String((item && item.label) || "FILE").toUpperCase();
    });
    labels.push("PDF LICENSE");
    return labels.filter((label, index) => labels.indexOf(label) === index).join(" + ");
  }

  /* Analytics helpers deliberately read only what is on the page at the moment
     SIGN & UNLOCK is clicked. Nothing is stored, and the same payload shape is
     produced whether the sign stage runs on the store or over a cold download
     page. */
  function analyticsDeviceType() {
    const touch = ((navigator && navigator.maxTouchPoints) || 0) > 0 ||
      !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const width = Math.min(
      Number(window.innerWidth) || 0,
      Number(window.screen && window.screen.width) || Number(window.innerWidth) || 0
    );
    return (touch || (width > 0 && width <= 768)) ? "MOBILE" : "DESKTOP";
  }
  function analyticsSourcePage() {
    const path = String(window.location && window.location.pathname || "");
    const file = path.split("/").filter(Boolean).pop() || "";
    return file === "download.html" ? "download.html" : "index.html";
  }
  function localTimestamp(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const absolute = Math.abs(offset);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
      sign + pad(Math.floor(absolute / 60)) + ":" + pad(absolute % 60);
  }
  /* Mint the serial at SIGN & UNLOCK, before the download page exists. It travels
     in the flow URL and the page adopts it, so the Formspree record, the serial
     on screen and the serial printed in the PDF are the same string. On the
     store `license-pdf.js` is not loaded yet, so the fallback reproduces its
     exact `KYRO-<year>-<SLUG>-<6 digits>` contract locally. */
  function makeLicenseSerial(beat) {
    const pdf = window.KYROlll_LICENSE_PDF;
    if (pdf && pdf.makeLicenseId) return pdf.makeLicenseId(beat);
    const year = String(new Date().getFullYear());
    const raw = String((beat && (beat.slug || beat.id)) || "BEAT").toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slug = ((raw || "BEAT").slice(0, 12).replace(/-+$/g, "") || "BEAT");
    const values = new Uint32Array(6);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
    else for (let i = 0; i < values.length; i += 1) values[i] = Math.floor(Math.random() * 4294967296);
    return "KYRO-" + year + "-" + slug + "-" + Array.prototype.map.call(values, (value) => String(value % 10)).join("");
  }

  /* The complete record Formspree receives. This is the one and only POST in the
     whole flow: it carries the address from the email step, the verified full
     name and stroke count from the signature step, the exact serial the PDF will
     print, and the package/beat context the dashboard needs to read the row. */
  function analyticsPayload(beat, pack, email, fullName, serial, optin, strokeCount) {
    const shortTitle = callName(beat);
    const name = String(fullName == null ? "" : fullName).trim() || String(email || "").trim();
    return {
      _subject: "KYROIII STORE — [" + pack.name + "] " + shortTitle + " (" + name + ")",
      email: String(email == null ? "" : email).trim(),
      fullName: String(fullName == null ? "" : fullName).trim(),
      beatTitle: String(beat.title || ""),
      beatShortTitle: shortTitle,
      beatId: String(beat.slug || beat.id || ""),
      beatBpmAndKey: beat.bpm + " BPM // " + String(beat.key || "").toUpperCase(),
      packageTier: String(pack.id || ""),
      packageName: String(pack.name || ""),
      includedFiles: packageFileSummary(beat, pack),
      licenseSerial: String(serial || ""),
      gateStepsCompleted: GATE_STEP_SUMMARY,
      newsletterOptIn: optin ? "YES" : "NO",
      signatureMethod: "DRAW + TYPE SYNCHRONIZED",
      signatureStrokes: String(Math.max(0, Number(strokeCount) || 0)),
      deviceType: analyticsDeviceType(),
      sourcePage: analyticsSourcePage(),
      timestampLocal: localTimestamp()
    };
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
  function downloadUrl(beatId, packageId, email, serial) {
    let url = "download.html?beat=" + encodeURIComponent(beatId) +
      "&package=" + encodeURIComponent(packageId) + "&t=" + grantToken();
    const address = String(email == null ? "" : email).trim();
    if (address) url += "&email=" + encodeURIComponent(address);
    /* The signature captured in the REVIEW & SIGN stage rides along too: the
       typed name as `?sign=`, a drawing packed as `?sig=`. Like the address it
       is never stored — losing the URL loses the signature. The serial minted at
       SIGN & UNLOCK rides along as `?serial=`, so the download page and its PDF
       use exactly the serial already recorded in the Formspree payload. */
    const payload = signaturePayload();
    if (payload.name) url += "&sign=" + encodeURIComponent(payload.name);
    const packed = encodeStrokes(payload.strokes);
    if (packed) url += "&sig=" + encodeURIComponent(packed);
    const licenseSerial = String(serial == null ? "" : serial).trim();
    if (licenseSerial) url += "&serial=" + encodeURIComponent(licenseSerial);
    return url;
  }
  function goToDownload(beat, pack, email, serial) {
    window.location.assign(downloadUrl(beat.id, pack.id, email, serial));
  }
  /* ------------------------------------------------------ session memory
     One unlocked package per beat, remembered only for the life of this page.
     It is a plain Map — no `localStorage`, no `sessionStorage`, no cookie and
     no server — so the store keeps asking on the next visit and the browser
     keeps nothing. */
  const grants = new Map();
  function grantKey(beatId, packageId) { return String(beatId) + "::" + String(packageId); }
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
  /* Keep a drawn signature. An empty array clears it. A drawing does NOT clear
     the typed name: the sign stage requires a full name AND a drawing, so both
     have to travel to the PDF. A typed name still replaces a drawing (see
     `setSignature`), so re-signing on the download page behaves as before. */
  function setDrawnSignature(strokes) {
    drawnStrokes = Array.isArray(strokes) && strokes.length
      ? strokes
        .map((stroke) => (Array.isArray(stroke) ? stroke : [])
          .map((point) => [Number(point && point[0]) || 0, Number(point && point[1]) || 0])
          .slice(0, SIGN_POINTS))
        .filter((stroke) => stroke.length > 1)
        .slice(0, 12)
      : null;
    return drawnStrokes;
  }
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
  /* Take the signature the sign stage handed forward. The name is adopted
     first — `setSignature` clears any drawing — and the strokes are laid over
     it last, so a hand-signed license keeps BOTH its mark and the full name that
     signed it. */
  function adoptSignature(name, packedStrokes) {
    if (name) setSignature(name);
    if (packedStrokes) setDrawnSignature(decodeStrokes(packedStrokes));
    return signaturePayload();
  }

  /* A scheduled drop no longer renders a "DOWNLOAD FREE" trigger at all — its
     countdown pill stands in the same slot (see script.js) — so a tap can never
     reach the packages early. `openMenu`/`start` are still callable straight
     from the console or a stale link, so both refuse a beat that is not live yet
     and say why. */
  function beatIsLive(beat) {
    const h = helpers();
    return !(h && h.isReleased) || h.isReleased(beat);
  }
  function holdScheduledDrop(beat) {
    if (beatIsLive(beat)) return false;
    const h = helpers();
    const label = (h && h.releaseLabel && h.releaseLabel(beat)) || "DROPPING SOON";
    showToast(label + " — UNLOCKS AT DROP TIME");
    return true;
  }
  /* There is exactly one exclusive license per beat. Once it is signed for, the
     beat is claimed for good: every lease, the package drawer and a cold
     download link are closed, even if a caller invokes the API directly. The
     claim is persisted by catalog.js, so this refusal survives a reload. */
  function holdExclusiveClaim(beat) {
    const h = helpers();
    if (!(beat && h && h.isExclusiveLocked && h.isExclusiveLocked(beat.id))) return false;
    const owned = !!(h.isExclusiveOwned && h.isExclusiveOwned(beat.id));
    showToast(owned ? "OWNED / YOURS — EXCLUSIVE RIGHTS CLAIMED" : "CLAIMED / SOLD OUT — THIS BEAT IS SECURED");
    return true;
  }

  /* `start` opens the gate on every selection — there is no grant shortcut, so
     the mandatory REVIEW & SIGNATURE stage can never be skipped. */
  function start(beatId, packageId, opts) {
    const catalog = helpers();
    const beat = catalog && catalog.beatById(beatId);
    const pack = catalog && catalog.packageById(packageId);
    if (!beat || !pack) { showToast("BEAT OR PACKAGE NOT FOUND"); return; }
    if (holdExclusiveClaim(beat)) return;
    if (holdScheduledDrop(beat)) return;
    if (pack.gate === "instant") { goToDownload(beat, pack, "", ""); return; }
    openGate(beat, pack, (b, p, email, serial) => { goToDownload(b, p, email, serial); }, opts);
  }

  /* ------------------------------------------------------ menu */
  let activeMenu = null;
  /* The breathing room the drawer keeps from the visible edge of the viewport.
     Both the positioner and the scroll that makes room for the drawer measure
     with it, so the two can never disagree. */
  const MENU_EDGE = 12;
  /* The drawer's own safe margin above the footer's separator line. The footer
     border is a hard boundary — the package sheet must never spill over the
     social marks or the copyright band, however little room is left. */
  const MENU_FOOTER_GAP = 18;
  function footerTop() {
    const footer = document.querySelector(".footer, .site-footer");
    if (!footer) return Infinity;
    const box = footer.getBoundingClientRect();
    return box.height > 0 ? box.top : Infinity;
  }
  /* A drawer opened on a card in the last row has almost no document room
     between its button and the footer. The `.drawer-stage` band before the
     footer provides it: it rests at zero height and grows by exactly the missing
     room, eased by CSS, so the footer glides down as one block instead of a
     temporary band being inserted (and removed) in a single frame. The final
     footer position is computed before the growth starts, so the fixed drawer
     freezes its geometry against where the footer will settle. */
  function drawerStage() {
    return document.querySelector(".drawer-stage");
  }
  function reserveDrawerRoom(trigger, natural) {
    const stage = drawerStage();
    if (!stage) return null;
    const rect = trigger.getBoundingClientRect();
    const footer = document.querySelector(".footer, .site-footer");
    const stageNow = stage.getBoundingClientRect().height;
    const footerDocTop = footer
      ? window.scrollY + footer.getBoundingClientRect().top
      : (document.documentElement.scrollHeight || 0);
    const triggerDocBottom = window.scrollY + rect.bottom;
    const room = Math.max(0, footerDocTop - MENU_FOOTER_GAP - triggerDocBottom);
    const viewport = viewportBox();
    const cap = Math.max(0, viewport.height - 2 * MENU_EDGE);
    /* `room` already contains whatever the stage is currently contributing. A
       resize re-measures while the old band is still applied, so its height is
       added back before solving for the new one — otherwise the band would
       count itself as free room and collapse to zero. */
    const height = Math.min(Math.max(0, natural + 1 - room + stageNow), cap);
    stage.style.height = height + "px";
    return {
      height: height,
      /* Where the footer will sit once the stage has finished easing; the
         drawer's hard floor in document space. */
      footerDocTop: footerDocTop + height - stageNow,
      /* The document height the page is heading to, so a sheet clamped to the
         page can never read the mid-transition (shorter) scroll range. */
      scrollHeight: (document.documentElement.scrollHeight || 0) + height - stageNow,
    };
  }
  function clearDrawerRoom() {
    const stage = drawerStage();
    if (stage) stage.style.height = "0px";
  }
  /* The viewport the drawer must fit inside. On a phone the visual viewport is
     the honest measurement — it shrinks with the keyboard and moves with the
     pinch — so the drawer is only ever clamped to what the visitor can see. The
     horizontal edges are needed too, because the drawer is placed in viewport
     coordinates (see `positionMenu`). */
  function viewportBox() {
    const vv = window.visualViewport;
    const left = vv ? vv.offsetLeft : 0;
    const top = vv ? vv.offsetTop : 0;
    const width = (vv && vv.width) || window.innerWidth;
    const height = (vv && vv.height) || window.innerHeight;
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  }
  /* The drawer's home is the page root (`<body>`), never the button's card. A
     `position: fixed` element is only viewport-anchored while no ancestor is a
     containing block for it — and the glass detail card carries a
     `backdrop-filter` while a catalog tile carries a `transform`, either of which
     would make a fixed child position against the card instead of the viewport.
     Mounting on `<body>` is what puts the drawer in the root stacking context, at
     a `z-index` above every card, section and footer, and beyond the reach of any
     ancestor's `overflow` — so it can never be clipped, cut off or painted under
     anything. The `host` (the button's own container) is still tracked, but only
     to light the ambient bloom and the tile lift while the drawer is open. */
  function menuHost(trigger) {
    return (trigger && trigger.parentElement) || document.body;
  }
  function openMenu(trigger, beatId) {
    closeMenu();
    const catalog = helpers();
    const beat = catalog && catalog.beatById(beatId);
    if (!beat) { showToast("BEAT NOT FOUND"); return; }
    if (holdExclusiveClaim(beat)) return;
    if (holdScheduledDrop(beat)) return;
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
    /* The drawer lives on `<body>` (see `menuHost`), not inside this card: that is
       what makes its `position: fixed` viewport-anchored and unclippable. The
       `host` class still lights the ambient bloom around the button. */
    document.body.appendChild(menu);
    host.classList.add("is-menu-open");
    if (tile) tile.classList.add("is-menu-open");
    if (stage) stage.classList.add("is-menu-open");
    activeMenu = { el: menu, anchor: trigger, host: host, tile: tile, stage: stage, autoScrolled: false, autoScrolling: false };
    menu.querySelectorAll(".download-tier").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeMenu();
        start(beat.id, btn.getAttribute("data-package"));
      });
    });
    trigger.setAttribute("aria-expanded", "true");
    positionMenu();
    /* The drawer is viewport-anchored, so a scroll must move it with its button.
       Only a transform is written here (see `trackMenuScroll`): the geometry was
       frozen when the drawer opened, so a fast scroll can never re-measure,
       re-size or flip it — it just glides with the trigger on the compositor. */
    window.addEventListener("scroll", trackMenuScroll, { passive: true });
    window.addEventListener("resize", scheduleMenuRefresh, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", scheduleMenuRefresh);
      window.visualViewport.addEventListener("scroll", scheduleMenuRefresh);
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
  /* A scroll never touches the drawer's layout. Its width, height, unfold
     direction and base `top`/`left` are frozen when it opens (see
     `positionMenu`), so all the scroll does is write a compositor transform that
     cancels the button's viewport travel. That is what keeps the sheet dead-
     stable through a fast flick: no re-measuring, no forced reflow and no flip
     from above the button to below it halfway down the page. */
  function trackMenuScroll() {
    if (!activeMenu || !activeMenu.base) return;
    const { el, base } = activeMenu;
    const dx = base.x - window.scrollX;
    const dy = base.y - window.scrollY;
    el.style.transform = "translate3d(" + dx + "px, " + dy + "px, 0)";
  }
  /* A real resize (rotation, desktop resize, visual-viewport change) invalidates
     the frozen geometry, so it recomputes the box and re-anchors it. */
  function scheduleMenuRefresh() {
    if (menuFrame) return;
    menuFrame = requestAnimationFrame(() => {
      menuFrame = 0;
      /* A real resize invalidates the reserved band too: the viewport and the
         footer distance have both moved, so the room is measured again. */
      if (activeMenu) activeMenu.reserved = null;
      positionMenu();
    });
  }
  function handleMenuOutside(e) {
    if (activeMenu && !activeMenu.el.contains(e.target) && !activeMenu.anchor.contains(e.target)) closeMenu();
  }
  function handleMenuKey(e) { if (e.key === "Escape") closeMenu(); }
  function closeMenu() {
    clearDrawerRoom();
    if (!activeMenu) return;
    const { el, anchor, host, tile, stage } = activeMenu;
    if (anchor) anchor.setAttribute("aria-expanded", "false");
    if (el) { el.classList.remove("is-open"); el.remove(); }
    if (host) host.classList.remove("is-menu-open");
    if (tile) tile.classList.remove("is-menu-open");
    if (stage) stage.classList.remove("is-menu-open");
    activeMenu = null;
    if (menuFrame) { cancelAnimationFrame(menuFrame); menuFrame = 0; }
    window.removeEventListener("resize", scheduleMenuRefresh, true);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", scheduleMenuRefresh);
      window.visualViewport.removeEventListener("scroll", scheduleMenuRefresh);
    }
    window.removeEventListener("scroll", trackMenuScroll);
    document.removeEventListener("keydown", handleMenuKey);
    document.removeEventListener("click", handleMenuOutside, true);
  }
  /* Every drawer opens downwards, so when the button sits low the page itself
     gives it room: a short, eased scroll moves the trigger up just enough for
     the whole panel to sit below it. That is the same motion on a beat page and
     on a catalog tile — a card near the foot of the grid slides its own room in
     rather than flipping the panel over its artwork. The scroll is driven frame
     by frame (not native smooth) so it stays gentle, can be cancelled by
     closing the drawer, and is instant under reduced motion. `positionMenu` is
     re-run once on arrival — the single intentional re-measure on this path. */
  function autoScrollForMenu(delta) {
    if (!activeMenu) return;
    const menu = activeMenu.el;
    const startY = window.scrollY;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 0 : Math.min(480, 240 + Math.abs(delta) * .7);
    const started = performance.now();
    activeMenu.autoScrolling = true;
    const step = (now) => {
      if (!activeMenu || activeMenu.el !== menu) return;
      const t = duration ? Math.min(1, (now - started) / duration) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      window.scrollTo(0, Math.round(startY + delta * eased));
      if (t < 1) { requestAnimationFrame(step); return; }
      activeMenu.autoScrolling = false;
      activeMenu.autoScrolled = true;
      positionMenu();
    };
    requestAnimationFrame(step);
  }
  /* Place the drawer against the button's own box in *viewport* coordinates.
     Because the drawer is `position: fixed` and its containing block is the
     viewport, no ancestor can clip it: an `overflow` guard on a card, the grid or
     the page does not apply to a fixed box. It spans exactly the button's width
     (nudged back inside the viewport if the button hugs an edge) and unfolds
     downwards off the button's bottom edge — on every surface, a beat page and a
     catalog tile alike. It never turns over: when the room below is short it
     scrolls the page just enough instead (see `autoScrollForMenu`), so the
     control can never flip up over the artwork, the header or the player. Its
     height is capped to the space actually available and the panel scrolls
     internally, so it can never be taller than the screen and never cut off. */
  function positionMenu() {
    if (!activeMenu) return;
    const { el, anchor } = activeMenu;
    const box = viewportBox();
    const rect = anchor.getBoundingClientRect();
    const edge = MENU_EDGE;
    /* Width and horizontal placement: the button's own width, pulled back inside
       the visible viewport when the button itself sits near an edge. */
    const width = Math.min(rect.width, Math.max(0, box.width - 2 * edge));
    const left = Math.max(box.left + edge, Math.min(rect.left, box.right - edge - width));
    el.style.width = width + "px";
    el.style.left = left + "px";
    /* Measure the panel's own height before capping it. */
    el.style.maxHeight = "none";
    const natural = el.getBoundingClientRect().height;
    /* Grow the reserved stage once per open, never on the later passes: the
       measured target is what the footer is heading to, and re-measuring it on
       every scroll/resize pass would chase the easing band instead of holding
       the drawer still. */
    if (!activeMenu.reserved) activeMenu.reserved = reserveDrawerRoom(anchor, natural);
    const reserved = activeMenu.reserved;
    /* The drawer may never cross the footer's separator line. When the footer
       is already inside the visible viewport its settled top edge is the real
       floor; the gap keeps a clean band of black between the sheet and the social
       / copyright boundary. When the footer is still below the fold the viewport
       edge is the floor. The reserved stage is what guarantees the room. */
    const footerEdge = reserved
      ? reserved.footerDocTop - window.scrollY
      : footerTop();
    const visibleFloor = box.bottom - edge;
    const floor = Number.isFinite(footerEdge) && footerEdge > rect.bottom
      ? Math.min(visibleFloor, footerEdge - MENU_FOOTER_GAP)
      : visibleFloor;
    const below = Math.max(0, floor - rect.bottom);
    /* How far the page itself can still scroll, which is exactly the extra room
       a beat-page drawer may claim below the button. */
    const pageRoom = Math.max(0, (reserved ? reserved.scrollHeight : (document.documentElement.scrollHeight || 0)) - (window.scrollY + box.height));
    /* The footer is a hard ceiling in document space too: even when it is still
       below the fold, the drawer must stop short of it, so the auto-scroll can
       never pull the sheet over the separator line. */
    const footerRoom = Number.isFinite(footerEdge) && footerEdge > rect.bottom
      ? Math.max(0, footerEdge - MENU_FOOTER_GAP - rect.bottom)
      : Infinity;
    /* Downwards, always — the drawer hangs off the button's bottom edge on a
       catalog tile exactly as it does on a beat page. The panel is never turned
       over, because an upward drawer is what covered the artwork and the header
       on a card near the foot of the grid. */
    const maxHeight = Math.min(natural, below + pageRoom, footerRoom);
    el.style.maxHeight = maxHeight + "px";
    el.style.top = rect.bottom + "px";
    el.classList.remove("download-menu--up");
    /* Freeze the anchor right here. `trackMenuScroll` always measures from this
       base, and nothing on the scroll path recomputes the geometry above — so a
       flick can move the drawer but can never re-size it or flip it over. */
    el.style.transform = "";
    activeMenu.base = { x: window.scrollX, y: window.scrollY };
    /* The drawer takes its room by moving the page, once, before the visitor
       has to scroll at all — on a beat page and on a catalog tile alike. The
       travel is measured against the capped height, so a footer-clamped sheet
       never scrolls past its own floor. */
    const need = maxHeight - below;
    if (!activeMenu.autoScrolled && !activeMenu.autoScrolling && need > .5 && pageRoom > .5) {
      autoScrollForMenu(Math.min(need, pageRoom));
    }
  }

  /* escapeHTML for gate body rendering */
  function escapeHTML(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ 
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" 
    }[c]));
  }

  /* ------------------------------------------------------------------ gates
     A gate is NOT a dialog any more. Selecting a package expands a panel
     inside the surface that was clicked — the beat's focus sheet, the beat
     card, the download page — and the email form and the whole REVIEW & SIGN
     stage render in that panel, in the page's own flow. There is no overlay,
     no backdrop, no page lock and no focus trap; the page keeps scrolling
     around the form, which is what makes the flow feel like part of the record
     instead of a window over it.

     `gate` is the open panel: { el, host }. The host is the `[data-gate-host]`
     slot that owns the expansion (the focus sheet's, the beat card's, the
     download page's). */
  let gate = null;

  /* Pick the slot the panel expands into. Callers may name it explicitly; the
     rest of the time the first *visible* host wins, so a beat card's slot is
     never chosen while the focus sheet is the surface on screen. */
  function gateHosts() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-gate-host]"));
  }
  function hostIsVisible(el) {
    if (!el || el.hidden) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 || box.height > 0 || el.getClientRects().length > 0;
  }
  function resolveGateHost(explicit) {
    if (explicit) return explicit;
    const hosts = gateHosts();
    const visible = hosts.filter(hostIsVisible)[0];
    if (visible) return visible;
    /* Nothing is laid out yet (a slot still hidden with its container): pick by
       the surface the visitor is actually on — the open focus sheet first, then
       the beat card, then whatever slot the page declares. */
    const sheet = document.getElementById("yx-focus");
    const sheetHost = sheet && sheet.querySelector("[data-gate-host]");
    if (sheetHost && !sheet.hidden) return sheetHost;
    const beatHost = document.querySelector(".beat-detail [data-gate-host]");
    if (beatHost) return beatHost;
    return hosts[0] || null;
  }

  /* The expansion itself: the panel is measured, the slot is collapsed to zero
     and eased open to that height on the sheet's own curve, then the inline
     height is released so the slot simply follows its content (a stage switch,
     a refusal line or a rotated keyboard can never leave it clipped). */
  const ease = "cubic-bezier(.16, 1, .3, 1)";
  function expandHost(host, panel) {
    if (!host) return;
    host.hidden = false;
    host.classList.add("is-open");
    host.innerHTML = "";
    host.appendChild(panel);
    const target = Math.ceil(panel.getBoundingClientRect().height);
    host.style.transition = "none";
    host.style.height = "0px";
    host.style.overflow = "hidden";
    void host.offsetHeight;
    host.style.transition = "height .52s " + ease;
    host.style.height = target + "px";
    window.clearTimeout(host._gateSettle);
    host._gateSettle = window.setTimeout(() => {
      if (gate && gate.host === host) releaseHost(host);
    }, 560);
  }
  function releaseHost(host) {
    if (!host) return;
    window.clearTimeout(host._gateSettle);
    host.style.height = "";
    host.style.overflow = "";
    host.style.transition = "";
  }
  /* A new stage makes the card taller or shorter; the slot follows it at once
     once the opening expansion has settled. */
  function resizeHost() {
    if (gate && gate.host) releaseHost(gate.host);
  }

  /* The gate has exactly one exit: CANCEL. There is no outside field to tap and
     no Escape handler, so a stray tap or key cannot wipe a step in progress.
     Closing collapses the slot back to zero and leaves the surface it grew out
     of exactly as it was. */
  function closeGate() {
    if (!gate) return;
    const { el, host } = gate;
    gate = null;
    document.documentElement.classList.remove("gate-open");
    document.dispatchEvent(new CustomEvent("kyrolll:gate-closed", { detail: {} }));
    if (host) {
      const height = el.getBoundingClientRect().height;
      host.style.transition = "none";
      host.style.overflow = "hidden";
      host.style.height = height + "px";
      void host.offsetHeight;
      host.style.transition = "height .3s cubic-bezier(.4, 0, .2, 1)";
      host.style.height = "0px";
      window.clearTimeout(host._gateSettle);
      host._gateSettle = window.setTimeout(() => {
        el.remove();
        host.classList.remove("is-open");
        host.style.height = "";
        host.style.overflow = "";
        host.style.transition = "";
        host.hidden = true;
      }, 320);
      return;
    }
    el.remove();
  }

  /* Every stage of a gate is rendered into the same card, so the CANCEL control
     is (re)bound after each render. Only the explicit button closes a gate. */
  function wireGateDismiss(panel) {
    panel.querySelectorAll("[data-gate-cancel]").forEach((el) => {
      el.removeEventListener("click", closeGate);
      el.addEventListener("click", closeGate);
    });
  }

  function gateCard(pack, beat, stageTitle, body, cardClass) {
    const titleText = stageTitle ? (escapeHTML(stageTitle) + ' — ' + escapeHTML(beat.title)) : escapeHTML(beat.title);
    return '<div class="gate-panel__card' + (cardClass ? ' ' + cardClass : '') + '" role="region" aria-labelledby="gate-title">' +
        '<span class="gate-panel__kicker">' + escapeHTML(pack.name) + '</span>' +
        '<h2 class="gate-panel__title" id="gate-title">' + titleText + '</h2>' + body + '</div>';
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

  /* Email gate body — the first and only step of every package's gate. The
     address plus the mandatory opt-in are all it asks for; submitting hands
     the same card to the REVIEW & SIGN stage. */
  function emailGateBody(pack, opts) {
    const label = (opts && opts.submit) || "UNLOCK DOWNLOAD";
    const copy = (opts && opts.copy === false) ? "" :
      '<p class="gate-panel__copy">ENTER YOUR EMAIL TO UNLOCK THE ' + escapeHTML(pack.name) + '.</p>';
    return copy +
      emailFormHTML(opts && opts.optin) +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-panel__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-gate-submit disabled>' + escapeHTML(label) + '</button>' +
      '</div>' +
      ((opts && opts.hint === false) ? '' : '<p class="gate-panel__hint" id="gate-hint">ENTER EMAIL, TICK THE BOX AND SUBMIT</p>');
  }

  /* The completed gate is the same panel, wearing its ALL SET face: the form
     collapses into the confirmation in place, inside the surface that owns the
     slot, and the slot follows the (shorter) card. */
  function showSuccessPanel() {
    if (!gate) return null;
    const card = gate.el.querySelector(".gate-panel__card");
    if (!card) return null;
    card.className = "gate-panel__card gate-panel__card--success";
    card.setAttribute("aria-live", "polite");
    card.innerHTML =
      '<div class="checkmark" aria-hidden="true">' +
        '<svg class="checkmark__svg" viewBox="0 0 52 52"><circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/><path class="checkmark__path" fill="none" d="M14 27 21 34 38 17"/></svg>' +
      '</div>' +
      '<h3 class="gate-panel__title">ALL SET</h3>' +
      '<p class="gate-panel__copy">GATE PASSED. UNLOCKING YOUR DOWNLOAD PAGE…</p>';
    resizeHost();
    return gate.el;
  }

  /* ---------------------------------------------- REVIEW & SIGN (the last step)
     Every gate now ends here instead of jumping straight to the download page:
     the modal turns into the license itself — the terms to read, then a full
     name typed AND a genuine signature drawn on the pad with mouse or finger.
     TYPE and DRAW share one readiness state, so neither tab can skip the other
     half. Only when the terms have been read to the end AND both halves exist
     does SIGN & UNLOCK come alive; that name and that drawing are stamped into
     the LICENSEE block of the PDF. Nothing is stored — they are handed forward
     in the download URL, exactly like the address. */
  function termsHTML(beat, pack) {
    const includes = (pack.includes || []).map((line) =>
      '<li>' + escapeHTML(line) + '</li>').join("");
    const exclusive = pack.grant === "exclusive" || pack.id === "exclusive";
    return '<p class="sign-terms__lead">A FREE, ' + (exclusive ? 'EXCLUSIVE' : 'NON-EXCLUSIVE') +
        ', WORLDWIDE, PERPETUAL LICENSE TO ' +
        escapeHTML(beat.title) + ' — THE ' + escapeHTML(pack.name) + '.</p>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">1.0</span>100% FREE FOR NON-PROFIT AND ' +
        'COMMERCIAL / PROFIT USE. RELEASE IT ON SPOTIFY, APPLE MUSIC, YOUTUBE OR ANYWHERE. NO ROYALTIES, ' +
        'NO HIDDEN FEES, NO CATCH.' +
        (exclusive
          ? ' FULL COMMERCIAL FREEDOM: RESELL, RE-LICENSE, TRANSFER OR TRADE THIS EXCLUSIVE ASSET AND ' +
            'KEEP 100% OF THE PROCEEDS.'
          : '') + '</p>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">2.0</span>THE ONLY RULE — CREDIT ' +
        '(PROD. BY KYROIII) IN THE SONG TITLE OR DESCRIPTION.</p>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">3.0</span>WHAT THIS PACKAGE INCLUDES:</p>' +
      '<ul class="sign-terms__list">' + includes + '</ul>' +
      '<p class="sign-terms__item"><span class="sign-terms__no">4.0</span>YOUR SIGNATURE IS STAMPED INTO ' +
        'THE LICENSEE BLOCK OF THE PDF CERTIFICATE, WHICH CARRIES ITS OWN UNIQUE SERIAL AND THIS BEAT\'S ' +
        'TEMPO AND KEY. NOTHING IS SAVED TO YOUR DEVICE.</p>' +
      '<p class="sign-terms__end">END OF TERMS</p>';
  }

  function showSignStage(beat, pack, email, onUnlocked, optin) {
    const modal = gate && gate.el;
    const card = modal && modal.querySelector(".gate-panel__card");
    if (!modal || !card) return;
    resizeHost();
    card.className = "gate-panel__card gate-panel__card--sign";
    card.innerHTML =
      '<span class="gate-panel__kicker">' + escapeHTML(pack.name) + '</span>' +
      '<h2 class="gate-panel__title" id="gate-title">LICENSE REVIEW &amp; SIGNATURE</h2>' +
      '<p class="gate-panel__copy">READ THE TERMS, TYPE YOUR FULL NAME, DRAW YOUR SIGNATURE, AND YOUR FILES UNLOCK.</p>' +
      '<div class="sign-terms" data-sign-terms role="region" tabindex="0" aria-label="License terms">' +
        termsHTML(beat, pack) +
      '</div>' +
      /* The FULL NAME field sits ABOVE the TYPE / DRAW switch and never hides:
         it is required in both modes, so switching to DRAW cannot skip the name
         that attributes the license. */
      '<label class="gate-field" data-sign-field for="sign-name">' +
        '<span class="gate-field__label">FULL NAME — FIRST AND LAST' +
          '<span class="gate-field__tick" aria-hidden="true">' + tickSVG() + '</span></span>' +
        '<input class="gate-input" id="sign-name" name="signature" type="text" autocomplete="off" ' +
          'autocapitalize="characters" enterkeyhint="done" spellcheck="false" maxlength="48" ' +
          'placeholder="TYPE YOUR FULL NAME">' +
      '</label>' +
      '<div class="sign-modes" role="group" aria-label="Signature style">' +
        '<button type="button" class="sign-mode is-active" data-sign-mode="type">TYPE</button>' +
        '<button type="button" class="sign-mode" data-sign-mode="draw">DRAW</button>' +
      '</div>' +
      /* The signature sheet: a clean field, so the customer never signs over the
         brand's flower mark. */
      '<div class="sign-sheet">' +
        '<div class="sign-pad" data-sign-pad hidden>' +
          '<canvas class="sign-pad__canvas" data-sign-canvas width="' + SIGN_PAD.w + '" height="' + SIGN_PAD.h + '"></canvas>' +
          '<div class="sign-pad__row"><span class="sign-pad__hint">DRAG TO SIGN — MOUSE OR FINGER</span>' +
            '<button type="button" class="sign-pad__clear" data-sign-clear>CLEAR</button></div>' +
        '</div>' +
        '<span class="license-cert__stamp" data-sign-stamp data-stamped="false"></span>' +
      '</div>' +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-panel__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-sign-submit disabled>SIGN &amp; UNLOCK</button>' +
      '</div>' +
      /* The initial hint already states the required order, so the card reads
         correctly in the frame before the first `refresh()`. */
      '<p class="gate-panel__hint" id="gate-hint">SCROLL THROUGH THE TERMS TO THE END</p>';
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
    let submitted = false;
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
    /* The one readiness rule, shared by BOTH tabs:
         isFullName(name) && a genuine drawing on the pad
       TYPE is not a shortcut past the pad and DRAW is not a shortcut past the
       name. Switching tabs only shows or hides the pad; it never changes the
       name, the strokes or the button's state. */
    function hasDrawnSignature() {
      return drawingValid();
    }
    function isReady() {
      return isFullName(typedName()) && hasDrawnSignature();
    }
    function nameProblem() {
      const value = typedName();
      if (!value) return "ENTER YOUR FULL NAME — FIRST AND LAST";
      if (!isFullName(value)) return "FIRST AND LAST NAME REQUIRED — A SINGLE WORD CANNOT SIGN";
      return "";
    }
    /* The unlock button's whole state — and deliberately NOT the error line.
       Reporting a refusal makes the card grow, the terms pane takes a scroll
       from that reflow, and the pane's own scroll listener used to land here:
       the refusal hid itself in the very frame it was announced. Only a
       deliberate edit or a mode switch clears it (see `refresh`). */
    function applyState() {
      const read = termsRead();
      const named = isFullName(typedName());
      const drawn = hasDrawnSignature();
      /* The one shared readiness condition the user sees on both tabs. */
      const signed = isReady();
      const ready = read && signed;
      if (submitBtn) submitBtn.disabled = !ready;
      if (field) field.classList.toggle("is-valid", named);
      if (stamp) {
        let label = "NOTHING SIGNED YET";
        if (signed) label = "SIGNATURE CAPTURED — " + strokes.length + " STROKE" + (strokes.length === 1 ? "" : "S");
        else if (drawn) label = "FULL NAME REQUIRED — FIRST AND LAST";
        else if (typedName()) label = typedName().toUpperCase();
        stamp.textContent = label;
        stamp.dataset.stamped = signed ? "true" : "false";
      }
      if (hint) {
        /* The three synchronized states, in one place: the pad is the missing
           half when the name is set, the name is the missing half when the pad
           is signed, and only both together is "all set" (with the terms read).
           The button is shared, so these read identically on TYPE and DRAW. */
        if (signed) hint.textContent = read ? "ALL SET — SIGN & UNLOCK" : "SCROLL THROUGH THE TERMS TO THE END";
        else if (named) hint.textContent = "FULL NAME SET — SWITCH TO DRAW TAB & SIGN THE PAD TO UNLOCK";
        else if (drawn) hint.textContent = "SIGNATURE CAPTURED — ENTER YOUR FULL FIRST & LAST NAME TO UNLOCK";
        else if (typedName()) hint.textContent = nameProblem();
        else hint.textContent = read ? "ENTER YOUR FULL NAME — FIRST AND LAST" : "SCROLL THROUGH THE TERMS TO THE END";
      }
    }
    /* A visitor editing something also dismisses a refusal that no longer
       applies. */
    function refresh() {
      applyState();
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
        canvas.addEventListener(type, () => {
          current = null;
          /* A finished drawing that has no valid full name on file reports the
             one thing still missing, instead of letting a bare stroke read as a
             signature. */
          if (mode === "draw" && drawingValid() && !isFullName(typedName())) {
            showGateError(errEl, "ENTER YOUR FULL NAME — FIRST AND LAST TO UNLOCK");
          }
        }));
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
        /* The full-name field is required in BOTH modes, so it never hides and
           the typed name is never cleared by a switch — only the pad's visibility
           changes. */
        if (pad) pad.hidden = mode !== "draw";
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
    /* Reading the terms is not an edit: it moves the button's state and nothing
       else. `refresh` here is what made a scroll dismiss a refusal. */
    if (terms) terms.addEventListener("scroll", applyState, { passive: true });
    /* The first pass is deferred by one frame, because the sheet has to be laid
       out before its terms pane can report whether it scrolls. */
    requestAnimationFrame(applyState);

    if (submitBtn) submitBtn.addEventListener("click", () => {
      if (submitted) return;
      if (!termsRead()) { showGateError(errEl, "READ THE TERMS TO THE END FIRST"); return; }
      /* The full name is enforced again here — the one thing a script can do is
         strip the `disabled` attribute, so a single word is refused on submit
         whatever mode the pad is in. */
      if (!isFullName(typedName())) {
        showGateError(errEl, nameProblem() || "TYPE YOUR FULL NAME TO UNLOCK");
        return;
      }
      /* The drawing is enforced again here too, and for BOTH tabs: the readiness
         rule is one shared state, so a script that strips `disabled` from the
         TYPE tab still cannot turn a typed name into a license without the pad's
         ink. There is no mode-conditional shortcut. */
      if (!hasDrawnSignature()) {
        showGateError(errEl, "DRAW YOUR FULL SIGNATURE ON THE PAD TO UNLOCK");
        return;
      }
      /* Capture BOTH halves — the typed full name AND the drawn signature — and
         hand them to the flow together, whichever tab the click came from. The
         full name is what attributes the drawing in the PDF's LICENSEE metadata
         line; `setSignature` clears a drawing, so the strokes are laid back over
         the name last. */
      setSignature(typedName());
      setDrawnSignature(strokes);
      submitted = true;
      submitBtn.disabled = true;
      if (hint) hint.textContent = "SIGNED — UNLOCKING YOUR FILES…";
      /* This is the single authoritative Formspree POST. By now the email step
         has supplied the address and opt-in, and this stage supplies the
         verified name and drawing, so the record is complete. The serial is
         minted here and travels in the flow URL so the download page — and the
         PDF it issues — print exactly the serial already recorded. */
      const serial = makeLicenseSerial(beat);
      const payload = analyticsPayload(beat, pack, email, typedName(), serial, optin, strokes.length);
      postAnalytics(payload).then((res) => {
        if (!res.ok && typeof console !== "undefined") console.warn("KYROIII analytics post failed:", res.error);
      });
      /* The panel stays in place and turns into the ALL SET confirmation; the
         flow moves on from `finalizeGate`, which collapses it on the way out. */
      finalizeGate(beat, pack, onUnlocked, email, serial);
    });
  }

  /* Common completion: record the grant for this page view (a record only — it
     never skips a later gate), then proceed and hand the just-submitted address
     and the serial minted at SIGN & UNLOCK to the next step. Nothing about the
     gate input is ever written down. The exclusive claim is the one durable
     record, and it is issued exactly once: if another tab claimed the beat while
     this gate was open, the flow is refused instead of handing over a second
     exclusive license. */
  function finalizeGate(beat, pack, onUnlocked, email, serial) {
    const finish = () => {
      if (pack.id === "exclusive") {
        const h = helpers();
        if (h && h.isExclusiveLocked && h.isExclusiveLocked(beat.id)) {
          showToast("CLAIMED / SOLD OUT — THIS BEAT IS SECURED");
          closeGate();
          return;
        }
      }
      rememberGrant(beat.id, pack.id, email);
      showSuccessPanel();
      /* The exclusive license is the one that takes the beat off the market.
         The claim is recorded only after the success surface is up, so the
         grid's in-place repaint cannot tear that hand-off out from under the
         visitor; the storefront reads the claimed entry on its next render. */
      if (pack.id === "exclusive") {
        const h = helpers();
        const claimed = h && h.lockExclusive ? h.lockExclusive(beat.id) : true;
        if (!claimed) {
          closeGate();
          showToast("CLAIMED / SOLD OUT — THIS BEAT IS SECURED");
          return;
        }
      }
      setTimeout(() => {
        closeGate();
        if (onUnlocked) onUnlocked(beat, pack, email || "", serial || "");
      }, 1400);
    };
    /* An exclusive claim is a global, first-writer-wins decision now, so the
       local register is refreshed from the shared seed and the live bus before
       the license is issued. If that check fails to reach the network, `finish`
       still runs against the last known state — the storefront never blocks a
       visitor because a bus is offline. */
    if (pack.id === "exclusive") {
      const h = helpers();
      if (h && h.syncExclusiveClaims) {
        h.syncExclusiveClaims({ force: true }).then(finish, finish);
        return;
      }
    }
    finish();
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

  /* ------------------------------------------------------- the gate hand-off
     Validate the email step and hand the card to REVIEW & SIGN. The one
     Formspree POST deliberately does not happen here: it belongs at SIGN &
     UNLOCK, where the full name, the drawing and the license serial also exist,
     so a record can never arrive half-empty. The button is only ever enabled
     once the whole form is valid, so this is also the Enter-key and defensive
     path. */
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
    hideGateError(errEl);
    if (submit) submit.disabled = true;
    const hint = modal.querySelector("#gate-hint");
    if (hint) hint.textContent = "EMAIL CONFIRMED — REVIEW & SIGN TO UNLOCK";
    showSignStage(beat, pack, state.email, onUnlocked, state.optin);
  }

  /* ---------------------------------------------------------- openGate dispatcher
     `opts.host` names the slot the panel expands into (the focus sheet passes
     its own). Without one, the first visible `[data-gate-host]` on the page is
     used, so the beat card and the download page open the same panel in their
     own column. There is no overlay fallback: the last resort is the page's
     own <main>. */
  function openGate(beat, pack, onUnlocked, opts) {
    closeGate();
    /* No session shortcut: selecting a package always renders the gate from
       scratch and always requires the REVIEW & SIGNATURE stage, even if this
       view already passed it. The in-page `grants` Map is only a record for the
       API — it is never consulted to skip a step. */
    const host = resolveGateHost(opts && opts.host);
    const panel = document.createElement("div");
    panel.className = "gate-panel";
    panel.setAttribute("data-gate-panel", "");

    /* Every package opens the same two-step gate: the email form now, then the
       REVIEW & SIGN stage. There is no social step, no like and no follow to
       verify, so the panel is one clean sheet. */
    const body = emailGateBody(pack, {});
    panel.innerHTML = gateCard(pack, beat, null, body, "");
    gate = { el: panel, host: host };
    document.documentElement.classList.add("gate-open");
    document.dispatchEvent(new CustomEvent("kyrolll:gate-open", {
      detail: { beatId: beat.id, packageId: pack.id }
    }));

    if (host) {
      expandHost(host, panel);
    } else {
      /* Defensive: a page with no declared slot still gets the panel inline,
         inside its own content column — never a floating window over it. */
      (document.querySelector("main") || document.body).appendChild(panel);
    }

    const modal = panel;
    const submit = modal.querySelector("[data-gate-submit]");
    const input = modal.querySelector("#gate-email");
    const optin = modal.querySelector("#gate-optin");
    const errEl = modal.querySelector("#gate-error");
    const hint = modal.querySelector("#gate-hint");
    const form = modal.querySelector("[data-gate-form]");
    if (form) form.addEventListener("submit", (ev) => ev.preventDefault());

    /* The whole gate, for every package: the address AND the mandatory opt-in,
       then the license. Nothing else stands in front of the files — no social
       step, no like, no follow, no subscribe. */
    const STEP_COPY = {
      idle: "ENTER EMAIL, TICK THE BOX AND SUBMIT",
      ready: "ALL SET — REVIEW & SIGN"
    };
    const readState = () => ({
      email: String(input && input.value || "").trim(),
      optin: !!(optin && optin.checked)
    });
    function refresh() {
      const emailOk = EMAIL_RE.test(String(input && input.value || "").trim());
      const ready = emailOk && !!(optin && optin.checked);
      submit.disabled = !ready;
      setFieldValid(modal, emailOk);
      hideGateError(errEl);
      if (hint) hint.textContent = ready ? STEP_COPY.ready : STEP_COPY.idle;
    }
    input && input.addEventListener("input", refresh);
    optin && optin.addEventListener("change", refresh);
    input && input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      submitGate(beat, pack, modal, onUnlocked, readState);
    });
    submit.addEventListener("click", () => submitGate(beat, pack, modal, onUnlocked, readState));
    refresh();

    /* Every gate opens straight on the field, so the caret goes into it — but
       the page is never wrenched to the top doing it: the field is focused
       without scrolling and the panel itself is eased into view inside its own
       scroll container. The address is never prefilled: a fresh gate is always
       a fresh gate. */
    if (input) setTimeout(() => { try { input.focus({ preventScroll: true }); input.select(); } catch (err) { /* ignore */ } }, 90);
    /* Once the expansion has settled the panel is brought fully into its own
       scroll container — measured after the growth, so the buttons at the foot
       of the form are on screen and not just the first field. */
    setTimeout(() => {
      const reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      try { panel.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }); } catch (err) { /* ignore */ }
    }, 600);

    // The only dismissal is CANCEL (bound by `wireGateDismiss` below). There is
    // deliberately no Escape or outside-click close, so a stray tap or key can
    // never wipe the gate or the signature in progress.
    wireGateDismiss(modal);
  }

  /* ------------------------------------------------------- analytics submission
     The one and only POST in the flow: a JSON record to the configured provider
     (Formspree) at SIGN & UNLOCK, once every field exists. `keepalive` lets the
     request finish while the flow moves on to the download page, so the record
     is not lost to the navigation. The promise never rejects — a failed post
     never blocks the free files, it is logged and the unlock continues. */
  function postAnalytics(payload) {
    const endpoint = newsletterEndpoint();
    if (!endpoint) return Promise.resolve({ ok: false, error: "no newsletter endpoint configured" });
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {}),
      keepalive: true
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

  /* One delegated listener for every "DOWNLOAD FREE" trigger on the page —
     installed once, at module load, in the capture phase, so a re-rendered grid
     keeps working and no per-button listener is ever left behind. */
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    /* A tap inside the open drawer belongs to the drawer, never to the button. */
    if (target.closest(".download-menu")) return;
    const btn = target.closest(".download-trigger, [data-download-trigger]");
    /* The button is the whole control: a tap that lands on the strip it lives in
       (a catalog tile's footer is padding around a slim button, and a finger is
       not a pixel) is the same intent, so the nearest trigger inside that
       container is opened. Without this a tap that missed the button by a couple
       of pixels did nothing but follow the tile's own link. */
    const host = btn ? null : target.closest(".download-actions, .catalog-tile__actions");
    const trigger = btn || (host ? host.querySelector("[data-download-trigger]") : null);
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    /* The trigger is a switch, not a one-way opener: a second tap closes the
       drawer it opened. Re-rendering it instead (the old behaviour) restarted its
       reveal animation under the finger and read as a second, stray panel. */
    if (activeMenu && activeMenu.anchor === trigger) { closeMenu(); return; }
    const beatId = trigger.getAttribute("data-beat-id");
    if (beatId) openMenu(trigger, beatId);
  }, true);

  /* The only memory in this module is the in-page `grants` Map: no storage
     write, no cookie, no unlock set that outlives the page and no remembered
     address. `isUnlocked` answers from that Map alone, so it is false on every
     fresh load, and the address a visitor typed only travels forward inside the
     current flow's URL. */
  window.KYROlll_DOWNLOADS = {
    isUnlocked: isUnlocked,
    isFullName: isFullName,
    setSignature: setSignature,
    setDrawnSignature: setDrawnSignature,
    signaturePayload: signaturePayload,
    adoptSignature: adoptSignature,
    licenseeName: licenseeName,
    downloadUrl, start, goToDownload, openMenu, closeMenu, openGate, closeGate,
    deliverablesFor: deliverablesFor,
    proFileName: proFileName,
    newsletterEndpoint, postAnalytics,
    downloadItem, showToast
  };
  } catch (e) { /* ignore top-level errors */ }
})();