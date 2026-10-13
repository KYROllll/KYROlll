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
hand-off pixels do not move either. On the auth page the preloader's stage is deliberately not
mounted at all (the filter at the top of `brand-logo.js`), so `hosts` there is just the login
flower. The veil's `logoBreathe` glow stays cancelled (`.preloader .logo-stage { animation: none }`)
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

`rememberExclusive()` inside `kyrolll-backend.js`'s `addLicense()` is what marks a beat taken: the
first time a purchase is recorded on the `exclusive` tier the beat id is added to the
`kyrolll_exclusive_sold` `localStorage` list. `licenses.soldExclusive()` returns that list plus
whatever `GET /rest/v1/licenses?select=beat_id&tier_id=eq.exclusive` yields — best-effort, so with
the documented owner-only RLS it only ever sees the signed-in buyer's own rows, and a public SELECT
policy on `beat_id` is what would make the lock site-wide. `script.js` calls it once per page load
(`loadSoldState()`) and marks every surface: `catalog-tile--sold` on the tile, `beat-detail--sold`
on the beat page, `disabled` + `buy-beat-btn--sold` on the BUY button (the ghosted label is covered
by the seal and the click handler refuses a sold button) and the angled `.sold-seal` over the cover
art. The seal always sits in the markup and is hidden with `visibility` — never `opacity` alone,
which would leak the words into `innerText` and the accessibility tree off a sold beat.

To eyeball it without a real exclusive checkout, seed the local record and reload the storefront:

```js
localStorage.setItem('kyrolll_exclusive_sold', '["flesh"]'); // then clear it to undo
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

## Supabase accounts, storage & licenses

Accounts, the permanent library and licensing run through Supabase, wired in
three files that every page loads (see the `<script>` order in `index.html`):

- `supabase-config.js` — project URL, anon key and bucket/table names. **While
  `url`/`anonKey` are empty the store runs in "local demo" mode**: accounts are
  kept in `localStorage`, libraries are local, and no request leaves the browser
  (the emailed one-time code is shown on screen instead). The preview boots with
  no secrets. Filling both values switches every page to Supabase Auth + Storage
  + Postgres.
- `kyrolll-backend.js` — a dependency-free Supabase REST client (Auth, Storage,
  PostgREST) behind `window.KYROlll_BACKEND`, with the same promise API in both
  modes. Auth is passwordless email OTP: `auth.signInWithOtp` asks Supabase to
  mail a 6-digit code (creating the account on first use) and `auth.verifyOtp`
  exchanges that code for a session — the same two calls cover sign-up and login.
- `catalog.js` — shared beats, the three tiers, and each tier's Storage object
  `path` + `name` + same-origin `fallback`.

Pages: `auth.html` (dedicated passwordless login/sign-up with a single 6-digit
code input, the live 3D flower and white fields), `dashboard.html` (username +
profile picture), `library.html` (audio download + PDF license), plus
`index.html` and `success.html`. The BUY dropdown always opens downward (clamped
to the space below and scrollable) so it can never cover the header or footer.

To attach a real project:

1. **Auth** — Authentication → Providers → Email → make sure email sign-in is
   enabled so `signInWithOtp` can send codes. The email template must include the
   `{{ .Token }}` placeholder so the code the code input asks for is actually
   sent. The code length is the project's **Email OTP Length** setting
   (GoTrue env `GOTRUE_MAILER_OTP_LENGTH`), **not** something the `/auth/v1/otp`
   request can set. Brand-new projects default the email OTP to 8; KYROlll pins
   its project to **6**, and `supabase-config.js` carries `otpLength: 6` to
   match, so the storefront and the emailed code agree. Whenever you change
   `otpLength`, bring the project field in step:
   `SUPABASE_ACCESS_TOKEN=… node set-otp-length.mjs`
   (defaults to 6, honours `OTP_LENGTH`; token from
   https://supabase.com/dashboard/account/tokens, Owner/Administrator — the
   Management API auth-config endpoint requires at least Admin; the script reads
   the project ref from `supabase-config.js`, GETs the current
   `mailer_otp_length`, PATCHes it, and prints the result). The auth page
   renders exactly `otpLength` digits in the code input and the OTP request
   sends `otp_length` so the UI and the emailed code can never drift apart.

   The **look** of the mail is also server-owned: GoTrue renders it from the
   project's email templates, so the stock "Supabase" copy and its default
   `{{ .ConfirmationURL }}` magic link have to be replaced in the project, not
   in the page. `SUPABASE_ACCESS_TOKEN=… node set-auth-email-templates.mjs`
   PATCHes the branded KYROlll dark templates (storefront ink, `{{ .Token }}`
   only, no stray link except the invite whose link is the action) plus the
   matching subjects through the same Management API endpoint. It defaults the
   support address to `kyrolll00@gmail.com` (`SUPPORT_EMAIL=…` to override),
   reads the ref from `supabase-config.js`, and only PATCHes fields that differ,
   so re-running is a no-op. `kyrolll-backend.js` sends no `email_redirect_to`,
   so a code-only login never mints a magic link in the first place.
2. **Storage** — create a private bucket `BEATS` for the masters and an
   `avatars` bucket for profile pictures (rename in `supabase-config.js` if you
   differ). Upload each tier's object to the path named in `catalog.js`.
3. **Table** — create `licenses` and lock it to the owner with RLS:

   ```sql
   create table public.licenses (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users(id) on delete cascade,
     beat_id text not null,
     beat_title text not null,
     tier_id text not null,
     tier text not null,
     price text,
     purchased_at timestamptz not null default now()
   );
   alter table public.licenses enable row level security;
   create policy "own licenses" on public.licenses
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

   If the table is missing the client keeps licenses in `localStorage`, so the
   library still works while you set things up.

`assets/jspdf.min.js` is a vendored UMD build of jsPDF (2.5.2) exposing
`window.jspdf.jsPDF`; `license-pdf.js` turns a purchased tier into a branded
certificate. The storefront itself still needs no external CDN at runtime.

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

Order delivery is **email-only**: the payscreen and the success modal never list
download links or license files (see `showSuccessModal` / `completeFreeOrder` in
`script.js`). Everything — links, PDF/TXT licenses — goes out through the
Worker's branded Resend email. That email cannot send until `RESEND_API_KEY` and
`RESEND_FROM` are set, so an un-configured preview legitimately reports
"EMAIL DELIVERY PENDING".

`index.html` pre-renders the active release's beat card so a direct beat link
(`?beat=…`) paints without a flash; `script.js` replaces the grid contents right after
parse. Home is the default state: the head only adds `beat-page` when the URL carries
`?beat=`, and `html:not(.beat-page) #grid > .beat-detail` keeps that pre-rendered card
hidden on the home route — so entering the store never flashes a beat page before the
homepage hero.
