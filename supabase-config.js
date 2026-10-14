/* KYROlll — Supabase configuration.
 *
 * Fill in `url` and `anonKey` from your Supabase project
 * (Project Settings → API). The anon/publishable key is designed to be public
 * in a static site: the key is used only to call the public `create-payment`
 * Edge Function, which mints a hosted NOWPayments invoice. The browser never
 * reads or writes a Supabase table.
 *
 * While `url`/`anonKey` are empty the store runs in "local demo" mode: no
 * request leaves the browser and the checkout falls back to the static
 * invoice links in `catalog.js`, so the preview works with no project attached.
 *
 * Optional: set `window.KYROlll_SUPABASE` before this script to override any
 * value without editing the file (e.g. from a build step).
 */
window.KYROlll_SUPABASE = Object.assign({
  url: "https://vuryglxywrqdnvnbelvp.supabase.co",
  anonKey: "sb_publishable_18muoQ1bmxrySKBpY9uI5g_CqvDrQWw",
  // Storage bucket that holds the downloadable masters. Files are delivered by
  // the webhook/email, not downloaded from the browser.
  buckets: { beats: "BEATS" }
}, window.KYROlll_SUPABASE || {});
