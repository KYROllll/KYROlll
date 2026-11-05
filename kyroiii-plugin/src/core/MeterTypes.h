#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <type_traits>

namespace kyro
{
/** Three-lamp diagnostic state. `idle` means "no signal / warming up" and lights no lamp. */
enum class Status
{
    idle,
    good,
    warn,
    bad
};

inline const char* statusLabel (Status status) noexcept
{
    switch (status)
    {
        case Status::good: return "OK";
        case Status::warn: return "WATCH";
        case Status::bad:  return "FAIL";
        case Status::idle:
        default:           return "IDLE";
    }
}

/**
    Diagnostic thresholds. These are deliberately product heuristics, not a
    compliance claim. They are kept in one place so the audio engine and the
    documentation cannot drift apart.
*/
namespace thresholds
{
    constexpr float lufsTarget = -14.0f;
    constexpr float lufsGoodLow = -16.0f;
    constexpr float lufsGoodHigh = -12.0f;
    constexpr float lufsWarnLow = -20.0f;
    constexpr float lufsWarnHigh = -9.0f;

    constexpr float lowEndGoodLow = -14.0f;   // low band share, dB
    constexpr float lowEndGoodHigh = -3.0f;
    constexpr float lowEndWarnLow = -20.0f;
    constexpr float lowEndWarnHigh = 0.0f;

    constexpr float correlationGood = 0.30f;
    constexpr float correlationWarn = 0.00f;

    constexpr float drGood = 8.0f;            // LU
    constexpr float drWarn = 5.0f;
}

inline Status classifyLowEnd (float db) noexcept
{
    if (! std::isfinite (db) || db <= -60.0f)
        return Status::idle;

    if (db >= thresholds::lowEndGoodLow && db <= thresholds::lowEndGoodHigh)
        return Status::good;

    if ((db >= thresholds::lowEndWarnLow && db < thresholds::lowEndGoodLow)
        || (db > thresholds::lowEndGoodHigh && db <= thresholds::lowEndWarnHigh))
        return Status::warn;

    return Status::bad;
}

inline Status classifyCorrelation (float correlation) noexcept
{
    if (! std::isfinite (correlation))
        return Status::idle;

    if (correlation >= thresholds::correlationGood)
        return Status::good;

    if (correlation >= thresholds::correlationWarn)
        return Status::warn;

    return Status::bad;
}

inline Status classifyLufs (float lufs, bool ready) noexcept
{
    if (! ready || ! std::isfinite (lufs) || lufs <= -60.0f)
        return Status::idle;

    if (lufs >= thresholds::lufsGoodLow && lufs <= thresholds::lufsGoodHigh)
        return Status::good;

    if (lufs < thresholds::lufsGoodLow && lufs >= thresholds::lufsWarnLow)
        return Status::warn;

    if (lufs > thresholds::lufsGoodHigh && lufs <= thresholds::lufsWarnHigh)
        return Status::warn;

    return Status::bad;
}

inline Status classifyDynamicRange (float lu, bool ready) noexcept
{
    if (! ready || ! std::isfinite (lu))
        return Status::idle;

    if (lu >= thresholds::drGood)
        return Status::good;

    if (lu >= thresholds::drWarn)
        return Status::warn;

    return Status::bad;
}

inline float linearToDb (float linear) noexcept
{
    if (linear <= 1.0e-6f)
        return -120.0f;

    return 20.0f * std::log10 (linear);
}

inline float energyToLufs (double energy) noexcept
{
    if (energy <= 1.0e-12)
        return -120.0f;

    return static_cast<float> (-0.691 + 10.0 * std::log10 (energy));
}

/**
    A single immutable frame handed from the audio thread to the editor.
    Trivially copyable by design: the UI never locks the audio thread.
*/
struct MeterSnapshot
{
    float lowEndDb = -120.0f;
    float correlation = 0.0f;
    float lufsMomentary = -120.0f;
    float lufsShortTerm = -120.0f;
    float lufsIntegrated = -120.0f;
    float truePeakDb = -120.0f;
    float dynamicRangeLu = 0.0f;
    float peakToLoudnessDb = 0.0f;

    Status lowEndStatus = Status::idle;
    Status correlationStatus = Status::idle;
    Status lufsStatus = Status::idle;
    Status dynamicRangeStatus = Status::idle;

    bool clipping = false;
    bool loudnessReady = false;
    bool dynamicsReady = false;

    double sampleRate = 48000.0;
    double sessionSeconds = 0.0;

    int historyCount = 0;
    std::array<float, 120> lowEndHistory {};
    std::array<float, 120> correlationHistory {};
    std::array<float, 120> lufsHistory {};
    std::array<float, 120> dynamicRangeHistory {};
};

static_assert (std::is_trivially_copyable<MeterSnapshot>::value,
               "MeterSnapshot must remain trivially copyable for the lock-free UI bus");
} // namespace kyro
