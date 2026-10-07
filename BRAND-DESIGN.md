# KYROlll — underground / pearl study

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

## Falling brown-X background

`background-x.js` paints the brown brush X (`assets/kyrolll-brown-x.png`) onto an
absolute document-height canvas behind the storefront. Sprites drift downward
with gentle rotation until they land at a page coordinate, where they remain
still as the visitor scrolls past. New page height adds marks without moving
the existing ones. The canvas honors reduced-motion, the shared pause toggle
(via the `motion-toggle` event), and tab visibility.

## Secondary mark and compact catalog

`assets/logos/kyrolll-secondary-source.png` is the provided
`Downloads/Untitled design-28.png` reference. The build extracts its gray wordmark
and brown brush X into transparent PNGs. The footer uses the full secondary
logo; the layered live-text main title uses its original brown X. The top banner
keeps only the motion control, leaving the hero as the sole brand mark above the catalog.

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

The hero is a centered single column: the layered KYROlll wordmark (with the
brown brush X), a minimal "EXPLORE BEATS" cue, then the flower as the dominant
centerpiece. The redundant tagline was removed so the flower has full breathing
room. The catalog and compact 2+1 lease offer follow the hero directly; token
promotions are paused (see `worker/BASE-TOKEN.md` for relaunch instructions).

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
