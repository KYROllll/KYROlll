#pragma once

#include "CorrelationMeter.h"
#include "DynamicRangeMeter.h"
#include "LoudnessMeter.h"
#include "LowEndMeter.h"
#include "MeterTypes.h"
#include "Seqlock.h"
#include "TruePeakMeter.h"

#include <array>
#include <atomic>

namespace kyro
{
/**
    The complete meter. Audio-thread only for process(); the editor only calls
    snapshot() and requestReset(). No allocation or locking happens in
    processBlock after prepare().
*/
class MeterEngine
{
public:
    MeterEngine();

    void prepare (double sampleRate);
    void reset();

    /** Safe from the message thread: the audio thread performs the reset. */
    void requestReset() noexcept { resetRequested.store (true, std::memory_order_relaxed); }

    void process (const float* left, const float* right, int numSamples) noexcept;

    MeterSnapshot snapshot() const noexcept { return bus.read(); }

    double getSampleRate() const noexcept { return sampleRate; }

private:
    void resetState();
    void processBlockBoundary() noexcept;
    void publish();
    void appendHistory (float lowEnd, float correlation, float lufs, float dr) noexcept;

    LoudnessMeter loudness;
    LowEndMeter lowEnd;
    CorrelationMeter correlation;
    DynamicRangeMeter dynamicRange;
    TruePeakMeter truePeak;

    double sampleRate = 48000.0;
    int blockSamples = 4800;
    int samplesToBlock = 4800;
    double sessionSeconds = 0.0;

    std::atomic<bool> resetRequested { false };
    Seqlock<MeterSnapshot> bus;

    int historyCount = 0;
    std::array<float, 120> lowEndHistory {};
    std::array<float, 120> correlationHistory {};
    std::array<float, 120> lufsHistory {};
    std::array<float, 120> dynamicRangeHistory {};
};
} // namespace kyro
