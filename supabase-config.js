/* Public Supabase configuration for the KYROIII storefront.
   Only the project URL and the publishable (anon) key belong here — never a
   secret/service-role key. The URL is the only value that still needs to be
   filled in: replace the placeholder below with your project's API URL
   (https://<project-ref>.supabase.co). The publishable key is already set.
   An existing window.KYROlll_SUPABASE (injected earlier) wins, and
   ?sb_url=... overrides the URL for local testing. */
(function () {
  "use strict";
  var existing = (window.KYROlll_SUPABASE && typeof window.KYROlll_SUPABASE === "object")
    ? window.KYROlll_SUPABASE : {};
  var injected = !!(existing && existing.url);
  var cfg = {
    url: existing.url || "https://sdvvaqbajnmgyjvtbzeo.supabase.co",
    anonKey: existing.anonKey || "sb_publishable_bn62aZqI4CdDoIzO5O88AA_Gentr2E3"
  };
  var overridden = false;
  try {
    var q = new URLSearchParams(window.location.search);
    if (q.get("sb_url")) { cfg.url = q.get("sb_url"); overridden = true; }
    if (q.get("sb_key")) cfg.anonKey = q.get("sb_key");
  } catch (e) { /* ignore */ }
  /* Match the exclusive-claims bus: on a local preview (localhost, 127.0.0.1,
     ::1, file:) Supabase verification is off unless it is explicitly enabled
     via ?sb_url=... or an injected window.KYROlll_SUPABASE, so the store's
     tests and local previews keep the original email → sign flow. */
  var isLocal = false;
  try {
    isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(location.hostname) || location.protocol === "file:";
  } catch (e) { isLocal = false; }
  if (isLocal && !overridden && !injected) {
    cfg.url = "";
  }
  window.KYROlll_SUPABASE = cfg;
})();
