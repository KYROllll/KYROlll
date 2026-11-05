#include "CorrelationMeter.h"

#include <algorithm>
#include <cmath>

namespace kyro
{
void CorrelationMeter::prepare (double)
{
    reset();
}

void CorrelationMeter::reset()
{
    sumLR = 0.0;
    sumLL = 0.0;
    sumRR = 0.0;
    value = 0.0f;
    signalSeen = false;
}

void CorrelationMeter::process (const float* left, const float* right, int numSamples) noexcept
{
    for (int i = 0; i < numSamples; ++i)
    {
        const double l = left[i];
        const double r = right[i];

        sumLR += l * r;
        sumLL += l * l;
        sumRR += r * r;
    }
}

void CorrelationMeter::endBlock() noexcept
{
    const double denominator = std::sqrt (sumLL * sumRR);
    signalSeen = denominator > 1.0e-9;

    if (signalSeen)
    {
        const double raw = sumLR / denominator;
        value = static_cast<float> (std::clamp (raw, -1.0, 1.0));
    }
    else
    {
        value = 0.0f;
    }

    sumLR = 0.0;
    sumLL = 0.0;
    sumRR = 0.0;
}
} // namespace kyro
