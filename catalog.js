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
        "FULL EXCLUSIVE RIGHTS — RESELL, RE-LICENSE & TRADE",
        "EMAIL OPT-IN FOR FUTURE DROPS"
      ]
    }
  ];

  // The artwork register. The collection on the home route shows ONLY pieces
  // listed here: every entry is a hand-drawn original, drawn for the record in
  // `beatId`, with its own scan in `src` (`assets/artwork/…`). A record with no
  // entry keeps its beat cover in the archive and is simply absent from the
  // collection — no stand-in photo and no empty placeholder slot. A piece is one
  // of one, so `edition` is always `1 / 1` and
  // `medium` describes the physical drawing; the 2028–2029 print/drop/apparel
  // window is copy in `storefront.js`/`style.css`, not data.
  window.KYROlll_ARTWORKS = [
    {
      id: "pink-study-01",
      title: "PINK STUDY 01",
      beatId: "white-night",
      year: 2026,
      src: "assets/artwork/pink-study-01.svg",
      medium: "INK & MARKER ON PAPER"
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
      preview: "assets/previews/flesh.mp3",
      youtube: "https://www.youtube.com/watch?v=8OhRJQn2YCU",
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
      // Schedule the drop for today at exactly 22:00 (Israel time).
      releaseAt: "2026-11-07T22:00:00+02:00",
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
    },
    // FUTURE TYPE BEAT - WHITE NIGHT.
    {
      id: "white-night",
      slug: "white-night",
      title: "[FREE 100%] FUTURE TYPE BEAT - WHITE NIGHT",
      shortTitle: "WHITE NIGHT",
      img: "assets/white-night.jpg",
      bpm: 142,
      key: "A",
      preview: "assets/previews/white-night.mp3",
      youtube: "https://www.youtube.com/@KYROlll00",
      // Schedule the drop for today at exactly 20:00 (Israel time).
      releaseAt: "2026-11-09T20:00:00+02:00",
      deliverables: {
        mp3: [
          { file: "assets/previews/white-night.mp3", name: "KYROIII - WHITE NIGHT (142 BPM - A).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/white-night.mp3", name: "KYROIII - WHITE NIGHT (142 BPM - A).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/white-night.wav", name: "KYROIII - WHITE NIGHT (142 BPM - A).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/white-night.mp3", name: "KYROIII - WHITE NIGHT (142 BPM - A).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/white-night.wav", name: "KYROIII - WHITE NIGHT (142 BPM - A).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/white-night-stems.zip", name: "KYROIII - WHITE NIGHT (142 BPM - A) - TRACKED STEMS.zip", label: "TRACKED STEMS" }
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
  // preview and every lease are retired, and every page of the store paints the
  // secured status instead of a button.
  //
  // The claim is GLOBAL. A browser publishes it to the store's claim bus (a
  // public ntfy topic); every open page subscribes to that bus, and a scheduled
  // GitHub Action merges the bus into `data/exclusive-claims.json`, the shared
  // seed every page fetches. localStorage is now only a cache plus an outbox
  // for claims made while offline — not the source of truth. `generation` is
  // the reset signal: bumping it retires every older claim and every older bus
  // message at once.
  //
  // The files are still public static assets, so this is a storefront record,
  // not server-side access control: it prevents duplicate claims and keeps the
  // whole store honest in the UI, but it cannot stop someone from fetching a
  // file directly.
  const EXCLUSIVE_LOCK_LABEL = "[CLAIMED / SOLD OUT]";
  const EXCLUSIVE_OWNED_LABEL = "[OWNED / YOURS]";
  const EXCLUSIVE_LOCK_NOTE = "THIS BEAT HAS BEEN SECURED WITH EXCLUSIVE RIGHTS AND ARCHIVED FROM PUBLIC RELEASE.";
  const EXCLUSIVE_OWNED_NOTE = "YOU HOLD THE EXCLUSIVE RIGHTS TO THIS BEAT. IT IS ARCHIVED FROM PUBLIC RELEASE AND CANNOT BE CLAIMED AGAIN.";
  const EXCLUSIVE_LOCK_BUTTON = "SOLD OUT";
  const EXCLUSIVE_OWNED_BUTTON = "OWNED / YOURS";
  const EXCLUSIVE_CLAIMS_KEY = "kyrolll_exclusive_claims";
  const EXCLUSIVE_CLAIMS_VERSION = 2;
  const EXCLUSIVE_CLAIMS_SEED = "data/exclusive-claims.json";
  const EXCLUSIVE_BUS_ORIGIN = "https://ntfy.sh";
  const EXCLUSIVE_BUS_FALLBACK_TOPIC = "kyroiii-claims-6f2a9d4c8b1e7f30";
  const EXCLUSIVE_POLL_MS = 20000;
  const EXCLUSIVE_SEED_MS = 300000;

  /* The live bus is off on a local preview by default, so the Playwright suite
     never publishes test claims into the real store. Add `?globalsync=1` (or
     set `window.KYROlll_EXCLUSIVE_SYNC = { enabled: true, topic: "..." }`)
     before catalog.js loads to exercise it locally. */
  function exclusiveSyncSettings() {
    const configured = window.KYROlll_EXCLUSIVE_SYNC || {};
    const loc = window.location || {};
    const search = typeof loc.search === "string" ? loc.search : "";
    const host = typeof loc.hostname === "string" ? loc.hostname : "";
    const protocol = typeof loc.protocol === "string" ? loc.protocol : "";
    const forced = configured.enabled === true || window.KYROlll_EXCLUSIVE_SYNC_FORCE === true ||
      /(?:^|[?&])globalsync=1(?:&|$)/.test(search);
    const local = !host || host === "localhost" || host === "127.0.0.1" || host === "::1" || protocol === "file:";
    const topicMatch = /[?&]claimstopic=([^&]+)/.exec(search);
    const explicitTopic = configured.topic || (topicMatch ? decodeURIComponent(topicMatch[1]) : "");
    return {
      enabled: configured.enabled === false ? false : (forced || !local),
      seed: configured.seed || EXCLUSIVE_CLAIMS_SEED,
      bus: String(configured.bus || EXCLUSIVE_BUS_ORIGIN).replace(/\/+$/, ""),
      topic: explicitTopic || EXCLUSIVE_BUS_FALLBACK_TOPIC,
      configuredTopic: explicitTopic || "",
      pollMs: Math.max(5000, Number(configured.pollMs) || EXCLUSIVE_POLL_MS),
      seedMs: Math.max(60000, Number(configured.seedMs) || EXCLUSIVE_SEED_MS)
    };
  }

  const exclusiveSync = exclusiveSyncSettings();
  const exclusiveBus = {
    seed: exclusiveSync.seed,
    bus: exclusiveSync.bus,
    topic: exclusiveSync.topic,
    configuredTopic: exclusiveSync.configuredTopic,
    source: null,
    cursor: 0,
    seen: {},
    seenCount: 0,
    syncing: null,
    flushing: null,
    pollTimer: 0,
    seedTimer: 0
  };

  /* A claim check must never hold a gate open on a slow or unreachable bus, so
     every network call is bounded. The caller always falls back to the last
     known state. */
  function exclusiveFetch(url, options, ms) {
    if (typeof window.fetch !== "function") return Promise.reject(new Error("fetch unavailable"));
    if (typeof window.AbortController !== "function" || typeof window.setTimeout !== "function") {
      return window.fetch(url, options);
    }
    const controller = new window.AbortController();
    const timer = window.setTimeout(() => {
      try { controller.abort(); } catch (err) { /* ignore */ }
    }, Math.max(500, Number(ms) || 5000));
    const request = Object.assign({}, options, { signal: controller.signal });
    const done = () => {
      try { window.clearTimeout(timer); } catch (err) { /* ignore */ }
    };
    return window.fetch(url, request).then((response) => { done(); return response; }, (err) => { done(); throw err; });
  }

  /* localStorage can be unavailable (private mode, a locked-down browser, a
     file:// page), so every read and write is defensive: if it fails the store
     still works from the in-memory catalog and the live bus. */
  function exclusiveStorage() {
    try {
      return window.localStorage || null;
    } catch (err) {
      return null;
    }
  }
  function mintToken(prefix, bytes) {
    const buffer = new Uint8Array(bytes);
    try {
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buffer);
    } catch (err) { /* fall through to the non-crypto seed */ }
    let token = "";
    for (let i = 0; i < buffer.length; i += 1) {
      // Math.random is enough for an ownership marker; this is never a
      // security boundary, only a way to recognise the same browser.
      const byte = buffer[i] || Math.floor(Math.random() * 256);
      token += ("0" + byte.toString(16)).slice(-2);
    }
    return prefix + token;
  }
  function mintBuyerId() { return mintToken("buyer-", 16); }
  function mintClaimNonce() { return mintToken("claim-", 8); }

  function parseClaimRecord(record) {
    if (!record || typeof record !== "object") return null;
    if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) return null;
    return {
      at: record.at,
      ownerId: typeof record.ownerId === "string" ? record.ownerId : "",
      msgId: typeof record.msgId === "string" ? record.msgId : "",
      nonce: typeof record.nonce === "string" ? record.nonce : ""
    };
  }
  function parseExclusiveClaims(raw) {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || data.version !== EXCLUSIVE_CLAIMS_VERSION) return null;
      if (!data.claims || typeof data.claims !== "object" || Array.isArray(data.claims)) return null;
      const claims = {};
      Object.keys(data.claims).forEach((id) => {
        const record = parseClaimRecord(data.claims[id]);
        if (record) claims[id] = record;
      });
      const outbox = Array.isArray(data.outbox) ? data.outbox.map((item) => {
        if (!item || typeof item.beatId !== "string") return null;
        const record = parseClaimRecord(item);
        return record ? {
          beatId: item.beatId,
          at: record.at,
          ownerId: record.ownerId,
          nonce: record.nonce,
          generation: typeof item.generation === "string" ? item.generation : ""
        } : null;
      }).filter(Boolean) : [];
      return {
        version: EXCLUSIVE_CLAIMS_VERSION,
        generation: typeof data.generation === "string" ? data.generation : "",
        buyerId: typeof data.buyerId === "string" ? data.buyerId : "",
        claims: claims,
        outbox: outbox
      };
    } catch (err) {
      return null;
    }
  }
  function readExclusiveClaims() {
    const storage = exclusiveStorage();
    if (!storage) return null;
    let raw = null;
    try {
      raw = storage.getItem(EXCLUSIVE_CLAIMS_KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    const parsed = parseExclusiveClaims(raw);
    /* A version-1 register is the old local-only test state. It is retired so
       the freshly opened global register starts clean. */
    if (!parsed) {
      try { storage.removeItem(EXCLUSIVE_CLAIMS_KEY); } catch (err) { /* ignore */ }
    }
    return parsed;
  }
  let exclusiveClaims = readExclusiveClaims() || {
    version: EXCLUSIVE_CLAIMS_VERSION,
    generation: "",
    buyerId: "",
    claims: {},
    outbox: []
  };
  if (!exclusiveClaims.buyerId) exclusiveClaims.buyerId = mintBuyerId();
  function saveExclusiveClaims() {
    const storage = exclusiveStorage();
    if (!storage) return false;
    try {
      storage.setItem(EXCLUSIVE_CLAIMS_KEY, JSON.stringify(exclusiveClaims));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* A claim shipped in `catalog.js` (rights sold outside the store) is honoured
     as a public sale — never as this browser's purchase. */
  const shippedExclusiveClaims = {};
  window.KYROlll_CATALOG.forEach((beat) => {
    if (beat && beat.exclusiveLocked) shippedExclusiveClaims[beat.id] = true;
  });
  function projectExclusiveClaims() {
    window.KYROlll_CATALOG.forEach((beat) => {
      if (!beat) return;
      const record = exclusiveClaims.claims[beat.id];
      if (record) {
        beat.exclusiveLocked = true;
        beat.exclusiveLockedAt = record.at;
        beat.exclusiveOwned = !!record.ownerId && record.ownerId === exclusiveClaims.buyerId;
        return;
      }
      if (shippedExclusiveClaims[beat.id]) {
        beat.exclusiveLocked = true;
        beat.exclusiveOwned = false;
        return;
      }
      delete beat.exclusiveLocked;
      delete beat.exclusiveLockedAt;
      delete beat.exclusiveOwned;
    });
  }
  projectExclusiveClaims();

  function announceExclusiveClaims() {
    if (typeof window.dispatchEvent !== "function" || typeof window.CustomEvent !== "function") return;
    window.dispatchEvent(new window.CustomEvent("kyrolll:exclusive-claims", {
      detail: { claims: Object.keys(exclusiveClaims.claims) }
    }));
  }
  function announceExclusiveClaim(beat) {
    if (typeof window.dispatchEvent !== "function" || typeof window.CustomEvent !== "function") return;
    window.dispatchEvent(new window.CustomEvent("kyrolll:exclusive-locked", {
      detail: { beatId: beat.id, slug: beat.slug, owned: !!beat.exclusiveOwned }
    }));
  }

  /* Earliest claim wins. `at` is the bus server time for a synced claim and the
     client's clock only while it is still in the outbox; the message id breaks
     a same-second tie deterministically. */
  function earlierClaim(candidate, current) {
    if (!current) return true;
    const a = Date.parse(candidate.at) || 0;
    const b = Date.parse(current.at) || 0;
    if (a !== b) return a < b;
    return String(candidate.msgId || candidate.nonce || "") < String(current.msgId || current.nonce || "");
  }
  function mergeExclusiveClaims(records, opts) {
    let changed = false;
    Object.keys(records || {}).forEach((id) => {
      const record = parseClaimRecord(records[id]);
      if (!record) return;
      const beat = window.KYROlll_HELPERS && window.KYROlll_HELPERS.beatById ? window.KYROlll_HELPERS.beatById(id) : null;
      if (!beat) return;
      const current = exclusiveClaims.claims[beat.id];
      if (earlierClaim(record, current)) {
        exclusiveClaims.claims[beat.id] = record;
        changed = true;
      }
    });
    if (changed) {
      saveExclusiveClaims();
      projectExclusiveClaims();
      if (!(opts && opts.silent)) announceExclusiveClaims();
    }
    return changed;
  }
  function applyExclusiveSeed(data) {
    if (!data || data.version !== EXCLUSIVE_CLAIMS_VERSION) return false;
    if (data.topic && !exclusiveBus.configuredTopic && String(data.topic) !== exclusiveBus.topic) {
      exclusiveBus.topic = String(data.topic);
      if (exclusiveBus.source) connectExclusiveBus();
    }
    const generation = typeof data.generation === "string" ? data.generation : "";
    let reset = false;
    if (generation && generation !== exclusiveClaims.generation) {
      exclusiveClaims.generation = generation;
      exclusiveClaims.claims = {};
      exclusiveClaims.outbox = [];
      reset = true;
    }
    const merged = mergeExclusiveClaims(data.claims, { silent: true });
    if (reset || merged) {
      saveExclusiveClaims();
      projectExclusiveClaims();
      announceExclusiveClaims();
      return true;
    }
    return false;
  }
  function handleBusEvent(event) {
    if (!event || event.event !== "message" || typeof event.message !== "string") return false;
    const id = typeof event.id === "string" ? event.id : "";
    if (id && exclusiveBus.seen[id]) return false;
    if (id) {
      exclusiveBus.seen[id] = true;
      exclusiveBus.seenCount += 1;
      if (exclusiveBus.seenCount > 4000) {
        exclusiveBus.seen = {};
        exclusiveBus.seenCount = 0;
      }
    }
    if (Number.isFinite(event.time) && event.time > exclusiveBus.cursor) exclusiveBus.cursor = event.time;
    let body;
    try { body = JSON.parse(event.message); } catch (err) { return false; }
    if (!body || body.type !== "claim") return false;
    /* Generation is compared strictly: a claim from before the last store-wide
       reset can never reopen a retired beat, and a client that has not loaded
       the seed yet cannot publish a generation-less claim into the register. */
    if (String(body.generation || "") !== String(exclusiveClaims.generation || "")) return false;
    if (typeof body.beatId !== "string") return false;
    const beat = window.KYROlll_HELPERS && window.KYROlll_HELPERS.beatById ? window.KYROlll_HELPERS.beatById(body.beatId) : null;
    if (!beat) return false;
    return mergeExclusiveClaims({
      [beat.id]: {
        at: new Date((Number.isFinite(event.time) ? event.time : Date.now() / 1000) * 1000).toISOString(),
        ownerId: typeof body.ownerId === "string" ? body.ownerId : "",
        msgId: id,
        nonce: typeof body.nonce === "string" ? body.nonce : ""
      }
    });
  }
  function applyBusLines(text) {
    let changed = false;
    String(text || "").split("\n").forEach((line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch (err) { return; }
      if (handleBusEvent(event)) changed = true;
    });
    return changed;
  }
  /* A claim made offline waits here and is published on the next connection.
     The bus normalises the timestamp to its own clock, so a client with a
     skewed clock cannot jump ahead of an earlier claim. */
  function flushExclusiveOutbox() {
    if (!exclusiveSync.enabled || !exclusiveBus.topic || !exclusiveClaims.outbox.length ||
        typeof window.fetch !== "function") return Promise.resolve();
    if (exclusiveBus.flushing) return exclusiveBus.flushing;
    const pending = exclusiveClaims.outbox.slice();
    const completed = {};
    const run = pending.reduce((chain, item) => chain.then(() => {
      const current = exclusiveClaims.claims[item.beatId];
      if (!current || current.nonce !== item.nonce) {
        completed[item.nonce] = true;
        return null;
      }
      return exclusiveFetch(exclusiveBus.bus + "/" + encodeURIComponent(exclusiveBus.topic), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          type: "claim",
          beatId: item.beatId,
          at: item.at,
          ownerId: item.ownerId,
          nonce: item.nonce,
          generation: item.generation || exclusiveClaims.generation
        })
      }, 6000).then((response) => {
        if (!response.ok) throw new Error("claim publish failed");
        return response.json().catch(() => null).then((info) => {
          completed[item.nonce] = true;
          if (info && info.id) {
            const live = exclusiveClaims.claims[item.beatId];
            if (live && live.nonce === item.nonce) {
              live.msgId = String(info.id);
              if (info.time) live.at = new Date(info.time * 1000).toISOString();
              saveExclusiveClaims();
              projectExclusiveClaims();
            }
          }
        });
      });
    }).catch(() => null), Promise.resolve());
    exclusiveBus.flushing = run.then(() => {
      exclusiveClaims.outbox = exclusiveClaims.outbox.filter((item) => !completed[item.nonce]);
      saveExclusiveClaims();
    }).finally(() => { exclusiveBus.flushing = null; });
    return exclusiveBus.flushing;
  }
  function syncExclusiveClaims(options) {
    if (!exclusiveSync.enabled || typeof window.fetch !== "function") {
      return Promise.resolve({ ok: false, disabled: true });
    }
    if (exclusiveBus.syncing && !(options && options.force)) return exclusiveBus.syncing;
    /* The seed is applied FIRST: it carries the current generation, and the bus
       messages are filtered against that generation. Reading both in parallel
       let a first-time visitor drop a live claim because their generation was
       still empty when the message arrived. */
    const seedRun = exclusiveFetch(exclusiveSync.seed + "?v=" + Date.now(), {
      cache: "no-store",
      headers: { Accept: "application/json" }
    }, 5000).then((response) => response.ok ? response.json() : null).then((data) => {
      if (data) applyExclusiveSeed(data);
      return !!data;
    }).catch(() => false);
    const run = seedRun.then((seedOk) => {
      const busRun = exclusiveBus.topic ? exclusiveFetch(
        exclusiveBus.bus + "/" + encodeURIComponent(exclusiveBus.topic) + "/json?poll=1&since=" +
          (exclusiveBus.cursor > 0 ? String(exclusiveBus.cursor) : "all"),
        { cache: "no-store", headers: { Accept: "application/json" } },
        5000
      ).then((response) => response.ok ? response.text() : "").then((text) => {
        applyBusLines(text);
        return !!text;
      }).catch(() => false) : Promise.resolve(false);
      return busRun.then((busOk) => {
        flushExclusiveOutbox();
        return { ok: seedOk || busOk, seed: seedOk, bus: busOk };
      });
    });
    exclusiveBus.syncing = run.finally(() => { exclusiveBus.syncing = null; });
    return exclusiveBus.syncing;
  }
  function connectExclusiveBus() {
    if (!exclusiveBus.topic || typeof window.EventSource !== "function") return;
    if (exclusiveBus.source) {
      try { exclusiveBus.source.close(); } catch (err) { /* ignore */ }
    }
    const since = exclusiveBus.cursor > 0 ? String(exclusiveBus.cursor) : "1h";
    const source = new window.EventSource(
      exclusiveBus.bus + "/" + encodeURIComponent(exclusiveBus.topic) + "/sse?since=" + since
    );
    exclusiveBus.source = source;
    source.addEventListener("message", (event) => {
      try { handleBusEvent(JSON.parse(event.data)); } catch (err) { /* ignore */ }
    });
  }
  function startExclusiveSync() {
    if (!exclusiveSync.enabled) return;
    exclusiveBus.topic = exclusiveSync.topic || EXCLUSIVE_BUS_FALLBACK_TOPIC;
    syncExclusiveClaims({ force: true }).then(() => connectExclusiveBus());
    if (typeof window.setInterval === "function") {
      exclusiveBus.pollTimer = window.setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState !== "hidden") syncExclusiveClaims();
      }, exclusiveSync.pollMs);
      exclusiveBus.seedTimer = window.setInterval(() => syncExclusiveClaims({ force: true }), exclusiveSync.seedMs);
    }
    if (typeof window.addEventListener === "function") {
      window.addEventListener("visibilitychange", () => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          syncExclusiveClaims({ force: true }).then(() => {
            if (!exclusiveBus.source || exclusiveBus.source.readyState === 2) connectExclusiveBus();
          });
        }
      });
    }
  }

  function isExclusiveLocked(beatId) {
    const beat = window.KYROlll_HELPERS.beatById(beatId);
    return !!(beat && beat.exclusiveLocked);
  }
  function isExclusiveOwned(beatId) {
    const beat = window.KYROlll_HELPERS.beatById(beatId);
    return !!(beat && beat.exclusiveLocked && beat.exclusiveOwned);
  }
  function exclusiveClaim(beatId) {
    const beat = window.KYROlll_HELPERS.beatById(beatId);
    if (!beat) return null;
    const record = exclusiveClaims.claims[beat.id];
    if (record) {
      return {
        at: record.at,
        owned: !!record.ownerId && record.ownerId === exclusiveClaims.buyerId,
        msgId: record.msgId || ""
      };
    }
    return beat.exclusiveLocked ? { at: beat.exclusiveLockedAt || "", owned: false } : null;
  }
  function lockExclusive(beatId, meta) {
    const beat = window.KYROlll_HELPERS.beatById(beatId);
    if (!beat || beat.exclusiveLocked || exclusiveClaims.claims[beat.id]) return false;
    const ownerId = (meta && meta.ownerId) || exclusiveClaims.buyerId;
    const at = new Date(timeNow()).toISOString();
    const nonce = mintClaimNonce();
    const record = { at: at, ownerId: ownerId, msgId: "", nonce: nonce };
    exclusiveClaims.claims[beat.id] = record;
    exclusiveClaims.outbox.push({
      beatId: beat.id,
      at: at,
      ownerId: ownerId,
      nonce: nonce,
      generation: exclusiveClaims.generation
    });
    beat.exclusiveLocked = true;
    beat.exclusiveLockedAt = at;
    beat.exclusiveOwned = ownerId === exclusiveClaims.buyerId;
    saveExclusiveClaims();
    announceExclusiveClaim(beat);
    flushExclusiveOutbox();
    return true;
  }
  /* A local reset is a developer/test convenience: it clears this browser's
     cache and pending outbox. The authoritative, store-wide reset is the
     GitHub Action's `reset` input, which bumps the shared generation. */
  function resetExclusiveClaims() {
    exclusiveClaims.claims = {};
    exclusiveClaims.outbox = [];
    /* Forget how far the bus was read too, so the next sync replays the shared
       register instead of resuming past the claim this reset just dropped. */
    exclusiveBus.cursor = 0;
    exclusiveBus.seen = {};
    exclusiveBus.seenCount = 0;
    saveExclusiveClaims();
    projectExclusiveClaims();
    announceExclusiveClaims();
    return true;
  }
  /* Another tab is the source of truth when it writes the claims record. The
     live catalog is re-projected and the store repaints, so a claim made in one
     tab retires the beat in every other tab without a reload. */
  if (typeof window.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (!event || event.key !== EXCLUSIVE_CLAIMS_KEY) return;
      const next = event.newValue ? parseExclusiveClaims(event.newValue) : {
        version: EXCLUSIVE_CLAIMS_VERSION,
        generation: exclusiveClaims.generation,
        buyerId: exclusiveClaims.buyerId,
        claims: {},
        outbox: []
      };
      if (!next) return;
      if (!next.buyerId) next.buyerId = exclusiveClaims.buyerId;
      exclusiveClaims = next;
      projectExclusiveClaims();
      announceExclusiveClaims();
    });
  }
  window.KYROlll_EXCLUSIVE_LOCK = {
    label: EXCLUSIVE_LOCK_LABEL,
    ownedLabel: EXCLUSIVE_OWNED_LABEL,
    note: EXCLUSIVE_LOCK_NOTE,
    ownedNote: EXCLUSIVE_OWNED_NOTE,
    button: EXCLUSIVE_LOCK_BUTTON,
    ownedButton: EXCLUSIVE_OWNED_BUTTON,
    storageKey: EXCLUSIVE_CLAIMS_KEY,
    seed: EXCLUSIVE_CLAIMS_SEED,
    topic: EXCLUSIVE_BUS_FALLBACK_TOPIC
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
    // beat has been claimed, `isExclusiveOwned` answers whether this browser is
    // the buyer, and `exclusiveClaim` returns the recorded claim. `lockExclusive`
    // marks the beat (persists it) the moment its exclusive package is signed.
    isExclusiveLocked(beatId) { return isExclusiveLocked(beatId); },
    isExclusiveOwned(beatId) { return isExclusiveOwned(beatId); },
    exclusiveClaim(beatId) { return exclusiveClaim(beatId); },
    lockExclusive(beatId, meta) { return lockExclusive(beatId, meta); },
    syncExclusiveClaims(options) { return syncExclusiveClaims(options); },
    resetExclusiveClaims() { return resetExclusiveClaims(); }
  };

  /* The bus starts after the helpers exist, so the seed and any cached bus
     events can be projected through the same resolvers every render uses. */
  startExclusiveSync();
})();
