/* KYROlll — shared catalog and free download packages.
 *
 * Loaded by every page so the store, the download menu and the download page
 * all agree on the same beats, packages and files. It is plain data plus tiny
 * helpers, with no DOM access, so it is safe to include before anything else.
 *
 * Every beat is 100% free. There is no cart, no checkout and no payment
 * gateway: each package either downloads instantly or is unlocked behind a
 * lightweight gate (a YouTube subscribe + like, or an email — see
 * `downloads.js`). */
(function () {
  "use strict";

  // Where the "subscribe" step sends the visitor. `?sub_confirmation=1` makes
  // YouTube show its own subscribe prompt on arrival, so one click both opens
  // the channel and asks to subscribe.
  window.KYROlll_YOUTUBE_CHANNEL = "https://www.youtube.com/@KYROllllll?sub_confirmation=1";

  // Where the email gate delivers a new subscriber. The endpoint is a form POST
  // URL — the gate posts to it through a hidden iframe, so the page never
  // navigates. Formspree is wired up here; any provider that accepts a form POST
  // (Buttondown's embed endpoint, a Beehiiv subscribe form, …) works by putting
  // its action URL in `endpoint` (or, for Buttondown, just its `username`). Left
  // blank, the gate still unlocks the files and only remembers the address
  // locally.
  window.KYROlll_NEWSLETTER = { provider: "formspree", username: "", endpoint: "https://formspree.io/f/xgaoppwo" };

  // The three free ways a beat leaves the store. `gate` is the initial behaviour:
  //   "email"    → Email input + submit → instant unlock + PDF.
  //   "youtube"  → YouTube Sub & Like (two steps), then Email input + submit → unlock + PDF.
  //   "exclusive"→ YouTube Sub & Like → Comment verification → Email with mandatory opt-in
  //     checkbox → submit → unlock Stems+MP3+WAV+PDF. No signature prompt.
  // `includes` is the plain-language list of what the package hands over; it is
  // printed in the generated license (see `downloads.js`).
  window.KYROlll_PACKAGES = [
    {
      id: "mp3",
      name: "MP3 LEASE",
      tag: "EMAIL GATE",
      gate: "email",
      blurb: "Enter your email to unlock instant download.",
      includes: ["Tagged MP3 audio file", "Free license"]
    },
    {
      id: "wav",
      name: "STANDARD WAV LEASE",
      tag: "SUBSCRIBE + LIKE",
      gate: "youtube",
      blurb: "Tagged MP3 + high-quality WAV + license. Subscribe, like, and enter your email to unlock.",
      includes: ["Tagged MP3 audio file", "High-quality WAV", "Free license"]
    },
    {
      id: "exclusive",
      name: "EXCLUSIVE / PRO PACKAGE",
      tag: "MULTI-STEP",
      gate: "exclusive",
      blurb: "Full stems + MP3 + WAV + license. Follow YouTube, comment, and email steps to unlock.",
      includes: [
        "Tagged MP3 audio file",
        "High-quality WAV",
        "Tracked stems",
        "Full rights / license",
        "Email opt-in for future drops"
      ]
    }
  ];

  // `id` is the beat's uuid and `slug` is the stable human handle kept for old
  // links (`?beat=flesh`); the helpers resolve either. `youtube` is the beat's
  // own video (used by the Standard WAV gate's "like this video" step).
  //
  // `deliverables` maps a package to the files the download page hands over:
  // each entry is `{ file, name, label }`, a same-origin `file`, the `name` the
  // browser saves it as and the `label` shown on the download page. The license
  // is not listed here — the download page always generates one.
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
          { file: "assets/previews/flesh.mp3", name: "KYROlll - FLESH (MP3 320kbps).mp3", label: "TAGGED MP3" }
        ],
        wav: [
          { file: "assets/previews/flesh.mp3", name: "KYROlll - FLESH (MP3 320kbps).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/flesh.wav", name: "KYROlll - FLESH (WAV 24-bit).wav", label: "HIGH-QUALITY WAV" }
        ],
        exclusive: [
          { file: "assets/previews/flesh.mp3", name: "KYROlll - FLESH (MP3 320kbps).mp3", label: "TAGGED MP3" },
          { file: "assets/previews/flesh.wav", name: "KYROlll - FLESH (WAV 24-bit).wav", label: "HIGH-QUALITY WAV" },
          { file: "assets/previews/flesh-stems.zip", name: "KYROlll - FLESH (TRACKED STEMS).zip", label: "TRACKED STEMS" }
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
