/* KYROIII — shared catalog and free download packages.

 * Loaded by every page so the store, the download menu and the download page
 * all agree on the same beats, packages and files. It is plain data plus tiny
 * helpers, with no DOM access, so it is safe to include before anything else.
 *
 * Every beat is 100% free. There is no cart, no checkout and no payment
 * gateway: every package is unlocked behind the same friction-free gate — an
 * email address plus acceptance of the license terms — with no social like,
 * follow or subscribe step of any kind (see `downloads.js`). Every gate then
 * closes with a REVIEW & SIGN stage, and the signature captured there is
 * stamped into the PDF license. Nothing is written down, so a fresh visit asks
 * again; only the current page view remembers a package it already unlocked. */

(function () {
  "use strict";

  // The official profiles. The footers link straight to these, and the gate
  // steps open the same destinations, so the store and the gates can never
  // drift apart. `?sub_confirmation=1` makes YouTube show its own subscribe
  // prompt on arrival, so one click both opens the channel and asks to
  // subscribe.
  window.KYROlll_SOCIAL = {
    youtube: "https://www.youtube.com/@KYROlll00",
    instagram: "https://www.instagram.com/kyrolll00/",
    tiktok: "https://www.tiktok.com/@kyrolll00",
    x: "https://x.com/KYROlll00"
  };
  window.KYROlll_YOUTUBE_CHANNEL = window.KYROlll_SOCIAL.youtube + "?sub_confirmation=1";

  // The store's external endpoints. `formspreeEndpoint` is authoritative for
  // every [FREE 100%] beat download; `paidFormspreeEndpoint` is reserved for a
  // future paid category, so free and paid submissions can never drift onto the
  // same Formspree form. The free form is the `KYROIII — FREE DOWNLOADS` form.
  const SITE = window.KYROlll_SITE = {
    formspreeEndpoint: "https://formspree.io/f/mvkkkoew",
    paidFormspreeEndpoint: ""
  };

  // Where the email gate delivers a new subscriber. The gate `fetch`es this URL
  // with `Accept: application/json`, so the submission is recorded by the
  // provider instead of navigating the page. Formspree is wired up here; any
  // provider that accepts a form POST and answers with CORS (Buttondown's embed
  // endpoint, a Beehiiv subscribe form, …) works by putting its action URL in
  // `endpoint` (or, for Buttondown, just its `username`). Left blank, the gate
  // still unlocks the files and sends nothing.
  window.KYROlll_NEWSLETTER = {
    provider: "formspree",
    username: "",
    endpoint: SITE.formspreeEndpoint,
    paidEndpoint: SITE.paidFormspreeEndpoint
  };

  // The three free ways a beat leaves the store. Every one of them uses the
  // same two-step gate, with no social requirement anywhere:
  //   step 1 — email + mandatory opt-in → submit
  //   step 2 — read the license terms, type a full name and sign → SIGN & UNLOCK
  // `gate` is kept as a package field for callers, but the only value in use is
  // "email"; "instant" remains available for a package that should skip the
  // gate entirely. `includes` is the plain-language list of what the package
  // hands over; it is printed in the generated license (see `downloads.js`).
  window.KYROlll_PACKAGES = [
    {
      id: "mp3",
      name: "MP3 LEASE",
      tag: "EMAIL + LICENSE",
      gate: "email",
      /* `grant` is the licensing half of the package, read by the generated PDF:
         `non-exclusive` keeps the beat in the market for other artists, while
         `exclusive` retires it (see the claim register below). The language is
         shared by every beat, so no catalog entry can carry its own terms. */
      grant: "non-exclusive",
      blurb: "ENTER YOUR EMAIL, ACCEPT THE LICENSE AND UNLOCK THE DOWNLOAD INSTANTLY.",
      includes: ["TAGGED MP3 AUDIO FILE", "FREE NON-EXCLUSIVE LICENSE"]
    },
    {
      id: "wav",
      name: "STANDARD WAV LEASE",
      tag: "EMAIL + LICENSE",
      gate: "email",
      grant: "non-exclusive",
      blurb: "TAGGED MP3 + HIGH-QUALITY WAV + LICENSE. ENTER YOUR EMAIL, ACCEPT THE LICENSE AND UNLOCK.",
      includes: ["TAGGED MP3 AUDIO FILE", "HIGH-QUALITY WAV", "FREE NON-EXCLUSIVE LICENSE"]
    },
    {
      id: "exclusive",
      name: "EXCLUSIVE / PRO PACKAGE",
      tag: "EMAIL + LICENSE",
      gate: "email",
      grant: "exclusive",
      blurb: "FULL STEMS + MP3 + WAV + EXCLUSIVE LICENSE. ENTER YOUR EMAIL, ACCEPT THE LICENSE AND UNLOCK.",
      includes: [
        "TAGGED MP3 AUDIO FILE",
        "HIGH-QUALITY WAV",
        "TRACKED STEMS",
        "FULL EXCLUSIVE RIGHTS / LICENSE",
        "EMAIL OPT-IN FOR FUTURE DROPS"
      ]
    }
  ];

  // `id` is the beat's stable id (the uuid for the original releases, the short
  // store handle for newer catalog entries) and `slug` is the human handle kept
  // for links (`?beat=flesh`); the helpers resolve either. `youtube` is the
  // beat's own video, exposed through `videoFor` for any caller that wants to
  // point at it; no gate step asks for a like or a follow.
  // `deliverables` maps a package to the files the download page hands over:
  // each entry is `{ file, name, label }`, a same-origin `file`, the `name` the
  // browser saves it as and the `label` shown on the download page. The `name`
  // below is the fallback; `downloads.js` re-derives every hand-over from the
  // beat's own metadata as `KYROIII - <BEAT> (<BPM> BPM - <KEY>).<ext>`, so an
  // engineer can read the tempo and key straight off the filename. Only the
  // extension is lowercase, so the file the visitor keeps is still a normal
  // `.mp3`/`.wav`. The license is not listed here — the download page always
  // generates one.

  // New release: GUNNA TYPE BEAT - VVS Motion. Stored oldest-first; the grid
  // sorts newest to front, so it lands at the lead of the catalog.
  window.KYROlll_CATALOG = [
    {
      id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
      slug: "flesh",
      title: "[FREE 100%] DON TOLIVER TYPE BEAT - FLESH",
      img: "assets/flesh.png",
      bpm: 130,
      key: "Am",
      preview: "assets/previews/BEAT 1 TAG.wav",
      youtube: "https://www.youtube.com/watch?v=8OhRJQn2YCU",
      vinylVariant: "white",
      deliverables: {
        mp3: [
          { file: "assets/previews/flesh.mp3", name: "KYROIII - FLESH (130 BPM - AM).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/flesh.mp3", name: "KYROIII - FLESH (130 BPM - AM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/flesh.wav", name: "KYROIII - FLESH (130 BPM - AM).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/flesh.mp3", name: "KYROIII - FLESH (130 BPM - AM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/flesh.wav", name: "KYROIII - FLESH (130 BPM - AM).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/flesh-stems.zip", name: "KYROIII - FLESH (130 BPM - AM) - TRACKED STEMS.zip", label: "TRACKED STEMS" }
        ]
      }
    },
    {
      id: "5f9bbcab-e010-4efe-b459-9c9182e1d85b",
      slug: "the-flow",
      title: "[FREE 100%] FUTURE TYPE BEAT - THE FLOW",
      img: "assets/the-flow.png",
      bpm: 124,
      key: "C#m",
      preview: "assets/previews/the-flow.mp3",
      youtube: "https://www.youtube.com/watch?v=aHMCkzw9Wuo",
      vinylVariant: "gold-rim",
      releaseAt: "2026-10-19T23:00:00+03:00",
      deliverables: {
        mp3: [
          { file: "assets/previews/the-flow.mp3", name: "KYROIII - THE FLOW (124 BPM - C#M).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/the-flow.mp3", name: "KYROIII - THE FLOW (124 BPM - C#M).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/the-flow.wav", name: "KYROIII - THE FLOW (124 BPM - C#M).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/the-flow.mp3", name: "KYROIII - THE FLOW (124 BPM - C#M).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/the-flow.wav", name: "KYROIII - THE FLOW (124 BPM - C#M).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/the-flow-stems.zip", name: "KYROIII - THE FLOW (124 BPM - C#M) - TRACKED STEMS.zip", label: "TRACKED STEMS" }
        ]
      }
    },
    {
      id: "a4acc928-410a-4200-8463-13bd9258058d",
      slug: "green-flesh",
      aliases: ["steam"],
      title: "[FREE 100%] LIL BABY TYPE BEAT - GREEN FLESH",
      img: "assets/steam.png",
      bpm: 138,
      key: "B",
      preview: "assets/previews/steam.mp3",
      youtube: "https://www.youtube.com/@KYROlll00",
      vinylVariant: "sage-white-rim",
      releaseAt: "2026-10-22T23:00:00+03:00",
      deliverables: {
        mp3: [
          { file: "assets/previews/steam.mp3", name: "KYROIII - GREEN FLESH (138 BPM - B).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/steam.mp3", name: "KYROIII - GREEN FLESH (138 BPM - B).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/steam.wav", name: "KYROIII - GREEN FLESH (138 BPM - B).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/steam.mp3", name: "KYROIII - GREEN FLESH (138 BPM - B).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/steam.wav", name: "KYROIII - GREEN FLESH (138 BPM - B).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/steam-stems.zip", name: "KYROIII - GREEN FLESH - TRACKED STEMS.zip", label: "TRACKED STEMS" }
        ]
      }
    },
    {
      id: "squish",
      slug: "squish",
      title: "[FREE 100%] LIL GOTIT TYPE BEAT - SQUISH!",
      shortTitle: "SQUISH!",
      img: "assets/squish.png",
      bpm: 124,
      key: "FM",
      preview: "assets/previews/squish.mp3",
      youtube: "https://www.youtube.com/@KYROlll00",
      vinylVariant: "ice-silver-rim",
      releaseAt: "2026-10-25T23:00:00+02:00",
      deliverables: {
        mp3: [
          { file: "assets/previews/squish.mp3", name: "KYROIII - SQUISH! (124 BPM - FM).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/squish.mp3", name: "KYROIII - SQUISH! (124 BPM - FM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/squish.wav", name: "KYROIII - SQUISH! (124 BPM - FM).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/squish.mp3", name: "KYROIII - SQUISH! (124 BPM - FM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/squish.wav", name: "KYROIII - SQUISH! (124 BPM - FM).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/squish-stems.zip", name: "KYROIII - SQUISH! - TRACKED STEMS.zip", label: "TRACKED STEMS" }
        ]
      }
    },
    {
      id: "just-d0-it",
      slug: "just-d0-it",
      title: "[FREE 100%] YEAT TYPE BEAT - JUST D0 IT",
      shortTitle: "JUST D0 IT",
      img: "assets/just-do-it.png",
      bpm: 135,
      key: "Am",
      preview: "assets/previews/just-do-it.mp3",
      youtube: "https://www.youtube.com/@KYROlll00",
      vinylVariant: "rage-fire-rim",
      releaseAt: "2026-10-27T23:00:00+02:00",
      deliverables: {
        mp3: [
          { file: "assets/previews/just-do-it.mp3", name: "KYROIII - JUST D0 IT (135 BPM - AM).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/just-do-it.mp3", name: "KYROIII - JUST D0 IT (135 BPM - AM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/just-do-it.wav", name: "KYROIII - JUST D0 IT (135 BPM - AM).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/just-do-it.mp3", name: "KYROIII - JUST D0 IT (135 BPM - AM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/just-do-it.wav", name: "KYROIII - JUST D0 IT (135 BPM - AM).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/just-do-it-stems.zip", name: "KYROIII - JUST D0 IT - TRACKED STEMS.zip", label: "TRACKED STEMS" }
        ]
      }
    },
    {
      id: "adll",
      slug: "adll",
      title: "[FREE 100%] YEAT TYPE BEAT - A.D.L",
      shortTitle: "A.D.L",
      img: "assets/adll.png",
      bpm: 124,
      key: "C#",
      preview: "assets/previews/adll.mp3",
      youtube: "https://www.youtube.com/@KYROlll00",
      vinylVariant: "graffiti-splatter",
      releaseAt: "2026-11-02T19:00:00+02:00",
      deliverables: {
        mp3: [
          { file: "assets/previews/adll.mp3", name: "KYROIII - A.D.L (124 BPM - C#).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/adll.mp3", name: "KYROIII - A.D.L (124 BPM - C#).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/adll.wav", name: "KYROIII - A.D.L (124 BPM - C#).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/adll.mp3", name: "KYROIII - A.D.L (124 BPM - C#).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/adll.wav", name: "KYROIII - A.D.L (124 BPM - C#).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/adll-stems.zip", name: "KYROIII - A.D.L - TRACKED STEMS.zip", label: "TRACKED STEMS" }
        ]
      }
    },
    // GUNNA TYPE BEAT - VVS Motion.
    {
      id: "72f9b3e3-7d3a-490e-b8b5-5b1e9d8e3668",
      slug: "gunna-type",
      title: "[FREE 100%] GUNNA TYPE BEAT - VVS MOTION",
      img: "assets/beat-cover.png",
      bpm: 146,
      key: "Fm",
      preview: "assets/previews/gunna-type.mp3",
      youtube: "https://www.youtube.com/@KYROlll00",
      vinylVariant: "white",
      // Schedule the drop for today at exactly 22:00 (Israel time).
      releaseAt: "2026-11-06T22:00:00+02:00",
      deliverables: {
        mp3: [
          { file: "assets/previews/gunna-type.mp3", name: "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/gunna-type.mp3", name: "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/gunna-type.wav", name: "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/gunna-type.mp3", name: "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/gunna-type.wav", name: "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/gunna-type-stems.zip", name: "KYROIII - GUNNA TYPE BEAT - VVS MOTION (146 BPM - FM) - TRACKED STEMS.zip", label: "TRACKED STEMS" }
        ]
      }
    }
  ];

  // ---------------------------------------------------------- release clock
  // A beat may carry `releaseAt` (an ISO timestamp with its own offset). Until
  // that instant it is a *scheduled drop*: the store paints it with a live
  // countdown pill (no clock hour — just the ticking HH:MM:SS, so the label is
  // timezone-proof) and, on its own page, an inert LOCKED control; it flips to
  // the full player the second the clock reaches zero — in page, no reload.
  // The clock accepts an override so a test (or a preview link) can stand at any
  // moment without waiting: set `window.KYROlll_NOW` to an ISO string or an epoch
  // before this file loads, or append `?now=<iso|epoch>` to the URL. The override
  // is read once, as a fixed instant, and then advances with real time — so a
  // countdown genuinely counts down instead of freezing.
  function parseWhen(value) {
    if (value == null || value === "") return null;
    const text = String(value).trim();
    const asNumber = typeof value === "number" ? value : (/^-?\d+$/.test(text) ? Number(text) : NaN);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const CLOCK_OFFSET = (function () {
    let override = null;
    if (typeof window !== "undefined") override = parseWhen(window.KYROlll_NOW);
    if (override == null && typeof location !== "undefined" && location.search) {
      try { override = parseWhen(new URLSearchParams(location.search).get("now")); } catch (error) { override = null; }
    }
    return override == null ? 0 : override - Date.now();
  })();
  function timeNow() { return Date.now() + CLOCK_OFFSET; }
  function releaseAtMs(beat) { return parseWhen(beat && beat.releaseAt); }
  // True when the beat has no schedule or its instant has passed.
  function isReleased(beat, when) {
    const at = releaseAtMs(beat);
    if (at == null) return true;
    const now = Number.isFinite(when) ? Number(when) : timeNow();
    return now >= at;
  }
  function msUntilRelease(beat, when) {
    const at = releaseAtMs(beat);
    if (at == null) return 0;
    const now = Number.isFinite(when) ? Number(when) : timeNow();
    return Math.max(0, at - now);
  }
  // HH:MM:SS, the countdown the badge ticks every second.
  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000));
    const pad = (n) => ("0" + n).slice(-2);
    return pad(Math.floor(total / 3600)) + ":" + pad(Math.floor((total % 3600) / 60)) + ":" + pad(total % 60);
  }
  function releaseLabel(beat) {
    if (!beat || releaseAtMs(beat) == null) return "";
    return beat.releaseLabel || "DROPPING SOON";
  }

  // ------------------------------------------------------- exclusive rights
  // A beat has exactly one exclusive license to give. The moment that package
  // is signed for, the beat is claimed: it leaves the free market, its public
  // preview and every lease are retired, and the catalog paints the secured
  // status instead of a button.
  // Like every other piece of storefront state this is a record, not storage:
  // the claim is written onto the live catalog entry and announced on the
  // window (`kyrolll:exclusive-locked`), so the grid re-renders in place, and
  // it is gone with the page. Nothing is written to localStorage, sessionStorage
  // or a cookie — a reload starts from the catalog as published.
  const EXCLUSIVE_LOCK_LABEL = "[EXCLUSIVE RIGHTS CLAIMED // SECURED]";
  const EXCLUSIVE_LOCK_NOTE = "THIS BEAT HAS BEEN SECURED WITH EXCLUSIVE RIGHTS AND ARCHIVED FROM PUBLIC RELEASE.";
  function isExclusiveLocked(beatId) {
    const beat = window.KYROlll_HELPERS.beatById(beatId);
    return !!(beat && beat.exclusiveLocked);
  }
  function lockExclusive(beatId) {
    const beat = window.KYROlll_HELPERS.beatById(beatId);
    if (!beat || beat.exclusiveLocked) return false;
    beat.exclusiveLocked = true;
    beat.exclusiveLockedAt = new Date(timeNow()).toISOString();
    if (typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
      window.dispatchEvent(new window.CustomEvent("kyrolll:exclusive-locked", {
        detail: { beatId: beat.id, slug: beat.slug }
      }));
    }
    return true;
  }
  window.KYROlll_EXCLUSIVE_LOCK = {
    label: EXCLUSIVE_LOCK_LABEL,
    note: EXCLUSIVE_LOCK_NOTE
  };

  window.KYROlll_HELPERS = {
    escapeHTML(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
    },
    beatById(id) {
      const key = String(id == null ? "" : id);
      return window.KYROlll_CATALOG.find((beat) =>
        beat.id === key || beat.slug === key ||
        (Array.isArray(beat.aliases) && beat.aliases.includes(key))) || null;
    },
    packageById(id) {
      return window.KYROlll_PACKAGES.find((pack) => pack.id === id) || null;
    },
    // The files a package hands over (never the license — the download page
    // always generates that). Returns [] for an unknown beat or package.
    deliverablesFor(beatId, packageId) {
      const beat = window.KYROlll_HELPERS.beatById(beatId);
      const list = beat && beat.deliverables && beat.deliverables[packageId];
      return Array.isArray(list) ? list : [];
    },
    // The beat's own video, or the channel as a last resort, for any caller
    // that wants to point at it. A scheduled drop's own video is
    // withheld from every caller until its clock lands: the beat page renders a
    // locked, non-clickable icon and the gate cannot open anyway, but the helper
    // never hands out the unreleased URL ahead of time either.
    videoFor(beatId) {
      const beat = window.KYROlll_HELPERS.beatById(beatId);
      if (beat && isReleased(beat)) return beat.youtube || window.KYROlll_YOUTUBE_CHANNEL;
      return window.KYROlll_YOUTUBE_CHANNEL;
    },
    // Where the email gate posts a new subscriber, or "" when no provider is
    // configured yet (the gate then stays local-only).
    newsletterEndpoint() {
      const config = window.KYROlll_NEWSLETTER || {};
      if (config.endpoint) return String(config.endpoint);
      if (config.provider === "buttondown" && config.username) {
        return "https://buttondown.com/api/emails/embed-subscribe/" + encodeURIComponent(String(config.username));
      }
      return "";
    },
    // The scheduled-release clock: `now()` is the store's time (a fixed override
    // plus real time), and the four helpers below answer whether a beat is live
    // yet and how long the countdown has left.
    now: timeNow,
    releaseAt(beat) { return releaseAtMs(beat); },
    isReleased: isReleased,
    msUntilRelease: msUntilRelease,
    formatCountdown: formatCountdown,
    releaseLabel: releaseLabel,
    // The exclusive-rights register: `isExclusiveLocked` answers whether the
    // beat has been claimed, and `lockExclusive` marks it (and announces the
    // change) the moment its exclusive package is signed for.
    isExclusiveLocked(beatId) { return isExclusiveLocked(beatId); },
    lockExclusive(beatId) { return lockExclusive(beatId); }
  };
})();
