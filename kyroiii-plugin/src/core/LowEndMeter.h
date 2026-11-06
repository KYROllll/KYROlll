#pragma once

#include "Biquad.h"

namespace kyro
{
/**
    Share of programme energy below 120 Hz, expressed in dB.

    0 dB means all energy sits in the low band; -20 dB means the low band is
    1 % of the full-band energy. A single 2nd-order low-pass is enough for a
    diagnostic ratio and keeps the audio-thread cost tiny.
*/
class LowEndMeter
{
public:
    void prepare (double sampleRate);
    void reset();

    void process (const float* left, const float* right, int numSamples) noexcept;
    void endBlock() noexcept;

    float lowEndDb() const noexcept { return value; }
    bool hasSignal() const noexcept { return signalSeen; }

    static constexpr float crossoverHz = 120.0f;

private:
    Biquad lowPassL;
    Biquad lowPassR;

    double lowSum = 0.0;
    double fullSum = 0.0;
    float value = -120.0f;
    bool signalSeen = false;
};
} // namespace kyro
