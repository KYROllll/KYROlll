/* KYROlll — backend bridge (database-free storefront).
 *
 * One small, dependency-free client that talks to Supabase over its REST API
 * to mint a hosted NOWPayments invoice, and exposes a stable promise API:
 *
 *   KYROlll_BACKEND.payments.createInvoice   — mint a NOWPayments invoice
 *
 * The storefront holds no account, session or bearer token, and never reads or
 * writes a Supabase table. The checkout is a hosted NOWPayments invoice, and the
 * order's audit row is written server-side only by the `nowpayments-webhook`
 * Edge Function with the service_role key — the browser never holds a secret.
 *
 * When `supabase-config.js` has no project URL/key the client stays in
 * "local demo" mode: `createInvoice` reports that payments are unavailable, so
 * the storefront falls back to the static invoice links in `catalog.js`. */
(function () {
  "use strict";

  const CONFIG = window.KYROlll_SUPABASE || {};

  const CONFIGURED = !!(
    CONFIG.url &&
    CONFIG.anonKey &&
    !/YOUR-|PROJECT\.supabase|eyJhbGciOi\.\.\./.test(String(CONFIG.url) + String(CONFIG.anonKey))
  );
  const base = CONFIGURED ? String(CONFIG.url).replace(/\/+$/, "") : "";

  /* ------------------------------------------------------------------ utils */

  function readJSON(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  /* ----------------------------------------------------------- supabase rpc */

  // `apikey` only selects the project; with no Authorization header every
  // request goes out as the anonymous `anon` role. That is deliberate: the
  // storefront has no session to send, and it never touches a table.
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
    payments: { createInvoice }
  };
})();
