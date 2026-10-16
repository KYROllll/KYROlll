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
 * The licensee signature is interactive: whatever the visitor types into
 * `#license-signature` is stamped straight into the LICENSEE block of the PDF
 * (live, as it is typed — the blob is rebuilt behind the scenes so the click
 * still saves instantly). Leaving it empty falls back to the address submitted
 * at the gate (`?email=…`), so the document can never end up unsigned.
 */
(function () {
  "use strict";

  const helpers = () => window.KYROlll_HELPERS || null;
  const downloads = () => window.KYROlll_DOWNLOADS || null;
  const escapeHTML = (value) => (helpers() ? helpers().escapeHTML(value) : String(value == null ? "" : value));

  const params = new URLSearchParams(location.search);
  const beat = helpers() && helpers().beatById(params.get("beat") || "");
  const pack = helpers() && helpers().packageById(params.get("package") || "");

  /* The one-shot grant token: proof that a gate was passed a moment ago, in
     this flow. It is never written down, so a cold link gets the gate. */
  const granted = !!params.get("t");

  /* The address submitted at that gate — the fallback LICENSEE signature. The
     typed signature itself lives in `downloads.js` (this page only feeds it),
     and `licenseeName()` is what both the stamp line and the PDF read. */
  let licensee = String(params.get("email") || "").trim();
  const licenseeName = () => {
    const d = downloads();
    return d ? d.licenseeName(licensee) : licensee;
  };

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

  /* The live signature stamp: the name shown under the serial is exactly what
     the PDF prints in its LICENSEE block — the typed signature when there is
     one, otherwise the address submitted at the gate. */
  function refreshStamp(animate) {
    if (!stampEl) return;
    const value = licenseeName();
    stampEl.textContent = value ? value.toUpperCase() : "SIGN ABOVE TO STAMP YOUR LICENSE";
    stampEl.dataset.stamped = value ? "true" : "false";
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
        d.setSignature(signatureEl.value);
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
      window.KYROlll_LICENSE_PDF.generateLicensePDF(beat, pack, d, serial, licenseeName());
    });
  }

  /* The license is assembled ahead of the click, then cached in `license-pdf.js`
     under this page's serial. The click itself then saves a ready blob
     synchronously, which is the only way Safari / iOS will download a generated
     file instead of opening it in its viewer. */
  function prebuildLicense() {
    if (!window.KYROlll_LICENSE_PDF || !window.KYROlll_LICENSE_PDF.primeLicensePDF) return;
    window.KYROlll_LICENSE_PDF.primeLicensePDF(beat, pack, serial, licenseeName()).catch((err) => {
      /* Non-fatal: the click falls back to building on demand. */
      if (typeof console !== "undefined") console.warn("KYROIII license prebuild failed:", err);
    });
  }

  function boot() {
    try {
      if (!beat || !pack) { showError(); return; }
      prebuildLicense();
      showLicensePanel();
      const d = downloads();
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
