# ARCHITECTURE — KYROIII MASTERING METER

## 1. Layers

```
┌─────────────────────────────────────────────────────────────┐
│ JUCE PLUGIN SHELL                                           │
│  PluginProcessor  ── prepare / processBlock / buses         │
│  PluginEditor     ── 30 Hz timer, owns MeterFace            │
│  MeterFace        ── header, 2×2 grid, footer, reset        │
│  DiagnosticWindow ── title, value, lamps, sparkline         │
│  FlowerLogo       ── vector petals, 30 Hz rotation          │
└───────────────────────────┬─────────────────────────────────┘
                            │ snapshot() / requestReset()
┌───────────────────────────▼─────────────────────────────────┐
│ PURE C++17 DSP CORE (no JUCE)                               │
│  MeterEngine                                                │
│   ├── LoudnessMeter        K-weighted LUFS                  │
│   ├── LowEndMeter          120 Hz energy share              │
│   ├── CorrelationMeter     L/R covariance                   │
│   ├── DynamicRangeMeter    P95 − P10 / PLR                  │
│   ├── TruePeakMeter        4× windowed-sinc peak            │
│   └── Seqlock               audio → UI frame                │
└─────────────────────────────────────────────────────────────┘
```

The core has no dependency on JUCE. It can be compiled and tested with a bare
`clang++` invocation, which is what `scripts/test.sh` does. This is deliberate:
the parts that are easy to get numerically wrong are testable without a DAW or
a plug-in build.

## 2. Audio path

`PluginProcessor::processBlock()`:

1. Creates `juce::ScopedNoDenormals`.
2. Reads the first two channels (mono is duplicated to both pointers).
3. Calls `MeterEngine::process(left, right, numSamples)`.
4. Returns without touching the buffer.

The engine is an observer, so the plug-in reports zero latency and no tail. It
supports mono or stereo input/output as long as input and output layouts match.

`MeterEngine` divides the stream into exact 100 ms blocks. The block length is
`round(sampleRate × 0.1)`, so 44.1 kHz uses 4410 samples and 48 kHz uses 4800.
Every 100 ms boundary calls:

```
LoudnessMeter::endBlock()
LowEndMeter::endBlock()
CorrelationMeter::endBlock()
DynamicRangeMeter::addShortTerm(loudness.shortTerm())
appendHistory(...)
publish()
```

This is the only place the snapshot is published (10 Hz). The editor reads it at
30 Hz, so the UI is smooth while the audio thread only pays for a small,
trivially-copyable struct copy.

## 3. Lock-free hand-off

`Seqlock<MeterSnapshot>` is a single-writer/single-reader seqlock:

- Writer: odd sequence → copy payload → even sequence, with release fences.
- Reader: read sequence, copy payload, re-read sequence; retry on a torn frame.

The payload is `static_assert`-ed to be trivially copyable. It contains four
120-point history arrays (12 seconds at 10 Hz), so the UI never walks back into
the audio engine for history.

`requestReset()` is an atomic flag consumed at the top of `process()`. The editor
never touches DSP state.

## 4. Loudness

`LoudnessMeter` applies two biquads per channel:

1. **K-weighting shelf** — +3.999843853973347 dB, `f0 = 1681.974450955533`,
   `Q = 0.7071752369554196`.
2. **K-weighting high-pass** — `f0 = 38.13547087602444`, `Q = 0.5003270373238773`.

Both are re-derived from the BS.1770 analogue prototypes at the current sample
rate, using the same `tan(π f0 / fs)` form as libebur128. This matters: the
published 48 kHz coefficient set is not valid at 44.1 or 96 kHz, and a generic
RBJ shelf produces a different pass-band gain.

Per 100 ms block the meter accumulates K-weighted sum-of-squares per channel and
stores `(sumL + sumR) / blockSamples` in a 30-slot ring. Then:

- **Momentary** = mean of the last 4 sub-blocks, converted with
  `−0.691 + 10·log10(energy)`.
- **Short-term** = mean of the last 30 sub-blocks.
- **Integrated** = every 4th sub-block (400 ms at 75 % overlap) is a gating
  block. Blocks above −70 LUFS are stored. The relative gate is
  `absolute-gated loudness − 10 LU`; the final integrated value is the mean of
  the blocks that pass both gates.

Calibration anchor: a 1 kHz sine at full scale in both channels reads ≈0 LUFS.
The test suite asserts 0 / −20 / −40 dBFS within 0.3–0.4 LU.

## 5. Low-end weight

`LowEndMeter` runs a 2nd-order low-pass at 120 Hz on each channel and accumulates:

```
lowEnergy  = Σ(LP(L)² + LP(R)²)
fullEnergy = Σ(L² + R²)
value      = 10·log10(lowEnergy / fullEnergy)
```

The result is clamped to −120…0 dB. Silence reports `idle`; a 60 Hz tone sits
near 0 dB; a 4 kHz tone sits far below −30 dB. This is intentionally not a
phase-coherent crossover: the number is a low-band energy share, and the UI
labels it as such.

## 6. Stereo correlation

`CorrelationMeter` accumulates raw `ΣLR`, `ΣL²`, `ΣR²` over 100 ms:

```
corr = ΣLR / sqrt(ΣL² · ΣR²)
```

It is clamped to −1…+1. Silence is `idle`. Identical channels are +1; inverted
channels are −1; unrelated tones sit near 0.

## 7. True peak

`TruePeakMeter` keeps 64 samples per channel. For every sample it evaluates a
16-tap Blackman-windowed sinc at 0.25, 0.5 and 0.75 of a sample interval, using
the segment that ended 8 samples ago (a 9-sample causal delay). Coefficients are
built once in `prepare()` and normalized to unity DC gain.

A 12 dB/s linear release holds the peak between transients. `clipped` latches if
a sample reaches full scale or the interpolated estimate exceeds 1.001 (0.01 dB),
which avoids false clipping on a numerically perfect full-scale sine.

The result is an **estimate**. BS.1770-4 specifies a particular polyphase FIR
and meter ballistic; this implementation is close enough for a diagnostic
display but is documented as `DBTP` (estimate), not a certified true-peak meter.

## 8. Dynamic range

`DynamicRangeMeter` receives one short-term LUFS value per 100 ms after the 3 s
warm-up. It keeps the most recent hour (36 000 values). Every 20 updates it
sorts a copy and computes:

```
DR = P95 − P10   (LU)
```

The history and its sort scratch buffer are reserved in `prepare()`, so the
audio thread copies and sorts into pre-sized storage and never allocates.

`PLR = truePeakDb − integratedLufs` is computed at publish time. DR becomes
“ready” after 30 short-term values (≈3 s of valid history). A steady tone has a
valid DR of 0 LU and is classified as `FAIL`, not `IDLE`.

## 9. UI layer

- `KyroTheme.h` owns every colour and font. Display type is Helvetica Neue bold;
  technical labels and numbers use Menlo.
- `drawTrackedText()` paints each glyph so the ALL-CAPS labels can carry wide
  letter-spacing without a font-feature dependency.
- `DiagnosticWindow` is a single painted component: header title, three lamps,
  text status, big value, unit, sparkline and two detail fields. It copies a
  `DiagnosticReading` at 30 Hz; no child components are created per frame.
- `MeterFace` lays out a fixed 1100 × 680 panel: 110 px header, 56 px footer,
  2×2 grid with a 14 px gap and 24 px margins.
- `PluginEditor` owns a 30 Hz timer and pushes the latest snapshot into
  `MeterFace`.
- `FlowerLogo` draws eight vector petals, rotates slowly and toggles pause on
  click.

## 10. Extension points

- **Target LUFS** — add a parameter/`AudioProcessorValueTreeState`, pass it to
  `classifyLufs`, and draw a movable target marker. Thresholds must stay in
  `MeterTypes.h` until they become parameters.
- **Reference profiles** — streaming −14, broadcast −23, club −8. Each is a
  target plus tolerance; do not fork the meter classes.
- **True-peak upgrade** — replace `TruePeakMeter` with a BS.1770-4 polyphase FIR
  and update the estimate wording. Keep the release/latch contract.
- **Responsive UI** — the current panel is fixed. A responsive version needs a
  scale factor or a layout relook, not just different bounds.

## 11. Real-time budget

Per sample, the engine performs:

- 2 biquads × 2 channels for K-weighting (4 biquad evaluations)
- 1 biquad × 2 channels for the 120 Hz split
- 3 multiply-adds per channel for correlation
- 3 × 16 taps × 2 channels for the inter-sample peak

That is comfortably below a few percent of one core at 96 kHz on Apple Silicon.
The expensive part is the dynamic-range sort, which runs every 2 s on the audio
thread. It is bounded to 36 000 values and is the first thing to move to a
worker if the session length or sample rate grows.
