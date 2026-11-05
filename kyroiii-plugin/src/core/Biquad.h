#pragma once

#include <cmath>

namespace kyro
{
/**
    Minimal transposed-direct-form-II biquad.

    The two K-weighting designs below are the exact BS.1770 analogue prototypes
    used by libebur128 (and most compliant meters), re-derived for any host
    sample rate. The generic low-pass is an RBJ cookbook design used only for the
    low-band split.
*/
class Biquad
{
public:
    void reset() noexcept
    {
        z1 = 0.0;
        z2 = 0.0;
    }

    void setCoefficients (double nb0, double nb1, double nb2,
                          double na1, double na2) noexcept
    {
        b0 = nb0;
        b1 = nb1;
        b2 = nb2;
        a1 = na1;
        a2 = na2;
    }

    /** Stage 1 of K-weighting: a +4 dB high shelf around 1.68 kHz. */
    void designKWeightingShelf (double sampleRate) noexcept
    {
        constexpr double f0 = 1681.974450955533;
        constexpr double gainDb = 3.999843853973347;
        constexpr double q = 0.7071752369554196;

        const double k = std::tan (3.14159265358979323846 * f0 / sampleRate);
        const double vh = std::pow (10.0, gainDb / 20.0);
        const double vb = std::pow (vh, 0.4996667741545416);
        const double a0 = 1.0 + k / q + k * k;

        setCoefficients ((vh + vb * k / q + k * k) / a0,
                         2.0 * (k * k - vh) / a0,
                         (vh - vb * k / q + k * k) / a0,
                         2.0 * (k * k - 1.0) / a0,
                         (1.0 - k / q + k * k) / a0);
    }

    /** Stage 2 of K-weighting: the 38 Hz high-pass. */
    void designKWeightingHighPass (double sampleRate) noexcept
    {
        constexpr double f0 = 38.13547087602444;
        constexpr double q = 0.5003270373238773;

        const double k = std::tan (3.14159265358979323846 * f0 / sampleRate);
        const double a0 = 1.0 + k / q + k * k;

        // BS.1770 publishes this stage with an unnormalised numerator; the
        // resulting pass-band gain is part of the standard's calibration.
        setCoefficients (1.0, -2.0, 1.0,
                         2.0 * (k * k - 1.0) / a0,
                         (1.0 - k / q + k * k) / a0);
    }

    void designLowPass (double f0, double q, double sampleRate) noexcept
    {
        const double w0 = 2.0 * 3.14159265358979323846 * f0 / sampleRate;
        const double cosW0 = std::cos (w0);
        const double alpha = std::sin (w0) / (2.0 * q);
        const double a0 = 1.0 + alpha;

        setCoefficients ((1.0 - cosW0) * 0.5 / a0,
                         (1.0 - cosW0) / a0,
                         (1.0 - cosW0) * 0.5 / a0,
                         -2.0 * cosW0 / a0,
                         (1.0 - alpha) / a0);
    }

    inline float processSample (float input) noexcept
    {
        const double x = static_cast<double> (input);
        const double y = b0 * x + z1;

        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;

        return static_cast<float> (y);
    }

private:
    double b0 = 1.0, b1 = 0.0, b2 = 0.0;
    double a1 = 0.0, a2 = 0.0;
    double z1 = 0.0, z2 = 0.0;
};
} // namespace kyro
