#include "MeterEngine.h"

#include <algorithm>
#include <cmath>

namespace kyro
{
MeterEngine::MeterEngine()
{
    prepare (48000.0);
}

void MeterEngine::prepare (double newSampleRate)
{
    sampleRate = newSampleRate > 0.0 ? newSampleRate : 48000.0;
    blockSamples = std::max (1, static_cast<int> (std::llround (sampleRate * 0.1)));
    samplesToBlock = blockSamples;

    loudness.prepare (sampleRate);
    lowEnd.prepare (sampleRate);
    correlation.prepare (sampleRate);
    truePeak.prepare (sampleRate);
    dynamicRange.prepare();
    dynamicRange.reset();

    resetState();
}

void MeterEngine::reset()
{
    resetState();
}

void MeterEngine::resetState()
{
    loudness.reset();
    lowEnd.reset();
    correlation.reset();
    dynamicRange.reset();
    truePeak.reset();

    sessionSeconds = 0.0;
    samplesToBlock = blockSamples;
    historyCount = 0;

    lowEndHistory.fill (-120.0f);
    correlationHistory.fill (0.0f);
    lufsHistory.fill (-120.0f);
    dynamicRangeHistory.fill (0.0f);

    publish();
}

void MeterEngine::process (const float* left, const float* right, int numSamples) noexcept
{
    if (resetRequested.exchange (false, std::memory_order_relaxed))
        resetState();

    if (numSamples <= 0)
        return;

    int offset = 0;

    while (offset < numSamples)
    {
        const int chunk = std::min (numSamples - offset, samplesToBlock);

        loudness.process (left + offset, right + offset, chunk);
        lowEnd.process (left + offset, right + offset, chunk);
        correlation.process (left + offset, right + offset, chunk);
        truePeak.process (left + offset, right + offset, chunk);

        offset += chunk;
        samplesToBlock -= chunk;

        if (samplesToBlock == 0)
        {
            processBlockBoundary();
            samplesToBlock = blockSamples;
        }
    }

    sessionSeconds += static_cast<double> (numSamples) / sampleRate;
}

void MeterEngine::processBlockBoundary() noexcept
{
    loudness.endBlock();
    lowEnd.endBlock();
    correlation.endBlock();

    if (loudness.hasShortTerm())
        dynamicRange.addShortTerm (loudness.shortTerm());

    appendHistory (lowEnd.lowEndDb(),
                   correlation.correlation(),
                   loudness.integrated(),
                   dynamicRange.dynamicRangeLu());

    publish();
}

void MeterEngine::appendHistory (float lowEndValue, float correlationValue,
                                 float lufsValue, float drValue) noexcept
{
    const auto append = [this] (std::array<float, 120>& target, float value)
    {
        if (historyCount < static_cast<int> (target.size()))
        {
            target[static_cast<size_t> (historyCount)] = value;
        }
        else
        {
            std::move (target.begin() + 1, target.end(), target.begin());
            target.back() = value;
        }
    };

    append (lowEndHistory, lowEndValue);
    append (correlationHistory, correlationValue);
    append (lufsHistory, lufsValue);
    append (dynamicRangeHistory, drValue);

    if (historyCount < static_cast<int> (lowEndHistory.size()))
        ++historyCount;
}

void MeterEngine::publish()
{
    MeterSnapshot frame;

    frame.lowEndDb = lowEnd.lowEndDb();
    frame.correlation = correlation.correlation();
    frame.lufsMomentary = loudness.momentary();
    frame.lufsShortTerm = loudness.shortTerm();
    frame.lufsIntegrated = loudness.integrated();
    frame.truePeakDb = linearToDb (truePeak.linearPeak());
    frame.dynamicRangeLu = dynamicRange.dynamicRangeLu();
    frame.peakToLoudnessDb = DynamicRangeMeter::peakToLoudness (frame.truePeakDb,
                                                                frame.lufsIntegrated);

    frame.lowEndStatus = classifyLowEnd (frame.lowEndDb);
    frame.correlationStatus = correlation.hasSignal()
                                ? classifyCorrelation (frame.correlation)
                                : Status::idle;
    frame.lufsStatus = classifyLufs (frame.lufsIntegrated, loudness.hasIntegrated());
    frame.dynamicRangeStatus = classifyDynamicRange (frame.dynamicRangeLu,
                                                     dynamicRange.isReady());

    frame.clipping = truePeak.isClipping();
    frame.loudnessReady = loudness.hasIntegrated();
    frame.dynamicsReady = dynamicRange.isReady();

    frame.sampleRate = sampleRate;
    frame.sessionSeconds = sessionSeconds;

    frame.historyCount = historyCount;
    frame.lowEndHistory = lowEndHistory;
    frame.correlationHistory = correlationHistory;
    frame.lufsHistory = lufsHistory;
    frame.dynamicRangeHistory = dynamicRangeHistory;

    bus.write (frame);
}
} // namespace kyro
