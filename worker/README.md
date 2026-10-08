# Checkout Enforcement Worker

Server-side gate for beat delivery. The site's JavaScript never sees the
NOWPayments key or the Drive URLs — only this Worker does.

## What it enforces

1. `POST /api/checkout` — creates the NOWPayments payment (API key stays here)
2. `POST /api/ipn` — receives payment webhooks; verifies the
   `x-nowpayments-sig` HMAC-SHA512 signature with your IPN secret; on
   `finished`, marks the order released and emails the download links
3. `GET /api/status?order_id=…` — live status for the popup; returns the
   links **only** after the IPN handler has marked the order released
4. `GET /api/exclusive-license?order_id=…` — buyer-specific exclusive PDF
   for a released exclusive order (the same agreement as the email attachment)

## Deploy

```bash
cd worker
npm install

npx wrangler kv namespace create ORDERS --config wrangler.toml # paste the id into wrangler.toml

npx wrangler secret put NOWPAYMENTS_API_KEY --config wrangler.toml
npx wrangler secret put NOWPAYMENTS_IPN_SECRET --config wrangler.toml
npx wrangler secret put RESEND_API_KEY --config wrangler.toml
npx wrangler secret put RESEND_FROM --config wrangler.toml # "KYROlll <noreply@your-verified-domain>"
npx wrangler secret put FLESH_WAV_URL --config wrangler.toml
npx wrangler secret put FLESH_MP3_URL --config wrangler.toml
npx wrangler secret put FLESH_EXCLUSIVE_URL --config wrangler.toml
npx wrangler secret put BEAT_LINKS --config wrangler.toml # MP3 + WAV URLs for future releases

npx wrangler deploy --config wrangler.toml
```

FLESH is the first built-in release, with ID `flesh`. Add later releases to
`CATALOG` in `script.js` (each entry needs `id`, `title`, `img`, `bpm`, `key`,
`leases`, and `left`; `name` is optional). Register matching IDs and titles in
`BEAT_CATALOG` or the Worker's built-in catalog, and store buyer files in the
private `BEAT_LINKS` binding. Without a matching Worker catalog entry or
purchased-format link, checkout is rejected.

Each catalog ID has a shareable beat view (`/?beat=flesh` for FLESH). Catalog
tiles show the artwork and title; the beat view contains the player, metadata,
and license options. Receipt and release emails link to the same beat view.

For FLESH, set `FLESH_WAV_URL`, `FLESH_MP3_URL`, and
`FLESH_EXCLUSIVE_URL` on the checkout Worker (use `--config wrangler.toml`
when invoking Wrangler from this directory).
The Worker delivers only the purchased format after payment and these bindings
do not replace existing `BEAT_LINKS`. The MP3 link currently points to the
same untagged recording used for the publicly accessible preview; supply a
different MP3 upload if a buyer-only version is desired. The exclusive secret
points to the buyer folder with clean MP3 and WAV files; exclusive checkout
will not charge if the folder link is missing. The receipt email includes the
folder link and personalized exclusive PDF and TXT agreements. A live checkout
also requires `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET`.

### In-browser audio previews

Add `preview: "assets/previews/new-beat.mp3"` (or a direct hosted `.mp3`/`.wav`
snippet URL) to a storefront catalog entry. This public snippet is separate
from the full purchase files configured in `BEAT_LINKS`. Serve remote previews
over HTTPS with the appropriate audio content type and byte-range support for
seeking. The preview loads on the first play click, and starting another beat
pauses the previous one. A keyboard-accessible seek bar shows elapsed/total
time. Keep `youtube` for the subtle fallback link; entries without `preview`
show an availability note instead of a broken player.

## Send emails with Resend (free tier)

All worker mail (`/api/notify-beat`, `/api/notify-drop`,
and the order confirmation after a `finished` IPN) is sent via the
[Resend API](https://resend.com) — the free plan is 3,000 emails/month and
delivers straight to the customer (no auto-reply feature to configure). Setup:

1. Create a free Resend account (no credit card) → **Add Domain** → add the DNS
   records (SPF/DKIM/DMARC) for a domain you control, and wait for verification.
2. Create an **API key** in your Resend dashboard.
3. Deploy the two secrets:
   ```bash
   npx wrangler secret put RESEND_API_KEY         # re_… from the dashboard
    npx wrangler secret put RESEND_FROM            # "KYROlll <noreply@your-domain>"
   ```
   The sender domain must be the verified one. (The placeholder
   `onboarding@resend.dev` provided by Resend only delivers to the account
   owner's own inbox, so a verified domain is required for customer mail.)
4. Redeploy: `npm run deploy`.

The Worker checks the API key and `RESEND_FROM` are set, and validates every
Resend response — a bad key, unverified sender, or quota hit surfaces via the
API response and worker logs instead of failing silently. Confirm the secrets
are deployed with `npx wrangler secret list`.

## Per-beat "notify me" endpoints

- `POST /api/notify-beat` — `{ beatId, beatName, email, ... }`. Validates the
  email, stores it (deduped) per beat in KV, and sends a confirmation email.
- `POST /api/notify-drop` — `{ beatId, beatName }`. Emails all subscribers of
  that beat that it's now live. Sends at most once per beat **and per email**
  (`notify-sent:<beatId>` / `notify-sent:<beatId>:<email>` KV keys). The
  This endpoint can be called when announcing a new catalog addition.

## BEAT_LINKS value (paste when prompted — keep out of git)

Upload separate buyer MP3 and WAV files for every tier you sell. Configure
`BEAT_LINKS` with the purchased formats; the Worker rejects carts
whose purchased format has no URL, so buyers are never charged for a missing
file. For FLESH, exclusive orders use the dedicated MP3+WAV folder secret;
other releases can use their exclusive link or WAV file. Existing string values
remain valid for WAV/exclusive purchases, but do **not** supply an MP3 file. Alternatively,
set `MP3_LINKS` as a JSON object of beat IDs to MP3 URLs alongside legacy
string `BEAT_LINKS` values.

```json
{"new-beat-id":{"mp3":"https://files.example/new-beat.mp3","wav":"https://files.example/new-beat.wav"}}
```

The delivery email contains format-specific download links plus PDF and TXT
license attachments; payment status also exposes the appropriate file link.

Keys must match the `id` fields in `script.js` and `BEAT_CATALOG`. For example,
set `BEAT_CATALOG` to `{"new-beat-id":{"title":"BEAT 01","name":"New Beat"}}`.
Configure a URL for each format you intend to sell.

## Finish line

1. Set the deployed URL in script.js → `WORKER_URL`
2. In NOWPayments dashboard, confirm the IPN callback URL points to
   `<worker-url>/api/ipn` and that your IPN secret matches
   `NOWPAYMENTS_IPN_SECRET` (also set `ALLOWED_ORIGIN` in wrangler.toml
   to your storefront origin, then redeploy)

Local dev: copy `.dev.vars.example` → `.dev.vars`, then `npm run dev`.
