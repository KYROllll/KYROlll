# KYROIII — underground / pearl study

## Brand assets

`assets/LOGO KYROlll.svg` is the supplied Downloads artwork, retained verbatim.
It contains a raster image and alpha mask inside an SVG wrapper. The brand build
traces the mask at 768px, including all eight petals and the two center cutouts.
The narrow center traces use a slightly stronger simplification so their pixel
steps cannot form an extra wedge in the extruded mesh. No circular backing is
generated.

`brand-logo.js` extrudes those contours with beveled edges using Three.js. A soft
pearl-white physical material (low metalness, high roughness, gentle clearcoat)
sits in a dim studio with large soft panels and a hemisphere fill, so the flower
reads as the original clean artwork rather than harsh chrome. Quaternion-composed
rotations turn slowly and fully around Y (26s), X (78s), and Z (156s) without
snapping. Inset bevels keep the mesh within the source silhouette. The canvas is
transparent, with no backing geometry or enclosing CSS decoration. The PNG
fallback (soft pearl gradient) remains visible if WebGL or the geometry fails to
load. Motion respects reduced-motion preferences, can be paused with the visible
control, and skips rendering offscreen/in hidden tabs.

Rebuild after changing the artwork or renderer:

```sh
npm ci
npm run build:brand
```

This generates the contour JSON, pearl SVG/PNG, social/PDF JPEG, email doodle
strip, local renderer and background bundles, and `email-template.html`. Ship
these generated files with the storefront. The renderer has no external CDN
dependency.

## Store palette: black, white, silver, with the restored hero accent

The storefront is built on deep matte black `#0B0B0B`, pure white `#FFFFFF`,
silver `#888888` and their equal-channel grey siblings. One section is a
deliberate colour exception: the hero's `THAT MY FAVORITE` tagline and pixel
heart keep their original neon-green and vivid-pink glitch accents. Every other
color literal in `style.css` is an equal-channel grey. The generated PDF remains
monochromatic by construction (`license-pdf.js` draws only equal-channel greys).
Beat cover art keeps the colour it was supplied in, and so does the vinyl disc:
it is a photograph (below), not a painted gradient, so its tan label never
becomes a CSS colour. The brand marks keep their colour too. See "Beat art keeps
its colour; the vinyl disc is a photograph".

Its borders are the crisp white/silver pair: a pure white frame (`1 1 1`, the
requested `#FFFFFF`) with a silver hairline and silver rules at
`0.631 0.631 0.631` — `#A1A1A1`, the neutral twin of `#A1A1AA`, chosen over the
requested hex itself because `#A1A1AA` carries nine blue units and the document
allows none. The flower hero has no box, plate or frame around it: the still is
composited on the field's own `#0B0B0B`, so the mark simply floats.

The "DOWNLOAD FREE" package menu is a drawer, not a popup: it renders inside the
trigger's own container, spans exactly the button, butts straight onto its edge
and pours a soft white ambient bloom (`downloadAmbientPulse`) from the button
into the panel. Its text is uppercase and its few literals (`#101010`, `#484848`,
white) are equal-channel greys, so the open drawer passes the same zero-hue and
ALL-CAPS audits the rest of the store does.

## Beat art keeps its colour; the vinyl disc is a photograph

The beat cover art is shown exactly as supplied on both the catalog tiles
(`.catalog-tile__art img`) and the beat detail (`.beat-detail__artwork img`):
no `grayscale()`, no `saturate(0)` and no other filter. The brand marks are never
re-cut or desaturated either: the brush X on the falling canvas
(`body > canvas`), `.footer__logo`, `.brand-wordmark__mark`, the vinyl record's
`.vinyl-record__logo` and the two watermark images all paint exactly as they were
drawn — the warm brown of the brush marks and the tints in the wordmark artwork
included.

There is no per-beat vinyl any more. Every beat plays the same record: the
supplied studio photograph, cut to the disc's edge, re-centred on its label and
alpha-masked to a clean circle (`assets/vinyl-classic.png`), painted as the
`.vinyl-record` background. Its grooves, both soft speculars, the unrecorded
lead-in band, the thin bright perimeter edge and the photographic centre label are
therefore real image pixels — nothing in the stylesheet paints a rim, a marbling
plume, a flake field or a tint, and there is no palette module or `--vinyl-*`
colour property. The centre label is the original logo artwork — the white
KYROIII flower on its own solid black plate (`assets/kyrolll-flower-label.png`,
the raster the official logo SVG embeds, pixels untouched) — printed dead centre
on a 30% circle that clears the photographed label's 28.06%, and it is the only
layer above the disc. It never rotates, carries no filter and declares no
animation: the label is ink on a record, not an animated logo. It also never
fades: the artwork is fetched eagerly (never `loading="lazy"`, `fetchpriority="high"`,
`decoding="sync"`) and the disc's pull-out animates the transform alone, so the
print is fully opaque and fully painted before, during and after the slide. No
splash, blob or other artwork layer exists on the record.

The record paints no colour of its own: the plate is the artwork's `#000000`, the
flower is `#FFFFFF`, and the disc is the photograph, so the record is
black-and-white throughout and needs no exception to the stylesheet's
equal-channel audit. (The store's authored colour exceptions are the hero tagline
and the hero's warm bloom.)
``npm run build:brand` remains the single source of truth for every generated brand asset,
and the storefront is the only thing that decides what a hue looks like on screen.

## Falling-X background

`background-x.js` paints the brush X (`assets/kyrolll-brown-x.png`, in the warm
brown it is drawn in — the canvas carries no filter) onto an absolute
document-height canvas behind the
storefront. Sprites drift downward with gentle rotation until they land at a
page coordinate, where they remain still as the visitor scrolls past. New page
height adds marks without moving the existing ones. The canvas honors
reduced-motion, the shared pause toggle (via the `motion-toggle` event), and tab
visibility.

## Secondary mark and compact catalog

`assets/logos/kyrolll-secondary-source.png` is the provided
`Downloads/Untitled design-28.png` reference. The build extracts its gray wordmark
and brush X into transparent PNGs. The footer uses the full secondary logo; the
layered live-text main title uses the extracted brush mark in its supplied
colour, so the identity keeps the accents the artwork was drawn with. The top banner keeps only the motion control,
leaving the hero as the sole brand mark above the catalog.

To intentionally replace that reference:

```sh
npm run build:brand -- --secondary-source "/path/to/reference.png"
```

The catalog toolbar holds the compact 2+1 lease card and three-column pricing.
Its border/shine animations respect both reduced motion and the pause control.
Scarcity marketing, stock counters, the ticker, and repeated prices have been
removed from the storefront. Sold-out availability and license/payment rules
continue to be enforced by the existing checkout logic.

## Hero

The hero is a centered single column: the layered KYROIII wordmark (with the
brown brush X), the `THAT MY FAVORITE` tagline with its green / pink glitch
accents and pixel heart, a minimal "EXPLORE BEATS" cue, then the flower as the
dominant centerpiece. The catalog and compact 2+1 lease offer follow the hero
directly; token promotions are paused (see `worker/BASE-TOKEN.md` for relaunch
instructions).

## Responsive

The layout is verified at 360, 375, 390, 414, 768, 1024, and 1440px widths.
A browser sweep asserts zero horizontal overflow, no clipped content, and
storefront layout at each breakpoint. Typography uses fluid `clamp()` sizing
with a monospace accent for technical labels.

## Emails

`worker/src/brand-email.js` is the shared live shell. Purchase receipts and
download rows are assembled in `buildDeliveryMessage` in `worker/src/index.js`.
The preview template is generated from that same shell. Its artist-name
placeholder must be HTML-escaped; its receipt placeholder expects trusted,
server-built HTML.

Emails use inline styles, presentation tables, system-font fallbacks, explicit
dark backgrounds, a static transparent metallic PNG, and plain-text alternatives.
PDF generation uses a separate JPEG URL because its image emitter requires JPEG.
Clients may still apply their own dark-mode transformations or block remote images;
the wordmark and all order/download content remain live text.

Publish storefront assets before deploying the checkout Worker so the new public
image URLs resolve for recipients. No customer email is sent by the preview build.

## Verification

```sh
node --test preview-player.test.mjs worker/catalog.test.mjs
node brand-design.test.mjs
```

The browser check requires Playwright Chromium (`npx playwright install chromium`).
It previews desktop/mobile, exercises cart and payment UI with local fixtures,
checks motion/fallback states, and renders a mixed-license receipt. Screenshots
are written to the OS temporary directory, not the deployed asset directory.
