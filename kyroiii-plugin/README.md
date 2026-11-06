# KYROIII MASTERING METER

**A custom AU / VST3 mastering meter and diagnostic console for macOS.**
Matte black, brushed gold and warm brown; a rotating eight-petal flower; four modular traffic-light diagnostic windows.

> **STATUS — INITIAL WORKSPACE / V0.1.0**
> The DSP core is implemented and unit-tested (50/50 checks). The JUCE AU, VST3 and Standalone targets build on Apple Silicon, and the AU passes `auval -v aufx Kmm1 Kyro`. Logic Pro registration, Developer ID signing and notarisation still belong on a machine with a full Xcode install; see [`docs/BUILD-MACOS.md`](docs/BUILD-MACOS.md).

---

## WHAT IT DOES

| WINDOW | PRIMARY READOUT | SECONDARY READOUT | TRAFFIC-LIGHT LOGIC |
| --- | --- | --- | --- |
| **LOW-END WEIGHT** | Low-band energy share, dB (20–120 Hz) | Sub-band target | `OK` −14…−3 dB · `WATCH` −20…−14 or −3…0 dB · `FAIL` outside |
| **STEREO CORRELATION** | Normalised correlation, −1…+1 | In-phase / diffuse / out-of-phase | `OK` ≥ +0.30 · `WATCH` 0…+0.30 · `FAIL` < 0 |
| **LUFS METERING** | Integrated LUFS (BS.1770, gated) | Momentary and short-term LUFS | `OK` −16…−12 · `WATCH` −20…−16 or −12…−9 · `FAIL` outside |
| **DYNAMIC RANGE** | DR = P95 − P10 of short-term LUFS | PLR and true-peak estimate | `OK` ≥ 8 LU · `WATCH` 5…8 LU · `FAIL` < 5 LU |

All thresholds live in one place: [`src/core/MeterTypes.h`](src/core/MeterTypes.h). They are mastering-diagnostic heuristics, not a claim of EBU R128 / Tech 3341 compliance.

### Signal path

```
AUDIO IN ──► PASS-THROUGH (bit-identical) ──► AUDIO OUT
                  │
                  ├─ K-weighting ─► 400 ms / 3 s / integrated LUFS
                  ├─ 120 Hz split ─► low-end energy share
                  ├─ L/R covariance ─► stereo correlation
                  ├─ 4× windowed-sinc ─► inter-sample true peak
                  └─ short-term history ─► DR / PLR
                                     │
                              lock-free snapshot
                                     │
                                JUCE editor @ 30 Hz
```

The plug-in is an **observer**: `processBlock()` never writes to the audio buffer. It can sit on a master bus without changing gain, phase or latency.

---

## QUICK START

### 1. Verify the workspace without JUCE

```bash
cd kyroiii-plugin
bash scripts/verify.sh
```

This checks the layout, shell syntax, CMake preset JSON, brand tokens, documentation links and then compiles + runs the dependency-free DSP test suite with `clang++`.

### 2. Build the AU, VST3 and Standalone app

Requirements:

- macOS 12 or newer (Apple Silicon M1/M2/M3/M4 target by default)
- Full Xcode 15+ (Logic Pro AU validation and signing are best verified with the full IDE)
- CMake 3.22+ (`brew install cmake`)
- Internet access on the first configure, or a local JUCE checkout via `JUCE_PATH`

```bash
cd kyroiii-plugin
bash scripts/build-macos.sh
```

JUCE is pinned to **8.0.15** and fetched by CMake on first configure. To use a local checkout:

```bash
JUCE_PATH=/path/to/JUCE bash scripts/build-macos.sh
```

Universal binary:

```bash
KYROIII_ARCH=universal bash scripts/build-macos.sh
```

### 3. Install for Logic Pro

```bash
bash scripts/install-macos.sh
```

This copies the AU to `~/Library/Audio/Plug-Ins/Components`, the VST3 to `~/Library/Audio/Plug-Ins/VST3`, and the Standalone app to `~/Applications`, then refreshes the Audio Component registrar.

Then:

1. Quit and reopen Logic Pro.
2. Open **Logic Pro → Settings → Plug-in Manager**.
3. Rescan **Audio Units**.
4. The plug-in appears as **KYROIII → KYROIII MASTERING METER**.

Manual validation:

```bash
auval -v aufx Kmm1 Kyro
```

The AU type is `aufx`, subtype `Kmm1`, manufacturer `Kyro`.

---

## VISUAL REFERENCE

The production UI is drawn in JUCE (`src/ui/`). A browser-viewable reference that mirrors the same layout, tokens and traffic-light behaviour lives at:

```
preview/index.html
```

Open it directly in a browser — no build step, no server, no external fonts. The preview is a design reference, not the plug-in binary. It includes a live demo mode and a reset control so the visual states can be reviewed without a DAW.

### Brand system

- Field: matte black `#0A0A0A`
- Panels: `#11100E` / `#171410`
- Primary accent: brushed gold `#D4AF37`
- Highlight: bright gold `#E5C158`
- Warm brown: `#6B4A2E` / deep `#3A2A1C`
- Type: warm cream `#F2EDE3`, muted `#8A8175`
- Traffic lights: green `#6FE08A`, amber `#E5C158`, red `#FF5C4D`
- Typography: **ALL CAPS** everywhere; wide tracking for labels, tight display tracking for the wordmark
- Flower: eight vector petals, slow continuous rotation, click to pause

These gold/brown accents are scoped to the plug-in workspace. The storefront's own monochrome audit lives in the repository root and is deliberately not applied to this product surface.

---

## PROJECT LAYOUT

```
kyroiii-plugin/
├── CMakeLists.txt              # AU + VST3 + Standalone, JUCE 8.0.15
├── CMakePresets.json           # arm64 + universal presets
├── README.md
├── AGENTS.md                   # agent/maintainer notes
├── VERSION
├── scripts/
│   ├── build-macos.sh          # configure + build + optional ctest
│   ├── install-macos.sh        # copy AU/VST3/app, refresh registrar
│   ├── test.sh                 # dependency-free DSP tests with clang++
│   └── verify.sh               # layout + brand + scripts + tests
├── src/
│   ├── core/                   # pure C++17, no JUCE
│   │   ├── MeterTypes.h        # status, thresholds, snapshot
│   │   ├── Biquad.h            # K-weighting + low-pass
│   │   ├── LoudnessMeter.*     # BS.1770 momentary/short-term/integrated
│   │   ├── LowEndMeter.*       # 120 Hz energy share
│   │   ├── CorrelationMeter.*  # normalised L/R correlation
│   │   ├── DynamicRangeMeter.* # P95 − P10, PLR
│   │   ├── TruePeakMeter.h     # 4× windowed-sinc inter-sample peak
│   │   ├── Seqlock.h           # lock-free audio → UI frame
│   │   └── MeterEngine.*       # orchestration + snapshot publication
│   ├── plugin/
│   │   ├── PluginProcessor.*   # AudioProcessor, pass-through
│   │   └── ...
│   └── ui/
│       ├── PluginEditor.*      # editor + 30 Hz timer
│       ├── MeterFace.*         # header, 2×2 grid, footer
│       ├── DiagnosticWindow.*  # modular traffic-light window
│       ├── FlowerLogo.*        # rotating vector flower
│       ├── KyroButton.h
│       └── KyroTheme.h         # colour tokens, fonts, tracked type
├── tests/
│   └── meter_core_test.cpp     # 50 checks, no external deps
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BRAND-UI.md
│   ├── BUILD-MACOS.md
│   └── TESTING.md
└── preview/                    # static UI reference
    ├── index.html
    ├── style.css
    ├── ui.js
    └── flower.svg
```

---

## METERING NOTES

### LUFS

- ITU-R BS.1770 K-weighting: 1.68 kHz +4 dB high shelf followed by a 38 Hz high-pass, re-derived for the current sample rate with the same analogue prototypes used by libebur128.
- Momentary: 400 ms. Short-term: 3 s. Integrated: 400 ms blocks at 75 % overlap, −70 LUFS absolute gate and −10 LU relative gate.
- Calibration anchor: a 1 kHz sine at full scale in both channels reads ≈ 0 LUFS (tested to ±0.3 LU).

### Low-end weight

A single 2nd-order low-pass at 120 Hz produces the sub-band. The readout is `10·log10(low-band energy / full-band energy)`. It is an energy-share diagnostic, not a phase-coherent crossover.

### Correlation

`ΣLR / √(ΣL² · ΣR²)` over 100 ms, clamped to −1…+1. Mono-compatible material sits near +1; a polarity-inverted pair sits near −1.

### True peak

A 16-tap Blackman-windowed sinc is evaluated at 0.25, 0.5 and 0.75 of every sample interval, with a 12 dB/s release. This is an **estimate**, not a certified BS.1770-4 true-peak meter. It is intentionally labelled `DBTP` in the UI with the estimator documented here.

### Dynamic range

Every 100 ms after the 3 s short-term warm-up, the short-term LUFS is appended to the session history. `DR = P95 − P10` over the most recent hour, in LU. `PLR = true peak − integrated LUFS`. These are programme-dynamics indicators, not EBU Tech 3342 compliance.

---

## TESTING

```bash
bash scripts/test.sh     # 50 DSP checks
bash scripts/verify.sh   # full workspace verification
```

The core tests cover:

- silence and idle states
- 0 / −20 / −40 dBFS LUFS calibration
- stereo correlation at +1 / −1 / uncorrelated
- 60 Hz vs 4 kHz low-end weight
- near-Nyquist inter-sample peak detection
- clipped-signal latch
- dynamic-range warm-up and steady-tone failure
- reset behaviour
- every status threshold
- snapshot finiteness and range

Manual DAW QA and AU validation steps are in [`docs/TESTING.md`](docs/TESTING.md).

---

## LIMITATIONS / NEXT

- The plug-in currently has **no automatable parameters**; the reference target is fixed at −14 LUFS.
- True peak is a windowed-sinc estimate, not a certified BS.1770-4 meter.
- The UI is a fixed 1100 × 680 px panel; host zoom/HiDPI scaling is handled by JUCE, but there is no internal responsive breakpoint.
- Only macOS is configured (AU + VST3 + Standalone). Windows VST3 is not wired.
- AU validation, notarisation and an installer package are release tasks, not part of this initial workspace.

---

## DOCUMENTATION

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — DSP flow, threading, snapshot bus
- [`docs/BRAND-UI.md`](docs/BRAND-UI.md) — tokens, type, grid, traffic-light semantics
- [`docs/BUILD-MACOS.md`](docs/BUILD-MACOS.md) — Xcode, CMake, JUCE, Logic Pro
- [`docs/TESTING.md`](docs/TESTING.md) — automated checks, auval, manual QA
- [`AGENTS.md`](AGENTS.md) — maintainer/agent invariants and commands

---

**KYROIII** · MASTERING METER / DIAGNOSTIC CONSOLE · V0.1.0
