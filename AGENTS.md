# AGENTS.md — running the KYROlll store in the Base44 sandbox

Repo-local notes that are not obvious from the manifests. Everything here is
about *running* the app in this sandbox, not about the app's own behaviour.

## Shape of the app

- **Storefront** — plain static files (`index.html`, `style.css`, `script.js`,
  `preview-player.js`, `hero-intro.js`, `assets/*.min.js`) served by `server.mjs`
  on port 8080. No bundler, no runtime dependencies: `server.mjs` is pure Node
  `http`, so edits to HTML/CSS/JS show up on a browser reload with no rebuild.
- `hero-intro.js` drives the hero scroll storytelling: it publishes a 0 → 1
  scroll progress onto `.brand-hero` as the `--hero-p` custom property (all hero
  movement is `calc()`-ed from it in CSS) and reveals the sections below the fold.
  It honours reduced motion and the shared `motion-toggle` event, so pausing
  motion freezes the parallax as well.
- **Checkout Worker** — `worker/` is a Cloudflare Worker (wrangler) that holds
  the NOWPayments key and the buyer download links. It is the only piece that
  needs secrets. It stores orders in a KV namespace (`ORDERS`), which wrangler
  simulates locally when running `wrangler dev`.

## How the two are wired here

- `docker-compose.base44.yml` runs `web` (`node server.mjs`, host port 3000) and
  `worker` (the locally installed Wrangler CLI, host port 8000). Both bind-mount
  the checkout and run live from source. Wrangler is launched directly rather
  than through `npx`, so normal container shutdowns do not log an npm SIGTERM
  command failure.
- `script.js` picks its backend URL from `window.KYROlll_WORKER_URL` if it is
  set, otherwise localhost:8787, otherwise the deployed `*.workers.dev` URL.
  `server.mjs` serves `/config.js` and, **only when `BASE44_PREVIEW_MODE=1`**,
  sets that global to `https://8000-$BASE44_PUBLIC_HOST_SUFFIX` (the exposed
  worker port). With the flag unset the route is a no-op and production keeps
  its built-in default.
- The worker's CORS default (`ALLOWED_ORIGIN` unset → `*`) is what lets the
  storefront on port 3000 call the worker on port 8000 cross-origin. No cookies
  or sessions are involved, so no `credentials: 'include'` is needed.

## Built assets (`assets/*.min.js`)

`assets/brand-logo.min.js` and `assets/background-x.min.js` are esbuild bundles of
`brand-logo.js` / `background-x.js`. `npm run build:brand` regenerates the whole asset
set but needs `sharp`, which this sandbox does not install. To rebuild one bundle, use
the esbuild that ships with the Worker and run its binary directly (`bin/esbuild` is a
native binary, not a JS entry point):

```bash
worker/node_modules/@esbuild/linux-x64/bin/esbuild background-x.js --bundle --minify \
  --format=esm --target=es2020 --legal-comments=eof --outfile=assets/background-x.min.js
```

Bump the `?v=N` query on the matching `<script>` tag in `index.html` afterwards.

`assets/brand-logo.min.js` bundles `three` (r186) plus one `three/addons` helper
(`BufferGeometryUtils`'s `mergeVertices`). It **can** be rebuilt here — install the
matching three in a throwaway directory, build there so `three` resolves, and let the same
esbuild write the repo's asset:

```bash
mkdir -p /tmp/rebuild && cd /tmp/rebuild && cp /app/brand-logo.js . \
  && npm install three@0.186.0 --no-audit --no-fund \
  && /app/worker/node_modules/@esbuild/linux-x64/bin/esbuild brand-logo.js --bundle --minify \
     --format=esm --target=es2020 --legal-comments=eof --outfile=/app/assets/brand-logo.min.js
```

Run on the **unmodified** `brand-logo.js` that command reproduces the committed bundle
byte-for-byte (`cmp` silent, 574295 bytes), so the toolchain is exactly reproducible and a
source edit can be shipped with confidence. Bump the `?v=N` query on the matching
`<script>` tag in `index.html` afterwards — and remember `brand-logo.js` without a rebuild
changes nothing. `npm run build:brand` is still the only thing that regenerates the
*images*, and it needs `sharp`, which this sandbox does not install. `background-x.js` has
no dependencies and rebuilds with the esbuild line above.

## Logo hand-off (still image → live 3D)

The hero shows `assets/kyrolll-flower-rest.png` until the WebGL flower has painted its
first frame, then cross-fades (`style.css`, `.logo-stage.is-ready`). That still is not a
separate artwork: it is a frame the 3D flower itself rendered at its resting pose,
captured at 2x from a 1040px stage with the transparent background kept, so it lands 1:1
on the 520px hero stage. Because the image already sits exactly where the renderer draws
the flower, `.logo-fallback` carries **no padding and no transform** — adding either
would offset the still against the 3D at the hand-off — and the .4s cross-fade is long
enough that the change reads as the material settling, not one image replacing another.
`.logo-stage` also carries a base `drop-shadow` equal to `logoBreathe`'s 0% frame so the
1.6s-delayed loop cannot pop a halo on. Keep those details in step if the logo changes.

The flower is never shown assembling itself: every petal is visible from the renderer's
very first frame, so the still → canvas hand-off swaps two resting flowers.
`brand-logo.js` still exposes a proportional `window.KYROlll_FLOWER_PROGRESS(p)` reveal for
callers that want it, but nothing drives it during a load.

**Every flower on the page turns on one shared clock.** All stages — the preloader's flower and
the hero's — are painted by a single rAF loop (`flowerLoop`) from one `elapsed` value, so they are
always at exactly the same angle: the pose the veil lifts off is the pose the hero carries on
with, with no jump, no half-turn and no drift between two independent render loops. The clock only
starts once every stage has reported its first paint (`stagePainted()`, also called when a stage
fails so one dead flower can never hold it back) plus a 450 ms hold; before that `elapsed` is 0,
which is exactly the pose the still image shows. `paused` / `document.hidden` freeze the shared
clock for every flower at once, and the drifting rim light only starts with the rotation, so the
hand-off pixels do not move either. A `.logo-stage` inside `#preloader` is deliberately skipped when
`body.auth-body` is set (the filter at the top of `brand-logo.js`), a guard from the removed sign-in
page: no page carries `auth-body` any more, so every stage now mounts. The veil's `logoBreathe` glow stays cancelled (`.preloader .logo-stage { animation: none }`)
and the still → canvas cross-fade stays cancelled for the veil flower
(`.preloader .logo-stage canvas, .preloader .logo-fallback { transition: none }`) — the canvas
joins at the resting pose, so that swap is invisible.

The opening of that turn is eased. `paintFlower` reads its three angles through `easedRotation`
instead of straight off the clock, so the flower leaves the resting pose from a standstill and
eases up to full speed (rate `1 - e^(-t/1.2s)`, `START_RAMP_S`) — at full speed out of a still
frame the flower lurched. `SPIN_SIGN = 1` sends the flower's near side to the right, the
left-to-right direction the storefront's type reads in; the preloader's flower and the hero's
share this one clock, so both open the same way. The resting pose is already angled a little to
the left of face-on (`object.rotation.y = -.22`), so the opening sweeps that lean back through
face-on (about 2s in) before turning past it; the flower therefore reads as near face-on for
the first seconds and reaches edge-on around 8s. The pose at `elapsed` 0 is still exactly the
resting pose, so this leaves the still → canvas hand-off and the captured
`kyrolll-flower-rest.png` valid. Reversing `SPIN_SIGN` is the whole of the direction: if it is
ever flipped back, re-check those two properties, since the mirrored turn reaches edge-on
sooner.

The preloader only lets its bar reach 100% once `complete()` holds: the page has finished loading
AND the hero flower has reported ready and built (a failed or timed-out flower is written off, and
`HARD_CAP_MS` remains the last-resort escape). Keep that in step with `.preloader__progress-bar`
carrying no CSS transition — the bar is eased from the same `preloader.js` rAF loop.

## Exclusive sales lock the beat ("SOLD EXCLUSIVE")

Nothing in the browser marks a beat taken any more — the `nowpayments-webhook` is the only writer of
`licenses` and it runs server-side — so the local `kyrolll_exclusive_sold` `localStorage` list is
the *whole* answer today: `licenses.soldExclusive()` returns that list plus whatever an
**anonymous** `GET /rest/v1/licenses?select=beat_id&license_type=eq.exclusive&status=eq.active`
yields. That read carries the publishable key as `apikey` only, with **no bearer** (there is no
session any more), so under the 0005 RLS (on, no policy) it returns zero rows and only the local
list matters. The query is kept as a best-effort so a project that ever adds a public `beat_id`
SELECT policy lights the site-wide lock up with no code change. `script.js` calls
it once per page load
(`loadSoldState()`) and marks every surface: `catalog-tile--sold` on the tile, `beat-detail--sold`
on the beat page, `disabled` + `buy-beat-btn--sold` on the BUY button (the ghosted label is covered
by the seal and the click handler refuses a sold button) and the angled `.sold-seal` over the cover
art. The seal always sits in the markup and is hidden with `visibility` — never `opacity` alone,
which would leak the words into `innerText` and the accessibility tree off a sold beat.

To eyeball it without a real exclusive checkout, seed the local record and reload the storefront:

```js
localStorage.setItem('kyrolll_exclusive_sold', '["6c56eda2-df4a-45b0-b9b7-68f8efdbb1af"]'); // then clear it to undo
```

To re-capture the frame after the flower changes, serve a throwaway page from the repo
root that mounts a wide `.logo-stage` plus a `.motion-toggle` button, loads
`assets/brand-logo.min.js`, and then: wait for `is-ready`, hold ~480ms (the pose is still
the resting one), and grab `canvas` inside a `requestAnimationFrame` (the WebGL buffer is
only readable in the frame that drew it, which is why the loop must already be running),
then POST `toDataURL('image/png')` somewhere it can be saved. From the preview browser a
receiver on host port 9099 is only reachable through the proxy: take `location.origin`
and swap its `3000-` prefix for `9099-`. Delete the throwaway page afterwards.

## The falling-X canvas is clamped by CSS, not re-measured in JS

`background-x.js` sizes its canvas from the page's measured height, so its value can be
left over from a taller transient state (the pre-rendered beat card before `script.js`
swaps it for a catalog tile, the 28px scroll-reveal transform). A canvas taller than the
page left a band of empty background open below the footer.
`body > canvas { height: 100% !important }` in `style.css` caps the canvas element to the
body's box, so it can never paint below the page; the bitmap keeps the JS measurement, so
a stale measurement only rescales the marks slightly.

Re-measuring with `document.body.offsetHeight` inside `resize()` was tried and reverted:
the clamp does not need it, and it did not make the sandbox smoke check any more reliable.

## Preview responsiveness in this sandbox

The storefront is heavy to render without a GPU. Measured on a fresh load here (SwiftShader,
dpr 1, 1280×800), before the software-rasteriser path below: one 1.5s main-thread block
while the flower initialises, then ~61ms per frame (≈16fps) indefinitely — 36 long tasks in
the first four seconds. Isolating the two animations (shrink the background canvas to 1×1
and re-measure the frame cadence) puts essentially all of that on the **flower**: the
falling-X canvas only adds ~2ms per frame, so it is not what needs trimming.

`brand-logo.js` therefore detects a software rasteriser (`WEBGL_debug_renderer_info`
matching `swiftshader|llvmpipe|softpipe|software`) and, only there, builds a lighter scene:
`bevelSegments` 5→2, a 128px reflection cube, a ~30fps cadence, and a scene build split
across frames so the page keeps answering while it is built. A GPU keeps every original
value. After it: one ~1.1s block, ~44ms per frame, 2 long tasks — and the flower is
unchanged (mean ink luminance 216 before and after).

The remaining block is the driver compiling and linking the pearl program, and it is not
removable without changing the material: SwiftShader does **not** expose
`KHR_parallel_shader_compile` (checked in the page), so three's `compileAsync` silently
falls back to a synchronous compile, and `checkShaderErrors = false` only skips the log
reads — the active-uniform query still forces the link. An environment several times slower
than this one can therefore still trip the platform's fresh-load smoke check
(`page_unresponsive`). Trim the material last, not the page structure.

## Supabase (account-less store)

There are **no accounts**. A visitor browses, picks a license, optionally leaves an
email, and pays on a hosted NOWPayments invoice; the beat and its PDF license are
delivered by email. Supabase is used for exactly three things: the public `beats`
catalog, the `licenses` audit table (written only by the webhook) and the private
`BEATS` storage bucket that holds the masters.

Three files every page loads (see the `<script>` order in `index.html`):

- `supabase-config.js` — project URL, anon/publishable key and bucket/table names.
  **While `url`/`anonKey` are empty the store runs in "local demo" mode**: no request
  leaves the browser and the checkout falls back to the static invoice links in
  `catalog.js`. The preview boots with no secrets.
- `kyrolll-backend.js` — a dependency-free Supabase REST client behind
  `window.KYROlll_BACKEND` exposing only `payments.createInvoice`
  (`POST /functions/v1/create-payment`, **no bearer** — the storefront is public) and
  `licenses.soldExclusive()` (a best-effort anonymous `beat_id` read). There is no
  Auth, no session, no token and no local-demo account branch: the anon key is sent as
  `apikey` only, which PostgREST resolves as the `anon` role.
- `catalog.js` — shared beats, the three tiers, and each tier's Storage object `path` +
  `name` + same-origin `fallback`.

Pages: `index.html` (home + catalog + beat page) and `success.html` (post-payment
confirmation). `library.html` is now a static notice — "No account needed — your beat
will be sent to your email after purchase…" — kept so old `?view=library` links and
bookmarks land somewhere sensible, and `support.html` is a static `mailto:` panel.
`license.html` is the static certificate template the delivery email links to: it reads
`?beat&tier&id&price&email`, prints the order and renders the PDF through the existing
`license-pdf.js` + `assets/jspdf.min.js`. `auth.html` and `dashboard.html` are
**deleted**. The BUY dropdown always opens
downward (clamped to the space below and scrollable) so it can never cover the header
or footer.

### The BUY flow

`tile → BUY → license tier → optional email → invoice`

1. `script.js` opens the license menu (`account.js:openLicenseMenu`); choosing a tier
   runs `beginPurchase()`, which records the pending purchase in `localStorage`
   (`kyrolll_pending_purchase`).
2. `promptCheckoutEmail()` shows the email step inside the (already styled)
   `.logout-modal` shell: an optional `.auth-input` email field, plus SKIP and CONTINUE
   TO PAYMENT. A malformed address is refused there; skipping is a first-class path, and
   NOWPayments then asks for an email on its own page.
3. `startPayment()` calls `payments.createInvoice({beatId, licenseType, email})` and
   sends the browser to the returned hosted invoice URL. In local-demo mode it falls
   back to the tier's static `url` in `catalog.js`.
4. `success.html` reads the pending purchase (title / tier / price / email) to fill the
   confirmation card.

### Tables & RLS

`migrations/0003_licenses_webhook.sql` creates `beats` and `licenses`;
`migrations/0005_licenses_email_nullable_user.sql` then reshapes `licenses` for the
account-less flow. The current expected shape is:

```sql
create table if not exists public.beats (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  created_at timestamptz not null default now()
);
alter table public.beats enable row level security;
drop policy if exists "beats are public" on public.beats;
create policy "beats are public" on public.beats
  for select to anon, authenticated using (true);
insert into public.beats (id, slug, title)
  values ('6c56eda2-df4a-45b0-b9b7-68f8efdbb1af', 'flesh', '[FREE] DON TOLIVER TYPE BEAT - FLESH')
  on conflict (slug) do nothing;
grant select on public.beats to anon, authenticated;

-- After migrations/0005_licenses_email_nullable_user.sql. There are no accounts,
-- so a row carries the buyer's optional email and a NULLABLE user_id (kept only
-- for historical rows; the auth.users foreign key is dropped).
create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                              -- nullable; no auth.users FK
  email text,                                -- the buyer's address, optional
  beat_id uuid not null references public.beats(id) on delete restrict,
  license_type text not null check (license_type in ('mp3','wav','exclusive')),
  price numeric(10,2) not null check (price >= 0),
  payment_id text unique,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.licenses enable row level security;  -- ON, with NO policy
```

The migration chain (all under `migrations/`, applied with
`MIGRATION=… SUPABASE_ACCESS_TOKEN=… node set-licenses-policy.mjs`, whose
`database/query` endpoint needs a token with the `database_read`/`database_write`
scopes; it prints the SQL for the editor when no token is set):

- `0001_licenses_rls.sql` — the original `for all` policy that also let a browser
  INSERT. **Superseded; do not re-apply.**
- `0002_licenses_foreign_key.sql` — added the `user_id → auth.users(id)` FK.
  **Superseded** (0005 drops it).
- `0003_licenses_webhook.sql` — the table in the payment shape + `beats`. The script's
  **default**; it DROPs and recreates `licenses`, so it must not be used on a live
  table with rows you care about.
- `0004_licenses_owner_only_select.sql` — non-destructive: turns RLS on, drops *every*
  policy on `licenses` (enumerated from `pg_policies`) and re-creates the owner-only
  SELECT. Written to close a public-read leak; 0005 now supersedes its policy.
- `0005_licenses_email_nullable_user.sql` — non-destructive: adds nullable `email`,
  makes `user_id` nullable, drops any FK to `auth.users`, and drops every policy,
  leaving RLS on with **none**.

With RLS on and no policy the publishable key (which ships in the browser) reads zero
`licenses` rows — never a customer list — and the only writer is the
`nowpayments-webhook` Edge Function, using the service_role key (which bypasses RLS).
Verify with the publishable key only — no bearer — the read must be `200 []`, never a
list of rows (`<publishable-key>` is `anonKey` from `supabase-config.js`):

```bash
curl -s "https://vuryglxywrqdnvnbelvp.supabase.co/rest/v1/licenses?select=*" \
  -H "apikey: <publishable-key>"
```

The browser never writes `licenses` at all. `seed-test-licenses.mjs` and
`diagnose-licenses.sql` are legacy DB tools kept from the account era; the seed still
works (it writes via the service_role key) but a row's `user_id` may now be empty.

### Payments (NOWPayments via Edge Functions)

The BUY flow is `create-payment` → hosted invoice → `nowpayments-webhook` →
`licenses` row:

- `supabase/functions/create-payment/index.ts` is **public** (no bearer to verify — the
  browser sends none). It takes `{beat_id, license_type, email?}`, prices the order
  server-side (`PRICES`, kept in step with `catalog.js`), checks the beat exists in
  `public.beats`, and calls `POST https://api.nowpayments.io/v1/invoice` with
  `order_description = JSON.stringify({email, beat_id, license_type, price})` and, when
  an email was given, `customer_email`. It returns `{ url }` and `account.js`'s
  `startPayment()` sends the browser there. No price and no license is trusted from the
  client. The email is optional and a malformed one is a `400`, never silently dropped.
- `supabase/functions/nowpayments-webhook/index.ts` verifies the `x-nowpayments-sig`
  header (HMAC-SHA512 over the key-sorted body, per NOWPayments' IPN scheme) and — only
  on `payment_status === "finished"` — inserts the row with the service_role key:
  `{email, beat_id, license_type, price, payment_id, status}`, with no `user_id`.
  `payment_id` is unique and the insert uses `resolution=ignore-duplicates`, so a
  retried IPN is a no-op. Any other status is acknowledged and ignored. A `500` here is
  deliberate: it asks NOWPayments to retry.
- **Both** functions deploy with JWT verification **off** (`supabase/config.toml` pins
  `verify_jwt = false` for each): NOWPayments has no Supabase token, and the storefront
  has no session to present. `create-payment` authenticates nothing — its only guards
  are the server-side price list and the beat-existence check — so nothing sensitive may
  be added to its response. Secrets: `NOWPAYMENTS_API_KEY` (create-payment) and
  `NOWPAYMENTS_IPN_SECRET` (webhook). Full deploy/verify steps: `supabase/README.md`.
- The `beat_id` uuid a checkout carries is the catalog's `id` (it has to match
  `public.beats.id`, or the webhook insert would fail the foreign key). The catalog keeps
  `slug` only so old `?beat=flesh` links still resolve.
- **Delivery is wired** (Resend): once the row is written the webhook looks the beat up
  in `public.beats` (title + slug), signs a **60-minute** URL for the purchased tier's
  object in the `BEATS` bucket, and emails the buyer the beat link plus a link to
  `license.html`. The buyer address is `order.email`, falling back to
  `payload.customer_email` (what NOWPayments collected when the buyer skipped our step).
  The Storage object for a tier is duplicated in the function's `BEAT_FILES` map (keyed
  by slug) because a Deno function cannot read `catalog.js` — keep it in step when a
  beat is added; an unknown slug falls back to a storefront link, never a dead signed
  URL. The mail is best-effort: the license row is the record of the sale, so a Resend
  failure (or a missing `RESEND_API_KEY`) is logged and the handler still returns `200`,
  which stops NOWPayments replaying an IPN for a payment that was already recorded.
  `RESEND_FROM` must be a Resend-verified domain — gmail.com cannot be a sender — and
  until one is verified it defaults to Resend's test sender, which only reaches the
  account owner. `SUPPORT_EMAIL` (default `kyrolll00@gmail.com`) is the reply-to and the
  address printed in the mail's footer. The storefront never lists download links — see
  "Deliberate behaviour".

### Leftover auth tooling

`set-auth-email-templates.mjs` and `set-otp-length.mjs` (and their tests) date from the
removed Supabase Auth: they branded the `{{ .Token }}` login emails and pinned the OTP
length. No page signs in and no auth email is ever sent now, so they are **unused** —
left in place, not deleted. `assets/jspdf.min.js` and `license-pdf.js` are no longer
loaded by the store pages — the only page that pulls them in is `license.html`, the
static certificate the delivery email links to.

The storefront itself still needs no external CDN at runtime.

## Secrets

`worker/.dev.vars` is generated at container start from the platform-managed
env file `/run/base44/app.env` (see the compose `command`). The file is
git-ignored. The app **boots without any secrets** — checkout invoices and
delivery emails stay disabled until real NOWPayments / Resend values (and the
`FLESH_*` buyer links) are provided. `/api/catalog` (the healthcheck) touches
only KV, so it works without credentials.

`GET /api/mins` degrades gracefully: with no `NOWPAYMENTS_API_KEY` it returns
`{"mins":{}}` without calling NOWPayments (the storefront then shows every
coin), and if the key is present but rejected (401/403) it stops after the
first call and logs one line instead of failing per coin. Neither case is an
error — the empty `mins` only means the sub-minimum coin lock isn't applied.

## Verify it works

```bash
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/          # 200 storefront
curl -s http://localhost:8000/api/catalog                                # {"sold":[]}
curl -s http://localhost:3000/config.js                                  # sets KYROlll_WORKER_URL
```

Tests that ship with the repo:
- `worker/*.test.mjs` (via `worker/verify.mjs`) and the root
  `preview-player.test.mjs` are `node:test` based and need no browser:
  `docker compose -f docker-compose.base44.yml exec -T worker node --test catalog.test.mjs base-token.test.mjs`
- `brand-design.test.mjs` is Playwright-based and needs Chromium + root
  `node_modules`, which the sandbox does not install. To run it without touching
  the checkout, copy the repo into a `node:22` container and install there:
  `docker run --rm -v "$PWD":/src:ro -w /work node:22 bash -lc 'cp -r /src/. /work/ && cd /work && npm i @playwright/test@1.63.0 && npx playwright install --with-deps chromium && node --test brand-design.test.mjs'`.

## Deliberate behaviour worth knowing

Order delivery is **email-only**: neither the payscreen nor `success.html` ever
lists download links or license files — `initSuccessPage()` in `account.js` only
prints the beat, tier and price it remembered in `localStorage`. Everything —
links, PDF/TXT licenses — is meant to go out by email from the payment webhook's
finished-payment hook (see "Payments"). Nothing sends that mail yet, so for now
the storefront collects the optional address and hands the buyer to NOWPayments.

`index.html` pre-renders the active release's beat card so a direct beat link
(`?beat=…`) paints without a flash; `script.js` replaces the grid contents right after
parse. Home is the default state: the head only adds `beat-page` when the URL carries
`?beat=`, and `html:not(.beat-page) #grid > .beat-detail` keeps that pre-rendered card
hidden on the home route — so entering the store never flashes a beat page before the
homepage hero.
