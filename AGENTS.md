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
  package then sits behind its gate (an email, plus a YouTube subscribe + like for the WAV
  and the exclusive). **Nothing is ever written down** — no `localStorage`, no
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
- **One palette for the store's own paint — and no filters on the art.** The storefront is
  deep matte black `#0B0B0B`, pure white `#FFFFFF` and silver `#888888`, with the original
  neon-green / vivid-pink glitch palette isolated to the hero tagline and heart. Every colour
  literal outside that tagline section in `style.css` is an equal-channel grey, and the
  `theme-color` metas are `#0b0b0b`. The supplied raster
  artwork is **not** desaturated, because the store shows its art rather than tinting it:
  `body > canvas` (the falling brush X), `.footer__logo`, `.brand-wordmark__mark`,
  `.vinyl-record__label` and both watermark images paint in the colour they were drawn in —
  the warm brown of the brush marks included — so no `grayscale()`/`saturate()` belongs in any
  of their chains. `npm run build:brand` (which needs `sharp`) still owns those files and is
  still the only thing that may re-cut them. The generated PDF is equal-channel by construction
  (`license-pdf.js`), and the brand-design test asserts both halves: it reads every colour out
  of the PDF bytes and every colour literal outside the dedicated tagline section of `style.css`.
  Keep any new CSS accents scoped to the tagline; all other storefront styling stays neutral.
- **The dialog is a phone citizen.** `.gate-modal` is measured in *dynamic* viewport units
  (`height: 100vh; height: 100dvh`) and the card scrolls inside it, so the unlock button can
  never hide behind mobile browser chrome; `downloads.js` also pins the page's scroll offset on
  the body while a gate is open (a plain `overflow: hidden` makes iOS jump to the top) and
  restores it on close. Inputs render at 16px on phones, so iOS does not zoom the page on
  focus, and every control on the path carries `touch-action: manipulation` (no 300 ms
  double-tap-zoom wait) while the signature pad keeps `touch-action: none` (it owns the
  gesture). One outside-click handler is installed for the life of the page — it used to be
  installed per gate and only removed on Escape, so every gate left another listener behind.
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

- `window.KYROlll_YOUTUBE_CHANNEL` — where the "subscribe" step sends the visitor
  (`?sub_confirmation=1` makes YouTube show its own subscribe prompt). Currently
  `https://www.youtube.com/@KYROllllll?sub_confirmation=1`.
- `window.KYROlll_PACKAGES` — exactly three options per beat:
  `mp3` (`"MP3 LEASE"`, `gate: "email"`), `wav` (`"STANDARD WAV LEASE"`,
  `gate: "youtube"`) and `exclusive` (`"EXCLUSIVE / PRO PACKAGE"`, `gate: "exclusive"`).
  `gate` is the whole behaviour: `email` asks for an address, `youtube` adds a subscribe +
  like before that address, `exclusive` is that same two-step flow with its own copy and
  submit label (there is **no** comment step), and `instant` (kept for a package that should
  skip the gate, unused today) goes straight to the download page. Every gate requires the address **and** the opt-in checkbox, and every gate then closes with the same
  REVIEW & SIGN stage (below). `includes` is the plain-language
  list of what the package hands over (MP3 → tagged MP3 + license; WAV → tagged MP3 +
  high-quality WAV + license; exclusive → tagged MP3 + WAV + tracked stems + full rights +
  email opt-in) and is printed verbatim in the generated license.
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
  `deliverablesFor(beatId, packageId)`, `videoFor(beatId)` and `newsletterEndpoint()`.
- `window.KYROlll_NEWSLETTER` — `{ provider, username, endpoint }`, where the email gate sends a
  new subscriber. The repo ships with a **Formspree** form wired to `endpoint`
  (`https://formspree.io/f/xgaoppwo`), posted to with `fetch` and `Accept: application/json` so
  the submission lands in the dashboard; swap it for any provider that accepts a form POST and
  answers with CORS (Buttondown's `embed-subscribe` URL, a Beehiiv subscribe form, …) — for
  Buttondown just set `username`. Left blank, the gate still unlocks the files and sends nothing.

`downloads.js` exposes `window.KYROlll_DOWNLOADS` and owns the whole interaction. It has
**no backend** — no Supabase, no worker and no storage of any kind (the old
`readEmail`/`writeEmail`/`markUnlocked` API is gone). Its one memory is the in-page `grants`
`Map`: `isUnlocked(beatId, packageId)` answers from it, `finalizeGate` fills it, and `start`
short-circuits a package it already holds — so the same view never asks twice, while a reload
starts empty. The only outbound request is the email gate's
subscribe POST (`postSubscribe`: `fetch(endpoint)` with `Accept: application/json` and a
form-urlencoded body — the shape Formspree records in its dashboard):

- The `[data-download-trigger]` button (delegated once on `document`, so a re-rendered
  grid keeps working) opens the `.download-menu` — the old downward-only license dropdown,
  relabelled. **It is not a popup.** `openMenu` renders it inside the trigger's *own*
  container (`.download-actions` / `.catalog-tile__actions`), so `positionMenu` takes both
  side edges and the seam straight off the trigger's own box (no horizontal maths at all) and
  the pair reads as one control that unfolds. `positionMenu` only picks the direction — down,
  or `.download-menu--up` welded to the button's top edge when the space below is the cramped
  side — and caps `max-height` to the visible viewport, so a short screen scrolls the tiers
  inside the drawer instead of running off it. Two pieces keep it uncut: its host
  (`.download-actions` / `.catalog-tile__actions`) carries an explicit `overflow: visible`,
  restated so a later rule cannot shave the open drawer off at its own container's edge, and
  the storefront's page-wide guards are `overflow-x: clip` only — `clip` on one axis leaves the
  other `visible`, so nothing in the ancestor chain clips the drawer vertically and there is no
  `overflow: hidden` anywhere to remove. It is deliberately **not** `position: fixed` on
  phones: `.beat-detail__content` carries a `backdrop-filter` and the catalog tiles carry a
  `transform`, both of which make them containing blocks for fixed descendants, so a fixed
  drawer would be positioned against the glass card instead of the viewport. The drawer holds a
  very high `z-index` (`9999`) inside its own container — safe, because the gate modal (200) and
  the toast (260) live on `<body>` and win from the root stacking context — and while closed it
  is also `visibility: hidden`, so an unopened drawer is inert to pointer and keyboard, while
  every `.download-tier` re-states `pointer-events: auto` so a tap always lands on the option
  itself. The direction is decided on the drawer's *real*
  measured height (`natural > below && above > below`), never on a guess: a drawer that misses
  the room below by a few pixels turns around instead of capping itself and making the visitor
  scroll for the last tier. **The trigger is a switch**: a tap on the trigger that owns the open
  drawer closes it (same delegated listener), because re-rendering it under the finger restarted
  the reveal animation and read as a second, stray panel. Page scrolling repositions nothing
  (the drawer travels with its button), so there is no scroll listener to lag behind a swipe;
  only `visualViewport` resize/scroll is watched, one reposition per frame. Because the drawer is
  part of the button, the delegated click also accepts a tap that lands on that container (a
  tile footer is padding around a slim button, and a finger is not a pixel), and the catalog
  tile drops its 3D hover transform while the drawer is open. `is-menu-open` is set on the
  container, the tile and `.beat-detail` — the last lifts the copy column over the sleeve,
  because the cover art is a positioned sibling painted after it and otherwise swallows the
  open drawer's taps. Opening also lifts the tile (`.catalog-tile.is-menu-open` gets
  `position: relative; z-index: 5`), because a tile later in the grid paints after this one and
  would otherwise cover an unfolded drawer. The container also carries the **ambient glow**:
  `.is-menu-open::after` is one blurred white bloom pouring out of the button into the drawer
  with a slow breath (`downloadAmbientPulse`, cancelled under reduced motion), and the lit
  button keeps a white `box-shadow` while `aria-expanded="true"`. The bloom is pinned to the
  container's own box (`left`/`right: 0`, a percentage height centred on the button) instead of
  being a fixed-width disc, so the light belongs to the button and can never wander sideways
  out of its column. One more fix worth keeping:
  `.catalog-tile:focus-within` no longer adds the 3D tilt (only `:hover` does) — it fired on
  mousedown, so the tile rotated under the finger, the slim button slid out from under the
  pointer and the click landed on the container: the button looked dead.
- `start(beatId, packageId)` resolves the beat + package, then opens that package's gate and
  continues on success (`gate: "instant"` short-circuits straight to the download page). It does
  **not** consult the in-page grant itself: `openGate` answers an already-unlocked package with
  the "ALREADY UNLOCKED THIS SESSION" toast and the same continuation, so the memory is read on
  exactly one path.
- `openGate(beat, pack, onUnlocked)` renders `.gate-modal` (backdrop + card) into `<body>`
  and adds `html.gate-open`. Each package asks for exactly what its listing promises:
  `gate: "email"` (MP3 lease) is the address only, `gate: "youtube"` (Standard WAV lease)
  shows **one** numbered step — subscribe to the channel — and `gate: "exclusive"` (Pro
  package) shows **two**: subscribe, then like this beat's own video
  (`youtubeSteps(channel, video, count)`, one `.gate-step` row per step); each row opens in a
  new tab, and each completed step morphs its number into a tick
  that draws itself (`.gate-step__tick`, monochrome). All three gates are wired by **one**
  block: only the step count (`[]` / `[false]` / `[false, false]`) and the two hint lines
  (`STEP_COPY`) differ, so the three copies of the same input/change/keydown/submit listeners
  are gone and a fourth package would only add a row to that table. **A step is not a
  click-through.**
  `wireYouTubeSteps` marks one done only when (a) the click was genuine — a scripted click
  (`isTrusted === false`) is refused outright — and (b) the row has held in its VERIFYING
  state for `STEP_HOLD_MS` (3.5 s), which is what stops the quick-bounce bypass of opening
  the tab and submitting immediately. The hold is shortened to `STEP_QUICK_MS` (1.2 s) only
  when the page really lost focus to the opened tab during it; a blocked popup still
  completes on the full hold, so a real visitor is never trapped. Re-clicking a step while
  it verifies does nothing: no second tab and no shortened hold. Every gate renders the same real
  `<form data-gate-form>` (with `action` pointed at
  the provider, so the flow degrades without scripting) holding one email field
  (`#gate-email`), the mandatory opt-in checkbox (`#gate-optin`, ticked and `required`), an
  inline error (`#gate-error`) and the CANCEL/backdrop (`[data-gate-cancel]`) + submit
  (`[data-gate-submit]`) row. The field always starts **empty** and the submit only enables
  once the address is well formed, the box is ticked and every step is done, so a plain click
  cannot skip anything; Enter on the field runs the same `submitGate`, which is also where a
  malformed address is refused with `#gate-error`. Escape or CANCEL closes. `submitGate` posts
  the address with `postSubscribe` and then hands the *same* card over to the sign stage
  (below) instead of leaving for the download page — the files stay locked until the license
  is signed.
- `showSignStage(beat, pack, email, onUnlocked)` is the last screen of every gate: the terms
  in their own scroll pane (`.sign-terms`), a TYPE / DRAW switch (`.sign-mode`), the signature
  sheet — the flower mark as a faint watermark (`.sign-watermark`) behind the field
  (`#sign-name`) or the pad (`.sign-pad__canvas`, pointer events, monochrome white ink,
  `touch-action: none`, DPR-scaled bitmap so the ink is crisp on a retina phone) — the live
  stamp (`[data-sign-stamp]`) and the one action that unlocks, `[data-sign-submit]`
  (**SIGN & UNLOCK**). The button only comes alive once the terms have been read **to the
  end** — `scrollHeight <= clientHeight`, or the pane scrolled to the bottom — *and* a real
  signature exists: a **FULL name** typed (`isFullName`: 2–4 name parts, each at least two
  letters, letters only) or a **genuine drawing** (`drawingValid`: `SIGN_INK_MIN` = 8 thinned
  points spread over at least `SIGN_SPAN_MIN` = 0.3 of the pad's width + height, so a tap, a
  dot or a two-point flick cannot sign). A single word, a blank line, initials and digits are
  all refused, and the refusal is enforced again inside the submit handler — so stripping the
  button's `disabled` attribute (the one thing a script can do) still unlocks nothing. The
  stage keeps two functions for that reason: `applyState()` moves the button, the stamp and the
  hint, while `refresh()` is `applyState()` plus `hideGateError`. Only a deliberate edit or a
  mode switch calls `refresh`; the terms pane's own `scroll` listener calls `applyState`,
  because reporting a refusal grows the card, the pane takes a scroll from that reflow and the
  pane's handler used to land in `refresh` — so the refusal hid itself in the frame it was
  announced (it showed up as an intermittent missing-error failure). The first pass is a
  `requestAnimationFrame(applyState)`, since a pane cannot say whether it scrolls until the
  sheet is laid out. A touch
  that slides off the pad keeps its stroke (the pointer is captured; only a mouse ends one on
  `pointerleave`), because a dropped stroke is what made people sign twice. The pad keeps at
  most `SIGN_POINTS` thinned points per stroke and 12 strokes, because the drawing has to fit
  in a URL. On SIGN & UNLOCK the signature is captured and `finalizeGate` runs.
- `downloadUrl(beatId, packageId, email)` is the hand-off to the download page: the URL carries
  a one-shot grant token (`?t=<random hex>`, minted fresh when a gate is passed) and, when there
  is one, the address just submitted (`?email=…`), the signed name (`?sign=…`) and a drawing
  (`?sig=<points packed as hundredths, strokes joined by ~>`). **None of it is stored
  anywhere** — the token only means "this flow passed the gate a moment ago", so the download
  page does not ask a second time, while a cold link (a bookmark, a shared URL, a new browser)
  has no token and is gated over the page.
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
the signature captured in the gate's sign step: a typed name set large on its rule, or a
**hand-drawn signature re-emitted as vector strokes** (`drawSignature`, silver, round caps) in
the same box. Behind that block sits the document's second flower — the *same* embedded mark,
drawn again at `WATERMARK_ALPHA` (0.08) through the `/GS1` `/ExtGState`, so the watermark costs
the file nothing and cannot carry a hue. The micro-line under that rule records who the
issuance went to — `SIGNED <date> - <address>` — and the LICENSOR side is `KYROIII`.

Object numbering is positional and easy to break: 1 catalog, 2 pages, 3 Helvetica, 4
Helvetica-Bold, **5 the watermark's `/ExtGState`, 6 the flower image**, then two objects per
page from `FIRST_PAGE_OBJ` (7). Adding or removing an object above the pages means moving that
constant, the `/GS1`/`/Im1` resource references and the `total` xref count together.

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
`.license-cert` block that shows the minted serial (`#license-serial`) over the signature that
came with the flow — `boot()` adopts `?sign=` / `?sig=` through `adoptSignature` before anything
is rendered, so the stamp line (`#license-stamp`) shows the name signed in the gate, or replays
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
`downloads.js` mints when a gate is passed, so a cold link — a shared URL, a bookmark, a new
browser — is gated over the page and the flow is the same from any entry point (and that cold
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
  (the MP3 email gate, the YouTube gate and the two-step exclusive gate — it asserts the
  comment step is gone). A YouTube step is watched through its hold: it is not done the moment
  it is clicked, it reports VERIFYING, and only then draws its tick. Every gate must then reach
  the REVIEW & SIGN stage, where the test proves the order is enforced — SIGN & UNLOCK is locked
  with a signature alone until the terms pane is scrolled to the end, a single-word name
  (`Madonna`) stays locked and is *still* refused after its `disabled` attribute is stripped —
  and it signs `Jordan Vega` (typed) or inks the pad with real pointer strokes (hand-drawn, on the
  pro flow), then lands on
  the download page: its 3D flower branding, the metadata chips, the file rows under their
  studio names (`KYROIII - FLESH (130 BPM - AM).mp3`, `… .wav`, `… - TRACKED STEMS.zip`) and the
  certificate block (a minted `KYRO-YYYY-FLESH-NNNNNN` serial, no raw text). It then downloads
  the PDF license (asserting the saved filename is exactly `KYROIII - FLESH (130 BPM - AM).mp3`)
  and asserts
  the `PROD. BY KYROIII` credit, the commercial grant, the package's `includes`, the embedded
  flower image, the centred masthead, the **ALL-CAPS** rule (no lowercase in any drawn string),
  the monochrome palette (every colour an equal-channel grey, so zero blue), the footer barcode +
  `HTTPS://KYROILL.STORE`, the LICENSEE block carrying the signature and the address the flow
  submitted, `PAGE 1 OF 1` and three distinct serials — straight from the PDF bytes. The
  hand-drawn signature is verified as real vector ink: multi-point paths inside the LICENSEE
  column, which no typed license contains. The flower watermark is asserted in all three places it
  is stamped — the signature sheet (`.sign-watermark img`), the certificate block
  (`.license-cert__watermark img`) and the PDF (the second `/Im1 Do`, drawn through `/GS1 gs`).
  Re-signing on the download page then downloads again,
  proving the new name replaces the old one in caps on the next issuance. It also
  asserts the gate posts a valid address to the configured newsletter provider (and never a
  malformed one, and never on a re-opened gate), that a package passed on the download page is
  remembered in-page only (the gate never re-opens, nothing is re-posted, and the memory is gone
  after a navigation), and that nothing is written to `localStorage`/`sessionStorage`. It needs
  Chromium + root `node_modules`,
  which the sandbox does not install. To run it without touching the checkout, copy the repo
  into a `node:22` container and install there:
  `docker run --rm -v "$PWD":/src:ro -w /work node:22 bash -lc 'cp -r /src/. /work/ && cd /work && npm i @playwright/test@1.63.0 && npx playwright install --with-deps chromium && node --test brand-design.test.mjs'`.

## Deliberate behaviour worth knowing

Downloads are plain same-origin files. All three packages sit behind a gate (an email, plus a
YouTube subscribe + like for the WAV and the exclusive — there is no comment step), which are
lead-capture courtesies rather than enforcement — the files themselves are public and nothing on
the server blocks them, and the grant token that skips the second ask is just a URL parameter.
The strict half of "genuine interaction" is what a static page can actually enforce: a trusted
click and a real dwell on each step (`STEP_HOLD_MS`), plus a **full name and a signature**
captured in the sign step (a single word, a blank field and a token dot are all refused before
the unlock button will move, and `submitGate` refuses them again if the attribute is stripped). A departure to the opened tab only ever *shortens* that hold — it is recorded, never
required — because a blocked popup would otherwise strand a real visitor, and because a
headless browser reports no blur at all (measured, so no check can depend on it).
The gate is remembered for the current page view only (`grants`), so a visitor who passes it and
comes back in the same view is not asked twice — while a reload, a new tab or another browser is
asked again from scratch, and no gate can ever be skipped by anything that outlives the page. The
email is the one thing that can leave the browser: with `KYROlll_NEWSLETTER` configured, the gate
posts the address to that provider (the opt-in box is a required part of every gate).

`index.html` pre-renders the active release's beat card so a direct beat link
(`?beat=…`) paints without a flash; `script.js` replaces the grid contents right after
parse. Home is the default state: the head only adds `beat-page` when the URL carries
`?beat=`, and `html:not(.beat-page) #grid > .beat-detail` keeps that pre-rendered card
hidden on the home route — so entering the store never flashes a beat page before the
homepage hero.
