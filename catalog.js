/* KYROIII — shared catalog and free download packages.
 *
 * Loaded by every page so the store, the download menu and the download page
 * all agree on the same beats, packages and files. It is plain data plus tiny
 * helpers, with no DOM access, so it is safe to include before anything else.
 *
 * Every beat is 100% free. There is no cart, no checkout and no payment
 * gateway: every package is unlocked behind a lightweight gate (an email, plus
 * a YouTube subscribe + like for the WAV and the exclusive — see
 * `downloads.js`). Every gate then closes with a REVIEW & SIGN stage, and the
 * signature captured there is stamped into the PDF license. Nothing is written
 * down, so a fresh visit asks again; only the current page view remembers a
 * package it already unlocked. */
(function () {
  "use strict";

  // Where the "subscribe" step sends the visitor. `?sub_confirmation=1` makes
  // YouTube show its own subscribe prompt on arrival, so one click both opens
  // the channel and asks to subscribe.
  window.KYROlll_YOUTUBE_CHANNEL = "https://www.youtube.com/@KYROllllll?sub_confirmation=1";

  // Where the email gate delivers a new subscriber. The gate `fetch`es this URL
  // with `Accept: application/json`, so the submission is recorded by the
  // provider instead of navigating the page. Formspree is wired up here; any
  // provider that accepts a form POST and answers with CORS (Buttondown's embed
  // endpoint, a Beehiiv subscribe form, …) works by putting its action URL in
  // `endpoint` (or, for Buttondown, just its `username`). Left blank, the gate
  // still unlocks the files and sends nothing.
  window.KYROlll_NEWSLETTER = { provider: "formspree", username: "", endpoint: "https://formspree.io/f/xgaoppwo" };

  // The three free ways a beat leaves the store. `gate` is the whole behaviour:
  //   "email"    → Email input + mandatory opt-in → submit → REVIEW & SIGN → files + PDF.
  //   "youtube"  → YouTube Sub & Like (two verified steps), then the same email
  //     form → REVIEW & SIGN → files + PDF.
  //   "exclusive"→ the same two YouTube steps as the WAV, then the same email
  //     form (mandatory opt-in) → REVIEW & SIGN → Stems+MP3+WAV+PDF.
  // `includes` is the plain-language list of what the package hands over; it is
  // printed in the generated license (see `downloads.js`).
  window.KYROlll_PACKAGES = [
    {
      id: "mp3",
      name: "MP3 LEASE",
      tag: "EMAIL GATE",
      gate: "email",
      blurb: "ENTER YOUR EMAIL TO UNLOCK THE DOWNLOAD INSTANTLY.",
      includes: ["TAGGED MP3 AUDIO FILE", "FREE LICENSE"]
    },
    {
      id: "wav",
      name: "STANDARD WAV LEASE",
      tag: "SUBSCRIBE + LIKE",
      gate: "youtube",
      blurb: "TAGGED MP3 + HIGH-QUALITY WAV + LICENSE. SUBSCRIBE, LIKE, AND ENTER YOUR EMAIL TO UNLOCK.",
      includes: ["TAGGED MP3 AUDIO FILE", "HIGH-QUALITY WAV", "FREE LICENSE"]
    },
    {
      id: "exclusive",
      name: "EXCLUSIVE / PRO PACKAGE",
      tag: "MULTI-STEP",
      gate: "exclusive",
      blurb: "FULL STEMS + MP3 + WAV + LICENSE. SUBSCRIBE, LIKE, AND ENTER YOUR EMAIL TO UNLOCK.",
      includes: [
        "TAGGED MP3 AUDIO FILE",
        "HIGH-QUALITY WAV",
        "TRACKED STEMS",
        "FULL RIGHTS / LICENSE",
        "EMAIL OPT-IN FOR FUTURE DROPS"
      ]
    }
  ];

  // `id` is the beat's uuid and `slug` is the stable human handle kept for old
  // links (`?beat=flesh`); the helpers resolve either. `youtube` is the beat's
  // own video (used by the Standard WAV gate's "like this video" step).
  //
  // `deliverables` maps a package to the files the download page hands over:
  // each entry is `{ file, name, label }`, a same-origin `file`, the `name` the
  // browser saves it as and the `label` shown on the download page. The `name`
  // below is the fallback; `downloads.js` re-derives every hand-over from the
  // beat's own metadata as `KYROIII - <BEAT> (<BPM> BPM - <KEY>).<ext>`, so an
  // engineer can read the tempo and key straight off the filename. Only the
  // extension is lowercase, so the file the visitor keeps is still a normal
  // `.mp3`/`.wav`. The license is not listed here — the download page always
  // generates one.
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
      /* A scheduled drop: this beat is locked — countdown badge on the card, no
         player and no drawer — until the store's clock reaches `releaseAt`, the
         moment script.js swaps the card for the playable one in page. The label
         is what the badge and the locked trigger say. */
      releaseAt: "2026-10-19T23:00:00+03:00",
      releaseLabel: "DROPPING TODAY AT 23:00",
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
    }
  ];

  /* ---------------------------------------------------------- release clock
     A beat may carry `releaseAt` (an ISO timestamp with its own offset). Until
     that instant it is a *scheduled drop*: the store paints it with a live
     countdown and a locked download trigger, and flips it to the full player the
     second the clock reaches zero — in page, with no reload.
     The clock accepts an override so a test (or a preview link) can stand at any
     moment without waiting: set `window.KYROlll_NOW` to an ISO string or an epoch
     before this file loads, or append `?now=<iso|epoch>` to the URL. The override
     is read once, as a fixed instant, and then advances with real time — so a
     countdown genuinely counts down instead of freezing. */
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
  /* True when the beat has no schedule or its instant has passed. */
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
  /* HH:MM:SS, the countdown the badge ticks every second. */
  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000));
    const pad = (n) => ("0" + n).slice(-2);
    return pad(Math.floor(total / 3600)) + ":" + pad(Math.floor((total % 3600) / 60)) + ":" + pad(total % 60);
  }
  function releaseLabel(beat) {
    if (!beat || releaseAtMs(beat) == null) return "";
    return beat.releaseLabel || "DROPPING SOON";
  }

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
      return window.KYROlll_CATALOG.find((beat) => beat.id === key || beat.slug === key) || null;
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
    // The beat's own video, or the channel as a last resort, so the "like"
    // step always has somewhere real to point.
    videoFor(beatId) {
      const beat = window.KYROlll_HELPERS.beatById(beatId);
      return (beat && beat.youtube) || window.KYROlll_YOUTUBE_CHANNEL;
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
    releaseLabel: releaseLabel
  };
})();
