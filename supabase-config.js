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
 * switches to Supabase Auth (with email confirmation), Storage and Postgres.
 *
 * Optional: set `window.KYROLLL_SUPABASE` before this script to override any
 * value without editing the file (e.g. from a build step).
 */
window.KYROLLL_SUPABASE = Object.assign({
  url: "",
  anonKey: "",
  // Storage buckets. `beats` holds the downloadable masters; `avatars` holds
  // profile pictures. Keep the names in step with your Supabase Storage.
  buckets: { beats: "BEATS", avatars: "avatars" },
  // Table that records permanent licenses (see the SQL in AGENTS.md).
  tables: { licenses: "licenses" }
}, window.KYROLLL_SUPABASE || {});
