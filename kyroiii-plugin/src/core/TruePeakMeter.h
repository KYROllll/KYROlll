#pragma once

#include <algorithm>
#include <array>
#include <cmath>

namespace kyro
{
/**
    4x windowed-sinc inter-sample peak estimator with a 12 dB/s release.

    Sixteen taps of a Blackman-windowed sinc are evaluated at 0.25, 0.5 and 0.75
    of every sample interval. The estimate is still an estimator rather than a
    certified ITU-R BS.1770-4 true-peak meter (the standard specifies a
    polyphase FIR and a particular meter ballistic), but it tracks near-Nyquist
    content far better than linear or 4-point cubic interpolation.
*/
class TruePeakMeter
{
public:
    void prepare (double sampleRate)
    {
        const double fs = sampleRate > 0.0 ? sampleRate : 48000.0;
        release = std::pow (10.0, -12.0 / 20.0 / fs);
        buildCoefficients();
        reset();
    }

    void reset()
    {
        historyL.fill (0.0);
        historyR.fill (0.0);
        writeIndex = 0;
        filled = 0;
        peak = 0.0;
        clipped = false;
    }

    void process (const float* left, const float* right, int numSamples) noexcept
    {
        for (int i = 0; i < numSamples; ++i)
        {
            const double sampleL = left[i];
            const double sampleR = right[i];

            historyL[static_cast<size_t> (writeIndex)] = sampleL;
            historyR[static_cast<size_t> (writeIndex)] = sampleR;

            double instant = std::max (std::abs (sampleL), std::abs (sampleR));

            if (filled >= 18)
            {
                for (int phase = 0; phase < 3; ++phase)
                {
                    instant = std::max (instant, evaluate (historyL, phase));
                    instant = std::max (instant, evaluate (historyR, phase));
                }
            }

            peak = std::max (instant, peak * release);

            if (std::abs (sampleL) >= 1.0 || std::abs (sampleR) >= 1.0
                || instant >= 1.001)
                clipped = true;

            writeIndex = (writeIndex + 1) % historySize;

            if (filled < historySize)
                ++filled;
        }
    }

    float linearPeak() const noexcept { return static_cast<float> (peak); }
    bool isClipping() const noexcept { return clipped; }

private:
    static constexpr int taps = 16;
    static constexpr int historySize = 64;
    static constexpr int segmentDelay = 9; // evaluate the segment ending 8 samples ago

    static double sinc (double x) noexcept
    {
        if (std::abs (x) < 1.0e-12)
            return 1.0;

        const double pix = 3.14159265358979323846 * x;
        return std::sin (pix) / pix;
    }

    static double blackman (double x) noexcept
    {
        constexpr double support = 8.0;

        if (std::abs (x) > support)
            return 0.0;

        const double ratio = 3.14159265358979323846 * x / support;
        return 0.42 + 0.5 * std::cos (ratio) + 0.08 * std::cos (2.0 * ratio);
    }

    void buildCoefficients() noexcept
    {
        for (int phase = 0; phase < 3; ++phase)
        {
            const double fraction = (phase + 1) * 0.25;
            double sum = 0.0;

            for (int tap = 0; tap < taps; ++tap)
            {
                const int offset = tap - (taps / 2);
                const double distance = fraction - static_cast<double> (offset);
                const double value = sinc (distance) * blackman (distance);
                coefficients[static_cast<size_t> (phase)][static_cast<size_t> (tap)] = value;
                sum += value;
            }

            if (std::abs (sum) > 1.0e-12)
            {
                for (int tap = 0; tap < taps; ++tap)
                    coefficients[static_cast<size_t> (phase)][static_cast<size_t> (tap)] /= sum;
            }
        }
    }

    double evaluate (const std::array<double, historySize>& history, int phase) const noexcept
    {
        double value = 0.0;

        for (int tap = 0; tap < taps; ++tap)
        {
            const int offset = tap - (taps / 2);
            const int relative = -segmentDelay + offset;
            const int index = (writeIndex + relative + historySize) % historySize;
            value += coefficients[static_cast<size_t> (phase)][static_cast<size_t> (tap)]
                     * history[static_cast<size_t> (index)];
        }

        return std::abs (value);
    }

    std::array<double, historySize> historyL {};
    std::array<double, historySize> historyR {};
    std::array<std::array<double, taps>, 3> coefficients {};
    int writeIndex = 0;
    int filled = 0;
    double peak = 0.0;
    double release = 0.999;
    bool clipped = false;
};
} // namespace kyro
