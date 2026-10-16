/* KYROIII — the elite PDF license generator.
 *
 * A dependency-free PDF writer. Every issued license is a single dark branded
 * certificate, redesigned around one centered hero: the 3D flower mark in the
 * middle of the masthead, the KYROIII wordmark beneath it, a full-width silver
 * divider, then the title, the hero serial block, one ruled metadata row, the
 * numbered clauses and two pre-filled signature blocks over a document-control
 * footer with a vector barcode.
 *
 * The LICENSEE block carries the signature captured in the gate's
 * review-and-sign step on `download.html` (see `downloads.js`). A typed
 * signature is set large on its rule; a *drawn* one is re-emitted as vector
 * strokes, so it stays crisp at any zoom and the document stays monochrome.
 * Both pads are pre-filled and dated, so no license ever goes out blank.
 *
 * The document is 100% ALL CAPS: every string runs through `toAscii`, which
 * uppercases it, so no lowercase letter can reach the page. The palette is
 * strictly monochromatic — deep matte black (#0B0B0B), crisp pure white
 * (#FFFFFF) and silver/grey rules (#888888 and siblings) — every channel equal,
 * so there is no blue (or any other hue) anywhere in the document.
 *
 * Every issuance mints a fresh serial (`KYRO-<year>-<SLUG>-<6 random digits>`
 * from `crypto.getRandomValues`), so no two licenses ever share an id, and the
 * serial shown on `download.html` is exactly the one printed in the PDF.
 *
 * One layout rule holds the whole document together: it must stay on a single
 * page. `FOOT_Y` is the hard floor the flow may not cross, and `ensure(...)`
 * reserves space for every block that must not be split. The exclusive
 * (stems) package is the tightest fit of the three — it ends ~24 pt above the
 * floor — so any new block, bigger flower or looser leading has to be paid for
 * by reclaiming the same space above it.
 */
(function () {
  "use strict";

  const CREDIT = "(Prod. by KYROIII)";
  const FLOWER_SRC = "assets/kyrolll-flower-rest.png?v=1";
  const SERIAL_PREFIX = "KYRO";
  const SUPPORT_EMAIL = "kyrolll00@gmail.com";
  const STORE_URL = "HTTPS://KYROILL.STORE";

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
     it cannot draw are the typographic ones, which fold to ASCII first. Every
     string in the document goes through here, and the very first thing it does
     is force uppercase — so the finished PDF can never contain a lowercase
     letter, whatever the source data says. */
  function toAscii(value) {
    return String(value == null ? "" : value)
      .toUpperCase()
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
  const MID = PAGE_W / 2;          // the masthead's centre line
  const FOOT_Y = M + 40;           // flow stops here; footer lives below
  const MARK = 120;                // the flower mark, centred in the masthead
  const MARK_TOP = PAGE_H - M - 20;
  /* Strictly monochromatic greys — every channel equal, so the document is deep
     black, crisp white and silver with zero blue cast. The first two are the
     exact brand values: #0B0B0B field and #888888 silver rules. */
  const BG = "0.043 0.043 0.043 rg";     // #0B0B0B — the deep matte black field
  const FRAME = "0.533 0.533 0.533";     // #888888 — minimalist silver frame
  const HAIR = "0.19 0.19 0.19";         // inner hairline
  const TICK = "0.72 0.72 0.72";         // bright silver corner ticks
  const WHITE = "1 1 1 rg";              // #FFFFFF — crisp pure white
  const SILVER = "0.8 0.8 0.8 rg";       // the drawn signature / soft silver text
  const SILVER_RG = "0.8 0.8 0.8";       // the same silver as a stroke colour
  const BODY = "0.85 0.85 0.85 rg";
  const MUTED = "0.55 0.55 0.55 rg";

  /* The signature payload: `{ name, strokes, pad }` where the strokes are
     normalised 0..1 polylines off the sign pad (`[[[x, y], ...], ...]`) and
     `pad` is the pad's aspect (`{ w, h }`). A plain string stays supported so a
     caller that only has a typed name keeps working. */
  function normalizeSignature(value) {
    if (!value) return { name: "", strokes: null, pad: null, email: "" };
    if (typeof value === "string") return { name: value.trim(), strokes: null, pad: null, email: "" };
    const strokes = Array.isArray(value.strokes)
      ? value.strokes
        .map((stroke) => (Array.isArray(stroke) ? stroke : [])
          .filter((point) => Array.isArray(point) && point.length === 2)
          .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0]))
        .filter((stroke) => stroke.length > 1)
      : null;
    const pad = value.pad && Number(value.pad.w) > 0 && Number(value.pad.h) > 0
      ? { w: Number(value.pad.w), h: Number(value.pad.h) } : null;
    return {
      name: String(value.name == null ? "" : value.name).trim(),
      strokes: strokes && strokes.length ? strokes : null,
      pad: pad,
      email: String(value.email == null ? "" : value.email).trim()
    };
  }

  /* The strokes, as a cache key fragment — exact, because two different
     drawings must never share a cached blob. */
  function signatureKey(sig) {
    const s = normalizeSignature(sig);
    return s.name + "|" + s.email + "|" + (s.strokes ? JSON.stringify(s.strokes) : "");
  }

  /* ---------------------------------------------------------------- page */

  function buildPdf(data) {
    const flower = data.flower;
    const sig = data.signature;
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
    /* A full-width silver divider — the masthead's cut line. */
    const rule = (yLine, color, width) => hline(COL_X, COL_X + COL_W, yLine, color, width);

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

    /* The dark field, the double frame with its corner ticks and — the mark the
       whole page is built around — the flower, centred in the masthead. */
    const chrome = () => {
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
      if (flower) {
        const imgX = (PAGE_W - MARK) / 2;
        const imgY = MARK_TOP - MARK;
        raw("q " + MARK.toFixed(2) + " 0 0 " + MARK.toFixed(2) + " " + imgX.toFixed(2) + " " + imgY.toFixed(2) + " cm /Im1 Do Q");
        box(imgX, imgY, MARK, MARK, HAIR, 0.6);
      }
    };

    const ensure = (height) => {
      if (y - height < FOOT_Y) { startPage(); return true; }
      return false;
    };

    /* Flow primitives, all expressed as a moving baseline. */
    const gap = (amount) => { y -= amount; };
    const heading = (label) => {
      ensure(24);
      gap(4);
      putTracked(COL_X, y, label, "F2", 10, WHITE, 0.4);
      gap(7);
      rule(y + 3, HAIR, 0.6);
      gap(7);
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

    /* A ruled metadata row: micro-labels on one baseline, bold values on the
       row below, hairline columns between them and a hairline rule under the
       lot. It is laid out as a real grid — every column shares the label and
       value baselines and the row is as tall as its tallest value — because
       one measured row of four is what buys the centered masthead its room
       without ever pushing the stems license onto a second page. */
    const gridRow = (pairs, weights) => {
      const total = weights.reduce((sum, w) => sum + w, 0);
      const columns = pairs.map((pair, i) => {
        const colW = COL_W * weights[i] / total;
        return {
          label: pair.label,
          x: COL_X + COL_W * weights.slice(0, i).reduce((sum, w) => sum + w, 0) / total,
          lines: wrapToWidth(pair.value, "F2", 9.5, colW - 14).slice(0, 2)
        };
      });
      const rows = columns.reduce((max, col) => Math.max(max, col.lines.length), 1);
      const labelY = y;
      ensure(10.5 + rows * 10 + 15);
      columns.forEach((col) => putTracked(col.x, labelY, col.label, "F1", 7, MUTED, 0.5));
      gap(10.5);
      for (let r = 0; r < rows; r += 1) {
        columns.forEach((col) => { if (col.lines[r]) put(col.x, y, col.lines[r], "F2", 9.5, WHITE, 0); });
        gap(10);
      }
      gap(2);
      columns.forEach((col, i) => { if (i > 0) vline(col.x - 7, y + 6, labelY + 8, HAIR, 0.6); });
      rule(y + 8, HAIR, 0.6);
      gap(12);
    };

    /* The drawn signature: the pointer polylines off the sign pad, re-emitted as
       real vector strokes in silver. Nothing rasterised, nothing embedded — the
       mark stays crisp at any zoom and cannot carry a hue into the document. */
    const drawSignature = (strokes, pad, bx, by, bw, bh) => {
      const aspect = pad && pad.w > 0 && pad.h > 0 ? pad.w / pad.h : bw / bh;
      const scale = Math.min(bw / (aspect * 100), bh / 100);
      const drawW = aspect * 100 * scale;
      const drawH = 100 * scale;
      const x0 = bx + (bw - drawW) / 2;
      const y0 = by;
      raw("1 J 1 j 1.05 w");
      stroke(SILVER_RG, 1.05);
      strokes.forEach((points) => {
        let path = "";
        points.forEach((point, i) => {
          const px = x0 + Math.min(Math.max(point[0], 0), 1) * drawW;
          const py = y0 + (1 - Math.min(Math.max(point[1], 0), 1)) * drawH;
          path += px.toFixed(2) + " " + py.toFixed(2) + (i ? " l " : " m ");
        });
        raw(path + "S");
      });
      raw("0 J 0 j");
    };

    function startPage() {
      if (current !== null) pages.push(current);
      current = "";
      chrome();
      y = MARK_TOP - MARK;
    }

    /* ------------------------------------------------------- page one */

    startPage();

    /* Masthead — the centered hero: the mark, the wordmark, the programme name,
       then the divider the title hangs under. */
    putCenter(MID, MARK_TOP - MARK - 25, "KYROIII", "F2", 26, WHITE, 1.4);
    putCenter(MID, MARK_TOP - MARK - 40, "FREE MUSIC LICENSE PROGRAM", "F1", 7.5, MUTED, 1.9);
    rule(MARK_TOP - MARK - 54, FRAME, 0.9);
    putCenter(MID, MARK_TOP - MARK - 79, "CERTIFICATE OF FREE LICENSE", "F2", 19, WHITE, 0.9);
    putCenter(MID, MARK_TOP - MARK - 95, "NON-EXCLUSIVE - WORLDWIDE - PERPETUAL - ROYALTY-FREE", "F1", 7.5, MUTED, 1.5);

    /* Serial block — the hero of the document. */
    const boxTop = MARK_TOP - MARK - 109;
    const boxH = 46;
    box(COL_X, boxTop - boxH, COL_W, boxH, FRAME, 1);
    putTracked(COL_X + 14, boxTop - 13, "LICENSE ID", "F1", 7, MUTED, 1.4);
    putTracked(COL_X + 14, boxTop - 33, data.serial, "F2", 15, WHITE, 0.9);
    putRight(COL_X + COL_W - 14, boxTop - 13, "ISSUED", "F1", 7, MUTED, 1.4);
    putRight(COL_X + COL_W - 14, boxTop - 33, data.issued, "F2", 11, WHITE, 0);
    y = boxTop - boxH - 40;

    gridRow([
      { label: "BEAT", value: data.title },
      { label: "PACKAGE", value: data.packageName },
      { label: "BPM / KEY", value: data.bpm + " BPM  -  " + data.key },
      { label: "TERRITORY", value: "WORLDWIDE" }
    ], [1.7, 1.25, 0.85, 0.85]);

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

    /* --------------------------------------------------- signatures */
    /* Two clean, straight, pre-filled signature blocks close the contract: the
       licensor KYROIII and the licensee, stamped with the signature captured in
       the gate's review-and-sign step (falling back to the address submitted
       there). Both names are set upright — no script face — on their own silver
       rule under a micro-label, so the block reads as a signed instrument
       rather than a blank to fill in. */
    ensure(88);
    const sigTop = y;
    const sigW = (COL_W - 40) / 2;
    const sigX2 = COL_X + sigW + 40;
    /* Long addresses must not run into the neighbouring column: step the name
       down in half-points until it fits its own rule. */
    const fitSize = (value, size, maxWidth) => {
      let s = size;
      while (s > 6.5 && measure(toAscii(value), "F2", s) > maxWidth) s -= 0.5;
      return s;
    };
    const signatureBlock = (x, name, label, micro, strokes, pad) => {
      hline(x, x + sigW, sigTop - 42, FRAME, 0.9);
      if (strokes) {
        drawSignature(strokes, pad, x + 2, sigTop - 40, sigW - 4, 30);
      } else {
        putTracked(x, sigTop - 30, name, "F2", fitSize(name, 12, sigW - 8), WHITE, 0.5);
      }
      putTracked(x, sigTop - 55, label, "F1", 7, MUTED, 1.2);
      putTracked(x, sigTop - 66, micro, "F1", 6.5, MUTED, 0.9);
    };
    const licenseeName = sig.name || "-";
    /* The micro line under the LICENSEE rule records who this issuance went to:
       the address the flow submitted at the gate, alongside the date. */
    const signedLine = "SIGNED " + data.issued + (sig.email ? " - " + sig.email : "");
    signatureBlock(COL_X, licenseeName, "LICENSEE SIGNATURE", signedLine, sig.strokes, sig.pad);
    signatureBlock(sigX2, "KYROIII", "LICENSOR (KYROIII)", "AUTHORISED SIGNATORY - KYROIII");
    gap(84);

    /* ------------------------------------------------ document footer */
    /* Close the last page first: `startPage` only pushes when a new one begins,
       so the final page would otherwise never reach `pages` at all. */
    if (current !== null) { pages.push(current); current = null; }

    /* The control block names the program, carries the support address, repeats
       the serial and numbers the page — the marks that make a printed contract
       feel authoritative. It is appended now that every page is known, so
       "PAGE n OF m" is always right. */
    const pageCount = pages.length;
    const footRuleY = M + 38;
    const footTextY = M + 28;
    /* Vector barcode graphic + the official store link, bottom-right of the
       footer. The bars are crisp white — black bars would be invisible on the
       black field — and their widths come from the license id, so every issued
       document carries its own mark. The link is printed uppercase to the left
       of the bars, on the same baseline. */
    function barcodeBlock() {
      const barsW = 116;
      const barsX = PAGE_W - M - 16 - barsW;
      const barsY = M + 12;
      const barsH = 11;
      /* Deterministic from the serial: the same license id always yields the
         same barcode, a different one always yields a different pattern. */
      let seed = 7;
      const serial = toAscii(data.serial || "KYRO");
      for (let i = 0; i < serial.length; i += 1) seed = (seed * 31 + serial.charCodeAt(i)) % 2147483647;
      let bc = "1 1 1 rg\n";
      let x = barsX;
      while (x < barsX + barsW - 2) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const barW = 0.9 + (seed / 2147483648) * 2.1;
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const gap = 1.1 + (seed / 2147483648) * 1.7;
        bc += x.toFixed(2) + " " + barsY.toFixed(2) + " " + barW.toFixed(2) + " " + barsH.toFixed(2) + " re f\n";
        x += barW + gap;
      }
      bc += "BT /F1 6 Tf 0 Tc " + MUTED + " " + COL_X.toFixed(2) + " " + barsY.toFixed(2) + " Td (" + escapePdfString(STORE_URL) + ") Tj ET\n";
      return bc;
    }

    pages.forEach((content, i) => {
      const right = "PAGE " + (i + 1) + " OF " + pageCount;
      const center = toAscii(data.serial || "");
      const left = toAscii("SUPPORT " + SUPPORT_EMAIL);
      const footer =
        HAIR + " 0.6 RG\n" +
        rule(footRuleY, HAIR, 0.6) + "\n" +
        "BT /F1 7 Tf 0 Tc " + MUTED + " " + COL_X.toFixed(2) + " " + footTextY.toFixed(2) + " Td (" + escapePdfString(left) + ") Tj ET\n" +
        "BT /F1 7 Tf 0 Tc " + MUTED + " " + (MID - measure(center, "F1", 7) / 2).toFixed(2) + " " + footTextY.toFixed(2) + " Td (" + escapePdfString(center) + ") Tj ET\n" +
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
    /* Two base-14 faces carry the whole document — Helvetica (F1) and
       Helvetica-Bold (F2) — so nothing is embedded and no third font is
       needed (the signatures are straight, not script). */
    pages.forEach((content, i) => {
      const pageObj = 6 + i * 2;
      const contentObj = pageObj + 1;
      const stream = toBytes(content);
      putObject(pageObj, toBytes(pageObj + " 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "]" +
        " /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents " + contentObj + " 0 R >> endobj\n"));
      putObject(contentObj, toBytes(contentObj + " 0 obj << /Length " + stream.length + " >> stream\n"));
      push(stream);
      push(toBytes("\nendstream\nendobj\n"));
    });

    const xrefStart = position;
    const total = 6 + pageCount * 2;
    let xref = "xref\n0 " + total + "\n0000000000 65535 f \n";
    for (let i = 1; i < total; i += 1) xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    xref += "trailer << /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";
    push(toBytes(xref));

    return new Blob([concatBytes.apply(null, chunks)], { type: "application/pdf" });
  }

  /* ---------------------------------------------------------------- public */

  const cache = new Map(); // beatId::packageId::serial::name::strokes -> { blob, name }

  function cacheKey(beat, pack, serial, signature) {
    if (!beat) return "";
    return (beat.id || beat.slug || "beat") + "::" + (pack && pack.id || "pack") + "::" +
      (serial || "") + "::" + signatureKey(signature);
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
    return "KYROIII - " + (safe || "BEAT") + " LICENSE.pdf";
  }

  function buildDocument(beat, pack, serial, signature, flower) {
    return buildPdf({
      title: beat.title,
      packageName: pack.name,
      bpm: String(beat.bpm),
      key: String(beat.key),
      issued: new Date().toISOString().slice(0, 10),
      includes: pack.includes || [],
      serial: serial,
      signature: normalizeSignature(signature),
      flower: flower
    });
  }

  /* Warm the flower ahead of the click. The sign step collects the signature
     live, so by the time the visitor signs the only remaining work is the
     document itself — which then builds inside the click. */
  function primeLicenseFlower() {
    return flowerJpeg();
  }

  function saveBuilt(beat, pack, serial, signature, flower, downloads) {
    const key = cacheKey(beat, pack, serial, signature);
    let entry = cache.get(key);
    if (!entry) {
      entry = { blob: buildDocument(beat, pack, serial, signature, flower), name: safeFileName(beat) };
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
  async function primeLicensePDF(beat, pack, serial, signature) {
    if (!beat || !pack) return null;
    const sid = serial || makeLicenseId(beat);
    const key = cacheKey(beat, pack, sid, signature);
    const cached = cache.get(key);
    if (cached) return cached.blob;
    const flower = await flowerJpeg();
    const blob = buildDocument(beat, pack, sid, signature, flower);
    cache.set(key, { blob: blob, name: safeFileName(beat) });
    return blob;
  }

  /* `signature` is the signature captured in the gate's review-and-sign step
     (`{ name, strokes, pad }`, or a plain typed string); it is stamped as the
     LICENSEE signature. */
  async function generateLicensePDF(beat, pack, downloads, serial, signature) {
    if (!beat || !pack) { if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE"); return; }
    const sid = serial || makeLicenseId(beat);
    const key = cacheKey(beat, pack, sid, signature);
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
      try { saveBuilt(beat, pack, sid, signature, flowerCache, downloads); }
      catch (err) {
        if (typeof console !== "undefined") console.error("KYROIII license PDF failed:", err);
        if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE - TRY AGAIN");
      }
      return;
    }
    try {
      const flower = await flowerJpeg();
      saveBuilt(beat, pack, sid, signature, flower, downloads);
    } catch (err) {
      /* The still image is the only fragile part and it already degrades to a
         text-only document, so a throw here is a real bug — surface it rather
         than swallowing it. */
      if (typeof console !== "undefined") console.error("KYROIII license PDF failed:", err);
      if (downloads && downloads.showToast) downloads.showToast("LICENSE UNAVAILABLE - TRY AGAIN");
    }
  }

  window.KYROlll_LICENSE_PDF = {
    makeLicenseId: makeLicenseId,
    normalizeSignature: normalizeSignature,
    primeLicenseFlower: primeLicenseFlower,
    primeLicensePDF: primeLicensePDF,
    generateLicensePDF: generateLicensePDF
  };
})();
