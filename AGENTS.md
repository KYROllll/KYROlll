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
byte-for-byte (`cmp` silent, 572128 bytes), so the toolchain is exactly reproducible and a
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
