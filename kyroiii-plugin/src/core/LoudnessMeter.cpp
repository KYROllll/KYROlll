#include "LoudnessMeter.h"

#include "MeterTypes.h"

#include <algorithm>
#include <cmath>

namespace kyro
{
void LoudnessMeter::prepare (double newSampleRate)
{
    sampleRate = newSampleRate > 0.0 ? newSampleRate : 48000.0;
    blockSamples = std::max (1, static_cast<int> (std::llround (sampleRate * 0.1)));

    shelfL.designKWeightingShelf (sampleRate);
    shelfR.designKWeightingShelf (sampleRate);
    highPassL.designKWeightingHighPass (sampleRate);
    highPassR.designKWeightingHighPass (sampleRate);

    // Pre-size the gating history on the message thread: endBlock() must never
    // allocate on the audio thread. reset() clears it without releasing capacity.
    gateBlocks.reserve (static_cast<size_t> (maxGateBlocks));

    reset();
}

void LoudnessMeter::reset()
{
    shelfL.reset();
    shelfR.reset();
    highPassL.reset();
    highPassR.reset();

    sumL = 0.0;
    sumR = 0.0;
    subBlocks.fill (0.0);
    writeIndex = 0;
    validSubBlocks = 0;
    completedBlocks = 0;

    gateBlocks.clear();
    integratedEnergy = 0.0;
    integratedReady = false;

    momentaryLufs = -120.0f;
    shortTermLufs = -120.0f;
    integratedLufs = -120.0f;
}

void LoudnessMeter::process (const float* left, const float* right, int numSamples) noexcept
{
    for (int i = 0; i < numSamples; ++i)
    {
        const double weightedL = highPassL.processSample (shelfL.processSample (left[i]));
        const double weightedR = highPassR.processSample (shelfR.processSample (right[i]));

        sumL += weightedL * weightedL;
        sumR += weightedR * weightedR;
    }
}

void LoudnessMeter::endBlock() noexcept
{
    const double energy = (sumL + sumR) / static_cast<double> (blockSamples);
    sumL = 0.0;
    sumR = 0.0;

    subBlocks[static_cast<size_t> (writeIndex)] = energy;
    writeIndex = (writeIndex + 1) % maxSubBlocks;

    if (validSubBlocks < maxSubBlocks)
        ++validSubBlocks;

    ++completedBlocks;

    auto averageRecent = [this] (int count)
    {
        const int n = std::min (count, validSubBlocks);
        double sum = 0.0;

        for (int i = 0; i < n; ++i)
        {
            const int index = (writeIndex - 1 - i + maxSubBlocks) % maxSubBlocks;
            sum += subBlocks[static_cast<size_t> (index)];
        }

        return n > 0 ? sum / static_cast<double> (n) : 0.0;
    };

    if (validSubBlocks >= 4)
        momentaryLufs = energyToLufs (averageRecent (4));

    if (validSubBlocks >= maxSubBlocks)
        shortTermLufs = energyToLufs (averageRecent (maxSubBlocks));

    // A 400 ms gating block every 100 ms (75 % overlap).
    if ((completedBlocks % 4) == 0 && validSubBlocks >= 4)
    {
        const double gateEnergy = averageRecent (4);
        const float gateLoudness = energyToLufs (gateEnergy);

        if (gateLoudness > -70.0f)
        {
            if (static_cast<int> (gateBlocks.size()) >= maxGateBlocks)
                gateBlocks.erase (gateBlocks.begin(),
                                  gateBlocks.begin() + static_cast<std::ptrdiff_t> (maxGateBlocks / 10));

            gateBlocks.push_back (gateEnergy);
        }

        updateIntegrated();
    }
}

void LoudnessMeter::updateIntegrated()
{
    if (gateBlocks.empty())
    {
        integratedReady = false;
        integratedLufs = -120.0f;
        return;
    }

    double absoluteSum = 0.0;
    int absoluteCount = 0;

    for (const double energy : gateBlocks)
    {
        if (energyToLufs (energy) > -70.0f)
        {
            absoluteSum += energy;
            ++absoluteCount;
        }
    }

    if (absoluteCount == 0)
    {
        integratedReady = false;
        integratedLufs = -120.0f;
        return;
    }

    const double absoluteMean = absoluteSum / static_cast<double> (absoluteCount);
    const float absoluteLoudness = energyToLufs (absoluteMean);
    const float relativeGate = absoluteLoudness - 10.0f;

    double gatedSum = 0.0;
    int gatedCount = 0;

    for (const double energy : gateBlocks)
    {
        const float loudness = energyToLufs (energy);

        if (loudness > -70.0f && loudness > relativeGate)
        {
            gatedSum += energy;
            ++gatedCount;
        }
    }

    if (gatedCount == 0)
    {
        integratedReady = false;
        integratedLufs = -120.0f;
        return;
    }

    integratedEnergy = gatedSum / static_cast<double> (gatedCount);
    integratedLufs = energyToLufs (integratedEnergy);
    integratedReady = true;
}
} // namespace kyro
