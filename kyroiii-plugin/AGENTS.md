# AGENTS.md — KYROIII MASTERING METER WORKSPACE

This file is the maintainer/agent contract for `kyroiii-plugin/`. It is not the
storefront contract; the repository-root `AGENTS.md` still governs the static
store. Everything here is scoped to this folder.

## What this is

A JUCE 8 AU/VST3/Standalone mastering meter and diagnostic console for macOS,
built around a dependency-free C++17 DSP core.

- **AU** for Logic Pro on Apple Silicon (default `arm64`, universal optional).
- **VST3** for other macOS hosts.
- **Standalone** for quick auditioning without a DAW.
- The plug-in is a pass-through observer: it must never alter audio, gain,
  phase or latency.

## Non-negotiable invariants

1. **`processBlock()` is real-time safe.** No allocation, no locks, no file I/O,
   no `juce::String` construction, no logging, no `repaint()` from the audio
   thread. The DSP core only uses pre-sized buffers.
2. **Audio → UI is a single-writer/single-reader seqlock** (`src/core/Seqlock.h`).
   The engine writes a trivially-copyable `MeterSnapshot`; the editor timer
   reads it. Do not add a mutex to the audio path.
3. **The audio buffer is read-only.** `PluginProcessor::processBlock()` passes
   pointers to the engine and never writes back. Any future gain/trim feature
   must be a deliberate, documented change.
4. **Thresholds live in `src/core/MeterTypes.h`.** Do not duplicate a threshold
   in the UI. `MeterFace.cpp` and `docs/` must agree with that file.
5. **All visible UI copy is ALL CAPS.** Labels, units, status words, badges,
   footer, buttons, tooltips. The wordmark is `KYROIII` and is already caps.
   The browser preview uses `text-transform: uppercase` as a backstop.
6. **The palette is scoped to this folder.** Matte black `#0A0A0A`, brushed gold
   `#D4AF37`, bright gold `#E5C158`, warm brown `#6B4A2E` / `#3A2A1C`, cream
   `#F2EDE3`, traffic-light green/amber/red. Do not reuse the storefront's
   monochrome rules here, and do not edit the storefront's `style.css` to make
   this palette pass its audit.
7. **The flower rotates by default and can be paused by clicking it.** Keep the
   motion slow (≈28 s per turn) and the path vector-based.
8. **Every diagnostic window has three lamps and a text status.** Status must
   never be conveyed by colour alone: `OK`, `WATCH`, `FAIL`, `IDLE` are written
   out in the header and under the value.
9. **The browser preview is a reference, not the product.** `preview/` must
   mirror the JUCE layout and tokens, but the C++ UI is the shipping surface.
   Do not link external fonts or assets into the preview.
10. **JUCE is pinned to `8.0.15`** in `CMakeLists.txt`. Upgrade deliberately:
    bump the tag, run `scripts/verify.sh`, then run a full macOS build and
    `auval` before committing.

## Commands

```bash
# Fast, dependency-free checks (works with only the Xcode command line tools)
bash scripts/verify.sh
bash scripts/test.sh

# Full macOS build; needs CMake + Internet (or JUCE_PATH)
bash scripts/build-macos.sh
JUCE_PATH=/path/to/JUCE bash scripts/build-macos.sh
KYROIII_ARCH=universal bash scripts/build-macos.sh

# Install into the user plug-in folders
bash scripts/install-macos.sh

# AU validation
auval -v aufx Kmm1 Kyro
```

`verify.sh` is the gate for every change. It checks layout, shell syntax, CMake
preset JSON, brand tokens, documentation links and the DSP tests.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/core/MeterTypes.h` | `Status`, thresholds, classification, `MeterSnapshot` |
| `src/core/Biquad.h` | K-weighting shelf/high-pass and RBJ low-pass |
| `src/core/LoudnessMeter.*` | 400 ms / 3 s / gated integrated LUFS |
| `src/core/LowEndMeter.*` | 120 Hz energy share |
| `src/core/CorrelationMeter.*` | Normalised L/R covariance |
| `src/core/DynamicRangeMeter.*` | P95 − P10, PLR |
| `src/core/TruePeakMeter.h` | 16-tap 4× windowed-sinc peak estimator |
| `src/core/Seqlock.h` | Lock-free snapshot bus |
| `src/core/MeterEngine.*` | 100 ms block orchestration, history, publish |
| `src/plugin/PluginProcessor.*` | JUCE `AudioProcessor`, pass-through, buses |
| `src/ui/PluginEditor.*` | Editor shell + 30 Hz timer |
| `src/ui/MeterFace.*` | Header, 2×2 diagnostic grid, footer |
| `src/ui/DiagnosticWindow.*` | Modular window, traffic lights, sparkline |
| `src/ui/FlowerLogo.*` | Rotating vector flower |
| `src/ui/KyroTheme.h` | Colour tokens, fonts, tracked type |
| `tests/meter_core_test.cpp` | 50 core checks, `assert`-style harness |
| `preview/` | Static UI reference |
| `docs/` | Architecture, brand, build, testing |

## DSP facts that are easy to break

- K-weighting must use the **exact BS.1770 prototype** (shelf + high-pass), not
  an arbitrary high-shelf. The calibration test expects a full-scale 1 kHz
  stereo sine at ≈0 LUFS. A generic RBJ shelf shifts the result by ~0.26 dB.
- Integrated LUFS uses **400 ms gating blocks at 75 % overlap** (one every
  100 ms), an absolute −70 LUFS gate and a relative −10 LU gate.
- The low-end meter is an **energy ratio**, not a crossed-over band level. It
  runs a 2nd-order 120 Hz low-pass and compares low-band energy to full-band
  energy over the same 100 ms block.
- Correlation is computed from raw L/R over the same 100 ms block, then clamped.
  Do not smooth it into the accumulator.
- The true-peak estimator has a deliberate **9-sample delay** and a 12 dB/s
  release. Do not “fix” the delay by evaluating a future sample without keeping
  the filtering causal; the peak is allowed to lag by a fraction of a
  millisecond.
- DR only becomes ready after 30 short-term values (≈3 s after the 3 s
  warm-up). `0 LU` is a valid, failing reading for a steady tone, not `idle`.
- `MeterEngine::requestReset()` is the message-thread API. The audio thread
  consumes the atomic flag at the start of `process()`. Do not reset DSP state
  from the UI directly.
- The loudness gating history and the dynamic-range history/scratch buffers are
  **reserved in `prepare()`**. `push_back`/`erase`/`assign` stay inside that
  capacity, so the audio thread never allocates. If you add a container to the
  DSP core, pre-size it the same way; `clear()` keeps capacity, `shrink_to_fit()`
  does not belong on the audio path.

## UI facts that are easy to break

- The editor is fixed at **1100 × 680 px** and is not resizable. If that
  changes, update the layout math in `MeterFace::resized()` and test at the new
  size; the window cards assume a 2×2 grid with a 14 px gap and 24 px margins.
- The header is 110 px, the footer 56 px, the grid gap 14 px. Keep the gold
  divider and the footer rule aligned with those constants.
- `DiagnosticWindow` paints its own title, lamps, big value, sparkline and two
  detail fields. Do not add child components per metric; the painted surface is
  intentionally cheap at 30 Hz.
- The sparkline skips values below `minValue - 1` so warm-up placeholders do
  not draw a false line.
- Every status text comes from `statusLabel()` and every lamp colour from
  `theme::statusColour()`. Do not hard-code a second mapping.
- The preview must keep the four `data-metric` hooks:
  `low-end`, `correlation`, `lufs`, `dynamic-range`.

## Build/verification environment

- The core tests need only `clang++` and the C++17 standard library. They do not
  need JUCE, CMake or a DAW.
- The full build needs **CMake 3.22+**, a macOS SDK and either network access
  for `FetchContent` or `JUCE_PATH`.
- AU validation and Logic Pro registration are best verified with a **full
  Xcode** install. The command line tools can still compile the AU/VST3/Standalone
  targets and run `auval`, but `xcodebuild` is not
  present there. `scripts/build-macos.sh` warns rather than failing in that
  state.
- `COPY_PLUGIN_AFTER_BUILD` is intentionally `FALSE`; installation is explicit
  via `scripts/install-macos.sh`.
- Ad-hoc signing (`codesign --force --deep --sign -`) is enough for local Logic
  testing. Public distribution needs a Developer ID identity and notarisation;
  that is not configured yet.

## Git / delivery

This workspace is part of the repository root. When shipping:

```bash
cd ..
git add -A
git commit -m "Initialize KYROIII mastering diagnostic plugin workspace"
git push origin main
```

Do not force-push. Do not rewrite history. If the root storefront has changed
underneath you, rebase/merge normally and re-run `scripts/verify.sh`.

## Definition of done for a change

- [ ] `bash scripts/verify.sh` passes.
- [ ] `bash scripts/test.sh` passes.
- [ ] If JUCE/C++ UI changed: full `scripts/build-macos.sh` succeeds and
      `auval -v aufx Kmm1 Kyro` passes on a machine with full Xcode.
- [ ] If thresholds changed: `MeterTypes.h`, `MeterFace.cpp`, `README.md`,
      `docs/ARCHITECTURE.md` and `docs/TESTING.md` agree.
- [ ] If visual tokens changed: `KyroTheme.h`, `preview/style.css`,
      `docs/BRAND-UI.md` and the README brand table agree.
- [ ] New UI copy is ALL CAPS.
- [ ] No audio-thread allocation/lock was introduced.
