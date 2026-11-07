/* ------------------------------------------------------------- cover-pressed
   Every KYROIII record is pressed from its own cover art.

   `catalog.js` knows the cover (`beat.img`); this module samples it on a tiny
   offscreen canvas, reduces the pixels to a dominant hue, an accent hue and an
   overall luminance, and turns that reading into the tones of one physical
   record: an opaque body, marbling plumes, a flake field, a centre label and a
   conic rim. The tones are written onto the record as `--vinyl-*` custom
   properties, and `style.css` paints the single `.vinyl-record--pressing` from
   them — so no beat needs its own stylesheet block, and no two covers can press
   the same record.

   Nothing is stored: the palette is an in-memory read of an image the page is
   already showing, cached per cover for the life of the tab. A cover that has
   not decoded yet (or a browser without 2D canvas) gets a deterministic neutral
   pressing built from the beat's own hash, so a record is never unstyled and
   never has to wait on the network to exist. */
(function (global) {
  "use strict";

  if (global.KYROlll_VINYL) return;

  const SAMPLE_SIZE = 32; // 1 024 pixels is plenty to name a palette
  const HUE_BUCKETS = 12; // 30° each
  const CACHE = new Map(); // cover key -> palette
  const PENDING = new Map(); // cover key -> Promise<palette>
  const WATCHED = new Map(); // beat id -> Set<Element>

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const normHue = (hue) => ((hue % 360) + 360) % 360;
  const round = (value, places) => {
    const factor = 10 ** (places || 0);
    return Math.round(value * factor) / factor;
  };

  /* Deterministic per-beat seed: the same beat always gets the same label size,
     rim weight and marbling layout, even before its cover has decoded. */
  function seedFor(beat) {
    const text = `${(beat && beat.slug) || ""}|${(beat && beat.id) || ""}|${(beat && beat.img) || ""}`;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function hslToRgb(hue, sat, light) {
    const h = normHue(hue) / 360;
    if (sat <= 0) {
      const channel = Math.round(light * 255);
      return [channel, channel, channel];
    }
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    const channel = (t) => {
      let value = t;
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      if (value < 1 / 6) return p + (q - p) * 6 * value;
      if (value < 1 / 2) return q;
      if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
      return p;
    };
    return [
      Math.round(channel(h + 1 / 3) * 255),
      Math.round(channel(h) * 255),
      Math.round(channel(h - 1 / 3) * 255),
    ];
  }

  /* Colours leave this module as plain `rgb()`/`rgba()` strings: every browser
     can paint them, and a test can read the real channels back out. */
  function colour(hue, sat, light, alpha) {
    const [r, g, b] = hslToRgb(hue, clamp(sat, 0, 1), clamp(light, 0, 1));
    if (alpha === undefined || alpha >= 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${round(clamp(alpha, 0, 1), 3)})`;
  }

  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 2;
    if (max === min) return { hue: 0, sat: 0, light };
    const delta = max - min;
    const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return { hue: hue * 60, sat, light };
  }

  /* Reads the sampled pixels into the three things a pressing needs: the hue it
     is built from, the hue that catches the light on its rim, and how bright the
     cover is overall (which decides whether the disc is a dark pressing or a
     pale one). Saturated pixels carry the hue; the whole frame carries luma. */
  function analysePixels(pixels) {
    const buckets = Array.from({ length: HUE_BUCKETS }, () => ({
      weight: 0, x: 0, y: 0, sat: 0, light: 0,
    }));
    let luma = 0;
    let count = 0;
    let satTotal = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 24) continue;
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      const { hue, sat, light } = rgbToHsl(r, g, b);
      const weight = (0.015 + sat * sat) * (0.35 + light);
      const bucket = buckets[Math.floor(normHue(hue) / (360 / HUE_BUCKETS)) % HUE_BUCKETS];
      const radians = (hue * Math.PI) / 180;
      bucket.weight += weight;
      bucket.x += Math.cos(radians) * weight;
      bucket.y += Math.sin(radians) * weight;
      bucket.sat += sat * weight;
      bucket.light += light * weight;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      satTotal += sat;
      count += 1;
    }

    if (!count) {
      return {
        luma: 0.14,
        colourful: false,
        dominant: { hue: 220, sat: 0.02, light: 0.2 },
        accent: { hue: 220, sat: 0.02, light: 0.2 },
      };
    }

    const totalWeight = buckets.reduce((sum, bucket) => sum + bucket.weight, 0) || 1;
    const ranked = buckets
      .map((bucket) => ({
        hue: bucket.weight ? normHue((Math.atan2(bucket.y, bucket.x) * 180) / Math.PI) : 0,
        sat: bucket.weight ? bucket.sat / bucket.weight : 0,
        light: bucket.weight ? bucket.light / bucket.weight : 0,
        weight: bucket.weight,
      }))
      .sort((a, b) => b.weight - a.weight);

    const dominant = ranked[0];
    /* The accent is the most *coloured* bucket that is far enough from the
       dominant hue to read as a second colour — the teal behind a red car, the
       orange on a teal portrait. If a cover is genuinely one colour, the accent
       falls back to the dominant hue and the rim is simply a brighter version
       of the pressing. */
    const angularDistance = (a, b) => {
      const difference = Math.abs(normHue(a) - normHue(b)) % 360;
      return difference > 180 ? 360 - difference : difference;
    };
    /* A vivid secondary light (the teal beam behind a red car, the frost around
       a face) can cover far less of the frame than the dominant body, so the
       accent is chosen by colour *and* separation, not by area alone. */
    const accentScore = (bucket) => {
      const distance = angularDistance(bucket.hue, dominant.hue);
      return bucket.sat ** 2 * bucket.weight * (0.5 + distance / 180);
    };
    const candidates = ranked.filter((bucket) => bucket.weight > totalWeight * 0.03
      && angularDistance(bucket.hue, dominant.hue) > 30);
    const accent = candidates.sort((a, b) => accentScore(b) - accentScore(a))[0]
      || dominant;

    return {
      luma: luma / count,
      colourful: accent.sat > 0.18 && accent.weight > totalWeight * 0.06,
      dominant,
      accent,
      averageSat: satTotal / count,
    };
  }

  /* One reading -> the complete set of custom properties a pressing paints. */
  function paletteFrom(analysis, beat) {
    const seed = seedFor(beat);
    const neutral = !analysis.colourful;
    const dominant = analysis.dominant;
    const accent = analysis.accent;

    // Per-beat expression, independent of the cover's own hue: two beats with
    // similar artwork still get their own label size, rim weight and marble
    // layout, so the shelf never looks like a run of the same record.
    const hueShift = (seed % 13) - 6;
    const labelSize = 38 + (seed % 7); // 38–44% of the disc
    const rimWidth = round(2.2 + (seed % 4) * 0.3, 1); // 2.2–3.1px hairline
    const veinX = 22 + (seed % 46); // %
    const veinY = 20 + ((seed >>> 4) % 46); // %

    const bodyHue = neutral ? 220 : dominant.hue + hueShift;
    const bodySat = neutral ? 0.045 : clamp(0.13 + dominant.sat * 0.62, 0.16, 0.52);
    const bodyLight = clamp(analysis.luma * 0.52 + 0.055, 0.07, 0.46);
    const sheen = neutral ? 0.5 : clamp(0.1 + (1 - bodyLight) * 0.16, 0.1, 0.28);
    const accentHue = neutral ? 220 : accent.hue;
    const accentSat = neutral ? 0.02 : clamp(0.42 + accent.sat * 0.45, 0.42, 0.9);

    const rimSat = neutral ? 0.04 : clamp(0.62 + accent.sat * 0.3, 0.62, 0.95);
    const rimLight = neutral ? 0.9 : clamp(0.5 + accent.sat * 0.22, 0.52, 0.78);
    const labelSat = neutral ? 0.05 : clamp(0.18 + dominant.sat * 0.4, 0.2, 0.58);

    const vars = {
      // -- the disc -----------------------------------------------------------
      "--vinyl-body-1": colour(bodyHue, bodySat, bodyLight),
      "--vinyl-body-2": colour(bodyHue, bodySat * 0.9, bodyLight * 0.55),
      "--vinyl-body-3": colour(bodyHue, bodySat * 0.75, bodyLight * 0.26),
      "--vinyl-sheen-1": colour(0, 0, 1, sheen),
      "--vinyl-sheen-2": colour(0, 0, 1, sheen * 0.32),
      "--vinyl-sheen-3": colour(0, 0, 1, sheen * 0.5),
      "--vinyl-sheen-4": colour(0, 0, 1, sheen * 0.85),
      "--vinyl-lip": colour(0, 0, 1, neutral ? 0.4 : 0.12),
      "--vinyl-groove-1": colour(accentHue, accentSat * 0.45, 0.78, 0.07),
      "--vinyl-groove-2": colour(0, 0, 0, 0.24),
      // -- marbling: the cover's accent drifting through the body -------------
      "--vinyl-marble-1": colour(accentHue, accentSat, neutral ? 0.97 : 0.68, neutral ? 0.2 : 0.26),
      "--vinyl-marble-2": colour(bodyHue, accentSat * 0.7, neutral ? 0.9 : 0.55, 0.18),
      "--vinyl-vein-1": colour(accentHue, accentSat * 0.8, neutral ? 0.98 : 0.78, 0.16),
      "--vinyl-vein-2": colour(bodyHue, accentSat * 0.6, neutral ? 0.88 : 0.42, 0.2),
      "--vinyl-flake-1": colour(accentHue, accentSat, 0.9, neutral ? 0.46 : 0.4),
      "--vinyl-flake-2": colour(accentHue, accentSat, 0.97, 0.26),
      "--vinyl-vein-x": `${veinX}%`,
      "--vinyl-vein-y": `${veinY}%`,
      "--vinyl-vein-x-2": `${100 - veinX}%`,
      "--vinyl-vein-y-2": `${100 - veinY}%`,
      // -- the centre label: a deep tint of the cover's own colour ------------
      "--vinyl-label-1": colour(neutral ? 220 : dominant.hue, labelSat, neutral ? 0.09 : 0.105),
      "--vinyl-label-2": colour(neutral ? 220 : dominant.hue, labelSat * 0.8, 0.028),
      "--vinyl-label-ring": colour(accentHue, neutral ? 0.03 : 0.55, neutral ? 0.95 : 0.72, 0.55),
      "--vinyl-label-edge": colour(accentHue, neutral ? 0.03 : 0.6, 0.9, 0.34),
      "--vinyl-label-size": `${labelSize}%`,
      "--vinyl-glow": colour(accentHue, neutral ? 0.02 : 0.6, 0.85, 0.3),
      // -- the foil rim -------------------------------------------------------
      "--vinyl-rim-1": colour(accentHue, rimSat, rimLight * 0.6),
      "--vinyl-rim-2": colour(accentHue + 6, rimSat, rimLight),
      "--vinyl-rim-3": colour(accentHue + 14, rimSat, Math.min(0.96, rimLight * 1.35)),
      "--vinyl-rim-4": colour(accentHue - 8, rimSat, rimLight * 0.92),
      "--vinyl-rim-width": `${rimWidth}px`,
    };

    return { vars, source: "cover" };
  }

  /* The pre-decode pressing: the same physical record, in the neutral
     black/silver of the store itself. It is still unique per beat through the
     seeded label size, rim weight and marble layout, and it is replaced by the
     cover reading the moment the image is available. */
  function fallbackPalette(beat) {
    const palette = paletteFrom({
      luma: 0.14,
      colourful: false,
      dominant: { hue: 220, sat: 0.02, light: 0.2 },
      accent: { hue: 220, sat: 0.02, light: 0.2 },
    }, beat);
    palette.source = "pending";
    return palette;
  }

  const keyFor = (beat) => `${(beat && beat.img) || ""}|${(beat && beat.slug) || ""}`;

  function paletteFor(beat) {
    return CACHE.get(keyFor(beat)) || fallbackPalette(beat);
  }

  function styleFor(beat) {
    return Object.entries(paletteFor(beat).vars)
      .map(([name, value]) => `${name}:${value}`)
      .join(";");
  }

  function paint(element, palette) {
    if (!element || !element.style) return;
    Object.entries(palette.vars).forEach(([name, value]) => element.style.setProperty(name, value));
    element.dataset.palette = palette.source;
  }

  function remember(beat, element) {
    const id = (beat && (beat.id || beat.slug)) || "";
    if (!id) return;
    if (!WATCHED.has(id)) WATCHED.set(id, new Set());
    WATCHED.get(id).add(element);
  }

  function repaint(beat) {
    const id = (beat && (beat.id || beat.slug)) || "";
    const palette = paletteFor(beat);
    const elements = WATCHED.get(id);
    if (!elements) return;
    elements.forEach((element) => {
      if (!element.isConnected) {
        elements.delete(element);
        return;
      }
      paint(element, palette);
    });
  }

  function loadCover(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error("No cover art"));
        return;
      }
      const image = new Image();
      const settle = () => {
        try {
          resolve(image);
        } catch (error) {
          reject(error);
        }
      };
      image.onload = settle;
      image.onerror = () => reject(new Error(`Cover art unavailable: ${src}`));
      image.decoding = "async";
      image.src = src;
    });
  }

  function readPixels(image) {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No 2D canvas");
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  }

  function prime(beat) {
    const key = keyFor(beat);
    if (CACHE.has(key)) return Promise.resolve(CACHE.get(key));
    if (PENDING.has(key)) return PENDING.get(key);
    const job = loadCover(beat && beat.img)
      .then((image) => {
        const palette = paletteFrom(analysePixels(readPixels(image)), beat);
        CACHE.set(key, palette);
        PENDING.delete(key);
        repaint(beat);
        return palette;
      })
      .catch((error) => {
        // A cover that fails leaves the neutral pressing in place: the record is
        // still a record, and nothing about the page waits on it.
        PENDING.delete(key);
        throw error;
      });
    PENDING.set(key, job);
    return job;
  }

  /* Applies the best palette available right now, then refines it once the
     cover has been read. The element is the one that survives this render, so a
     grid rebuild simply registers a new one. */
  function watch(beat, element) {
    if (!beat || !element) return;
    remember(beat, element);
    paint(element, paletteFor(beat));
    if (CACHE.has(keyFor(beat))) return;
    prime(beat).catch(() => { /* keep the neutral pressing */ });
  }

  global.KYROlll_VINYL = {
    version: 1,
    paletteFor,
    styleFor,
    watch,
    prime,
    // Pure derive over sampled RGBA data: used by the tests and by any caller
    // that already has pixels (no DOM required).
    paletteFromPixels: (pixels, beat) => paletteFrom(analysePixels(pixels), beat),
  };
})(typeof window !== "undefined" ? window : globalThis);
