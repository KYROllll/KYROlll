/* KYROlll — backend bridge (account-less store).
 *
 * One small, dependency-free client that talks to Supabase over its REST API
 * and exposes a stable promise API used by every page:
 *
 *   KYROlll_BACKEND.payments.createInvoice   — mint a NOWPayments invoice
 *   KYROlll_BACKEND.licenses.soldExclusive   — best-effort "sold exclusive" read
 *
 * There is no account, session or bearer token any more. The storefront is
 * public, the checkout is a hosted NOWPayments invoice, and the `licenses` row
 * is written only by the `nowpayments-webhook` Edge Function with the
 * service_role key — the browser never reads or writes the table beyond the
 * (currently empty) sold-exclusive lookup, and it never holds a secret.
 *
 * When `supabase-config.js` has no project URL/key the client stays in
 * "local demo" mode: `createInvoice` reports that payments are unavailable and
 * `soldExclusive` answers from the local record, so the storefront still runs
 * in preview. */
(function () {
  "use strict";

  const CONFIG = window.KYROlll_SUPABASE || {};
  const SOLD_KEY = "kyrolll_exclusive_sold";

  const CONFIGURED = !!(
    CONFIG.url &&
    CONFIG.anonKey &&
    !/YOUR-|PROJECT\.supabase|eyJhbGciOi\.\.\./.test(String(CONFIG.url) + String(CONFIG.anonKey))
  );
  const LICENSES_TABLE = (CONFIG.tables && CONFIG.tables.licenses) || "licenses";
  const base = CONFIGURED ? String(CONFIG.url).replace(/\/+$/, "") : "";

  /* ------------------------------------------------------------------ utils */

  function readJSON(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function lsGet(key) { try { return localStorage.getItem(key); } catch (err) { return null; } }

  /* ----------------------------------------------------------- supabase rpc */

  // `apikey` only selects the project; with no Authorization header every
  // request goes out as the anonymous `anon` role. That is deliberate: there is
  // no session to send, and `licenses` has RLS on with no policy, so this role
  // reads zero license rows.
  async function request(method, path, options) {
    const opts = options || {};
    const headers = { apikey: CONFIG.anonKey, Accept: "application/json" };
    let body = opts.body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof File)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    Object.assign(headers, opts.headers || {});
    console.log("KYROlll: request() →", method, base + path);
    let response;
    try {
      response = await fetch(base + path, { method, headers, body });
    } catch (netErr) {
      const msg = "Network/CORS error: " + String((netErr && netErr.message) || netErr);
      console.error("KYROlll: request() network failure for", path, msg);
      const error = new Error(msg);
      error.status = 0;
      error.network = true;
      throw error;
    }
    let data = null;
    const text = await response.text();
    if (text) data = readJSON(text, text);
    if (!response.ok) {
      console.error("KYROlll: request() ← HTTP", response.status, response.statusText, "for", method, base + path);
      console.error("KYROlll: request() error body:", text || "(empty response body)");
      const message = (data && (data.msg || data.message || data.error_description || data.error || data.hint)) || response.statusText;
      const error = new Error(String(message || "Request failed"));
      error.status = response.status;
      error.code = data && (data.error_code || data.code);
      error.body = text;
      throw error;
    }
    return data;
  }

  /* --------------------------------------------------------------- licenses */

  function localSold() { return readJSON(lsGet(SOLD_KEY), []) || []; }

  /* Beats sold on an exclusive license. The local record is the whole answer
   * today — `licenses` is locked down (RLS on, no policy), so the anonymous read
   * returns zero rows — but the query is kept as a best-effort so a project that
   * ever exposes a public `beat_id` policy lights the site-wide lock up with no
   * code change. Never throws. */
  async function soldExclusive() {
    const ids = new Set(localSold());
    if (!CONFIGURED) return Array.from(ids);
    try {
      const rows = await request(
        "GET",
        "/rest/v1/" + LICENSES_TABLE + "?select=beat_id&license_type=eq.exclusive&status=eq.active"
      );
      (rows || []).forEach((row) => { if (row.beat_id) ids.add(row.beat_id); });
    } catch (err) { /* not readable here — the local answer still stands */ }
    return Array.from(ids);
  }

  /* --------------------------------------------------------------- payments */

  /* Ask the `create-payment` Edge Function for a NOWPayments invoice. The
   * function prices the order server-side (a price sent from the browser is
   * never trusted) and returns `{ url }` — the hosted invoice page. The email is
   * optional: when present it is pre-filled on the invoice and carried in the
   * order JSON so the webhook can deliver the files; when absent NOWPayments
   * collects one on its own page. */
  async function createInvoice(input) {
    if (!CONFIGURED) throw new Error("SUPABASE NOT CONFIGURED");
    const beatId = input && input.beatId;
    const licenseType = input && input.licenseType;
    const email = String((input && input.email) || "").trim();
    if (!beatId || !licenseType) throw new Error("MISSING LICENSE SELECTION");
    const payload = { beat_id: beatId, license_type: licenseType };
    if (email) payload.email = email;
    return request("POST", "/functions/v1/create-payment", { body: payload });
  }

  window.KYROlll_BACKEND = {
    configured: CONFIGURED,
    mode: CONFIGURED ? "supabase" : "local",
    licenses: { soldExclusive },
    payments: { createInvoice }
  };
})();
