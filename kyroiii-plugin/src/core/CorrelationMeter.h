#pragma once

namespace kyro
{
/**
    Normalised stereo correlation over a 100 ms block.

    +1 = mono-coherent, 0 = uncorrelated, -1 = fully out of phase.
*/
class CorrelationMeter
{
public:
    void prepare (double sampleRate);
    void reset();

    void process (const float* left, const float* right, int numSamples) noexcept;
    void endBlock() noexcept;

    float correlation() const noexcept { return value; }
    bool hasSignal() const noexcept { return signalSeen; }

private:
    double sumLR = 0.0;
    double sumLL = 0.0;
    double sumRR = 0.0;
    float value = 0.0f;
    bool signalSeen = false;
};
} // namespace kyro
