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
      title: "[FREE] DON TOLIVER TYPE BEAT - FLESH",
      img: "assets/flesh.png",
      bpm: 130,
      key: "Am",
      preview: "assets/previews/BEAT 1 TAG.wav",
      youtube: "https://youtu.be/8OhRJQn2YCU",
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
    }
  ];

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
    }
  };
})();
