# BRAND UI — KYROIII MASTERING METER

A dark instrument panel, not a dashboard. Matte black field, brushed gold
hardware, warm brown depth, cream type, and three-lamp diagnostic windows.

## 1. Colour tokens

| Token | Hex | Use |
| --- | --- | --- |
| `background` | `#0A0A0A` | Plug-in field |
| `panel` | `#11100E` | Window body |
| `panelRaised` | `#171410` | Header / button hover |
| `hairline` | `#2B2419` | Window outlines, rules |
| `hairlineSoft` | `#1D1913` | Graph grid, internal dividers |
| `gold` | `#D4AF37` | Primary accent, units, rules |
| `goldBright` | `#E5C158` | Sparkline, highlights |
| `brown` | `#6B4A2E` | Flower depth, warm gradients |
| `brownDeep` | `#3A2A1C` | Ambient glow, pressed states |
| `cream` | `#F2EDE3` | Primary text, values |
| `muted` | `#8A8175` | Secondary labels |
| `dim` | `#5C554B` | Inactive readouts |
| `good` | `#6FE08A` | Traffic light 1 / OK |
| `warn` | `#E5C158` | Traffic light 2 / WATCH |
| `bad` | `#FF5C4D` | Traffic light 3 / FAIL |
| `idle` | `#3A352E` | Unlit lamp |

Rules:

- The field is never pure black `#000000`; `#0A0A0A` keeps the brushed-gold
  edges from clipping.
- Gold is a **line and label** accent. Large areas stay black/brown; do not paint
  a whole card gold.
- The three lamp colours are semantic. Do not reuse `bad` for decorative
  accents.
- All caps, always. The wordmark is `KYROIII`; it is not `KyroIII` or `KYROlll`
  in visible UI.

## 2. Typography

| Role | Face | Size | Tracking | Case |
| --- | --- | --- | --- | --- |
| Wordmark | Helvetica Neue Bold | 34 px | 4.2 px | `KYROIII` |
| Window title | Menlo | 9 px | 2.2 px | ALL CAPS |
| Big value | Helvetica Neue Bold | 43 px | −0.03 em | Numerals |
| Unit | Menlo | 7.5 px | 1.8 px | ALL CAPS |
| Status | Menlo | 7.5 px | 1.4–1.5 px | ALL CAPS |
| Detail label | Menlo | 7 px | 1.4 px | ALL CAPS |
| Detail value | Menlo | 9 px | 0.6 px | ALL CAPS |
| Footer | Menlo | 7 px | 1.6–1.9 px | ALL CAPS |
| Session clock | Menlo | 19 px | 1.2 px | Numerals |

The C++ UI uses `juce::FontOptions` with `Helvetica Neue` and `Menlo`. The
browser preview uses the nearest system stacks. No web fonts, no raster type,
no outlined text.

## 3. Layout geometry (JUCE)

```
1100 × 680 panel
├── header        110 px
│   ├── flower     76 × 76 at (24, 18)
│   ├── wordmark   x = 116, y = 12
│   ├── subtitle   y = 58
│   └── session    right edge − 24, width 244
├── content       24 px side margins, 14 px gap
│   ├── row 1: LOW-END WEIGHT | STEREO CORRELATION
│   └── row 2: LUFS METERING  | DYNAMIC RANGE
└── footer         56 px
    ├── APPLE SILICON NATIVE // AU + VST3
    ├── KYROIII PRECISION DIAGNOSTICS // V0.1.0
    └── RESET METERS (144 × 28, right)
```

- Window cards use a 3 px corner radius, a 1 px `hairline` outline, a short gold
  top rule and four 1 px gold corner ticks.
- The header and footer are separated by a gold-to-transparent gradient rule.
- A very low-opacity horizontal scanline texture (every 4 px) gives the field
  depth without reading as a pattern.
- A radial warm-brown glow sits behind the header, fading into the field. It
  must never wash out the value text.

## 4. Window anatomy

```
┌────────────────────────────────────────────────────┐
│ LOW-END WEIGHT                  WATCH   ● ○ ○      │  title · text · lamps
│                                                    │
│  -8.4        ╱╲    sparkline                       │  value · 42 % graph
│  DB / 20-120 HZ                                    │
│  STATUS / WATCH                                    │
│  ─────────────────────────────────────────────     │
│  BAND              │ TARGET                        │
│  SUB / 20-120 HZ   │ -14 TO -3 DB                  │
└────────────────────────────────────────────────────┘
```

- The primary value is the largest element in the card.
- The unit is gold; the status line is the status colour.
- The sparkline is a 42 %-width right column with a 5 px gold glow, 1.5 px bright
  gold line, a subtle gradient fill and a cream endpoint dot.
- The two detail fields are separated by a 1 px soft hairline.
- `IDLE` is a valid state: no lamp, muted text, `-` value, no fake zero.

## 5. Traffic-light semantics

| Status | Lamp | Text | Meaning |
| --- | --- | --- | --- |
| `good` | Green | `OK` | Inside the target window |
| `warn` | Amber | `WATCH` | Close to the edge / needs attention |
| `bad` | Red | `FAIL` | Outside the diagnostic window |
| `idle` | None | `IDLE` | No signal or still warming up |

- Only one lamp is lit at a time; the other two stay dark with a hairline ring.
- The active lamp gets a soft 12 px glow and a brighter fill.
- **Never rely on colour alone**: the header text and the `STATUS / …` line both
  spell the state out. This is also why the preview includes both.
- The three lamps always appear in the same order: green, amber, red.

## 6. Flower

- Eight petals, each a vertical ellipse rotated 45° around the centre.
- Petal fill runs from bright gold at the tip to warm brown at the root.
- A dark centre disc with a gold ring and a bright gold core; eight tiny gold
  dots sit around it.
- A 1 px outer ring and a very soft gold halo frame the mark.
- Motion: one full turn every ≈28 s, linear, no bounce, no easing, no pulsing.
- Click the flower to pause/resume. Respect `prefers-reduced-motion` in the
  preview; the JUCE version exposes the click toggle.
- Do not rasterize the flower in the plug-in. The preview ships `flower.svg`;
  the C++ version is the same geometry drawn as `juce::Path`s.

## 7. Copy rules

- Everything the user reads is ALL CAPS: `LOW-END WEIGHT`, `STEREO
  CORRELATION`, `LUFS METERING`, `DYNAMIC RANGE`, `RESET METERS`, `NO CLIP`,
  `CLIP LATCH`, `SESSION`, `OK`, `WATCH`, `FAIL`, `IDLE`.
- Units are lowercase in normal prose only when referring to the standard
  (`LUFS`, `LU`, `dB`). In the UI, write `DB`, `DBTP`, `LUFS`, `LU`.
- Use `-` for a missing value, not `0.0` or `N/A`.
- The target is `-14 LUFS`; write the minus sign as a plain hyphen in the UI for
  font consistency.
- Do not add marketing copy inside the meter windows. The console is a tool.

## 8. Motion and accessibility

- 30 Hz UI timer; no animation of layout, shadows or colours on the audio path.
- The flower is the only continuous animation. It is decorative; it has no
  meter function.
- Lamp transitions are 120 ms linear colour/opacity only.
- All interactive controls have a visible focus ring (1 px bright gold, 4 px
  offset).
- Status is duplicated as text, so colour-blind users can read the state.
- The preview honours `prefers-reduced-motion`; the JUCE editor can add a
  reduced-motion check if the host exposes it in the future.

## 9. Preview parity

`preview/index.html` + `style.css` + `ui.js` are the design reference. They must
match:

- the same four window titles and order;
- the same tokens (search for `--gold`, `--bad`, etc.);
- the same traffic-light order and active-lamp treatment;
- the same ALL-CAPS copy;
- the same 2×2 desktop grid, collapsing to one column under 820 px;
- the same rotating flower (SVG, 28 s).

The preview is allowed to be responsive and to include a live demo. The JUCE UI
is fixed at 1100 × 680. Any visual change should be made in both places, then
verified with `scripts/verify.sh` and a browser reload.
