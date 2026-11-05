#include "core/MeterEngine.h"

#include <cmath>
#include <functional>
#include <iostream>
#include <string>
#include <vector>

namespace
{
constexpr double sampleRate = 48000.0;
constexpr double pi = 3.14159265358979323846;

int failures = 0;
int checks = 0;

void check (bool condition, const std::string& message)
{
    ++checks;

    if (! condition)
    {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}

void checkNear (double actual, double expected, double tolerance, const std::string& message)
{
    check (std::abs (actual - expected) <= tolerance,
           message + " (actual " + std::to_string (actual)
               + ", expected " + std::to_string (expected)
               + " +/- " + std::to_string (tolerance) + ")");
}

std::vector<float> sine (double frequency, double seconds, float amplitude,
                         double phase = 0.0, double fs = sampleRate)
{
    const int count = static_cast<int> (std::llround (seconds * fs));
    std::vector<float> samples (static_cast<size_t> (count));

    for (int i = 0; i < count; ++i)
        samples[static_cast<size_t> (i)] = amplitude
            * static_cast<float> (std::sin (2.0 * pi * frequency * i / fs + phase));

    return samples;
}

void feed (kyro::MeterEngine& engine,
           const std::vector<float>& left,
           const std::vector<float>& right,
           int blockSize = 512)
{
    const int count = static_cast<int> (std::min (left.size(), right.size()));

    for (int offset = 0; offset < count; offset += blockSize)
    {
        const int chunk = std::min (blockSize, count - offset);
        engine.process (left.data() + offset, right.data() + offset, chunk);
    }
}

void feedMono (kyro::MeterEngine& engine, const std::vector<float>& mono, int blockSize = 512)
{
    feed (engine, mono, mono, blockSize);
}

kyro::MeterSnapshot analyse (const std::vector<float>& left,
                             const std::vector<float>& right,
                             double fs = sampleRate)
{
    kyro::MeterEngine engine;
    engine.prepare (fs);
    feed (engine, left, right);
    return engine.snapshot();
}

void testSilenceIsIdle()
{
    const auto snapshot = analyse (std::vector<float> (48000, 0.0f),
                                   std::vector<float> (48000, 0.0f));

    check (snapshot.lowEndStatus == kyro::Status::idle, "silence keeps low-end idle");
    check (snapshot.lufsStatus == kyro::Status::idle, "silence keeps LUFS idle");
    check (snapshot.correlationStatus == kyro::Status::idle, "silence keeps correlation idle");
    check (snapshot.truePeakDb <= -100.0f, "silence reports no peak");
    check (! snapshot.clipping, "silence does not latch clipping");
}

void testBiquadCalibration()
{
    // A 1 kHz sine at full scale in both channels is the BS.1770 anchor: the
    // K-weighting gain and -0.691 offset cancel to approximately 0 LUFS.
    const auto tone = sine (1000.0, 3.0, 1.0f);
    const auto snapshot = analyse (tone, tone);

    check (snapshot.loudnessReady, "integrated loudness becomes ready");
    checkNear (snapshot.lufsIntegrated, 0.0, 0.30, "0 dBFS 1 kHz stereo sine reads 0 LUFS");
    checkNear (snapshot.lufsMomentary, 0.0, 0.30, "momentary loudness is calibrated");
    checkNear (snapshot.lufsShortTerm, 0.0, 0.30, "short-term loudness is calibrated");

    const auto quiet = sine (1000.0, 3.0, 0.1f);
    const auto quietSnapshot = analyse (quiet, quiet);
    checkNear (quietSnapshot.lufsIntegrated, -20.0, 0.30, "-20 dBFS sine reads -20 LUFS");

    const auto veryQuiet = sine (1000.0, 3.0, 0.01f);
    const auto veryQuietSnapshot = analyse (veryQuiet, veryQuiet);
    checkNear (veryQuietSnapshot.lufsIntegrated, -40.0, 0.40, "-40 dBFS sine reads -40 LUFS");
}

void testCorrelation()
{
    const auto left = sine (440.0, 1.0, 0.5f);
    const auto same = analyse (left, left);
    check (same.correlation > 0.99f, "identical channels correlate to +1");
    check (same.correlationStatus == kyro::Status::good, "in-phase stereo is good");

    std::vector<float> inverted (left.size());
    for (size_t i = 0; i < left.size(); ++i)
        inverted[i] = -left[i];

    const auto opposite = analyse (left, inverted);
    check (opposite.correlation < -0.99f, "inverted channels correlate to -1");
    check (opposite.correlationStatus == kyro::Status::bad, "out-of-phase stereo is bad");

    const auto other = sine (660.0, 1.0, 0.5f);
    const auto unrelated = analyse (left, other);
    check (std::abs (unrelated.correlation) < 0.25f, "unrelated tones stay near zero correlation");
}

void testLowEndWeight()
{
    const auto sub = sine (60.0, 1.0, 0.5f);
    const auto subSnapshot = analyse (sub, sub);
    check (subSnapshot.lowEndDb > -3.0f, "60 Hz tone reads as low-end heavy");

    const auto high = sine (4000.0, 1.0, 0.5f);
    const auto highSnapshot = analyse (high, high);
    check (highSnapshot.lowEndDb < -30.0f, "4 kHz tone reads as no low-end weight");
}

void testTruePeakEstimator()
{
    // fs / 4 with a 45 degree phase lands every sample at +/-0.707, so the
    // sample peak is -3 dBFS while the reconstructed peak is 0 dBFS.
    const auto tone = sine (sampleRate / 4.0, 1.0, 1.0f, pi / 4.0);
    const auto snapshot = analyse (tone, tone);

    check (snapshot.truePeakDb > -1.0f,
           "4x cubic inter-sample estimator finds the hidden peak");
    check (snapshot.truePeakDb < 3.0f, "inter-sample estimate stays bounded");

    const auto hot = sine (997.0, 1.0, 1.2f);
    const auto hotSnapshot = analyse (hot, hot);
    check (hotSnapshot.clipping, "over-full-scale signal latches clipping");
}

void testDynamicRange()
{
    const auto constant = sine (500.0, 12.0, 0.6f);
    const auto flat = analyse (constant, constant);
    check (flat.dynamicsReady, "dynamic range becomes ready after the warm-up");
    check (flat.dynamicRangeLu < 0.5f, "steady tone reports almost no dynamic range");
    check (flat.dynamicRangeStatus == kyro::Status::bad, "steady tone fails the DR heuristic");

    const int count = static_cast<int> (12.0 * sampleRate);
    std::vector<float> modulated (static_cast<size_t> (count));

    for (int i = 0; i < count; ++i)
    {
        const double time = i / sampleRate;
        const double envelope = 0.08 + 0.72 * (0.5 + 0.5 * std::sin (2.0 * pi * 0.25 * time));
        modulated[static_cast<size_t> (i)] = static_cast<float> (
            envelope * 0.8 * std::sin (2.0 * pi * 500.0 * time));
    }

    const auto dynamic = analyse (modulated, modulated);
    check (dynamic.dynamicsReady, "modulated signal has a DR reading");
    check (dynamic.dynamicRangeLu > 2.0f, "modulated signal reports dynamic range");
}

void testReset()
{
    kyro::MeterEngine engine;
    engine.prepare (sampleRate);

    const auto tone = sine (440.0, 1.0, 0.5f);
    feedMono (engine, tone);
    check (engine.snapshot().lowEndStatus != kyro::Status::idle, "meter sees a tone before reset");

    engine.requestReset();
    const std::vector<float> quiet (1024, 0.0f);
    feedMono (engine, quiet);

    const auto snapshot = engine.snapshot();
    check (snapshot.lufsStatus == kyro::Status::idle, "reset clears loudness status");
    check (snapshot.lowEndStatus == kyro::Status::idle, "reset clears low-end status");
    check (snapshot.sessionSeconds < 0.5, "reset restarts the session clock");
}

void testStatusThresholds()
{
    using kyro::Status;

    check (kyro::classifyLufs (-14.0f, true) == Status::good, "target LUFS is good");
    check (kyro::classifyLufs (-18.0f, true) == Status::warn, "quiet LUFS warns");
    check (kyro::classifyLufs (-30.0f, true) == Status::bad, "very quiet LUFS fails");
    check (kyro::classifyLufs (-14.0f, false) == Status::idle, "LUFS idle while warming up");

    check (kyro::classifyCorrelation (0.5f) == Status::good, "strong correlation is good");
    check (kyro::classifyCorrelation (0.1f) == Status::warn, "weak correlation warns");
    check (kyro::classifyCorrelation (-0.5f) == Status::bad, "negative correlation fails");

    check (kyro::classifyLowEnd (-8.0f) == Status::good, "anchored low-end is good");
    check (kyro::classifyLowEnd (-17.0f) == Status::warn, "light low-end warns");
    check (kyro::classifyLowEnd (-40.0f) == Status::bad, "absent low-end fails");

    check (kyro::classifyDynamicRange (12.0f, true) == Status::good, "wide DR is good");
    check (kyro::classifyDynamicRange (6.0f, true) == Status::warn, "narrow DR warns");
    check (kyro::classifyDynamicRange (0.0f, true) == Status::bad, "flat DR fails");
}

void testSnapshotSanitisation()
{
    const auto left = sine (83.0, 4.0, 0.9f);
    const auto right = sine (83.0, 4.0, 0.9f, 0.4);
    const auto snapshot = analyse (left, right);

    check (std::isfinite (snapshot.lowEndDb), "low-end value is finite");
    check (std::isfinite (snapshot.correlation), "correlation value is finite");
    check (std::isfinite (snapshot.lufsIntegrated), "integrated value is finite");
    check (std::isfinite (snapshot.truePeakDb), "true peak value is finite");
    check (std::isfinite (snapshot.dynamicRangeLu), "dynamic range value is finite");
    check (snapshot.correlation >= -1.0f && snapshot.correlation <= 1.0f,
           "correlation stays in range");
    check (snapshot.historyCount > 0, "history is populated");
}

struct Test
{
    const char* name;
    std::function<void()> run;
};

} // namespace

int main()
{
    const Test tests[] = {
        { "silence is idle", testSilenceIsIdle },
        { "BS.1770 calibration", testBiquadCalibration },
        { "stereo correlation", testCorrelation },
        { "low-end weight", testLowEndWeight },
        { "true-peak estimator", testTruePeakEstimator },
        { "dynamic range", testDynamicRange },
        { "reset", testReset },
        { "status thresholds", testStatusThresholds },
        { "snapshot sanitisation", testSnapshotSanitisation },
    };

    for (const auto& test : tests)
    {
        const int before = failures;
        test.run();
        std::cout << (failures == before ? "PASS " : "FAIL ") << test.name << '\n';
    }

    std::cout << '\n' << (checks - failures) << '/' << checks << " checks passed\n";

    if (failures > 0)
    {
        std::cerr << failures << " check(s) failed\n";
        return 1;
    }

    return 0;
}
