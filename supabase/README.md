# KYROlll payments — Supabase setup

The purchase path is: **BUY → `create-payment` → NOWPayments invoice →
`nowpayments-webhook` → `licenses` row → delivery email**.

There are no accounts. The browser never writes a license, and it never reads
one either: `licenses` has RLS on with no policy, so the anon/publishable key
matches no rows, and the webhook is the single writer (service_role bypasses
RLS).

```
storefront BUY
   │  POST /functions/v1/create-payment   (no bearer — the storefront is public)
   │    { beat_id, license_type, email? }
   ▼
create-payment  ── resolves the price server-side, builds
   │               order_description = {email, beat_id, license_type, price}
   │  POST https://api.nowpayments.io/v1/invoice
   ▼
NOWPayments hosted invoice  ── redirects the browser to success_url
   │  POST /functions/v1/nowpayments-webhook   (x-nowpayments-sig)
   ▼
nowpayments-webhook ── verifies the HMAC, and on payment_status "finished"
   │                    inserts the row with the service_role key
   ▼
public.licenses ── RLS on, no policy: no browser can read or write it
```

## 1. Schema

Apply `migrations/0003_licenses_webhook.sql` with the SQL editor or:

```bash
SUPABASE_ACCESS_TOKEN=sb_pat_… node set-licenses-policy.mjs
```

It creates `public.beats`, recreates `public.licenses` in the payment shape, and
installs the (now superseded) owner policy. **It drops the old `licenses` table**
— export any rows first.

Then reshape `licenses` for the account-less store (non-destructive — it keeps
the rows):

```bash
MIGRATION=migrations/0005_licenses_email_nullable_user.sql \
  SUPABASE_ACCESS_TOKEN=sb_pat_… node set-licenses-policy.mjs
```

0005 adds a nullable `email`, makes `user_id` nullable, drops the
`user_id → auth.users(id)` foreign key, and drops every policy (RLS stays on with
none). On a project that already has rows, that order matters: 0003 first only if
you are starting clean.

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

Both functions are public — the storefront has no session, and NOWPayments has no
Supabase token — so each deploys with JWT verification off:

```bash
supabase functions deploy create-payment --no-verify-jwt
supabase functions deploy nowpayments-webhook --no-verify-jwt
```

`supabase/config.toml` pins `verify_jwt = false` for both, so a plain
`supabase functions deploy` does the same. `create-payment` authenticates
nothing: its only guards are the server-side price list and the beat-existence
check, so never put anything sensitive in its response.

## 4. Verify

Browser console on the storefront (no sign-in needed):

```js
// Ask for an invoice; expect { url: "https://nowpayments.io/payment/?iid=…" }
await window.KYROlll_BACKEND.payments.createInvoice({
  beatId: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
  licenseType: "mp3",
  email: "buyer@example.com"   // optional — omit to let NOWPayments collect it
});
```

With no real payment, insert a test row as the service_role (bypasses RLS) to
exercise the delivery hook. There is no user to tie it to, so `user_id` is left
empty and the buyer's address goes in `email`:

```bash
curl -s "$SUPABASE_URL/rest/v1/licenses" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"beat_id":"6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
       "email":"buyer@example.com",
       "license_type":"mp3","price":9.95,"payment_id":"test-manual-1"}'
```

The same read with the anon key alone (no bearer) must return `[]` — that is RLS
(on, no policy) proving the browser cannot read anyone's licenses.
