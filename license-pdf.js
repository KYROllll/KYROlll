/* KYROlll — the elite PDF license generator.
 *
 * A dependency-free PDF writer. Every issued license is a single dark branded
 * document — the 3D flower as the header mark, a unique serial number
 * (`KYRO-2026-<BEAT>-<DIGITS>`), a ruled metadata grid, numbered clauses, a
 * two-party signature block (the licensee's typed signature over the licensor's)
 * and a document-control footer — laid out against real font metrics so the grid
 * actually aligns. It is handed to the browser as a normal `download`-attribute
 * link, so it never opens a viewer.
 *
 * The palette is strictly neutral — deep black, crisp white and silver, no
 * colour cast of any kind. The page mints one serial per view and the signature
 * modal hands back the licensee's name, so the serial and the signature shown on
 * `download.html` are exactly the ones printed in the PDF.
 */
(function () {
  "use strict";

  const CREDIT = "(Prod. by KYROIII)";
  const FLOWER_SRC = "assets/kyrolll-flower-rest.png?v=1";
  const SERIAL_PREFIX = "KYRO";

  /* ------------------------------------------------------ font metrics */
  /* Adobe AFM advance widths for Helvetica / Helvetica-Bold, ASCII 32..126,
     per 1000 units. The base-14 fonts are guaranteed present, so measuring with
     their own metrics gives exact column alignment with nothing embedded. */
  const HELV = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
  ];
  const HELVB = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
  ];

  /* Helvetica is the base-14 font, so nothing is embedded; the only characters
     it cannot draw are the typographic ones, which fold to ASCII first. */
  function toAscii(value) {
    return String(value == null ? "" : value)
      .replace(/[\u2014\u2013]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u00ae\u00a9]/g, "(c)")
      .replace(/\u00b7/g, "-")
      .replace(/[\u2192\u2197]/g, ">")
      .replace(/[^\x20-\x7E]/g, "");
  }

  function escapePdfString(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function measure(str, font, size) {
    const table = font === "F2" ? HELVB : HELV;
    const text = String(str == null ? "" : str);
    let units = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      units += (code >= 32 && code <= 126) ? table[code - 32] : 556;
    }
    return units * size / 1000;
  }

  /* Width-driven wrap (not character-count), so columns never overflow. */
  function wrapToWidth(text, font, size, maxWidth) {
    const words = toAscii(text).split(/\s+/);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      if (!word) return;
      const next = line ? line + " " + word : word;
      if (measure(next, font, size) > maxWidth && line) { lines.push(line); line = word; }
      else { line = next; }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function toBytes(value) { return new TextEncoder().encode(value); }

  function concatBytes() {
    const parts = Array.prototype.slice.call(arguments);
    let length = 0;
    parts.forEach((part) => { length += part.length; });
    const out = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => { out.set(part, offset); offset += part.length; });
    return out;
  }

  /* ------------------------------------------------------------ serials */

  function randomDigits(count) {
    const values = new Uint32Array(count);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
    else for (let i = 0; i < count; i += 1) values[i] = Math.floor(Math.random() * 4294967296);
    let out = "";
    for (let i = 0; i < count; i += 1) out += String(values[i] % 10);
    return out;
  }

  /* `KYRO-2026-FLESH-482913` — one unique serial per issued license. */
  function makeLicenseId(beat) {
    const year = String(new Date().getFullYear());
    const raw = toAscii((beat && (beat.slug || beat.id)) || "BEAT").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const slug = (raw || "BEAT").slice(0, 12);
    return SERIAL_PREFIX + "-" + year + "-" + slug + "-" + randomDigits(6);
  }

  /* ---------------------------------------------------- the still flower */

  /* `undefined` = not attempted yet, `null` = attempted and unusable, object =
     ready. The distinction lets `generateLicensePDF` build synchronously on the
     very first click once the flower has been warmed, while still degrading to a
     text-only document when the image cannot be decoded. */
  let flowerCache;

  function flowerJpeg() {
    if (flowerCache !== undefined) return Promise.resolve(flowerCache);
    return new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#0b0b0b";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0);
          const base64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          flowerCache = { bytes: bytes, width: canvas.width, height: canvas.height };
          resolve(flowerCache);
        } catch (err) { flowerCache = null; resolve(null); }
      };
      image.onerror = () => { flowerCache = null; resolve(null); };
      image.src = FLOWER_SRC;
    });
  }

  /* ------------------------------------------------------------- palette */

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const M = 56;                    // outer margin
  const INNER = 7;                 // inner hairline inset inside the frame
  const COL_X = M + 18;            // content column, clear of the frame
  const COL_W = PAGE_W - M * 2 - 36;
  const FOOT_Y = M + 30;           // flow stops here; footer lives below
  /* Strictly neutral greys — every channel equal, so the document is deep black,
     crisp white and silver with no blue cast anywhere. */
  const BG = "0.031 0.031 0.031 rg";     // the deep black field
  const FRAME = "0.5 0.5 0.5";           // minimalist silver frame
  const HAIR = "0.19 0.19 0.19";         // inner hairline
  const TICK = "0.72 0.72 0.72";         // bright silver corner ticks
  const WHITE = "1 1 1 rg";
  const SILVER = "0.8 0.8 0.8 rg";       // signatures / soft silver text
  const BODY = "0.85 0.85 0.85 rg";
  const MUTED = "0.55 0.55 0.55 rg";

  /* ---------------------------------------------------------------- page */

  function buildPdf(data) {
    const flower = data.flower;
    const pages = [];
    let current = null;
    let y = 0;                     // current baseline

    function raw(line) { current += line + "\n"; }

    const stroke = (color, width) => raw(color + " " + width + " RG");
    const hline = (x1, x2, yLine, color, width) => {
      stroke(color, width || 0.6);
      raw(x1.toFixed(2) + " " + yLine.toFixed(2) + " m " + x2.toFixed(2) + " " + yLine.toFixed(2) + " l S");
    };
    const vline = (xLine, y1, y2, color, width) => {
      stroke(color, width || 0.6);
      raw(xLine.toFixed(2) + " " + y1.toFixed(2) + " m " + xLine.toFixed(2) + " " + y2.toFixed(2) + " l S");
    };
    const box = (x, boxY, w, h, color, width) => {
      stroke(color, width || 0.6);
      raw(x.toFixed(2) + " " + boxY.toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re S");
    };

    /* One run of text at a baseline. Letter-spacing uses the text-space `Tc`
       operator: the run stays a single string, so the PDF remains searchable
       and copyable — a legal document, not a stack of loose glyphs. (Verified:
       `Tc` adds its value in points per gap, unscaled by the font size.) */
    const put = (x, baseline, str, font, size, color, tracking) => {
      const text = toAscii(str);
      raw("BT /" + font + " " + size + " Tf " + (tracking || 0) + " Tc " + color + " " +
        x.toFixed(2) + " " + baseline.toFixed(2) + " Td (" + escapePdfString(text) + ") Tj ET");
      return tracking ? measure(text, font, size) + tracking * Math.max(0, text.length - 1) : measure(text, font, size);
    };
    const putTracked = put;
    const trackedWidth = (str, font, size, tracking) => {
      const text = toAscii(str);
      return measure(text, font, size) + tracking * Math.max(0, text.length - 1);
    };
    const putRight = (xRight, baseline, str, font, size, color, tracking) => {
      const w = tracking ? trackedWidth(str, font, size, tracking) : measure(str, font, size);
      return put(xRight - w, baseline, str, font, size, color, tracking);
    };
    const putCenter = (cx, baseline, str, font, size, color, tracking) => {
      const w = tracking ? trackedWidth(str, font, size, tracking) : measure(str, font, size);
      return put(cx - w / 2, baseline, str, font, size, color, tracking);
    };

    /* The dark field, the double frame and its corner ticks — the precision
       cut that reads as an official instrument rather than a poster. */
    const chrome = (withMark) => {
      raw(BG + " 0 0 " + PAGE_W + " " + PAGE_H + " re f");
      box(M, M, PAGE_W - M * 2, PAGE_H - M * 2, FRAME, 1);
      box(M + INNER, M + INNER, PAGE_W - (M + INNER) * 2, PAGE_H - (M + INNER) * 2, HAIR, 0.6);
      const t = 13;
      const corners = [
        [M + INNER, M + INNER, 1, 1],
        [PAGE_W - M - INNER, M + INNER, -1, 1],
        [M + INNER, PAGE_H - M - INNER, 1, -1],
        [PAGE_W - M - INNER, PAGE_H - M - INNER, -1, -1]
      ];
      corners.forEach((c) => {
        hline(c[0], c[0] + t * c[2], c[1], TICK, 1);
        vline(c[0], c[1], c[1] + t * c[3], TICK, 1);
      });
      if (withMark && flower) {
        const size = 104;
        const imgX = COL_X;
        const imgY = PAGE_H - M - 26 - size;
        raw("q " + size.toFixed(2) + " 0 0 " + size.toFixed(2) + " " + imgX.toFixed(2) + " " + imgY.toFixed(2) + " cm /Im1 Do Q");
        box(imgX, imgY, size, size, HAIR, 0.6);
      }
    };

    const ensure = (height) => {
      if (y - height < FOOT_Y) { startPage(false); return true; }
      return false;
    };

    /* Flow primitives, all expressed as a moving baseline. */
    const gap = (amount) => { y -= amount; };
    const heading = (label) => {
      ensure(24);
      gap(4);
      putTracked(COL_X, y, label, "F2", 9, WHITE, 0.4);
      gap(7);
      hline(COL_X, COL_X + COL_W, y + 3, HAIR, 0.6);
      gap(9);
    };
    const LEAD = 3.6;
    const paragraph = (text, size) => {
      const s = size || 9;
      wrapToWidth(text, "F1", s, COL_W).forEach((line) => {
        ensure(s + 4);
        put(COL_X, y, line, "F1", s, BODY, 0);
        gap(s + LEAD);
      });
    };
    const bullet = (text) => {
      const s = 9;
      const lines = wrapToWidth(text, "F1", s, COL_W - 14);
      ensure(lines.length * (s + LEAD));
      put(COL_X, y, "-", "F2", s, BODY, 0);
      lines.forEach((line, i) => {
        if (i) gap(s + LEAD);
        put(COL_X + 14, y, line, "F1", s, BODY, 0);
        gap(s + LEAD);
      });
    };

    /* A ruled metadata table: hairline row underneath, hairline columns between,
       micro-label over each value. This is the block that makes the page read as
       a contract sheet rather than a paragraph. */
    const gridRow = (pairs) => {
      const colW = COL_W / pairs.length;
      ensure(48);
      const rowTop = y + 8;
      const rowBottom = y - 2;
      pairs.forEach((pair, i) => {
        const x = COL_X + colW * i;
        const inner = colW - 14;
        putTracked(x, y, pair.label, "F1", 7, MUTED, 0.5);
        gap(10.5);
        wrapToWidth(pair.value, "F2", 9.5, inner).slice(0, 2).forEach((line) => {
          ensure(13);
          put(x, y, line, "F2", 9.5, WHITE, 0);
          gap(10);
        });
        if (i > 0) vline(x - 7, rowBottom, rowTop, HAIR, 0.6);
      });
      gap(2);
      hline(COL_X, COL_X + COL_W, y + 8, HAIR, 0.6);
      gap(12);
    };

    function startPage(withMark) {
      if (current !== null) pages.push(current);
      current = "";
      chrome(withMark);
      y = PAGE_H - M - 40;
    }

    /* ------------------------------------------------------- page one */

    startPage(true);

    const markX = COL_X + (flower ? 148 + 22 : 0);
    putTracked(markX, PAGE_H - M - 74, "KYROlll", "F2", 26, WHITE, 1.2);
    putTracked(markX, PAGE_H - M - 92, "FREE MUSIC LICENSE PROGRAM", "F1", 7.5, MUTED, 1.9);
    y = PAGE_H - M - 150;

    putTracked(COL_X, y, "CERTIFICATE OF FREE LICENSE", "F2", 17, WHITE, 0.9);
    gap(15);
    putTracked(COL_X, y, "NON-EXCLUSIVE  ·  WORLDWIDE  ·  PERPETUAL  ·  ROYALTY-FREE", "F1", 7.5, MUTED, 1.5);
    gap(22);

    /* Serial block — the hero of the document. */
    const serialTop = y + 9;
    box(COL_X, y - 34, COL_W, 48, FRAME, 1);
    putTracked(COL_X + 14, serialTop - 12, "LICENSE ID", "F1", 7, MUTED, 1.4);
    putTracked(COL_X + 14, serialTop - 33, data.serial, "F2", 15, WHITE, 0.9);
    putRight(COL_X + COL_W - 14, serialTop - 12, "ISSUED", "F1", 7, MUTED, 1.4);
    putRight(COL_X + COL_W - 14, serialTop - 33, data.issued, "F2", 11, WHITE, 0);
    gap(30);
    gridRow([
      { label: "BEAT", value: data.title },
      { label: "PACKAGE", value: data.packageName }
    ]);
    gridRow([
      { label: "BPM / KEY", value: data.bpm + " BPM  -  " + data.key },
      { label: "TERRITORY", value: "WORLDWIDE" },
      { label: "LICENSOR", value: "KYROlll" }
    ]);

    /* ------------------------------------------------------- clauses */

    heading("1.0    GRANT OF RIGHTS");
    paragraph("This beat is 100% free - for NON-PROFIT and COMMERCIAL / PROFIT use. Release it on Spotify, " +
      "Apple Music, YouTube, anywhere. Upload it, monetise it, keep what you make. No royalties, no hidden " +
      "fees, no catch. This license is non-exclusive, worldwide, perpetual and fully paid-up.");

    heading("2.0    THE ONLY RULE");
    paragraph("Give proper credit in the song title or description, exactly as:");
    ensure(18);
    putTracked(COL_X + 14, y, CREDIT, "F2", 11, WHITE, 0.6);
    gap(16);

    heading("3.0    WHAT THIS PACKAGE INCLUDES");
    (data.includes || []).forEach(bullet);

    heading("4.0    SUPPORT");
    ensure(30);
    putTracked(COL_X, y, "kyrolll00@gmail.com", "F1", 9, BODY, 0);
    gap(12);
    putTracked(COL_X, y, data.channel || "youtube.com/@KYROllllll", "F1", 9, BODY, 0);
    gap(26);

    /* --------------------------------------------------- signatures */
    /* The two marks that close a contract: the licensee's typed signature (the
       name entered in the signature modal) and the licensor's, each drawn in a
       formal italic above its own rule, under a micro-label. */
    ensure(104);
    const sigTop = y;
    const sigW = (COL_W - 40) / 2;
    const sigX2 = COL_X + sigW + 40;
    const signatureBlock = (x, name, label, micro) => {
      hline(x, x + sigW, sigTop - 40, FRAME, 0.8);
      put(x + 3, sigTop - 31, name, "F3", 17, SILVER, 0);
      putTracked(x, sigTop - 54, label, "F1", 7, MUTED, 1.2);
      putTracked(x, sigTop - 65, micro, "F1", 6.5, MUTED, 0.9);
    };
    signatureBlock(COL_X, data.licensee || "—", "LICENSEE — SIGNATURE", "SIGNED " + data.issued);
    signatureBlock(sigX2, "KYROIII", "KYROlll — LICENSOR", "AUTHORISED SIGNATORY");
    gap(84);

    /* ------------------------------------------------ document footer */
    /* Close the last page first: `startPage` only pushes when a new one begins,
       so the final page would otherwise never reach `pages` at all. */
    if (current !== null) { pages.push(current); current = null; }

    /* The control block names the program, repeats the serial and numbers the
       page — the marks that make a printed contract feel authoritative. It is
       appended now that every page is known, so "PAGE n OF m" is always right. */
    const pageCount = pages.length;
    const footRuleY = M + 22;
    const footTextY = M + 13;
    /* Vector barcode graphic + URL label in the footer — links to the store. */
    function barcodeBlock() {
      const barsX = PAGE_W - M - 110;
      const barsY = footRuleY - 18;
      let bc = "";
      const url = "https://kyroill.store";
      for (let b = 0; b < 12; b++) {
        const x = barsX + b * 7 + (b % 2 ? 0 : 2);
        const h = (b % 3 === 0) ? 14 : 8;
        bc += "0 0 0 RG\n" + x.toFixed(1) + " " + barsY.toFixed(1) + " m " + (x + 2.4).toFixed(1) + " " + barsY.toFixed(1) + " l " + (x + 2.4).toFixed(1) + " " + (barsY + h).toFixed(1) + " l " + x.toFixed(1) + " " + (barsY + h).toFixed(1) + " l f\n";
      }
      bc += "BT /F1 5.5 Tf 0 Tc 0.55 0.55 0.55 rg " + (barsX - 4).toFixed(2) + " " + (barsY - 10).toFixed(2) + " Td (" + escapePdfString(url) + ") Tj ET\n";
      return bc;
    }

    pages.forEach((content, i) => {
      const right = "PAGE " + (i + 1) + " OF " + pageCount;
      const center = data.serial;
      const footer =
        HAIR + " 0.6 RG\n" +
        COL_X.toFixed(2) + " " + footRuleY.toFixed(2) + " m " + (COL_X + COL_W).toFixed(2) + " " + footRuleY.toFixed(2) + " l S\n" +
        "BT /F1 7 Tf 0 Tc " + MUTED + " " + COL_X.toFixed(2) + " " + footTextY.toFixed(2) + " Td (" + escapePdfString("KYROlll OPEN RELEASE PROGRAM") + ") Tj ET\n" +
        "BT /F1 7 Tf 0 Tc " + MUTED + " " + (PAGE_W / 2 - measure(center, "F1", 7) / 2).toFixed(2) + " " + footTextY.toFixed(2) + " Td (" + escapePdfString(center) + ") Tj ET\n" +
        "BT /F1 7 Tf 0 Tc " + MUTED + " " + (PAGE_W - M - 18 - measure(right, "F1", 7)).toFixed(2) + " " + footTextY.toFixed(2) + " Td (" + escapePdfString(right) + ") Tj ET\n" +
        barcodeBlock();
      pages[i] = content + footer;
    });

    /* ---- assemble: objects are emitted in number order -------------------- */
    const kids = [];
    for (let i = 0; i < pageCount; i += 1) kids.push((6 + i * 2) + " 0 R");

    const chunks = [];
    let position = 0;
    const push = (bytes) => { chunks.push(bytes); position += bytes.length; };
    const putObject = (number, bytes) => { offsets[number] = position; push(bytes); };
    const offsets = [];

    /* "%PDF-1.4" plus the conventional binary marker line, so a reader can tell
       a PDF from plain text at a glance. */
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    putObject(1, toBytes("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"));
    putObject(2, toBytes("2 0 obj << /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pageCount + " >> endobj\n"));
    putObject(3, toBytes("3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n"));
    putObject(4, toBytes("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj\n"));
    if (flower) {
      putObject(5, toBytes("5 0 obj << /Type /XObject /Subtype /Image /Width " + flower.width + " /Height " + flower.height +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + flower.bytes.length + " >> stream\n"));
      push(flower.bytes);
      push(toBytes("\nendstream\nendobj\n"));
    } else {
      putObject(5, toBytes("5 0 obj << >> endobj\n"));
    }
    /* The signature font (Times-Italic — a formal, hand-written-looking base-14
       face) is the one object emitted after the pages; its number is known up
       front so every page can reference it. */
    const font3 = 6 + pageCount * 2;
    pages.forEach((content, i) => {
      const pageObj = 6 + i * 2;
      const contentObj = pageObj + 1;
      const stream = toBytes(content);
      putObject(pageObj, toBytes(pageObj + " 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "]" +
        " /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 " + font3 + " 0 R >> /XObject << /Im1 5 0 R >> >> /Contents " + contentObj + " 0 R >> endobj\n"));
      putObject(contentObj, toBytes(contentObj + " 0 obj << /Length " + stream.length + " >> stream\n"));
      push(stream);
      push(toBytes("\nendstream\nendobj\n"));
    });
    putObject(font3, toBytes(font3 + " 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >> endobj\n"));

    const xrefStart = position;
    const total = font3 + 1;
    let xref = "xref\n0 " + total + "\n0000000000 65535 f \n";
    for (let i = 1; i < total; i += 1) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    xref += "trailer << /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";
    push(toBytes(xref));

    return new Blob([concatBytes.apply(null, chunks)], { type: "application/pdf" });
  }

  /* ---------------------------------------------------------------- public */

  let cache = new Map(); // beatId::packageId::serial::licensee -> { blob, name }

  function cacheKey(beat, pack, serial, licensee) {
    if (!beat) return "";
    return (beat.id || beat.slug || "beat") + "::" + (pack && pack.id || "pack") + "::" +
      (serial || "") + "::" + (String(licensee || "").trim().toLowerCase());
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function safeFileName(beat) {
    const safe = toAscii(beat.title).replace(/[^A-Za-z0-9 .,-]/g, " ").trim().replace(/\s+/g, " ");
    return "KYROlll - " + (safe || "BEAT") + " LICENSE.pdf";
  }

  function buildDocument(beat, pack, serial, licensee, flower) {
    const channel = String(window.KYROlll_YOUTUBE_CHANNEL || "")
      .replace(/^https?:\/\/(www\.)?/, "")
      .split("?")[0];
    return buildPdf({
      title: beat.title,
      packageName: pack.name,
      bpm: String(beat.bpm),
      key: String(beat.key),
      issued: new Date().toISOString().slice(0, 10),
      includes: pack.includes || [],
      channel: channel,
      serial: serial,
      licensee: String(licensee == null ? "" : licensee).trim(),
      flower: flower
    });
  }

  /* Warm the flower ahead of the click. The signature modal collects the name
     first, so by the time the visitor signs, the only remaining work is the
     document itself — which then builds inside the click. */
  function primeLicenseFlower() {
    return flowerJpeg();
  }

  function saveBuilt(beat, pack, serial, licensee, flower, downloads) {
    const key = cacheKey(beat, pack, serial, licensee);
    let entry = cache.get(key);
    if (!entry) {
      entry = { blob: buildDocument(beat, pack, serial, licensee, flower), name: safeFileName(beat) };
      cache.set(key, entry);
    }
    try {
      saveBlob(entry.blob, entry.name);
      if (downloads && downloads.showToast) downloads.showToast("LICENSE PDF DOWNLOADED");
    } catch (err) {
      if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE - TRY AGAIN");
    }
  }

  /* Assemble the document and park it in the cache, so a later click can save it
     without awaiting anything first. */
  async function primeLicensePDF(beat, pack, serial, licensee) {
    if (!beat || !pack) return null;
    const sid = serial || makeLicenseId(beat);
    const key = cacheKey(beat, pack, sid, licensee);
    const cached = cache.get(key);
    if (cached) return cached.blob;
    const flower = await flowerJpeg();
    const blob = buildDocument(beat, pack, sid, licensee, flower);
    cache.set(key, { blob: blob, name: safeFileName(beat) });
    return blob;
  }

  /* `licensee` is the name the visitor typed into the signature modal; it is
     embedded as the LICENSEE signature. */
  async function generateLicensePDF(beat, pack, downloads, serial, licensee) {
    if (!beat || !pack) { if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE"); return; }
    const sid = serial || makeLicenseId(beat);
    const key = cacheKey(beat, pack, sid, licensee);
    const cached = cache.get(key);
    if (cached) {
      try { saveBlob(cached.blob, cached.name); if (downloads && downloads.showToast) downloads.showToast("LICENSE PDF DOWNLOADED"); }
      catch (err) { if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE - TRY AGAIN"); }
      return;
    }
    // Once the flower is warmed this whole branch runs synchronously before any
    // `await`, so the save still happens inside the click — which is what Safari
    // and iOS require to download a generated file instead of opening a viewer.
    if (flowerCache !== undefined) {
      try { saveBuilt(beat, pack, sid, licensee, flowerCache, downloads); }
      catch (err) {
        if (typeof console !== "undefined") console.error("KYROlll license PDF failed:", err);
        if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE - TRY AGAIN");
      }
      return;
    }
    try {
      const flower = await flowerJpeg();
      saveBuilt(beat, pack, sid, licensee, flower, downloads);
    } catch (err) {
      /* The still image is the only fragile part and it already degrades to a
         text-only document, so a throw here is a real bug — surface it rather
         than swallowing it. */
      if (typeof console !== "undefined") console.error("KYROlll license PDF failed:", err);
      if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE - TRY AGAIN");
    }
  }

  window.KYROlll_LICENSE_PDF = {
    makeLicenseId: makeLicenseId,
    primeLicenseFlower: primeLicenseFlower,
    primeLicensePDF: primeLicensePDF,
    generateLicensePDF: generateLicensePDF
  };
})();
