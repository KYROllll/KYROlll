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
  var cfg = {
    url: existing.url || "[PASTE YOUR REAL PROJECT URL]",
    anonKey: existing.anonKey || "sb_publishable_bn62aZqI4CdDoIzO5O88AA_Gentr2E3"
  };
  try {
    var q = new URLSearchParams(window.location.search);
    if (q.get("sb_url")) cfg.url = q.get("sb_url");
    if (q.get("sb_key")) cfg.anonKey = q.get("sb_key");
  } catch (e) { /* ignore */ }
  window.KYROlll_SUPABASE = cfg;
})();
