/* KYROlll — NOWPayments IPN webhook (Supabase Edge Function).
 *
 * NOWPayments POSTs every payment update here. The handler
 *
 *   1. verifies the `x-nowpayments-sig` header (HMAC-SHA512 over the
 *      key-sorted body, using the IPN secret), then
 *   2. when `payment_status === "finished"`, inserts the license row into
 *      `public.licenses` with the **service_role** key.
 *
 * The service_role key is what makes this the single writer: the table has a
 * SELECT-only RLS policy (migrations/0003_licenses_webhook.sql), so no browser
 * can insert a license, and service_role bypasses RLS. The row's `user_id` and
 * `beat_id` come from the `order_description` JSON that `create-payment` put on
 * the invoice — which itself was built from a verified JWT, never from the
 * client's request body.
 *
 * Deploy WITHOUT JWT verification, because NOWPayments cannot present a
 * Supabase token (see supabase/config.toml):
 *
 *   supabase functions deploy nowpayments-webhook --no-verify-jwt
 *   supabase secrets set NOWPAYMENTS_IPN_SECRET=… 
 *
 * Required secrets: NOWPAYMENTS_IPN_SECRET. SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const IPN_SECRET = (Deno.env.get("NOWPAYMENTS_IPN_SECRET") ?? "").trim();

const LICENSES_TABLE = "licenses";

/* ------------------------------------------------------------- signature --- */

/** Rebuild the exact bytes NOWPayments signs: the body with every object's
 *  keys sorted alphabetically (recursively), serialized with no extra
 *  whitespace. */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Constant-time-ish HMAC-SHA512 verification via WebCrypto (`verify` compares
 *  in the crypto implementation rather than with a JS `===`). */
async function signatureIsValid(body: string, header: string): Promise<boolean> {
  if (!IPN_SECRET || !header) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }
  let signature: Uint8Array;
  try {
    signature = hexToBytes(header);
  } catch {
    return false;
  }
  if (signature.length === 0) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(IPN_SECRET),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(canonicalize(payload)),
  );
}

/* ---------------------------------------------------------------- helpers --- */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type OrderDescription = {
  user_id?: string;
  beat_id?: string;
  license_type?: string;
  price?: number;
};

function parseOrder(description: unknown, orderId: unknown): OrderDescription | null {
  const candidates = [description, orderId];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && parsed.user_id && parsed.beat_id) {
        return parsed as OrderDescription;
      }
    } catch {
      /* not our JSON — try the next candidate */
    }
  }
  return null;
}

async function insertLicense(order: OrderDescription, paymentId: string, priceAmount: unknown): Promise<void> {
  const row = {
    user_id: order.user_id,
    beat_id: order.beat_id,
    license_type: order.license_type,
    price: typeof order.price === "number" ? order.price : Number(order.price),
    payment_id: paymentId,
    status: "active",
  };
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${LICENSES_TABLE}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        // IPNs are retried; payment_id is unique, so a retry is a clean no-op.
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`licenses insert failed (HTTP ${response.status}): ${detail}`);
  }
  console.log("KYROlll webhook: license recorded", {
    payment_id: paymentId,
    beat_id: order.beat_id,
    license_type: order.license_type,
    // `price_amount` is what the invoice asked for in USD.
    invoiced: priceAmount,
  });
}

/* ----------------------------------------------------------------- handler -- */

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "METHOD NOT ALLOWED" }, 405);
  }

  const body = await request.text();
  const signature = request.headers.get("x-nowpayments-sig") ?? "";

  if (!IPN_SECRET) {
    console.error("KYROlll webhook: NOWPAYMENTS_IPN_SECRET is not set — refusing the callback.");
    return json({ error: "WEBHOOK NOT CONFIGURED" }, 500);
  }
  if (!(await signatureIsValid(body, signature))) {
    console.warn("KYROlll webhook: rejected an IPN with an invalid signature.");
    return json({ error: "INVALID SIGNATURE" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "INVALID JSON" }, 400);
  }

  // Every other status (waiting, confirming, confirmed, sending, partially_paid,
  // failed, refunded, expired) is acknowledged and ignored — only a finished
  // payment mints a license.
  if (payload.payment_status !== "finished") {
    return json({ ok: true, ignored: payload.payment_status ?? null });
  }

  const paymentId = payload.payment_id != null ? String(payload.payment_id) : "";
  if (!paymentId) {
    console.warn("KYROlll webhook: a finished payment arrived without a payment_id.");
    return json({ error: "MISSING PAYMENT ID" }, 400);
  }

  const order = parseOrder(payload.order_description, payload.order_id);
  if (!order || !order.user_id || !order.beat_id || !order.license_type) {
    console.error("KYROlll webhook: could not read the order JSON off the payment.", { payment_id: paymentId });
    return json({ error: "MISSING ORDER" }, 400);
  }

  // A signed payload still has to have paid what we asked: a finished payment
  // whose price_amount is less than the invoice's price is not a sale. (The
  // signature proves NOWPayments sent it; this guards the *amount*.)
  const expected = Number(order.price);
  const invoiced = Number(payload.price_amount);
  if (Number.isFinite(expected) && Number.isFinite(invoiced) && invoiced + 0.01 < expected) {
    console.warn("KYROlll webhook: underpaid invoice — refusing the license.", {
      payment_id: paymentId,
      invoiced,
      expected,
    });
    return json({ error: "PRICE MISMATCH" }, 400);
  }

  try {
    await insertLicense(order, paymentId, payload.price_amount);
  } catch (err) {
    // 500 tells NOWPayments to retry the IPN, which is exactly what we want
    // when the write failed.
    console.error("KYROlll webhook:", String((err && (err as Error).message) || err));
    return json({ error: "INSERT FAILED" }, 500);
  }

  return json({ ok: true });
});
