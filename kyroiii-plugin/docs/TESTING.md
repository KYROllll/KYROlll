# TESTING — KYROIII MASTERING METER

## 1. Fast automated checks

```bash
cd kyroiii-plugin
bash scripts/verify.sh
```

`verify.sh` is the change gate. It checks:

- the required workspace files;
- `bash -n` on every script;
- `CMakePresets.json` parses;
- `CMakeLists.txt` still builds AU + VST3 + Standalone with `Kmm1` / `Kyro`;
- the theme tokens (`#0A0A0A`, gold, brown, traffic lights) in C++ and CSS;
- all four window titles in C++ and the browser preview;
- documentation commands and links;
- the DSP suite below.

The DSP suite has no JUCE dependency:

```bash
bash scripts/test.sh
```

`clang++ -std=c++17 -Wall -Wextra -Wpedantic` compiles the core and runs 50
checks. It is expected to print `50/50 checks passed` and exit 0.

## 2. What the core suite covers

| Test | Assertion |
| --- | --- |
| Silence | all windows `idle`, no peak, no clipping |
| BS.1770 calibration | 1 kHz stereo sine at 0 / −20 / −40 dBFS reads 0 / −20 / −40 LUFS (±0.3–0.4) |
| Stereo correlation | identical ≈ +1, inverted ≈ −1, unrelated tones near 0 |
| Low-end weight | 60 Hz ≈ 0 dB, 4 kHz < −30 dB |
| True peak | fs/4, 45° phase reads ≈0 dBTP even though every sample is −3 dBFS |
| Clipping | 1.2 FS sine latches `clipping` |
| Dynamic range | steady tone → 0 LU and `FAIL`; modulated tone → > 2 LU |
| Reset | clears statuses, history and session clock |
| Thresholds | every `good` / `warn` / `bad` / `idle` boundary |
| Snapshot | all values finite, correlation in range, history populated |

### Calibration expectations

- `lufsIntegrated` for a full-scale 1 kHz stereo sine: **0.0 ± 0.3 LU**
- `lufsIntegrated` for −20 dBFS: **−20.0 ± 0.3 LU**
- `lufsIntegrated` for −40 dBFS: **−40.0 ± 0.4 LU**
- The K-weighting must be the exact BS.1770 shelf + high-pass. Replacing it with
  a generic RBJ shelf fails the calibration test by ~0.26 dB.

## 3. Full build verification (macOS, full Xcode recommended)

```bash
bash scripts/build-macos.sh
ctest --test-dir build/macos-arm64 --output-on-failure
bash scripts/install-macos.sh
auval -v aufx Kmm1 Kyro
```

Expected:

- three artefacts (`.component`, `.vst3`, `.app`);
- `100% tests passed, 0 tests failed`;
- `AU VALIDATION SUCCEEDED.`

If `cmake` is missing, see [`BUILD-MACOS.md`](BUILD-MACOS.md). The verification
suite itself does not require CMake.

## 4. Manual Logic Pro QA

Use a 48 kHz / 24-bit session on Apple Silicon.

### 4.1 Insertion and pass-through

1. Insert **KYROIII MASTERING METER** on the Stereo Out.
2. Play a full mix.
3. Confirm:
   - no gain change, no phase flip, no added latency;
   - the AU does not report a tail;
   - the plug-in opens at 1100 × 680.

### 4.2 Low-end weight

| Source | Expected |
| --- | --- |
| 60 Hz sine | value near 0 dB, `WATCH` or `FAIL` (pure sub is not a mix) |
| 4 kHz sine | value < −30 dB, `FAIL` |
| Full mix with anchored kick/bass | roughly −14…−3 dB, `OK` |
| Thin, high-passed mix | < −20 dB, `FAIL` |

The meter is an energy-share diagnostic. A pure 60 Hz tone at 0 dB reads as
“too much low end” by design.

### 4.3 Stereo correlation

| Source | Expected |
| --- | --- |
| Mono kick/bass | ≈ +1.00, `OK` |
| Wide stereo pad | 0.0…0.6, `WATCH`/`OK` |
| Polarity-inverted channels | ≈ −1.00, `FAIL` |
| Silence | `IDLE`, value `-` |

### 4.4 LUFS

Feed a calibrated 1 kHz tone at −20 dBFS (both channels) for 5 seconds:

- integrated → **−20.0 LUFS** (±0.3)
- momentary and short-term → **−20.0 LUFS** (±0.3)
- status → `WATCH` (target is −14)

Then play a −14 LUFS master:

- integrated → ≈ −14, status `OK`
- quieter material → `WATCH`, then `FAIL` below −20.

Let a 3-second short-term window fill before judging the integrated value.

### 4.5 Dynamic range

| Source | Expected |
| --- | --- |
| Steady 1 kHz tone | DR ≈ 0 LU, `FAIL` |
| Heavily limited master | DR < 5 LU, `FAIL` |
| Dynamic acoustic / orchestral | DR > 8 LU, `OK` |
| PLR | true peak minus integrated LUFS |

The DR readout waits for 30 short-term values (≈3 s after the 3 s warm-up).
Before that it shows `-` and `IDLE`.

### 4.6 True peak / clip latch

- Play a full-scale sine: `NO CLIP`, true peak ≈ 0 dBTP.
- Push a limiter output to +0.5 dBTP or use a hot intersample-peak test file:
  `CLIP LATCH` turns red and stays latched until `RESET METERS`.
- A 1.2 FS sample-peak signal latches immediately.

### 4.7 Reset and flower

- Click **RESET METERS**: all values return to `-` / `IDLE`, session to
  `00:00:00`, clip latch clears.
- Click the flower: rotation pauses; click again to resume.
- Confirm the flower does not affect audio or CPU materially.

### 4.8 Sample rates and layouts

Repeat the smoke test at **44.1, 48, 88.2 and 96 kHz**:

- 1 kHz calibration still reads correctly;
- no NaN/Inf, no stuck values;
- the 120 Hz low-end split still behaves;
- mono-in/mono-out and stereo-in/stereo-out both work.

### 4.9 Host stress

- Open/close the editor 20 times.
- Change buffer sizes (32…1024) while playing.
- Toggle the bypass (the meter should keep its state or reset cleanly; it must
  not click, crash or allocate).
- Leave the session open for 30+ minutes; confirm CPU stays flat and the DR
  history does not grow without bound (capped at one hour).

## 5. Browser preview QA

Open `preview/index.html` directly (no server needed):

- 1100 px desktop: 2×2 grid, flower spinning, the active lamp lit green/amber/red;
- 820 px: one column, session block moves under the wordmark;
- 390 px: no horizontal overflow, values still legible;
- reset clears values and the session clock;
- clicking the flower pauses the CSS animation;
- `prefers-reduced-motion: reduce` stops the flower;
- no external network requests (fonts/assets are all local).

The preview is a reference. It does not prove the JUCE rendering, but it is the
fastest way to review tokens, copy and traffic-light states.

## 6. Acceptance criteria

A build is shippable when:

- [ ] `bash scripts/verify.sh` passes.
- [ ] `bash scripts/test.sh` reports `50/50 checks passed`.
- [ ] `scripts/build-macos.sh` completes with full Xcode.
- [ ] `auval -v aufx Kmm1 Kyro` succeeds.
- [ ] Logic loads the AU on Apple Silicon and passes audio untouched.
- [ ] All four windows respond to the sources in section 4.
- [ ] Reset and flower pause work.
- [ ] No console errors, no NaN/Inf, no stuck clip latch after reset.
- [ ] CPU is stable over a 30-minute session.

## 7. Known gaps

- True peak is a 4× windowed-sinc estimate, not a certified BS.1770-4 meter.
- DR is a P95−P10 indicator, not EBU Tech 3342.
- No automated GUI/DAW test yet; the manual section is the contract.
- AU notarisation and a `.pkg` installer are not configured.
- The editor is fixed-size; host scaling is handled by JUCE but there is no
  internal breakpoint.
