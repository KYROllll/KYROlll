/* KYROlll — Supabase configuration.
 *
 * Fill in `url` and `anonKey` from your Supabase project
 * (Project Settings → API). The anon key is designed to be public in a static
 * site; row-level security and storage policies are what protect the data.
 *
 *   url:     "https://YOUR-PROJECT.supabase.co"
 *   anonKey: "eyJhbGciOi..."   (the "anon public" key)
 *
 * While these stay empty the whole store runs in "local demo" mode: accounts,
 * libraries and licenses are kept in this browser only, so the preview works
 * with no Supabase project attached. As soon as both values are set every page
 * switches to Supabase Auth (with emailed one-time codes), Storage and Postgres.
 *
 * Optional: set `window.KYROlll_SUPABASE` before this script to override any
 * value without editing the file (e.g. from a build step).
 */
window.KYROlll_SUPABASE = Object.assign({
  url: "https://vuryglxywrqdnvnbelvp.supabase.co",
  anonKey: "sb_publishable_18muoQ1bmxrySKBpY9uI5g_CqvDrQWw",
  // Storage buckets. `beats` holds the downloadable masters; `avatars` holds
  // profile pictures. Keep the names in step with your Supabase Storage.
  buckets: { beats: "BEATS", avatars: "avatars" },
  // Table that records permanent licenses (see the SQL in AGENTS.md).
  tables: { licenses: "licenses" },
  // Digits in the emailed one-time code. Keep it in step with the project's
  // "Email OTP Length" (Supabase dashboard → Authentication → Providers →
  // Email, env `GOTRUE_MAILER_OTP_LENGTH`). Brand-new projects default to 8;
  // KYROlll pins its project to 6 with `set-otp-length.mjs`, which defaults to
  // 6 to match. The auth page renders exactly this many digits in the code
  // input and the OTP request asks for it.
  otpLength: 6
}, window.KYROlll_SUPABASE || {});
