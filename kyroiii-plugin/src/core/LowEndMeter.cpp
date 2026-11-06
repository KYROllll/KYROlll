#include "LowEndMeter.h"

#include <algorithm>
#include <cmath>

namespace kyro
{
void LowEndMeter::prepare (double sampleRate)
{
    const double fs = sampleRate > 0.0 ? sampleRate : 48000.0;

    lowPassL.designLowPass (crossoverHz, 0.7071067811865476, fs);
    lowPassR.designLowPass (crossoverHz, 0.7071067811865476, fs);

    reset();
}

void LowEndMeter::reset()
{
    lowPassL.reset();
    lowPassR.reset();

    lowSum = 0.0;
    fullSum = 0.0;
    value = -120.0f;
    signalSeen = false;
}

void LowEndMeter::process (const float* left, const float* right, int numSamples) noexcept
{
    for (int i = 0; i < numSamples; ++i)
    {
        const float l = left[i];
        const float r = right[i];
        const double lowL = lowPassL.processSample (l);
        const double lowR = lowPassR.processSample (r);

        lowSum += lowL * lowL + lowR * lowR;
        fullSum += static_cast<double> (l) * l + static_cast<double> (r) * r;
    }
}

void LowEndMeter::endBlock() noexcept
{
    signalSeen = fullSum > 1.0e-9;

    if (! signalSeen)
    {
        value = -120.0f;
    }
    else
    {
        const double ratio = (lowSum + 1.0e-12) / (fullSum + 1.0e-12);
        value = static_cast<float> (std::clamp (10.0 * std::log10 (ratio), -120.0, 0.0));
    }

    lowSum = 0.0;
    fullSum = 0.0;
}
} // namespace kyro
