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
- `script.js` picks its backend URL from `window.KYROLLL_WORKER_URL` if it is
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

`assets/brand-logo.min.js` bundles `three` + `three/addons`, so it can **not** be rebuilt
in this sandbox — nothing here installs `three` (and `build-brand-assets.mjs` also needs
`sharp`). Treat `brand-logo.js` as read-only while working in the preview: editing it
without rebuilding the bundle silently changes nothing. `background-x.js` has no
dependencies and rebuilds fine with the esbuild line above.

## Logo hand-off (still image → live 3D)

The hero shows `assets/kyrolll-metal.png` until the WebGL flower has painted its first
frame, then cross-fades (`style.css`, `.logo-stage.is-ready`). Two deliberate details:
the still is centred on the resting 3D flower's footprint — computed by projecting the
traced contours through `object.rotation.set(.15, -.22, -.12)` and the `PerspectiveCamera`
(33° at z 6.4), which lands on 313×307 px in a 420px stage against the still's 314×306 —
and the cross-fade is .4s, long enough that the change reads as the material settling
rather than one image replacing another. `.logo-stage` also carries a base
`drop-shadow` equal to `logoBreathe`'s 0% frame so the 1.6s-delayed loop cannot pop a
halo on. Keep those three in step if the logo markup changes.

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

The storefront is heavy to render without a GPU: the 3D flower (three.js, MSAA, physical
material) plus the falling-X canvas leave the main thread at roughly 15fps (~65-70ms per
frame). The page itself still loads quickly (`domInteractive` ~1.3s, `load` ~2s), yet the
platform's fresh-load smoke check intermittently reports `page_unresponsive (app broken)`.
It failed the same way with and without the changes above, including with the pre-existing
background asset, so treat it as environment capacity — the user's own preview is a second
renderer competing for the same CPU — rather than a defect in `background-x.js`. If it
needs to be lighter, trim the WebGL renderer first (`antialias`, pixel ratio,
`bevelSegments`), not the page structure.

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
curl -s http://localhost:3000/config.js                                  # sets KYROLLL_WORKER_URL
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
