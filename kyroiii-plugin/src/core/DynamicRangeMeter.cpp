#include "DynamicRangeMeter.h"

#include <algorithm>
#include <cmath>

namespace kyro
{
void DynamicRangeMeter::prepare()
{
    // Pre-size both buffers so addShortTerm()/recompute() never allocate on the
    // audio thread. reset() clears them without releasing this capacity.
    values.reserve (static_cast<size_t> (maxValues));
    scratch.reserve (static_cast<size_t> (maxValues));
}

void DynamicRangeMeter::reset()
{
    values.clear();
    scratch.clear();
    cachedDr = 0.0f;
    updatesSinceRecompute = 0;
}

void DynamicRangeMeter::addShortTerm (float lufs)
{
    if (! std::isfinite (lufs) || lufs <= -70.0f)
        return;

    if (static_cast<int> (values.size()) >= maxValues)
        values.erase (values.begin(), values.begin() + static_cast<std::ptrdiff_t> (maxValues / 10));

    values.push_back (lufs);
    ++updatesSinceRecompute;

    if (updatesSinceRecompute >= recomputeEvery)
        recompute();
}

void DynamicRangeMeter::recompute()
{
    updatesSinceRecompute = 0;

    if (values.size() < 30)
    {
        cachedDr = 0.0f;
        return;
    }

    // scratch already holds maxValues capacity, so this copy cannot allocate.
    scratch.assign (values.begin(), values.end());
    std::sort (scratch.begin(), scratch.end());

    const auto percentile = [this] (double p)
    {
        const double position = p * static_cast<double> (scratch.size() - 1);
        const auto lower = static_cast<size_t> (std::floor (position));
        const auto upper = static_cast<size_t> (std::ceil (position));
        const double fraction = position - static_cast<double> (lower);
        return static_cast<double> (scratch[lower])
             + (static_cast<double> (scratch[upper]) - static_cast<double> (scratch[lower])) * fraction;
    };

    cachedDr = static_cast<float> (std::max (0.0, percentile (0.95) - percentile (0.10)));
}

float DynamicRangeMeter::peakToLoudness (float truePeakDb, float integratedLufs) noexcept
{
    if (! std::isfinite (truePeakDb) || ! std::isfinite (integratedLufs)
        || truePeakDb <= -60.0f || integratedLufs <= -60.0f)
        return 0.0f;

    return std::max (0.0f, truePeakDb - integratedLufs);
}
} // namespace kyro
