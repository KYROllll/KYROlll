/* KYROlll — create a NOWPayments invoice (Supabase Edge Function).
 *
 * The storefront is account-less, so this endpoint is public: the visitor picks
 * a tier, optionally types a delivery email, and this function mints the hosted
 * invoice. There is no bearer to verify any more.
 *
 *   POST /functions/v1/create-payment
 *   { "beat_id": "<uuid>", "license_type": "mp3" | "wav" | "exclusive", "email": "buyer@example.com" }
 *
 * It resolves the price **server-side** (a price sent from the browser is never
 * trusted), checks the beat exists, and asks NOWPayments for a hosted invoice.
 * The returned `invoice_url` is where the browser goes.
 *
 * The order identity is embedded in `order_description` as a JSON string —
 * exactly the shape the `nowpayments-webhook` function reads back:
 *
 *   {"email":"buyer@example.com","beat_id":"…","license_type":"mp3","price":9.95}
 *
 * `email` is optional: when the buyer skips the step it is `null` here and
 * NOWPayments collects one on its own page. When present it is also sent as
 * `customer_email` so the invoice is pre-filled, and the webhook stores it on
 * the license row so support can find the order.
 *
 * This function never touches `licenses`; the webhook is the only writer.
 *
 * Deploy WITHOUT JWT verification — there is no signed-in user to present a
 * token (see supabase/config.toml):
 *   supabase functions deploy create-payment --no-verify-jwt
 *   supabase secrets set NOWPAYMENTS_API_KEY=…
 *
 * Optional secrets: SITE_URL (success/cancel redirects, defaults to the
 * storefront's public domain). SUPABASE_URL and SUPABASE_ANON_KEY are injected.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const NOWPAYMENTS_API_KEY = Deno.env.get("NOWPAYMENTS_API_KEY") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://www.kyrolll.store").replace(/\/+$/, "");

// Server-side price list. This is the source of truth for what a buyer is
// charged — a price sent from the browser is never trusted. Keep it in step
// with `catalog.js` (KYROlll_LICENSES[].priceValue).
const PRICES: Record<string, number> = {
  mp3: 9.95,
  wav: 14.95,
  exclusive: 299.95,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "POST") {
    return json({ error: "METHOD NOT ALLOWED" }, 405);
  }
  if (!NOWPAYMENTS_API_KEY) {
    return json({ error: "PAYMENTS NOT CONFIGURED" }, 500);
  }

  // 1. What are they buying? Everything comes from the request body — there is
  //    no signed-in user; the price is resolved below, never read from here.
  let body: { beat_id?: unknown; license_type?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID JSON" }, 400);
  }
  const beatId = typeof body.beat_id === "string" ? body.beat_id : "";
  const licenseType = typeof body.license_type === "string" ? body.license_type : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!UUID_RE.test(beatId)) return json({ error: "INVALID BEAT ID" }, 400);
  if (!Object.prototype.hasOwnProperty.call(PRICES, licenseType)) {
    return json({ error: "INVALID LICENSE TYPE" }, 400);
  }
  // The email is optional, but a *malformed* one is rejected rather than
  // silently dropped, so the buyer never thinks delivery is on when it is not.
  if (email && !EMAIL_RE.test(email)) return json({ error: "INVALID EMAIL" }, 400);

  const price = PRICES[licenseType];

  // 2. The beat must exist — `licenses.beat_id` references `public.beats`, so
  //    selling a beat that is not in the table could only produce a failed
  //    webhook insert later.
  const beatResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/beats?select=id&id=eq.${encodeURIComponent(beatId)}`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
  );
  if (beatResponse.ok) {
    const beats = await beatResponse.json();
    if (!Array.isArray(beats) || beats.length === 0) {
      return json({ error: "UNKNOWN BEAT" }, 404);
    }
  }

  // 3. Create the hosted invoice. `order_description` is the JSON the webhook
  //    reads back (exactly the order identity). `customer_email` pre-fills the
  //    invoice when the buyer gave us one. `order_id` stays short and uses only
  //    the characters NOWPayments documents (alphanumerics and `-`) — it just
  //    labels the invoice in the dashboard, and the webhook falls back to it
  //    only if `order_description` is unreadable.
  const description = JSON.stringify({
    email: email || null,
    beat_id: beatId,
    license_type: licenseType,
    price,
  });

  const invoiceBody: Record<string, unknown> = {
    price_amount: price,
    price_currency: "USD",
    order_id: `${beatId}-${licenseType}`,
    order_description: description,
    ipn_callback_url: `${SUPABASE_URL}/functions/v1/nowpayments-webhook`,
    success_url: `${SITE_URL}/success.html`,
    cancel_url: `${SITE_URL}/index.html`,
  };
  if (email) invoiceBody.customer_email = email;

  const invoiceResponse = await fetch("https://api.nowpayments.io/v1/invoice", {
    method: "POST",
    headers: {
      "x-api-key": NOWPAYMENTS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(invoiceBody),
  });

  const invoiceText = await invoiceResponse.text();
  let invoice: Record<string, unknown> = {};
  try {
    invoice = invoiceText ? JSON.parse(invoiceText) : {};
  } catch {
    invoice = { raw: invoiceText };
  }

  if (!invoiceResponse.ok) {
    console.error("KYROlll create-payment: NOWPayments rejected the invoice", invoiceResponse.status, invoiceText);
    return json({ error: "COULD NOT CREATE INVOICE" }, 502);
  }

  const url = invoice.invoice_url ?? invoice.invoiceUrl ?? "";
  if (!url) {
    console.error("KYROlll create-payment: NOWPayments returned no invoice_url", invoiceText);
    return json({ error: "NO INVOICE URL" }, 502);
  }

  return json({ url, invoice_id: invoice.id ?? null, price, license_type: licenseType });
});
