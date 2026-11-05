#pragma once

#include "Biquad.h"

#include <array>
#include <vector>

namespace kyro
{
/**
    ITU-R BS.1770 K-weighted loudness with 100 ms sub-blocks.

    Momentary = 400 ms, short-term = 3 s, integrated = 400 ms blocks at 75 %
    overlap with the -70 LUFS absolute gate and -10 LU relative gate.
*/
class LoudnessMeter
{
public:
    void prepare (double sampleRate);
    void reset();

    void process (const float* left, const float* right, int numSamples) noexcept;
    void endBlock() noexcept;

    float momentary() const noexcept { return momentaryLufs; }
    float shortTerm() const noexcept { return shortTermLufs; }
    float integrated() const noexcept { return integratedLufs; }

    bool hasMomentary() const noexcept { return completedBlocks >= 4; }
    bool hasShortTerm() const noexcept { return completedBlocks >= 30; }
    bool hasIntegrated() const noexcept { return integratedReady; }

    int completedBlockCount() const noexcept { return completedBlocks; }

private:
    static constexpr int maxSubBlocks = 30; // 3 s at 100 ms resolution
    static constexpr int maxGateBlocks = 100000;

    void updateIntegrated();

    double sampleRate = 48000.0;
    int blockSamples = 4800;

    Biquad shelfL, shelfR, highPassL, highPassR;

    double sumL = 0.0;
    double sumR = 0.0;

    std::array<double, maxSubBlocks> subBlocks {};
    int writeIndex = 0;
    int validSubBlocks = 0;
    int completedBlocks = 0;

    std::vector<double> gateBlocks;
    double integratedEnergy = 0.0;
    bool integratedReady = false;

    float momentaryLufs = -120.0f;
    float shortTermLufs = -120.0f;
    float integratedLufs = -120.0f;
};
} // namespace kyro
