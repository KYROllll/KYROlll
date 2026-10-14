/* KYROlll — NOWPayments IPN webhook (Supabase Edge Function).
 *
 * NOWPayments POSTs every payment update here. The handler
 *
 *   1. verifies the `x-nowpayments-sig` header (HMAC-SHA512 over the
 *      key-sorted body, using the IPN secret),
 *   2. when `payment_status === "finished"`, inserts the license row into
 *      `public.licenses` with the **service_role** key, then
 *   3. emails the buyer their beat + license certificate through Resend.
 *
 * The store has no accounts, so a row carries no `user_id` (the column is
 * nullable — migrations/0005_licenses_email_nullable_user.sql) and instead
 * stores the buyer's `email`, taken from the `order_description` JSON that
 * `create-payment` put on the invoice. The email is optional: when the buyer
 * skipped it the row records `null` and the address lives only on the
 * NOWPayments payment (in which case delivery falls back to whatever address
 * NOWPayments collected for the invoice).
 *
 * The service_role key is what makes this the single writer: `licenses` has RLS
 * on with no policy, so no browser can read or write it, and service_role
 * bypasses RLS.
 *
 * Delivery is best-effort by design: the license row is the record of the sale,
 * so once it is written a Resend failure only logs — the handler still returns
 * 200 so NOWPayments does not replay a payment that was already recorded.
 *
 * Deploy WITHOUT JWT verification, because NOWPayments cannot present a
 * Supabase token (see supabase/config.toml):
 *
 *   supabase functions deploy nowpayments-webhook --no-verify-jwt
 *   supabase secrets set NOWPAYMENTS_IPN_SECRET=… RESEND_API_KEY=… RESEND_FROM="KYROlll <orders@kyrolll.store>"
 *
 * Required secrets: NOWPAYMENTS_IPN_SECRET, RESEND_API_KEY. Optional:
 * RESEND_FROM (default `KYROlll <onboarding@resend.dev>` — Resend's test
 * sender, which only delivers to the account owner until a domain is verified),
 * SUPPORT_EMAIL (default kyrolll00@gmail.com, used as reply-to and in the note),
 * SITE_URL (default https://www.kyrolll.store) and LICENSE_TEMPLATE_URL (default
 * `${SITE_URL}/license.html`). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
 * injected by the platform.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const IPN_SECRET = (Deno.env.get("NOWPAYMENTS_IPN_SECRET") ?? "").trim();

const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
// Resend cannot send *from* a gmail.com address — the domain has to be one you
// verified. Until `kyrolll.store` is verified the default is Resend's test
// sender, which only reaches the Resend account owner.
const RESEND_FROM = (Deno.env.get("RESEND_FROM") ?? "KYROlll <onboarding@resend.dev>").trim();
const SUPPORT_EMAIL = (Deno.env.get("SUPPORT_EMAIL") ?? "kyrolll00@gmail.com").trim();
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://www.kyrolll.store").replace(/\/+$/, "");
const LICENSE_TEMPLATE_URL = (Deno.env.get("LICENSE_TEMPLATE_URL") ?? `${SITE_URL}/license.html`).trim();

const LICENSES_TABLE = "licenses";
const BEATS_TABLE = "beats";
const BEATS_BUCKET = (Deno.env.get("BEATS_BUCKET") ?? "BEATS").trim();
// Signed download links live this long.
const DOWNLOAD_EXPIRY_SECONDS = 60 * 60;

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
  email?: string | null;
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
      if (parsed && typeof parsed === "object" && parsed.beat_id && parsed.license_type) {
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
    // No account: `user_id` is nullable and stays empty. The buyer's email (when
    // they gave one) is what lets support find the order.
    email: typeof order.email === "string" && order.email ? order.email : null,
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
    email: typeof order.email === "string" && order.email ? order.email : null,
    // `price_amount` is what the invoice asked for in USD.
    invoiced: priceAmount,
  });
}

/* -------------------------------------------------------------- delivery --- */

type Beat = { id: string; slug?: string | null; title?: string | null };

// The Storage object each tier delivers, keyed by the beat's `slug` — a mirror
// of `files[].path` in catalog.js, which the Deno function cannot read. Keep in
// step when a beat is added; an unknown slug falls back to a storefront link
// rather than a dead signed URL.
const BEAT_FILES: Record<string, Record<string, string>> = {
  flesh: {
    mp3: "flesh/KYROlll - FLESH - MP3 320kbps.mp3",
    wav: "flesh/KYROlll - FLESH - WAV 24bit.wav",
    exclusive: "flesh/KYROlll - FLESH - EXCLUSIVE.zip",
  },
};

// Human labels for the tier ids (`licenses.license_type`).
const TIER_LABELS: Record<string, string> = {
  mp3: "MP3 LEASE",
  wav: "STANDARD WAV LEASE",
  exclusive: "EXCLUSIVE LEASE",
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** The buyer's address: the order JSON first, then whatever NOWPayments
 *  collected on its own page (`customer_email` on the finished payment). */
function buyerEmail(order: OrderDescription, payload: Record<string, unknown>): string {
  const candidates = [order.email, payload.customer_email, payload.customerEmail];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

/** Title + slug for the beat being delivered. Missing rows are not fatal: the
 *  mail still goes out with a generic title and no file mapping. */
async function loadBeat(beatId: string): Promise<Beat | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${BEATS_TABLE}?select=id,slug,title&id=eq.${encodeURIComponent(beatId)}`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!response.ok) {
      console.error("KYROlll webhook: beat lookup failed", response.status, await response.text());
      return null;
    }
    const rows = await response.json();
    return Array.isArray(rows) && rows[0] ? rows[0] as Beat : null;
  } catch (err) {
    console.error("KYROlll webhook: beat lookup error", String((err as Error)?.message || err));
    return null;
  }
}

/** A 60-minute signed URL for a private Storage object, or null when the object
 *  is not mapped or signing fails. */
async function signedDownloadUrl(path: string): Promise<string | null> {
  try {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(BEATS_BUCKET)}/${encoded}`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: DOWNLOAD_EXPIRY_SECONDS }),
      },
    );
    if (!response.ok) {
      console.error("KYROlll webhook: signing the download failed", response.status, await response.text());
      return null;
    }
    const data = await response.json() as { signedURL?: string; signedUrl?: string };
    const relative = data?.signedURL ?? data?.signedUrl ?? "";
    if (!relative) return null;
    return relative.startsWith("http") ? relative : `${SUPABASE_URL}/storage/v1${relative}`;
  } catch (err) {
    console.error("KYROlll webhook: signing the download errored", String((err as Error)?.message || err));
    return null;
  }
}

function deliveryHtml(input: {
  title: string;
  tier: string;
  downloadUrl: string | null;
  licenseUrl: string;
  expiresMinutes: number;
}): string {
  const { title, tier, downloadUrl, licenseUrl, expiresMinutes } = input;
  const button = "display:inline-block;padding:14px 26px;background:#f3f3f1;color:#080809;font-size:12px;font-weight:700;letter-spacing:.16em;text-decoration:none;";
  const ghost = "display:inline-block;padding:13px 26px;border:1px solid #3a3a3f;color:#f3f3f1;font-size:12px;font-weight:700;letter-spacing:.16em;text-decoration:none;";
  const downloadBlock = downloadUrl
    ? `<a href="${escapeHtml(downloadUrl)}" style="${button}">DOWNLOAD BEAT</a>`
    : `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#96969c">Your download is being prepared — reply to this email and we will send it right away.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;background:#050505;font-family:Helvetica,Arial,sans-serif;color:#f3f3f1">
  <div style="padding:32px 16px">
    <div style="max-width:560px;margin:0 auto;border:1px solid #2a2a2e;background:#0b0b0c;padding:32px">
      <p style="margin:0 0 22px;font-size:11px;letter-spacing:.3em;color:#96969c">KYROlll</p>
      <h1 style="margin:0 0 6px;font-size:24px;letter-spacing:.02em">YOUR BEAT IS READY</h1>
      <p style="margin:0 0 26px;font-size:14px;color:#96969c">${escapeHtml(title)}</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 26px">
        <tr>
          <td style="padding:8px 0;font-size:11px;letter-spacing:.2em;color:#96969c;border-top:1px solid #2a2a2e">LICENSE</td>
          <td style="padding:8px 0;font-size:13px;text-align:right;border-top:1px solid #2a2a2e">${escapeHtml(tier)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:11px;letter-spacing:.2em;color:#96969c;border-top:1px solid #2a2a2e">DELIVERY</td>
          <td style="padding:8px 0;font-size:13px;text-align:right;border-top:1px solid #2a2a2e">VIA EMAIL</td>
        </tr>
      </table>
      ${downloadBlock}
      <p style="margin:20px 0 0"><a href="${escapeHtml(licenseUrl)}" style="${ghost}">PDF LICENSE</a></p>
      <p style="margin:26px 0 0;font-size:12px;line-height:1.7;color:#96969c">
        This link expires in ${expiresMinutes} minutes. Contact ${escapeHtml(SUPPORT_EMAIL)} if you have issues.
      </p>
    </div>
    <p style="max-width:560px;margin:16px auto 0;font-size:10px;letter-spacing:.2em;color:#5a5a60;text-align:center">KYROlll &middot; ${new Date().getFullYear()}</p>
  </div>
</body>
</html>`;
}

/** Send the beat + certificate. Throws only on a Resend error, which the caller
 *  logs without failing the webhook. */
async function sendDeliveryEmail(
  order: OrderDescription,
  beat: Beat | null,
  to: string,
): Promise<void> {
  const licenseType = String(order.license_type || "");
  const title = (beat?.title || "Your KYROlll beat").trim();
  const tier = TIER_LABELS[licenseType] || licenseType.toUpperCase();

  const slug = beat?.slug ?? "";
  const filePath = slug ? BEAT_FILES[slug]?.[licenseType] : undefined;
  const downloadUrl = filePath ? await signedDownloadUrl(filePath) : null;

  const licenseUrl = `${LICENSE_TEMPLATE_URL}?beat=${encodeURIComponent(slug || order.beat_id || "")}` +
    `&tier=${encodeURIComponent(licenseType)}` +
    `&id=${encodeURIComponent(String(order.beat_id || ""))}` +
    `&price=${encodeURIComponent(order.price == null ? "" : String(order.price))}` +
    `&email=${encodeURIComponent(to)}`;

  const html = deliveryHtml({
    title,
    tier,
    downloadUrl,
    licenseUrl,
    expiresMinutes: DOWNLOAD_EXPIRY_SECONDS / 60,
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      reply_to: SUPPORT_EMAIL,
      subject: `Your KYROlll beat — ${title}`,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the email (HTTP ${response.status}): ${await response.text()}`);
  }
  const sent = await response.json() as { id?: string };
  console.log("KYROlll webhook: delivery email sent", {
    to,
    beat: beat?.slug ?? order.beat_id,
    license_type: licenseType,
    resend_id: sent?.id ?? null,
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
  if (!order || !order.beat_id || !order.license_type) {
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

  // Delivery is best-effort: the sale is already recorded, so a mail hiccup is
  // logged and swallowed rather than turned into a 500 that would replay the
  // whole IPN.
  const to = buyerEmail(order, payload);
  if (!RESEND_API_KEY) {
    console.warn("KYROlll webhook: RESEND_API_KEY is not set — the license is recorded but no email was sent.", {
      payment_id: paymentId,
      to: to || null,
    });
  } else if (!to) {
    console.warn("KYROlll webhook: no buyer email on the order or the payment — skipping delivery.", {
      payment_id: paymentId,
    });
  } else {
    try {
      const beat = await loadBeat(String(order.beat_id));
      await sendDeliveryEmail(order, beat, to);
    } catch (err) {
      console.error("KYROlll webhook: delivery email failed (license already recorded)", {
        payment_id: paymentId,
        to,
        error: String((err && (err as Error).message) || err),
      });
    }
  }

  return json({ ok: true });
});
