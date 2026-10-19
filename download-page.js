/* KYROIII — the clean download page.
 * * `download.html?beat=<id>&package=<id>` is where every package lands once its
 * gate has been passed: the 3D flower, a glass hero, one download row per file
 * and the license panel. The license itself is never shown as raw text — it is
 * issued as a PDF from `license-pdf.js`, with a unique serial the page mints up
 * front so the id on screen is the id in the document. There is no backend —
 * the files are public, so the gate is a courtesy.
 *
 * NOTHING IS REMEMBERED HERE EITHER. There is no `localStorage`, no
 * `sessionStorage` and no unlock set: the page only trusts the one-shot grant
 * token (`?t=…`) that `downloads.js` mints when a gate is passed in this very
 * flow — plus the in-page grant that `downloads.js` keeps for this view. Arriving
 * without it — a bookmark, a shared link, a fresh browser — the package's gate
 * opens over the page and asks again, from scratch.
 *
 * The licensee signature is interactive: a FULL name typed into
 * `#license-signature` is stamped straight into the LICENSEE block of the PDF
 * (live, as it is typed — the blob is rebuilt behind the scenes so the click
 * still saves instantly). The same full-name rule the gate enforces applies
 * here: a single word is refused inline and never reaches the document. Leaving
 * it empty falls back to the signature captured at the gate, then to the address
 * submitted there (`?email=…`), so the document can never end up unsigned.
 */
(function () {
  "use strict";

  const helpers = () => window.KYROlll_HELPERS || null;
  const downloads = () => window.KYROlll_DOWNLOADS || null;
  const escapeHTML = (value) => (helpers() ? helpers().escapeHTML(value) : String(value == null ? "" : value));
  /* The same rule the gate's REVIEW & SIGN stage enforces: a license is signed
     by a FULL name — first AND last. A re-sign here that is a single word never
     reaches the document; the previous signature is kept instead. */
  const isFullName = (value) => {
    const d = downloads();
    return (d && d.isFullName) ? d.isFullName(value) : true;
  };

  const params = new URLSearchParams(location.search);
  const beat = helpers() && helpers().beatById(params.get("beat") || "");
  const pack = helpers() && helpers().packageById(params.get("package") || "");

  /* The one-shot grant token: proof that a gate was passed a moment ago, in
     this flow. It is never written down, so a cold link gets the gate. */
  const granted = !!params.get("t");

  /* A scheduled drop is closed until its clock lands (catalog.js owns the
     clock). A flow that just passed a gate holds a grant token, so it is already
     live; a cold link — a bookmark, a shared URL — waits on a countdown and
     unlocks itself the second the clock reaches zero. */
  const releasePending = () => {
    const h = helpers();
    return !!(h && h.isReleased && beat && !h.isReleased(beat));
  };

  /* The address submitted at that gate — the fallback LICENSEE signature. The
     signature itself lives in `downloads.js` (this page only feeds it), and
     `licenseeName()` is what both the stamp line and the PDF read. */
  let licensee = String(params.get("email") || "").trim();
  const licenseeName = () => {
    const d = downloads();
    return d ? d.licenseeName(licensee) : licensee;
  };
  /* What the PDF stamps into its LICENSEE block: the signature captured in the
     gate's REVIEW & SIGN stage — a typed name or a drawing — with the gate's
     address as the fallback name, so the block is never blank. */
  const signature = () => {
    const d = downloads();
    const payload = (d && d.signaturePayload) ? d.signaturePayload() : { name: "", strokes: null };
    return {
      name: payload.name || licensee || "",
      strokes: payload.strokes || null,
      pad: payload.pad || null,
      email: licensee || ""
    };
  };
  /* The drawing, replayed as vector strokes. SVG and the canvas share the same
     origin — top-left, y growing downwards — so a point is copied straight
     across: no `1 - y` flip here. (Flipping it was the bug that rendered every
     drawn signature upside down in the preview, while the PDF — whose origin is
     the bottom-left — flipped it correctly, so the page and the document
     disagreed.) The mark keeps the pad's aspect ratio and is centred in the box,
     so it lands exactly where `license-pdf.js` prints it. */
  function strokeSVG(strokes, pad) {
    const box = { w: 170, h: 46 };
    pad = (pad && pad.w && pad.h) ? pad : { w: 600, h: 220 };
    const aspect = pad.w / pad.h;
    const scale = Math.min(box.w / (aspect * 100), box.h / 100);
    const w = aspect * 100 * scale;
    const h = 100 * scale;
    const x0 = (box.w - w) / 2;
    const paths = strokes.map((stroke) => "<path d=\"M" + stroke.map((point) =>
      (x0 + point[0] * w).toFixed(2) + " " + (point[1] * h).toFixed(2)).join("L") + "\"/>").join("");
    return '<svg class="license-cert__mark" viewBox="0 0 ' + box.w + " " + box.h +
      '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Drawn signature">' + paths + "</svg>";
  }

  const kickerEl = document.getElementById("download-kicker");
  const titleEl = document.getElementById("download-title");
  const subEl = document.getElementById("download-sub");
  const metaEl = document.getElementById("download-meta");
  const countEl = document.getElementById("download-files-count");
  const filesPanel = document.getElementById("download-files");
  const listEl = document.getElementById("download-list");
  const licensePanel = document.getElementById("license-panel");
  const serialEl = document.getElementById("license-serial");
  const signatureEl = document.getElementById("license-signature");
  const signErrorEl = document.getElementById("license-sign-error");
  const stampEl = document.getElementById("license-stamp");

  /* One serial per page view, minted by the same generator the PDF uses, so the
     id shown here is exactly the id printed in the document — and the prebuilt
     blob is cached under that same serial. */
  const serial = (window.KYROlll_LICENSE_PDF && beat && window.KYROlll_LICENSE_PDF.makeLicenseId(beat)) || "";

  function fileRowHTML(item, index) {
    return (
      '<article class="download-item" style="--i:' + index + '">' +
        '<span class="download-item__index">' + String(index + 1).padStart(2, "0") + "</span>" +
        '<span class="download-item__body">' +
          '<span class="download-item__label">' + escapeHTML(item.label || "FILE") + "</span>" +
          '<span class="download-item__name">' + escapeHTML(item.name || item.file) + "</span>" +
        "</span>" +
        '<button type="button" class="kyrolll-btn download-item__btn" data-file-index="' + index + '">DOWNLOAD</button>' +
      "</article>"
    );
  }

  /* The beat's metadata, kept to a quiet row of chips: tempo, key and what the
     package hands over. Nothing else — the page itself says the rest. */
  function metaChips(items) {
    const hasStems = items.some((item) => /\.zip$/i.test((item && item.file) || ""));
    const tag = !items.length ? "" : (hasStems ? "STEMS + WAV + MP3" : (items.length > 1 ? "WAV + MP3" : "MP3"));
    return [beat.bpm + " BPM", String(beat.key).toUpperCase(), tag].filter(Boolean);
  }
  function renderMeta(items) {
    if (!metaEl) return;
    metaEl.innerHTML = metaChips(items).map((chip) =>
      '<span class="dl-meta__chip">' + escapeHTML(chip) + "</span>").join("");
  }

  function showError() {
    kickerEl.textContent = "DOWNLOAD";
    titleEl.textContent = "NOTHING TO DOWNLOAD";
    subEl.textContent = "THAT LINK DOES NOT POINT AT A BEAT OR A PACKAGE. HEAD BACK TO THE STORE AND PICK ONE.";
    if (metaEl) metaEl.innerHTML = "";
    licensePanel.hidden = true;
    listEl.innerHTML =
      '<div class="download-list__empty"><a class="kyrolll-btn" href="index.html#catalog">BACK TO THE STORE</a></div>';
  }

  function render() {
    if (!beat || !pack) { showError(); return; }
    const d = downloads();
    const items = d ? d.deliverablesFor(beat.id, pack.id) : [];

    document.title = pack.name + " — " + beat.title + " — KYROIII";
    kickerEl.textContent = pack.name;
    titleEl.textContent = beat.title;
    subEl.textContent = "EVERY FILE BELOW IS YOURS, FREE. CREDIT (PROD. BY KYROIII) AND YOU ARE CLEAR TO RELEASE ON SPOTIFY, APPLE MUSIC AND YOUTUBE.";
    renderMeta(items);

    filesPanel.hidden = false;
    listEl.innerHTML = items.map(fileRowHTML).join("") ||
      '<div class="download-list__empty">NO FILES IN THIS PACKAGE YET.</div>';
    if (countEl) countEl.textContent = items.length + (items.length === 1 ? " FILE" : " FILES");

    if (pack.id === "exclusive") {
      const note = document.createElement("div");
      note.className = "download-list__note";
      note.setAttribute("role", "region");
      note.setAttribute("aria-label", "Producer Note — Tracked Stems");
      note.innerHTML = '<span class="download-list__note-kicker">TRACKED STEMS — PRODUCER NOTE</span>' +
        '<p class="download-list__note-text">TRACKED STEMS ARE PART OF OUR EXCLUSIVE, LIMITED DROPS — A WAY TO KEEP THE CATALOG FRESH, CURATED AND ELITE. THE STEMS ARE SUPPLIED EXACTLY AS THEY LEFT THE STUDIO: SEVEN TRACKS, NO WRAPPERS, NO EXTRA FILES.</p>';
      listEl.appendChild(note);
    }

    listEl.querySelectorAll("[data-file-index]").forEach((button) => {
      button.addEventListener("click", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
        const index = Number(button.getAttribute("data-file-index"));
        if (d) d.downloadItem(items[index]);
      });
    });

    probeFiles(items);

    if (d) showLicensePanel();
  }

  /* A file that is not actually on the server must never be handed over — the
     catch-all would answer with the storefront's HTML, which is what makes a
     "download" open as a webpage. Check each one and dim the row if it is
     missing, instead of downloading something that is not the file. */
  function probeFiles(items) {
    items.forEach((item, index) => {
      if (!item || !item.file) return;
      fetch(item.file, { method: "HEAD" })
        .then((res) => {
          const type = res.headers.get("content-type") || "";
          if (!res.ok || type.indexOf("text/html") === 0) markMissing(index);
        })
        .catch(() => { /* offline or blocked: leave the row usable */ });
    });
  }
  function markMissing(index) {
    const btn = listEl.querySelector('[data-file-index="' + index + '"]');
    if (!btn) return;
    const row = btn.closest(".download-item");
    if (row) row.classList.add("is-missing");
    btn.disabled = true;
    btn.textContent = "UNAVAILABLE";
  }

  /* The live signature stamp: exactly what the PDF prints in its LICENSEE block
     — the name signed in the gate's sign step (or typed here afterwards), or
     the drawing itself, replayed as vector strokes, with the address submitted
     at the gate as the fallback. */
  function refreshStamp(animate) {
    if (!stampEl) return;
    const sig = signature();
    const value = sig.strokes ? "" : licenseeName();
    if (sig.strokes) {
      stampEl.innerHTML = strokeSVG(sig.strokes, sig.pad) +
        '<span class="license-cert__mark-note">DRAWN SIGNATURE STAMPED ON YOUR PDF</span>';
    } else {
      stampEl.textContent = value ? value.toUpperCase() : "SIGN ABOVE TO STAMP YOUR LICENSE";
    }
    stampEl.dataset.stamped = (sig.strokes || value) ? "true" : "false";
    if (animate && value) {
      stampEl.classList.remove("is-stamped");
      // Force the animation to restart on every stamp.
      void stampEl.offsetWidth;
      stampEl.classList.add("is-stamped");
    }
  }

  /* The license panel is static markup and the serial is minted once at load,
     so everything is bound exactly once. `render()` can run again after a gate
     opens over the page; it must not re-bind or re-mint. */
  let licenseWired = false;
  let stampTimer = 0;
  function showLicensePanel() {
    if (!licensePanel) return;
    licensePanel.hidden = false;
    if (serialEl && serial) serialEl.textContent = serial;
    refreshStamp(false);
    if (licenseWired) return;
    const d = downloads();
    const pdfBtn = licensePanel.querySelector("[data-license-pdf]");
    if (!d || !pdfBtn) return;
    licenseWired = true;
    if (signatureEl) {
      signatureEl.addEventListener("input", () => {
        const value = signatureEl.value.trim();
        // The full-name rule applies here too: a single word is refused (it never
        // reaches the document) and the refusal is stated inline, while an empty
        // field clears the typed name and falls back to the gate's signature.
        const invalid = value !== "" && !isFullName(value);
        if (signErrorEl) {
          signErrorEl.hidden = !invalid;
          signErrorEl.textContent = invalid ? "ENTER YOUR FULL NAME — FIRST AND LAST" : "";
        }
        if (!invalid) d.setSignature(value);
        refreshStamp(false);
        // Rebuild the ready-to-save blob shortly after the typing stops, so the
        // download click still saves synchronously — which is what Safari and
        // iOS require — no matter what name is on the document.
        clearTimeout(stampTimer);
        stampTimer = setTimeout(() => {
          refreshStamp(true);
          prebuildLicense();
        }, 220);
      });
    }
    pdfBtn.addEventListener("click", (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      // Stamp the LICENSEE block with the signature just typed, falling back to
      // the address submitted at the gate in this flow — both read live.
      // `generateLicensePDF` forces a real file download (an octet-stream blob on
      // iOS) through a `download` anchor, so the PDF never replaces this page.
      window.KYROlll_LICENSE_PDF.generateLicensePDF(beat, pack, d, serial, signature());
    });
  }

  /* The license is assembled ahead of the click, then cached in `license-pdf.js`
     under this page's serial. The click itself then saves a ready blob
     synchronously, which is the only way Safari / iOS will download a generated
     file instead of opening it in its viewer. */
  function prebuildLicense() {
    if (!window.KYROlll_LICENSE_PDF || !window.KYROlll_LICENSE_PDF.primeLicensePDF) return;
    window.KYROlll_LICENSE_PDF.primeLicensePDF(beat, pack, serial, signature()).catch((err) => {
      /* Non-fatal: the click falls back to building on demand. */
      if (typeof console !== "undefined") console.warn("KYROIII license prebuild failed:", err);
    });
  }

  /* A cold link to a scheduled drop: no player, no files and no license until
     the clock lands. The countdown ticks in place and `boot` is re-run the
     second the beat goes live, so the page unlocks itself. */
  let dropTimer = 0;
  function clearDropWatch() { clearInterval(dropTimer); dropTimer = 0; }
  function dropCountdownHTML() {
    const h = helpers();
    const label = (h && h.releaseLabel && h.releaseLabel(beat)) || "DROPPING TODAY AT 23:00";
    const time = (h && h.formatCountdown && h.msUntilRelease) ? h.formatCountdown(h.msUntilRelease(beat)) : "00:00:00";
    return '<span class="drop-countdown drop-countdown--lg" role="timer" aria-live="off">' +
      '<span class="drop-countdown__dot" aria-hidden="true"></span>' +
      '<span class="drop-countdown__label">' + escapeHTML(label) + "</span>" +
      '<span class="drop-countdown__time" data-countdown="' + escapeHTML(beat.id) + '">' + time + "</span></span>";
  }
  function tickDrop() {
    const h = helpers();
    if (!h || !h.isReleased || !dropTimer) return;
    if (h.isReleased(beat)) { clearDropWatch(); boot(); return; }
    const el = listEl.querySelector('[data-countdown="' + beat.id + '"]');
    if (el) el.textContent = h.formatCountdown(h.msUntilRelease(beat));
  }
  function showLocked() {
    clearDropWatch();
    document.title = "SCHEDULED DROP — " + beat.title + " — KYROIII";
    kickerEl.textContent = "SCHEDULED DROP";
    titleEl.textContent = beat.title;
    subEl.textContent = "THE PLAYER, EVERY FREE PACKAGE AND THE LICENSE UNLOCK AUTOMATICALLY AT DROP TIME.";
    if (metaEl) metaEl.innerHTML = [beat.bpm + " BPM", String(beat.key).toUpperCase(), "FREE DOWNLOAD"]
      .map((chip) => '<span class="dl-meta__chip">' + escapeHTML(chip) + "</span>").join("");
    filesPanel.hidden = true;
    licensePanel.hidden = true;
    listEl.innerHTML = '<div class="drop-locked drop-locked--page">' + dropCountdownHTML() +
      '<p class="drop-locked__note">THIS PAGE UNLOCKS ITSELF THE SECOND THE CLOCK HITS ZERO.</p></div>' +
      '<div class="download-list__empty"><a class="kyrolll-btn" href="index.html#catalog">BACK TO THE STORE</a></div>';
    tickDrop();
    dropTimer = setInterval(tickDrop, 1000);
  }

  function boot() {
    try {
      if (!beat || !pack) { showError(); return; }
      if (releasePending() && !granted) { showLocked(); return; }
      /* The signature captured in the gate's sign step arrives in this flow's
         URL (`?sign=` / `?sig=`) and is adopted before anything is rendered, so
         the stamp and the prebuilt PDF carry it too. Nothing is stored. */
      const d = downloads();
      if (d && d.adoptSignature && granted) d.adoptSignature(params.get("sign"), params.get("sig"));
      prebuildLicense();
      showLicensePanel();
      // Without the grant token from a just-passed gate this is a cold entry
      // point, so the package's gate opens over the page — nothing about this
      // browser is consulted, because nothing about it is remembered.
      if (d && pack.gate !== "instant" && !granted) {
        kickerEl.textContent = pack.name;
        titleEl.textContent = beat.title;
        subEl.textContent = "ONE QUICK STEP AND YOUR FILES UNLOCK.";
        renderMeta([]);
        listEl.innerHTML = '<div class="download-list__empty">UNLOCK THIS PACKAGE TO REVEAL YOUR FILES.</div>';
        d.openGate(beat, pack, (b, p, email) => {
          if (email) licensee = String(email).trim();
          prebuildLicense();
          render();
        });
      } else {
        render();
      }
    } catch (err) {
      console.error("KYROIII download page error:", err);
      render();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
