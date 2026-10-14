/* KYROlll — shared catalog and license tiers.
 *
 * Loaded by every page so the store, the license dropdown, the success page
 * and the library all agree on the same beats, tiers, prices, checkout links
 * and Supabase Storage object paths. It is plain data plus tiny helpers, with
 * no DOM access, so it is safe to include before anything else. */
(function () {
  "use strict";

  // The three official tiers and their NOWPayments hosted invoices. `rights`
  // is the plain-language grant printed onto the generated PDF license.
  window.KYROlll_LICENSES = [
    {
      id: "mp3",
      name: "MP3 LEASE",
      price: "$9.95",
      priceValue: 9.95,
      blurb: "Tagged MP3 + PDF license",
      url: "https://nowpayments.io/payment/?iid=5704655234",
      rights: [
        "Non-exclusive lease of the tagged MP3.",
        "Distribute up to 5,000 copies.",
        "Up to 50,000 audio streams.",
        "One music video.",
        "Non-profit live performances."
      ]
    },
    {
      id: "wav",
      name: "STANDARD WAV LEASE",
      price: "$14.95",
      priceValue: 14.95,
      blurb: "Untagged WAV + MP3 + PDF license",
      url: "https://nowpayments.io/payment/?iid=5611617128",
      rights: [
        "Non-exclusive lease of the untagged WAV and MP3.",
        "Distribute up to 10,000 copies.",
        "Up to 500,000 audio streams.",
        "Unlimited music videos.",
        "Paid live performances."
      ]
    },
    {
      id: "exclusive",
      name: "EXCLUSIVE LEASE",
      price: "$299.95",
      priceValue: 299.95,
      blurb: "Full exclusive rights + stems",
      url: "https://nowpayments.io/payment/?iid=4868491664",
      rights: [
        "Exclusive, unlimited commercial use.",
        "Unlimited distribution and streams.",
        "Broadcast, sync and paid performance rights.",
        "Tracked-out stems on request.",
        "Any prior lease of this beat is replaced."
      ]
    }
  ];

  // `id` is the beat's uuid and must match `public.beats.id` — a license's
  // `beat_id` is a foreign key into that table, and the webhook writes whatever
  // uuid the checkout carried. `slug` is the stable human handle kept for old
  // links (`?beat=flesh`); the helpers resolve either.
  //
  // `files` maps a tier to its Supabase Storage object (`path`), the filename a
  // buyer downloads (`name`) and a same-origin `fallback` used in local demo
  // mode or if the bucket object is missing.
  window.KYROlll_CATALOG = [
    {
      id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
      slug: "flesh",
      title: "[FREE] DON TOLIVER TYPE BEAT - FLESH",
      img: "assets/flesh.png",
      bpm: 130,
      key: "Am",
      preview: "assets/previews/BEAT 1 TAG.wav",
      downloadName: "KYROlll - FLESH",
      files: {
        mp3: {
          path: "flesh/KYROlll - FLESH - MP3 320kbps.mp3",
          name: "KYROlll - FLESH (MP3 320kbps).mp3",
          fallback: "assets/previews/flesh.mp3"
        },
        wav: {
          path: "flesh/KYROlll - FLESH - WAV 24bit.wav",
          name: "KYROlll - FLESH (WAV 24bit).wav",
          fallback: 'assets/previews/DON TOLIVER TYPE BEAT - "FLESH" - BPM 130 - KEY Am TAG.wav'
        },
        exclusive: {
          path: "flesh/KYROlll - FLESH - EXCLUSIVE.zip",
          name: "KYROlll - FLESH (EXCLUSIVE).zip",
          fallback: 'assets/previews/DON TOLIVER TYPE BEAT - "FLESH" - BPM 130 - KEY Am TAG.wav'
        }
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
    licenseById(id) {
      return window.KYROlll_LICENSES.find((license) => license.id === id) || null;
    },
    fileFor(beatId, tierId) {
      const beat = window.KYROlll_HELPERS.beatById(beatId);
      return (beat && beat.files && beat.files[tierId]) || null;
    }
  };
})();
