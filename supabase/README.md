# KYROlll payments — Supabase setup

The purchase path is: **BUY → `create-payment` → NOWPayments invoice →
`nowpayments-webhook` → `licenses` row → library**.

The browser never writes a license. The table has a SELECT-only RLS policy, and
the webhook is the single writer (service_role).

```
storefront BUY
   │  POST /functions/v1/create-payment   (Bearer: buyer's token)
   ▼
create-payment  ── verifies the token, resolves the price, builds
   │               order_description = {user_id, beat_id, license_type, price}
   │  POST https://api.nowpayments.io/v1/invoice
   ▼
NOWPayments hosted invoice  ── redirects the browser to success_url
   │  POST /functions/v1/nowpayments-webhook   (x-nowpayments-sig)
   ▼
nowpayments-webhook ── verifies the HMAC, and on payment_status "finished"
   │                    inserts the row with the service_role key
   ▼
public.licenses ── RLS: the buyer may SELECT only their own rows
```

## 1. Schema

Apply `migrations/0003_licenses_webhook.sql` with the SQL editor or:

```bash
SUPABASE_ACCESS_TOKEN=sb_pat_… node set-licenses-policy.mjs
```

It creates `public.beats`, recreates `public.licenses` in the payment shape, and
installs the SELECT-only owner policy. **It drops the old `licenses` table** —
export any rows first.

The seed uuid in the migration is the same uuid as the `flesh` entry in
`catalog.js`. Keep the two in step when you add beats.

## 2. Secrets

```bash
supabase secrets set \
  NOWPAYMENTS_API_KEY=…          `# create-payment: creates the invoice` \
  NOWPAYMENTS_IPN_SECRET=…       `# nowpayments-webhook: verifies x-nowpayments-sig`
# Optional:
#   SITE_URL=https://www.kyrolll.store   (success/cancel redirects)
#   ALLOWED_ORIGIN=https://www.kyrolll.store   (defaults to *)
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform — do not set them by hand.

In the NOWPayments dashboard, set the IPN callback URL to

```
https://<project-ref>.supabase.co/functions/v1/nowpayments-webhook
```

(`create-payment` sends this automatically as `ipn_callback_url` on each
invoice, so the dashboard value is only a fallback.)

## 3. Deploy

```bash
supabase functions deploy create-payment
supabase functions deploy nowpayments-webhook --no-verify-jwt
```

The `--no-verify-jwt` flag matters: NOWPayments has no Supabase token to send,
so the gateway would otherwise 401 every callback. `supabase/config.toml` pins
the same setting for a plain `supabase functions deploy`.

## 4. Verify

Signed-in browser console (storefront on the same project):

```js
// Ask for an invoice; expect { url: "https://nowpayments.io/payment/?iid=…" }
await window.KYROlll_BACKEND.payments.createInvoice({
  beatId: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
  licenseType: "mp3"
});
```

With no real payment, insert a test license as the service_role (bypasses RLS)
and confirm the library lists it for the test account
`51e2c961-c95b-4dad-8a9b-ac30e6728ee5`:

```bash
curl -s "$SUPABASE_URL/rest/v1/licenses" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"user_id":"51e2c961-c95b-4dad-8a9b-ac30e6728ee5",
       "beat_id":"6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
       "license_type":"mp3","price":9.95,"payment_id":"test-manual-1"}'
```

Then sign in as that user and open `library.html`. The same row read with the
anon key (no bearer) must return `[]` — that is RLS proving the browser cannot
read or write anyone else's licenses.
