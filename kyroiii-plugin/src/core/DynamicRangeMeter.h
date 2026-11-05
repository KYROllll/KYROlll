#pragma once

#include <vector>

namespace kyro
{
/**
    Session dynamic-range estimate from the short-term loudness history.

    DR = P95(short-term LUFS) - P10(short-term LUFS), in LU. This is a useful
    programme-dynamics indicator, not a formal EBU 3342 measurement.
*/
class DynamicRangeMeter
{
public:
    /** Reserves the full session capacity on the message thread. */
    void prepare();
    void reset();
    void addShortTerm (float lufs);

    float dynamicRangeLu() const noexcept { return cachedDr; }
    bool isReady() const noexcept { return values.size() >= 30; }

    static float peakToLoudness (float truePeakDb, float integratedLufs) noexcept;

private:
    static constexpr int maxValues = 36000; // one hour at 10 Hz
    static constexpr int recomputeEvery = 20;

    void recompute();

    std::vector<float> values;
    std::vector<float> scratch;
    float cachedDr = 0.0f;
    int updatesSinceRecompute = 0;
};
} // namespace kyro
