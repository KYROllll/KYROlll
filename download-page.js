/* KYROlll — the clean download page.
 *
 * `download.html?beat=<id>&package=<id>` is where every package lands once it
 * is unlocked: the 3D flower, a glass hero, one download row per file and the
 * license panel. The license itself is never shown as raw text — it is issued
 * as a PDF from `license-pdf.js`, with a unique serial the page mints up front
 * so the id on screen is the id in the document. A direct link to a gated
 * package this browser has not unlocked re-opens that package's gate over the
 * page, so the flow is safe from any entry point. There is no backend — the
 * files are public, so the gate is a courtesy, and everything it remembers
 * stays in `localStorage`.
 *
 * The licensee name/email stamped in the PDF is pulled automatically from
 * localStorage (the address entered at the gate) — no interactive signature
 * modal is needed, so PDF generation can never break on a missing name. */
(function () {
  "use strict";

  const helpers = () => window.KYROlll_HELPERS || null;
  const downloads = () => window.KYROlll_DOWNLOADS || null;
  const escapeHTML = (value) => (helpers() ? helpers().escapeHTML(value) : String(value == null ? "" : value));

  const params = new URLSearchParams(location.search);
  const beat = helpers() && helpers().beatById(params.get("beat") || "");
  const pack = helpers() && helpers().packageById(params.get("package") || "");

  const kickerEl = document.getElementById("download-kicker");
  const titleEl = document.getElementById("download-title");
  const subEl = document.getElementById("download-sub");
  const metaEl = document.getElementById("download-meta");
  const filesPanel = document.getElementById("download-files");
  const listEl = document.getElementById("download-list");
  const licensePanel = document.getElementById("license-panel");
  const serialEl = document.getElementById("license-serial");

  /* One serial per page view, minted by the same generator the PDF uses, so the
     id shown here is exactly the id printed in the document — and the prebuilt
     blob is cached under that same serial. */
  const serial = (window.KYROlll_LICENSE_PDF && beat && window.KYROlll_LICENSE_PDF.makeLicenseId(beat)) || "";

  /* The licensee name stamped in the PDF: auto-pulled from the remembered
     email/address the visitor entered at the gate. No signature modal. */
  function licenseeName() {
    try {
      const stored = localStorage.getItem("kyrolll_licensee");
      if (stored) return stored;
    } catch (err) {}
    const email = (downloads() && downloads().readEmail ? downloads().readEmail() : "") || "";
    return email.split("@")[0] || "";
  }

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

  function showError() {
    kickerEl.textContent = "DOWNLOAD";
    titleEl.textContent = "NOTHING TO DOWNLOAD";
    subEl.textContent = "That link does not point at a beat or a package. Head back to the store and pick one.";
    metaEl.textContent = "";
    licensePanel.hidden = true;
    listEl.innerHTML =
      '<div class="download-list__empty"><a class="kyrolll-btn" href="index.html#catalog">BACK TO THE STORE</a></div>';
  }

  function render() {
    if (!beat || !pack) { showError(); return; }
    const d = downloads();
    const items = d ? d.deliverablesFor(beat.id, pack.id) : [];

    document.title = pack.name + " — " + beat.title + " — KYROlll";
    kickerEl.textContent = pack.name;
    titleEl.textContent = beat.title;
    subEl.textContent = "Every file below is yours, free. Credit (Prod. by KYROIII) and you are clear to release on Spotify, Apple Music and YouTube.";
    metaEl.textContent = beat.bpm + " BPM // " + beat.key;

    filesPanel.hidden = false;
    listEl.innerHTML = items.map(fileRowHTML).join("") ||
      '<div class="download-list__empty">NO FILES IN THIS PACKAGE YET.</div>';

    if (pack.id === "exclusive") {
      const note = document.createElement("div");
      note.className = "download-list__note";
      note.setAttribute("role", "region");
      note.setAttribute("aria-label", "Producer Note — Tracked Stems");
      note.innerHTML = '<span class="download-list__note-kicker">TRACKED STEMS — PRODUCER NOTE</span>' +
        '<p class="download-list__note-text">Tracked stems are part of our exclusive, limited drops — a way to keep the catalog fresh, curated and elite. These stems are supplied for your release use only, exactly as delivered. Each stem is fully tagged, separated by instrument group, and delivered in studio-quality WAV format for your commercial and non-commercial releases.</p>';
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

  /* The license panel is static markup and the serial is minted once at load,
     so everything is bound exactly once. `render()` can run again after a gate
     opens over the page; it must not re-bind or re-mint. */
  let licenseWired = false;
  function showLicensePanel() {
    if (!licensePanel) return;
    licensePanel.hidden = false;
    if (serialEl && serial) serialEl.textContent = serial;
    if (licenseWired) return;
    const d = downloads();
    const pdfBtn = licensePanel.querySelector("[data-license-pdf]");
    if (!d || !pdfBtn) return;
    licenseWired = true;
    pdfBtn.addEventListener("click", (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      // Stamp the licensee name/email automatically from localStorage —
      // no interactive signature modal is needed.
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
      if (typeof console !== "undefined") console.warn("KYROlll license prebuild failed:", err);
    });
  }

  function boot() {
    try {
      if (!beat || !pack) { showError(); return; }
      prebuildLicense();
      showLicensePanel();
      const d = downloads();
      // A gated package only renders its files once this browser has unlocked
      // it; otherwise the gate opens over the page and reveals them on success.
      if (d && pack.gate !== "instant" && !d.isUnlocked(beat.id, pack.id)) {
        kickerEl.textContent = pack.name;
        titleEl.textContent = beat.title;
        subEl.textContent = "One quick step and your files unlock.";
        metaEl.textContent = beat.bpm + " BPM // " + beat.key;
        listEl.innerHTML = '<div class="download-list__empty">UNLOCK THIS PACKAGE TO REVEAL YOUR FILES.</div>';
        d.openGate(beat, pack, render);
      } else {
        render();
      }
    } catch (err) {
      console.error("KYROlll download page error:", err);
      render();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
