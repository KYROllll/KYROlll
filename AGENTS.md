# AGENTS.md — running the KYROIII store in the Base44 sandbox

Repo-local notes that are not obvious from the manifests. Everything here is
about *running* the app in this sandbox, not about the app's own behaviour.

## Shape of the app

- **Storefront** — plain static files (`index.html`, `download.html`, `style.css`,
  `script.js`, `catalog.js`, `downloads.js`, `download-page.js`, `preview-player.js`,
  `marquee.js`, `hero-intro.js`, `preloader.js`, `assets/*.min.js`) served by `server.mjs`
  on port 8080. No bundler, no runtime dependencies: `server.mjs` is pure Node `http`, so
  edits to HTML/CSS/JS show up on a browser reload with no rebuild.
- **No backend and no secrets.** Every beat is 100% free: there is no cart, no
  checkout, no payment gateway, no Supabase, no worker and no server-side state.
  `catalog.js` holds the shared data (beats plus the three free packages) and
  `downloads.js` — with `download-page.js` for the landing page — is the whole
  "commerce" layer: the "DOWNLOAD FREE" trigger opens a three-package menu, and every
  package then sits behind its gate (an email for the MP3, subscribe + like + Instagram for the
  WAV, and those plus TikTok and X for the exclusive). **Nothing is ever written down** — no `localStorage`, no
  `sessionStorage`, no cookie, no unlock set and nothing prefilled. The only memory is a
  plain in-page `Map` in `downloads.js` (`grants`): a package passed in *this* page view is
  not asked for twice, and the map dies with the page, so a reload, a new tab or a shared
  link always asks again from scratch. The one thing that can leave the browser is the
  address the visitor submits, which is posted to the newsletter provider (below).
- **Brand casing.** The wordmark is `KYROIII` (K-Y-R-O-I-I-I) and it is itself all caps, so
  the page-wide uppercase does not change it. Every other visible string — headlines, buttons,
  labels, gate copy, form fields and their placeholders, catalog blurbs and package names, file
  names, the support page — is authored in ALL CAPS as well, and `html { text-transform:
  uppercase }` is the backstop for every text node (`input`/`textarea`/`select`/`button` and
  `::placeholder` are set explicitly too, because Safari does not reliably inherit the casing
  into form controls). There are **no casing opt-outs** left: the two `text-transform: none`
  rules that survive are the wordmark's own layer (its text is already `KYROIII` and the
  transform would only be a no-op) and the preloader name, for the same reason. Only the
  *value* a visitor types keeps its own casing — it is what travels to the provider and into
  the flow URL — while everything rendered is shouted in the brand voice. The PDF is forced
  again in `toAscii` (`license-pdf.js`), which uppercases before it sanitises; `KYROlll`
  survives only as an API name (`window.KYROlll_*`), an asset path (`assets/kyrolll-*.png`)
  and the YouTube handle.
- **One palette for the store's own paint — with two isolated colour exceptions.** The
  storefront is deep matte black `#0B0B0B`, pure white `#FFFFFF` and silver `#888888`, with the
  original neon-green / vivid-pink glitch palette isolated to the hero tagline and heart. Every
  colour literal outside **two** deliberately marked sections — the hero tagline and THE FLOW's
  `gold-rim` vinyl palette — is an equal-channel grey, and the `theme-color` metas are
  `#0b0b0b`. The beat cover art is **not** filtered: the catalog tiles and the beat detail show
  the supplied covers in their original colour. The same is true of the brand marks:
  `body > canvas` (the falling brush X), `.footer__logo`, `.brand-wordmark__mark`,
  `.vinyl-record__logo` and both watermark images paint in the colour they were drawn in — the
  warm brown of the brush marks included — so no `grayscale()`/`saturate()` belongs in any of
  their chains. THE FLOW's collector pressing is the coloured vinyl: its deep matte `#0a0a0c`
  body and single ultra-fine gold foil rim (`#d4af37` / `#e5c158`) are the vinyl's own
  intentional CSS colour block, scoped between the `THE FLOW gold-rim palette` markers. There
  is no splash, blob or extra graphic on the disc — just the black body, the perimeter rim and
  the spinning flower. `npm run build:brand` (which needs `sharp`) still owns the raster brand
  files and is still the only thing that may re-cut them. The generated PDF is equal-channel by
  construction (`license-pdf.js`), and the brand-design test asserts both halves: it reads
  every colour out of the PDF bytes and every colour literal outside the two marked stylesheet
  sections, and it asserts the covers keep their colour, the gold rim is painted and masked,
  and the splash layer is gone. Keep any new CSS accents scoped to those marked exceptions;
  all other storefront styling stays neutral.
- **The dialog is a phone citizen.** `.gate-modal` is measured in *dynamic* viewport units
  (`height: 100vh; height: 100dvh`) and the card is capped at `max-height: 90dvh` and scrolls
  inside itself, so even the five-step exclusive gate (steps + email + buttons) stays whole and
  the unlock button can never hide behind mobile browser chrome; `downloads.js` also pins the page's scroll offset on
  the body while a gate is open (a plain `overflow: hidden` makes iOS jump to the top) and
  restores it on close. Inputs render at 16px on phones, so iOS does not zoom the page on
  focus, and every control on the path carries `touch-action: manipulation` (no 300 ms
  double-tap-zoom wait) while the signature pad keeps `touch-action: none` (it owns the
  gesture). The dialog has exactly **one exit — its CANCEL button**: the backdrop carries no
  dismiss attribute and there is no outside-click or Escape handler, so a stray tap or key can
  never close a gate or wipe a step in progress.
- `hero-intro.js` drives the hero scroll storytelling: it publishes a 0 → 1
  scroll progress onto `.brand-hero` as the `--hero-p` custom property (all hero
  movement is `calc()`-ed from it in CSS) and reveals the sections below the fold.
  It honours reduced motion and the shared `motion-toggle` event, so pausing
  motion freezes the parallax as well.

## How it is wired here

- `docker-compose.base44.yml` runs a single service, `web` (`node server.mjs`,
  host port 3000 → container 8080). It bind-mounts the checkout and runs live
  from source. There is no worker service any more — the storefront's only cross-origin
  call is the newsletter POST, which the provider answers with CORS headers, so nothing
  needs a second port or a proxy.

## Built assets (`assets/*.min.js`)

`assets/brand-logo.min.js` and `assets/background-x.min.js` are esbuild bundles of
`brand-logo.js` / `background-x.js`. `esbuild` is a root devDependency
(`package.json`), so after `npm install` a single bundle rebuilds with `npx`:

```bash
npx esbuild background-x.js --bundle --minify \
  --format=esm --target=es2020 --legal-comments=eof --outfile=assets/background-x.min.js
```

Bump the `?v=N` query on the matching `<script>` tag in `index.html` afterwards.

The same rule covers the storefront's own `style.css` and hand-written scripts
(`downloads.js`, `script.js`, …): the `?v=N` query is the **only** cache-buster, so an
edit that ships without bumping it is invisible to every browser that already holds the
old URL. Bump the matching tag on **all** pages that link it — `index.html`,
`download.html` and `support.html` each carry their own copy, and the three drifting
apart is how `style.css?v=128` outlived the drawer fix that shipped in `style.css` after
it. A version only ever needs to move forwards.

`server.mjs` also answers `.html`, `.js`, `.mjs` and `.css` with
`Cache-Control: no-cache`, so the preview server revalidates the page and its scripts on every
load; the `?v=N` query remains the cache-buster that travels to a static host (GitHub Pages has
no `server.mjs`). Never add a Service Worker for this: a store that remembers nothing in the
browser should not start remembering its own assets.

`assets/brand-logo.min.js` bundles `three` (r186) plus one `three/addons` helper
(`BufferGeometryUtils`'s `mergeVertices`). It **can** be rebuilt here — install the
matching three in a throwaway directory, build there so `three` resolves, and let the same
esbuild write the repo's asset:

```bash
mkdir -p /tmp/rebuild && cd /tmp/rebuild && cp /app/brand-logo.js . \
  && npm install three@0.186.1 esbuild@0.28.2 --no-audit --no-fund \
  && ./node_modules/.bin/esbuild brand-logo.js --bundle --minify \
     --format=esm --target=es2020 --legal-comments=eof --outfile=/app/assets/brand-logo.min.js
```

Run on the **unmodified** `brand-logo.js` that command reproduces the committed bundle
byte-for-byte as long as `three` matches the pin (`cmp` is the check), so the toolchain is
reproducible and a source edit can be shipped with confidence. Bump the `?v=N` query on the
matching `<script>` tag in `index.html` afterwards — and remember `brand-logo.js` without a
rebuild changes nothing. `npm run build:brand` regenerates the *images* and both bundles,
and it needs `sharp`, which this sandbox does not install. `background-x.js` has no
dependencies and rebuilds with the esbuild line above.

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
hand-off pixels do not move either. Every `.logo-stage` on the page mounts; there is no
skip filter any more (the `body.auth-body` guard dated from the removed sign-in page). The
veil's `logoBreathe` glow stays cancelled (`.preloader .logo-stage { animation: none }`)
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

## `will-change` is handed back when a reveal settles

`.reveal` is pre-promoted with `will-change: opacity, transform` while its slide-in is still
to come, and `.reveal.is-revealed` (and `.beat-page .reveal`) takes it back with
`will-change: auto`. That is compositor hygiene: **`will-change` makes an element a stacking
context**, and a layer held for the life of the page is a cost with no benefit once the slide
is over. (This used to be load-bearing — the drawer lived inside the card, so a `.reveal`
stacking context could trap its `z-index` and the footer painted over it. The drawer is now
mounted on `<body>` at `z-index: 999999`, in the root stacking context, so no ancestor's
stacking context can contain it. Keep the `will-change: auto` regardless: a bare
`.reveal.is-revealed` still promotes every settled section for the life of the page.)

## The marquee is the one surface that keeps its compositor layer

The ticker is a permanently animating strip, so it is the deliberate exception to the rule
above: both `.marquee-banner` and `.marquee-track` carry `will-change: transform` and a
`translate3d`/`translateZ(0)` promotion for the life of the page, and the banner adds
`contain: layout paint` so a scroll-time reflow elsewhere can never invalidate it. The
animation itself is a Web Animations `translate3d` keyframe at a constant px/s speed with
`easing: "linear"` and `iterations: Infinity`, so it runs on the compositor thread and never
touches layout. Nothing in `marquee.js` listens for `scroll`, and nothing syncs the strip to
scroll position — it runs on its own timeline, independent of the page.

Two scroll-time hitches have been fixed and must not come back:

- **The banner is exempt from the section reveal** (`.marquee-banner.reveal` is forced
  `opacity: 1; transform: translateZ(0)`). An ancestor held at `opacity < 1` forces the whole
  strip into one render surface, which drops the ticker's own compositor animation for the
  length of the fade — and that fade is triggered by the very scroll that brings the strip into
  view. The marquee arrives settled instead.
- **`marquee.js` ignores a resize that does not change `innerWidth`.** A phone's address bar
  collapsing as you scroll fires `resize` with only the height changing, hundreds of times per
  scroll; rebuilding the track on each one (a synchronous re-layout plus a fresh animation) is
  what made the ticker stutter as the page scrolled. Only a real width change rebuilds.
  `brand-design.test.mjs` asserts both: the banner's computed opacity is `1` and a
  height-only resize leaves the track's children untouched (a width change replaces them).

## The audio player is inert while it plays

`preview-player.js` writes to the scrub bar on every media event (`timeupdate` fires several
times a second): `seek.value`, the `--preview-progress` custom property behind the track's
gradient, and the time readout's text. `.beat-preview` and `.beat-preview__seek` therefore carry
`contain: layout style`, and the player is locked onto one permanent hardware layer with
`transform: translateZ(0)` + `backface-visibility: hidden` + `perspective: 1000px` +
`will-change: transform`. Those writes therefore never reflow the card or the sections around it
and no repaint can nudge the mobile player mid-playback. It is `layout` containment, **not
`paint`**, so the static playing glow is never clipped.

The frame itself never animates: there is **no sheen pseudo-element, no rotating border and no
pulsing shadow**. The old masked conic ring rotated its whole (wide) rectangle, so its long edges
swept diagonally across the player's face and out past the box — the "spinning indicator" breach —
and the old `playerPulse` / `togglePulse` keyframes repainted a `box-shadow` inside a
`backdrop-filter`ed surface every frame (the documented cause of shimmer/jitter). The playing state
is now a static border colour and a static glow only. The time readout is fixed-width: `13ch`
(`width` + `min-width`), `white-space: nowrap`, `tabular-nums` + `font-feature-settings: "tnum"`,
and `update()` only writes it when the string actually changed — so a ticking second or a duration
arriving can never change its measured width and move the player. Nothing here listens to `scroll`
— playback is driven entirely by the media element's own events.

The scrub handle is 8px inside a `border-radius: 999px` + `overflow: hidden` track, and
`.beat-preview__details` insets that track 4px from the player's chrome, so at 0 % and 100 % the dot
keeps clear air on every side instead of grazing the edge. `brand-design.test.mjs` asserts the
containment/transform/backface/perspective/will-change, the fixed 13ch readout, the absence of any
sheen or shadow keyframes, the handle/track contract, samples the player and its neighbours for 60
frames of playback and requires zero drift, and then scrolls the open drawer to prove its seam
never moves and its direction never flips.

## The vinyl record slides out after a beat — translate only

The beat page's sleeve/record pair starts with the record fully tucked behind the opaque
sleeve. `script.js` adds `vinyl-open` **1.35 s** after the card is built (the card's own
0.8 s fade finishes well inside that delay), and `style.css` transitions the record out over
**1 s** on `cubic-bezier(.16, 1, .3, 1)`, with a short opacity fade alongside.

The tuck is the element's **first** computed state — `.beat-detail:not(.vinyl-open)
.vinyl-record` sets `translateX(0)` and `opacity: 0` in the stylesheet, so the record is
never briefly painted in the exposed position: no pre-render flash, no pop. Only
`translateX` and `opacity` move. A 360° rotation is never reintroduced: a rotating square's
*axis-aligned* box grows by √2 (a 422 px record measured ~597 px wide) and overshot the
stage by up to ~74 px — that was the original "pop / breach the artwork frame" glitch. A
pure horizontal slide keeps the circle, its box and its shadow inside the stage throughout.
The stage is 100% wide (capped at 620px) and the sleeve is 68% of it, which is a ~422px
square on desktop and a nearly full-width cover on a phone. The record is 92% of the sleeve,
inset 4% of the sleeve on every side (`top: 4%`, `height: 92%`, `width: 92%` relative to the
sleeve), so its circular top and bottom can never poke past the cover frame; it travels 53%
of its own width and its far edge lands at ~98.44% of the stage, leaving ~1.5% breathing
room. FLESH's pearl pressing has a 58% black label, and the complete official flower
(`.vinyl-record__logo`) sits at 65.2% of the record — the optical centre of the label's
exposed crescent — so the sleeve never crops any part of the mark. THE FLOW's black/gold
pressing keeps the classic 36% label and the logo centred on it. The logo image alone spins
continuously (`vinylCenterSpin`, 16s linear); the outer record box never rotates.
Both the reveal and its transition live inside `@media (prefers-reduced-motion:
no-preference)`: under reduced motion the base `.vinyl-record` rule leaves the record at
rest immediately, and adding `vinyl-open` is a no-op. `.beat-detail__artwork-wrap` keeps
`contain: layout` (not `paint`, which would clip the record's shadow) so a child box can
never nudge a surrounding box.

`catalog.js` gives each beat its own pressing: FLESH is `vinylVariant: "white"` (a pearl-white
disc with a broad black centre label and the full flower, no spindle hole), THE FLOW is
`vinylVariant: "gold-rim"` (a deep matte `#0a0a0c` disc with a single ultra-fine metallic gold
foil rim), GREEN FLESH is `vinylVariant: "sage-white-rim"` (a smoky grey-green disc with a
delicate white outer hairline and the complete flower in its deep matte black centre label),
SQUISH! is `vinylVariant: "ice-silver-rim"` (an icy chrome-slate disc with diamond-silver
micro-grooves and a pure-white perimeter hairline), and JUST D0 IT is
`vinylVariant: "rage-fire-rim"` (a deep matte `#0a0a0a` disc with one delicate fire-red/orange
perimeter hairline and the complete flower in its matte black centre label). `script.js` writes
the variant onto the card (`data-vinyl`) and the record (`.vinyl-record--white` /
`.vinyl-record--gold-rim` / `.vinyl-record--sage-white-rim` / `.vinyl-record--ice-silver-rim` /
`.vinyl-record--rage-fire-rim`); the old `"gold"` value resolves to `gold-rim`, and a bare black
disc remains the base/fallback. The rim is `.vinyl-record__rim`, a conic-gradient masked to a
~1.6px outer hairline. It sits above the grooves (z-index 3) but only at the perimeter, while
the centre label (z-index 1) and the spinning flower (z-index 2) stay clean on top. The record
DOM holds only that rim and the flower — there is no splash, blob or other graphic layer. Each
coloured pressing is isolated between its own palette markers and excluded from the
equal-channel audit. The pre-rendered FLESH card in `index.html` mirrors the white markup so the
first paint is already white; the record's vertical containment, the large cover width, the
fully-exposed logo and the zero horizontal overflow are asserted at 375, 390, 768 and 1440 px,
and the
gold-rim body, single rim gradient/mask, clean DOM and stacking are asserted on THE FLOW.

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

## Free downloads, the package menu and the gates

Every beat is free. The store is static, account-less and secret-free; the only
"commerce" is a browser-side file hand-off, split across `catalog.js` (data) and
`downloads.js` + `download-page.js` (behaviour). There is no cart, no checkout and no
payment gateway.

`catalog.js` is plain data with no DOM access, loaded first:

- `window.KYROlll_SOCIAL` — the official profile URLs the footers link and the gate
  steps open: `youtube` (`https://www.youtube.com/@KYROlll00`), `instagram`
  (`https://www.instagram.com/kyroill00`), `tiktok` (`https://www.tiktok.com/@kyroill00`)
  and `x` (`https://x.com/KYROlllll`).
- `window.KYROlll_YOUTUBE_CHANNEL` — where the "subscribe" step sends the visitor
  (`?sub_confirmation=1` makes YouTube show its own subscribe prompt). Built from
  `KYROlll_SOCIAL.youtube`, so it is
  `https://www.youtube.com/@KYROlll00?sub_confirmation=1`.
- `window.KYROlll_PACKAGES` — exactly three options per beat:
  `mp3` (`"MP3 LEASE"`, `gate: "email"`), `wav` (`"STANDARD WAV LEASE"`,
  `gate: "youtube"`) and `exclusive` (`"EXCLUSIVE / PRO PACKAGE"`, `gate: "exclusive"`).
  `gate` is the whole behaviour: `email` asks for an address, `youtube` adds subscribe +
  like this beat's own video + Instagram before that address, `exclusive` is those three
  plus TikTok and X with its own copy and submit label (there is **no** comment step), and
  `instant` (kept for a package that should skip the gate, unused today) goes straight to
  the download page. Every gate requires the address **and** the opt-in checkbox, and every
  gate then closes with the same REVIEW & SIGN stage (below). `includes` is the
  plain-language list of what the package hands over (MP3 → tagged MP3 + license; WAV →
  tagged MP3 + high-quality WAV + license; exclusive → tagged MP3 + WAV + tracked stems +
  full rights + email opt-in) and is printed verbatim in the generated license.
- `window.KYROlll_CATALOG` — one entry per beat: `id` (the uuid, also the `?beat=` value),
  `slug` (kept only so old `?beat=flesh` links resolve), `title`, `img`, `bpm`, `key`,
  `preview`, `youtube` (the beat's own video, used by the "like" step) and `deliverables`
  — a map of package id → an array of `{ file, name, label }`, where `file` is a
  **same-origin** path, `name` is what the browser saves it as and `label` is shown on the
  download page. `downloads.js` re-derives that `name` from the beat's own metadata on the
  way out (see the studio filenames below), so the `name` in the data is only the fallback
  for a caller with no beat in hand. The license is never listed: the download page always
  generates one.
- `window.KYROlll_HELPERS` — `escapeHTML`, `beatById(idOrSlug)`, `packageById(id)`,
  `deliverablesFor(beatId, packageId)`, `videoFor(beatId)` and `newsletterEndpoint()`,
  plus the scheduled-release clock: `now()`, `releaseAt(beat)`, `isReleased(beat[, at])`,
  `msUntilRelease(beat[, at])`, `formatCountdown(ms)` and `releaseLabel(beat)`.
- A beat may carry `releaseAt` (an ISO instant with its own offset) and a `releaseLabel`.
  That makes it a **scheduled drop**: until the store's clock reaches the instant, the
  catalog tile shows a monochrome countdown pill and nothing else — the universal label
  (`DROPPING SOON`, never a clock hour, so no timezone to misread) beside a live
  `HH:MM:SS`, standing alone in the action slot where `DOWNLOAD FREE` normally sits, with
  no button at all. The beat's own page shows the same pill with a dedicated **inert
  `LOCKED` control** beneath it (`lockedButtonHTML`; it carries no
  `data-download-trigger`, so the drawer cannot be reached) and no player.
  There is no YouTube icon beside the title in either state — the beat-detail head is
  the title and its specs only, and the old locked `<span>` / live anchor pair is gone.
  `videoFor()` still withholds the beat's own video from the gate's "like this beat"
  step until `isReleased()`, and the gate step itself unlocks with the clock.
  `start`/`openMenu` refuse a locked drop with a toast even if called directly.
  The second the clock lands, `script.js` (`refreshReleaseWatch`: a 1 s display interval
  plus a precise timeout) rebuilds the grid in place, so the full player and the drawer
  appear with no reload and no redeploy. The clock is read off `now()`, which honours an
  override for tests and preview links: set `window.KYROlll_NOW` before `catalog.js` loads,
  or append `?now=<iso|epoch>` — the override is a *fixed* instant that then advances with
  real time, so a countdown genuinely counts down. A cold `download.html` link to a drop
  that has not landed shows the same countdown and unlocks itself; a flow that just passed
  a gate carries the grant token and goes straight through.
- `window.KYROlll_SITE` — `{ formspreeEndpoint, paidFormspreeEndpoint }`. `formspreeEndpoint`
  is the authoritative **KYROIII — FREE DOWNLOADS** form (`https://formspree.io/f/mvkkkoew`)
  for every `[FREE 100%]` beat, while `paidFormspreeEndpoint` is an intentionally empty slot for
  a future paid category, so the two flows can never share a form by accident.
- `window.KYROlll_NEWSLETTER` — `{ provider, username, endpoint, paidEndpoint }`, where the
  email gate sends a new subscriber. `endpoint` mirrors `SITE.formspreeEndpoint` and
  `paidEndpoint` mirrors the paid slot. The repo ships with a **Formspree** form wired to
  `endpoint` (`https://formspree.io/f/mvkkkoew`), posted to with `fetch` and
  `Accept: application/json` so the submission lands in the dashboard; swap it for any provider
  that accepts a form POST and answers with CORS (Buttondown's `embed-subscribe` URL, a Beehiiv
  subscribe form, …) — for Buttondown just set `username`. Left blank, the gate still unlocks
  the files and sends nothing.

`downloads.js` exposes `window.KYROlll_DOWNLOADS` and owns the whole interaction. It has
**no backend** — no Supabase, no worker and no storage of any kind (the old
`readEmail`/`writeEmail`/`markUnlocked` API is gone). Its one memory is the in-page `grants`
`Map`: `isUnlocked(beatId, packageId)` answers from it and `finalizeGate` fills it, but it is a
**record only** — no path consults it to skip a step, so every selection re-opens the full gate
and re-requires REVIEW & SIGN, and a reload starts empty. The only outbound request is the
single authoritative analytics POST at SIGN & UNLOCK (`postAnalytics`: `fetch(endpoint)` with
`Accept: application/json` and a JSON body), carrying the email, verified full name, beat and
package context, the exact license serial, the completed social steps, the opt-in and the
device/source page. It is deliberately not sent at the email step, so a Formspree record can
never arrive half-empty:

- The `[data-download-trigger]` button (delegated once on `document`, so a re-rendered
  grid keeps working) opens the `.download-menu` — the old downward-only license dropdown,
  relabelled. **It is not a popup inside the card** — it is a root-anchored sheet:
  `openMenu` appends it to `<body>` and it is painted `position: fixed`, so `positionMenu`
  places it in *viewport* coordinates straight off the trigger's own box (both side edges and
  the seam) and the pair still reads as one control that unfolds. Mounting on `<body>` — never
  inside the card — is the whole point: a fixed element is only viewport-anchored while no
  ancestor is a containing block for it, and the glass detail card (`backdrop-filter`) and the
  catalog tiles (`transform`) would otherwise anchor it to the card.
  **It unfolds downwards by default**, off the button's bottom edge, and is only turned over —
  `.download-menu--up`, `transform-origin: bottom center` — when the room below the button is
  smaller than the room above, so a button near the foot of the page still shows all three
  tiers. Its width is the button's own width, pulled back inside the visible viewport when the
  button hugs an edge, and its height is capped to the space actually available, so the panel is
  never taller than the screen: an oversized list scrolls internally rather than running off the
  bottom. There is no framing scroll any more (the old `frameDrawer` is gone) — a fixed drawer
  that flips and clamps is already whole, so the page never moves under the visitor. Because the
  drawer does not travel with the page, `positionMenu` freezes the drawer's geometry against the
  button when it opens — width, capped height, unfold direction and base `top`/`left` — and a
  `scroll` then does **nothing but write a compositor `transform`** (`trackMenuScroll`: the
  negation of the viewport's scroll delta) so the sheet glides along with its button. It used to
  call `positionMenu` on every `scroll` frame, which re-measured the available space, forced a
  reflow and **flipped the drawer from above the button to below it mid-flick** — the wobble on a
  fast scroll. Only a `resize` / `visualViewport` change recomputes the box (`scheduleMenuRefresh`);
  a scroll never re-measures, re-sizes or flips it. The reveal therefore lives on the standalone
  `translate` property (`.download-menu { translate: 0 -6px }` → `.is-open { translate: 0 0 }`) so
  the `transform` slot stays free for the scroll tracking; the two compose. The drawer keeps
  `transform: translateZ(0)` + `will-change: transform` so that per-scroll write is a compositor
  job, and it stays `position: fixed` on `<body>` (the test still asserts that).
  **Nothing can clip it**: a fixed box whose containing block is the viewport is immune to every
  ancestor's `overflow`, so the storefront's page-wide `overflow-x: clip` guards — which keep
  the page from scrolling sideways — have no say over the drawer and stay exactly as they are.
  The drawer sits in the root stacking context at `z-index: 999999`, above every card, section,
  glow and the footer; the gate modal (`1000000`) and the toast (`1000001`) are raised above it
  so an open dialog still wins. While closed it is `visibility: hidden`, so an unopened drawer
  is inert to pointer and keyboard, while every `.download-tier` re-states `pointer-events:
  auto` so a tap always lands on the option itself. The drawer is a **glass** sheet — the same
  `backdrop-filter` treatment the detail card wears (equal-channel greys only, per the monochrome
  rule), with a silver edge and the pure-white seam along the button. **The trigger is a
  switch**: a tap on the trigger that owns the open drawer closes it (same delegated listener),
  because re-rendering it under the finger restarted the reveal animation and read as a second,
  stray panel. The delegated click also accepts a tap that lands on the button's container (a
  tile footer is padding around a slim button, and a finger is not a pixel). `is-menu-open` is
  still set on the container (which keeps the **ambient glow** — one blurred white bloom,
  `downloadAmbientPulse`, cancelled under reduced motion — and the lit `box-shadow` while
  `aria-expanded="true"`), on the tile and on `.beat-detail`; those lifts are now only cosmetic,
  since the drawer itself outranks them all from the root context. The bloom itself is pinned to the
  container's own box (`left`/`right: 0`, a percentage height centred on the button) instead of
  being a fixed-width disc, so it can never wander sideways out of its column.
  **No hover in the storefront changes geometry at all** (measured: every rect on the tile and the
  beat card holds to 0.00px across 90 frames of a held hover), and no hover tween touches a shadow
  or a `transform`: the tile's lift, the trigger's glow and the drawer tiers' highlight all arrive
  in a single frame (only `border-color`/`background`/`color` transition), because animating a
  `box-shadow` inside a `backdrop-filter`ed card re-composes the blur every frame — the flicker
  that reads as hover jitter. `.catalog-tile:focus-within` adds no movement at all (it fired on
  mousedown, so a slim button slid out from under the pointer and the click landed on the
  container: the button looked dead). The player follows the same rule at full strength: it carries
  no `::before` sheen, no `playerSpin`/`playerPulse`/`togglePulse` keyframes and no animated
  `box-shadow` at all — the playing state is a static border colour and a static glow, so nothing
  in the frame repaints the `backdrop-filter`ed surface during playback (see the player section
  above).
- **A catalog card contains its own children, and the grid owns the vertical rhythm.** `.catalog-tile`
  is a flex column and `.catalog-tile__link` grows (`flex: 1 1 auto`) to fill the card, so the action
  slot — the countdown pill on a scheduled drop, the `DOWNLOAD FREE` button otherwise — always stays
  inside the tile's border. It used to be `height: 100%`, which made the link fill the
  grid-stretched tile and pushed the action slot ~44px past the card's own bottom edge; on a
  single-column phone that bled into the next beat (the reported THE FLOW-countdown-over-FLESH
  overlap). Spacing between cards comes from one place, `.grid { gap: clamp(28px, 4vw, 40px) }`
  — ~28px on phones, 40px on desktop — never from a per-tile `margin-bottom` that could double up.
  `brand-design.test.mjs` asserts both halves: no card's contents overflow its box and the pill
  clears the next card on a 390px viewport.
- **The beat-detail title is a balanced display block, and the head holds nothing else.** The h2
  is `display: block` with `text-wrap: balance`, `overflow-wrap: normal` and no hyphenation, so the
  longest titles (`[FREE 100%] LIL GOTIT TYPE BEAT - SQUISH!`, `… JUST D0 IT`) split into evenly
  weighted whole-word lines inside the glass card instead of leaving an orphaned word or breaking
  mid-word. Its size is fluid but capped (`clamp(25px, 2.9vw, 38px)`, `clamp(23px, 6vw, 30px)` on
  phones) with a tight display tracking and a ~1.12 line-height; `brand-design.test.mjs` measures
  the rendered line boxes, the card containment and the specs clearance at 390, 1024 and 1440 px.
  The YouTube icon that used to sit beside it — a locked `<span>` before a drop, a live anchor
  after — is gone in both states: `.beat-detail__head` is the title and `.card__specs` only, and
  `style.css` carries no `.card__youtube-link` rule. The gate's "like this beat" step still opens
  `videoFor(beat.id)`, so the beat video remains one tap away inside the WAV/exclusive flows.
- `start(beatId, packageId)` resolves the beat + package, then opens that package's gate and
  continues on success (`gate: "instant"` short-circuits straight to the download page). There is
  **no grant shortcut**: even a package this view already passed opens the gate from scratch and
  requires REVIEW & SIGN again, so the mandatory signature step can never be skipped.
- `openGate(beat, pack, onUnlocked)` renders `.gate-modal` (backdrop + card) into `<body>`
  and adds `html.gate-open`. Each package asks for exactly what its listing promises:
  `gate: "email"` (MP3 lease) is the address only, `gate: "youtube"` (Standard WAV lease)
  shows **three** numbered steps — subscribe, like this beat's own video, follow on
  Instagram — and `gate: "exclusive"` (Pro package) shows **five**: those three plus TikTok
  and X (`socialSteps(actions, video)`, one `.gate-step` row per step, each with a
  `data-gate-action` of `sub` / `like` / `ig` / `tt` / `x`); each row opens in a new tab,
  and each completed step morphs its number into a tick that draws itself
  (`.gate-step__tick`, monochrome). The `like` href is `videoFor(beat.id)` — the
  same helper whose URL the old title icon used to open, and the only place the beat
  video is linked from the page now. All three gates are wired by **one**
  block: only the step count (`[]` / `[false, false, false]` /
  `[false, false, false, false, false]`) and the two hint lines (`STEP_COPY`) differ, so
  the three copies of the same input/change/keydown/submit listeners are gone and a fourth
  package would only add a row to that table. **A step is not a click-through.**
  `wireGateSteps` marks one done only when (a) the click was genuine — a scripted click
  (`isTrusted === false`) is refused outright — and (b) the row has held in its VERIFYING
  state for `STEP_HOLD_MS` (3.5 s), which is what stops the quick-bounce bypass of opening
  the tab and submitting immediately. The hold is shortened to `STEP_QUICK_MS` (1.2 s) only
  when the page really lost focus to the opened tab during it; a blocked popup still
  completes on the full hold, so a real visitor is never trapped. Re-clicking a step while
  it verifies does nothing: no second tab and no shortened hold. Every gate renders the same real
  `<form data-gate-form>` (with `action` pointed at
  the provider, so the flow degrades without scripting) holding one email field
  (`#gate-email`), the mandatory opt-in checkbox (`#gate-optin`, ticked and `required`), an
  inline error (`#gate-error`) and the CANCEL (`[data-gate-cancel]`) + submit
  (`[data-gate-submit]`) row. The field always starts **empty** and the submit only enables
  once the address is well formed, the box is ticked and every step is done, so a plain click
  cannot skip anything; Enter on the field runs the same `submitGate`, which is also where a
  malformed address is refused with `#gate-error`. **Only CANCEL closes the dialog** — the
  backdrop is inert (no `data-gate-cancel`, no outside-click listener) and Escape does nothing,
  so a stray tap or key cannot close a gate mid-step. `submitGate` validates the address and
  opt-in and then hands the *same* card over to the sign stage (below) without posting — the
  files stay locked until the license is signed, and the one authoritative Formspree POST fires
  at SIGN & UNLOCK with every analytics field present.
- `showSignStage(beat, pack, email, onUnlocked, optin)` is the last screen of every gate: the terms
  in their own scroll pane (`.sign-terms`), the **FULL NAME — FIRST AND LAST** field
  (`#sign-name`) **above** the TYPE / DRAW switch (`.sign-mode`) and never hidden — it is
  required in **both** modes, so switching to DRAW can never skip the name — then the signature
  sheet — a **clean field** (nothing is drawn behind it, so the customer never signs over the
  brand's flower; the mark now lives in the PDF's LICENSOR approval stamp) around the pad
  (`.sign-pad__canvas`, pointer events, monochrome white ink,
  `touch-action: none`, DPR-scaled bitmap so the ink is crisp on a retina phone) — the live
  stamp (`[data-sign-stamp]`) and the one action that unlocks, `[data-sign-submit]`
  (**SIGN & UNLOCK**). The button only comes alive once the terms have been read **to the
  end** — `scrollHeight <= clientHeight`, or the pane scrolled to the bottom — *and* the
  signature is complete: a **FULL name** (`isFullName`: 2–4 name parts, each at least two
  letters, letters only) **AND** a **genuine drawing** on the pad
  (`drawingValid`: `SIGN_INK_MIN` = 8 thinned points spread over at least `SIGN_SPAN_MIN` = 0.3
  of the pad's width + height, so a tap, a dot or a two-point flick cannot sign) must both be
  present. `TYPE` and `DRAW` are **one shared readiness state**
  (`isReady = isFullName(name) && hasDrawnSignature()`), not two rules: switching tabs only
  shows or hides the pad and never changes the name, the strokes or the button, so TYPE cannot
  bypass the drawing and DRAW cannot bypass the name. The hint names the missing half exactly —
  `FULL NAME SET — SWITCH TO DRAW TAB & SIGN THE PAD TO UNLOCK`, or
  `SIGNATURE CAPTURED — ENTER YOUR FULL FIRST & LAST NAME TO UNLOCK`, and
  `ALL SET — SIGN & UNLOCK` only when both exist (with the terms read). A single word, a blank
  line, initials and digits are all refused, and the refusal is enforced again inside the submit
  handler for **both** tabs — so stripping the button's `disabled` attribute (the one thing a
  script can do) still unlocks nothing. A finished stroke with no valid name reports
  `ENTER YOUR FULL NAME — FIRST AND LAST TO UNLOCK` on the spot, and the stamped sheet reads
  `FULL NAME REQUIRED — FIRST AND LAST`. The stage keeps two functions for that reason:
  `applyState()` moves the button, the stamp and the hint, while `refresh()` is `applyState()`
  plus `hideGateError`. Only a deliberate edit or a mode switch calls `refresh`; the terms
  pane's own `scroll` listener calls `applyState`, because reporting a refusal grows the card,
  the pane takes a scroll from that reflow and the pane's handler used to land in `refresh` — so
  the refusal hid itself in the frame it was announced (it showed up as an intermittent
  missing-error failure). The first pass is a `requestAnimationFrame(applyState)`, since a pane
  cannot say whether it scrolls until the sheet is laid out. A touch
  that slides off the pad keeps its stroke (the pointer is captured; only a mouse ends one on
  `pointerleave`), because a dropped stroke is what made people sign twice. The pad keeps at
  most `SIGN_POINTS` thinned points per stroke and 12 strokes, because the drawing has to fit
  in a URL. On SIGN & UNLOCK **both** halves are captured — whichever tab the click came from —
  and `finalizeGate` runs.
- `downloadUrl(beatId, packageId, email)` is the hand-off to the download page: the URL carries
  a one-shot grant token (`?t=<random hex>`, minted fresh when a gate is passed) and, when there
  is one, the address just submitted (`?email=…`), the signed name (`?sign=…`) and a drawing
  (`?sig=<points packed as hundredths, strokes joined by ~>`). **None of it is stored
  anywhere** — the token only means "this flow passed the gate a moment ago", so the download
  page does not ask a second time, while a cold link (a bookmark, a shared URL, a new browser)
  has no token and is gated over the page. The token only counts **with** the signature it
  carries: `download-page.js` treats a bare `?t=` as a cold link, so the whole sign step can
  never be skipped by adding a token.
- `setSignature(value)` / `setDrawnSignature(strokes)` / `licenseeName(fallback)` /
  `signaturePayload()` / `adoptSignature(name, packed)` are the licensee identity: a typed name
  clears any drawing and vice versa, `licenseeName(fallback)` returns the typed name or the
  address the flow submitted at the gate, and `signaturePayload()` returns the
  `{ name, strokes, pad }` that `license-pdf.js` stamps. Nothing about it is stored — the
  download page re-adopts it from the URL, and `license-pdf.js` only reads the result.
- Every hand-over is renamed for the studio: `proFileName(beat, item)` builds
  `KYROIII - <BEAT> (<BPM> BPM - <KEY>).<ext>` (beat name from the tail of the title, key
  uppercased, only the extension lowercase) for audio, plus the file's own `label` for
  anything else — so the pro package hands over
  `KYROIII - FLESH (130 BPM - AM) - TRACKED STEMS.zip`. `deliverablesFor` applies it, which is
  why both the download page's row and the saved file carry it.
- `downloadItem` builds a detached `<a download>` for a same-origin file, so nothing navigates
  the page away. The href carries `?dl=1&name=<friendly name>`, which is what lets `server.mjs`
  answer with `Content-Disposition: attachment` — that header, not the `download` attribute, is
  what makes a phone save the file instead of previewing it (and `?dl` is required so the inline
  beat preview keeps streaming the same `.wav`/`.mp3` normally). There is no text license any
  more: `downloads.js` hands over files and gates only, and the license is a PDF issued by
  `license-pdf.js` (see below). Every package shares
  the same terms: **100% free for non-profit AND commercial/profit use** (release on Spotify,
  Apple Music, YouTube, monetise it), with a single rule — credit `(Prod. by KYROIII)` in the
  song title or description. The package's `includes` are listed under "WHAT THIS PACKAGE
  INCLUDES". The gate, trigger, menu, download-list and download-page styles live in
  `style.css` under "10. Free downloads, package menu, gates & download page".

`license-pdf.js` is the whole license: a dependency-free PDF writer (`window.KYROlll_LICENSE_PDF`
= `{ makeLicenseId, normalizeSignature, primeLicensePDF, generateLicensePDF }`).
`makeLicenseId(beat)` mints a fresh `KYRO-<year>-<SLUG>-<6 random digits>` per issuance from
`crypto.getRandomValues`, so no two licenses ever share an id; `download-page.js` mints it once
per page view and passes it to the PDF, so the id on screen is the id in the document. The
document is an A4 certificate built around one centered masthead: the flower still as an
embedded `/DCTDecode` JPEG at the middle of the page — **nothing outlines it**, no box, plate
or frame, because the still is composited on the field's own `#0B0B0B` and therefore floats —
the `KYROIII` wordmark under it, a full-width divider, then the title, the hero serial block,
**one** ruled metadata row
(BEAT / PACKAGE / BPM / KEY / TERRITORY), numbered clauses 1.0–3.0, two **straight, pre-filled
signature blocks** and a footer carrying the support address, the serial, a vector barcode and
`HTTPS://KYROILL.STORE` — held to a **single page** for every package. The LICENSEE block shows
the signature captured in the gate's sign step: the typed full name **and** the
**hand-drawn signature re-emitted as vector strokes** (`drawSignature`, **pure crisp white
`#FFFFFF`**, round caps) in the same box — the name is set large on its rule only when the
download page is re-signed typed-only — and **nothing is drawn behind it**, so the customer
never signs over the brand's flower. The micro-line under that rule records who the
issuance went to — `SIGNED <date> - <FULL NAME> - <address>`, and the full name is carried even
when the mark is hand-drawn, so a drawing is never anonymous (the line steps its size and
tracking down via `putMicro` until it fits its own rule). The LICENSOR block, bottom-right, is
closed by the store's **official approval stamp** — a precision architectural brand plate
(square, not round): a crisp white outer hairline and a silver `#888888` inner hairline carrying
the master frame's white corner ticks, a silver divider, the *same* embedded flower mark
(`/Im1`) centred with generous padding in the left compartment, and left-aligned tracked-out
ALL-CAPS type in the right compartment — `KYROIII` (bold white) / `OFFICIAL VERIFIED SEAL`
(silver) / `AUTHORIZED LICENSOR` (white) — standing cleanly above the Licensor's signature line,
in place of the old plain name, with zero collisions or crooked text. Reusing the
already-embedded `/Im1` costs the stamp nothing.

Object numbering is positional and easy to break: 1 catalog, 2 pages, 3 Helvetica, 4
Helvetica-Bold, **5 the flower image**, then two objects per
page from `FIRST_PAGE_OBJ` (6). Adding or removing an object above the pages means moving that
constant, the `/Im1` resource reference and the `total` xref count together.

Three rules hold that document together and are easy to break by accident:

- **It is 100% ALL CAPS.** Every string goes through `toAscii`, which uppercases before it
  sanitises, so no lowercase letter can reach a page whatever the source data says. The two
  signature faces are upright Helvetica, not a script font — that is why no third font object
  exists and the whole document is Helvetica / Helvetica-Bold.
- **It is monochromatic, with crisp white/silver borders.** `#0B0B0B` field and `#FFFFFF`
  type; the borders are the requested `#ffffff / #a1a1aa` pair realised on equal channels —
  `FRAME` is pure white `1 1 1` (`#FFFFFF`) and `HAIR` is `0.631 0.631 0.631` (`#A1A1A1`, the
  neutral twin of `#A1A1AA`), which is what draws the inner hairline, the masthead divider,
  the heading rules, the metadata column separators, the signature rules and the footer rule.
  Every channel is equal: zero blue, zero hue of any kind. The barcode bars are drawn white
  (`1 1 1 rg`) — black bars on the black field are invisible.
- **It fits one page.** `FOOT_Y` (where the flow stops above the footer rule) and the
  `ensure(...)` reservations are the page-count knobs. The footer needs a rule, a row of control
  text and a row for the barcode + link, and the exclusive package is the tightest fit of the
  three (its signature block lands with ~26 pt to spare). **The centered masthead is paid for
  above the clauses, not below them**: it spends ~70 pt more than the old corner layout, and
  that is reclaimed by the single metadata row (whose `gridRow` lays all four columns on shared
  baselines — walk the columns sequentially and every value after the first drifts down the
  page) and by dropping the old 4.0 SUPPORT section into the footer. Nothing may be pushed up
  without reclaiming the same space: bigger flower, looser leading or a fourth clause puts the
  exclusive license onto a second page.

Letter-spacing uses the text-space `Tc` operator, so each run stays one string and the PDF
remains searchable and copyable. Base-14 Helvetica with real AFM metrics (`measure`,
`wrapToWidth`) does all the layout. The old jsPDF path is gone; `buildPdf` still degrades to a
text-only PDF if the flower image fails, and a thrown error is a real bug (logged + toast), not
a fallback. `primeLicensePDF` builds the blob (and caches the flower JPEG) ahead of the click,
so the cached branch of `generateLicensePDF` awaits nothing before `saveBlob` — the download
stays inside the user's click, which is what Safari / iOS require to save a generated file
instead of opening it in a viewer.

`download-page.js` fills `download.html` from the `?beat=`/`?package=` params and gives the
hand-off the full luxury treatment: a glass hero with the live 3D flower (`.dl-hero__flower`,
one `.logo-stage` with no preloader veil), a glassmorphism file card with one row per file, and a
`.license-cert` block that shows the serial minted at SIGN & UNLOCK (`#license-serial`) over the
signature that came with the flow — `boot()` adopts `?sign=` / `?sig=` through `adoptSignature`
and `?serial=` beside them before anything is rendered, so the serial recorded in the Formspree
analytics, the serial on screen and the serial printed in the PDF are the same string; a cold link
mints its own serial, and a gate passed on this page adopts the one its SIGN & UNLOCK just
recorded — so the stamp line (`#license-stamp`) shows the name signed in the gate, or replays
a hand-drawn one as an inline SVG (`.license-cert__mark`), and the PDF carries the same mark.
**That replay copies the pad's points straight across — `point[1] * h`, no `1 - y`** — because
SVG shares the canvas' top-left origin, while `license-pdf.js`'s `drawSignature` *does* flip
y (its origin is the bottom-left). Flipping both is what rendered every drawing upside down in
the preview while the document stayed right, so the two disagreed; the strokes are also held
crisp with `stroke-width: 2.6` + `vector-effect: non-scaling-stroke`, the pen weight of the pad
itself. The
`#license-signature` field is a re-sign: typing a new name replaces the signature (and the
prebuilt blob, ~220 ms after the last keystroke) and clears any drawing, and an empty one falls
back to the gate address, so the document is never unsigned. It prebuilds the license at load
(`primeLicensePDF`) so the click saves a ready blob, and probes each file with a `HEAD` so a row
whose file is missing is dimmed to "UNAVAILABLE" instead of handing over the storefront's HTML.
There is no raw-text preview, no `.txt` and no COPY button. The page content paints immediately
and never waits on the flower; if WebGL fails the still `kyrolll-flower-rest.png` simply
remains. The page itself remembers nothing: `boot()` trusts only the one-shot `?t=` grant token
`downloads.js` mints when a gate is passed — and only together with the signature that flow
carries (`?sign=` / `?sig=`) — so a cold link — a shared URL, a bookmark, a new browser — is
gated over the page and the flow is the same from any entry point (and that cold
gate runs the same REVIEW & SIGN stage in place, so the signature never has to make the
round trip). The LICENSEE signature is the one captured in the sign step, or the typed
`#license-signature` value on top of it, falling back to the `?email=` value from that same
flow (updated live if a gate happens to run on this page) — never a stored address.

`server.mjs` (the static preview server) is what actually makes a download a download: for a
same-origin file requested with `?dl`/`?name` it answers `Content-Disposition: attachment` with
the friendly name, and it no longer substitutes `index.html` for a missing asset — only
extension-less routes fall back, everything else 404s. Without that, a missing file was served
the storefront HTML with a `200`, which is exactly what makes a "download" open as a webpage.
`HEAD` is answered from `fs.stat`, so the download page's availability probe never reads a 38 MB
WAV. None of this exists on a static host (there is no `server.mjs`), so the client-side pieces —
the prebuilt PDF and the `download` attribute — carry the flow there.

Nothing the visitor leaves is stored anywhere — not server-side and not in the browser. There is
no persisted unlock set, no remembered address, no marketing list and no `kyrolll_licensee`:
those `localStorage` keys are gone, and the brand-design test asserts both `localStorage` and
`sessionStorage` stay empty across four passes through the gates. The in-page `grants` Map is
the only memory there is, and it does not survive the page. The only thing that leaves the
browser is the address the visitor submits at a gate, which is `fetch`-posted to the configured
newsletter provider (and only there).

`script.js` renders one `.download-trigger` per beat (a `--compact` variant on a catalog
tile) and nothing else about downloads. There is no `checkout.js`, no sold/exclusive state
(`kyrolll_exclusive_sold` is gone), no pending-purchase record and no `success.html` /
`license.html` / `library.html`.

The one piece of package metadata that is duplicated outside `catalog.js` is the file
name in a `deliverables` entry; there is no server-side copy to keep in step, so adding a
beat is a single edit to `catalog.js`. The files themselves are **conventional paths**
(`assets/previews/flesh.mp3`, `flesh.wav`, `flesh-stems.zip`). `flesh-stems.zip` holds the
seven stems **exactly as they were supplied** — `808.wav`, `HI HAT.wav`, `MELODY.wav`,
`OPEN .wav`, `PERC.wav`, `RISER.wav`, `SNARE.wav` — with no README, no placeholder files and
no archive metadata (`zip -X -j`), so the pro package hands over the stems and nothing else.
`the-flow-stems.zip` holds its nine stems the same flat way (`808.wav`, `END THE BEAT.wav`,
`HIHAT.wav`, `KICK.wav`, `MELODY.wav`, `PERC 2.wav`, `PERC.wav`, `SNARE.wav`,
`TEXTURE.wav`) — but rendered **16-bit/48 kHz** rather than the supplied 24-bit. The 24-bit
set is ~419 MB of PCM and zips to ~136 MB, over GitHub's 100 MB hard per-file limit, while
the 16-bit set zips to ~65 MB; the reduction is a plain round-to-nearest, so nothing else
about the stems changes and the archive stays a normal file any machine can open.
`just-do-it-stems.zip` follows the same rule with its nine supplied stems (`808.wav`,
`BASS.wav`, `HI HAT.wav`, `MELODY.wav`, `OPEN.wav`, `PERC 2.wav`, `PERC.wav`, `SFX.wav`,
`SNARE.wav`), rendered 16-bit/48 kHz and archived flat with `zip -X -j`; it is ~48 MB. Keep
that in mind if a future stem set is rebuilt: `zip` here only speaks `store`/`deflate`, so the
bit depth is the only lever that actually moves the size.

## Verify it works

```bash
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200 storefront
```

There are no secrets and no environment variables: the app boots as-is, and the free
downloads work the moment the static files are served.

Tests that ship with the repo:
- `preview-player.test.mjs` is `node:test` based and needs no browser:
  `node --test preview-player.test.mjs`
- `brand-design.test.mjs` is Playwright-based and checks the storefront layout, the
  tagged audio preview, the "DOWNLOAD FREE" package menu and all three gated paths
  (the MP3 email gate, the three-step WAV gate — subscribe + the beat's own video + Instagram
  — and the five-step exclusive gate, which adds TikTok and X; it asserts the comment step is
  gone). A social step is watched through its hold: it is not done the moment it is clicked,
  it reports VERIFYING, and only then draws its tick. The test asserts each step's exact
  destination, including that the `like` href is the beat's own YouTube URL, the same one the
  icon beside the title opens, and that the MP3 gate carries no social step at all. Every gate must then reach
  the REVIEW & SIGN stage, where the test proves the order is enforced — SIGN & UNLOCK is locked
  with a full name alone or a drawing alone until the terms pane is scrolled to the end *and*
  both halves exist, a single-word name (`Madonna`) stays locked and is *still* refused after
  its `disabled` attribute is stripped — and it signs `Jordan Vega` **and** inks the pad with
  real pointer strokes, then lands on
  the download page: its 3D flower branding, the metadata chips, the file rows under their
  studio names (`KYROIII - FLESH (130 BPM - AM).mp3`, `… .wav`, `… - TRACKED STEMS.zip`) and the
  certificate block (a minted `KYRO-YYYY-FLESH-NNNNNN` serial, no raw text). It then downloads
  the PDF license (asserting it saves directly as
  `KYROIII - LICENSE - FLESH (KYRO-YYYY-FLESH-NNNNNN).pdf`) and asserts
  the `PROD. BY KYROIII` credit, the commercial grant, the package's `includes`, the embedded
  flower image, the centred masthead, the **ALL-CAPS** rule (no lowercase in any drawn string),
  the monochrome palette (every colour an equal-channel grey, so zero blue), the footer barcode +
  `HTTPS://KYROILL.STORE`, the LICENSEE block carrying the signature and the address the flow
  submitted, `PAGE 1 OF 1` and three distinct serials — straight from the PDF bytes. The
  hand-drawn signature is verified as real vector ink: multi-point paths inside the LICENSEE
  column, which a re-signed, typed-only license does not contain, inked in pure white with no
  silver pen left. Nothing
  draws behind the LICENSEE signature any more (no `.sign-watermark`, no `.license-cert__watermark`
  and no `/GS1` in the PDF); the flower's second draw is the LICENSOR approval stamp, asserted in
  the right column with its `OFFICIAL VERIFIED SEAL` / `AUTHORIZED LICENSOR` legend, and the
  hand-drawn issuance's micro-line is asserted to carry the full name that signed it. It also
  proves TYPE and DRAW are one readiness machine: typing `MATAN MAMADOV` on TYPE keeps the
  button locked until the pad is inked, a drawing with the name empty or a single word (`MATAN`)
  keeps it locked on both tabs, and only both halves enable it — identically on TYPE and DRAW.
  The empty-area clicks are watched from both stages: the backdrop at `(5, 5)`, a viewport-corner
  mouse click and a click on the modal root never close, reset or dismiss a gate or a signature
  in progress. The download page's re-sign field refuses a single word the same way; re-signing
  then downloads again, proving the new name replaces the old one in caps on the next issuance. It also
  asserts the gate posts a valid address to the configured newsletter provider (and never a
  malformed one, and never on a re-opened gate), that the backdrop and Escape never dismiss a
  gate or the sign stage (only CANCEL does), that selecting a package passed on the download page
  re-opens the full gate and still requires the signature (nothing is auto-opened or prefilled,
  nothing is re-posted until submit, and the record is gone after a reload), and that nothing is
  written to `localStorage`/`sessionStorage`. It needs
  Chromium + root `node_modules`,
  which the sandbox does not install. To run it without touching the checkout, copy the repo
  into a `node:22` container and install there:
  `docker run --rm -v "$PWD":/src:ro -w /work node:22 bash -lc 'cp -r /src/. /work/ && cd /work && npm i @playwright/test@1.63.0 && npx playwright install --with-deps chromium && node --test brand-design.test.mjs'`.

## Deliberate behaviour worth knowing

Downloads are plain same-origin files. All three packages sit behind a gate (an email for the
MP3, plus subscribe + like-the-beat + Instagram for the WAV, and those plus TikTok and X for
the exclusive — there is no comment step), which are lead-capture courtesies rather than
enforcement — the files themselves are public and nothing on
the server blocks them, and the grant token is just a URL parameter. The strict half of
"genuine interaction" is what a static page can actually enforce: a trusted
click and a real dwell on each step (`STEP_HOLD_MS`), plus a **full name AND a drawn signature**
captured in the sign step — both are required on **both** TYPE and DRAW tabs, so neither a
typed name alone nor a bare drawing can stand in for the other (a single word, a blank field, an
unsigned pad and a token dot are all refused before the unlock button will move, and the submit
handler refuses them again if the attribute is stripped). A departure to the opened tab only ever *shortens* that hold — it is recorded, never
required — because a blocked popup would otherwise strand a real visitor, and because a
headless browser reports no blur at all (measured, so no check can depend on it).
The dialog has one exit — its CANCEL button. The backdrop and Escape are inert, so a stray tap
or key cannot wipe a gate or a signature in progress. The in-page `grants` record never skips a
selection: a visitor who passes a package and selects it again in the same view is asked in full
again, with the signature stage empty and locked, while a reload, a new tab or another browser is
asked from scratch. The
email is the one thing that can leave the browser: with `KYROlll_NEWSLETTER` configured, the gate
posts the address to that provider (the opt-in box is a required part of every gate).

`index.html` pre-renders the active release's beat card so a direct beat link
(`?beat=…`) paints without a flash; `script.js` replaces the grid contents right after
parse. Home is the default state: the head only adds `beat-page` when the URL carries
`?beat=`, and `html:not(.beat-page) #grid > .beat-detail` keeps that pre-rendered card
hidden on the home route — so entering the store never flashes a beat page before the
homepage hero.
