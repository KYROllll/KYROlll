#pragma once

#include "KyroTheme.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace kyro
{
/** The signature eight-petal flower, drawn as vector paths and slowly rotated. */
class FlowerLogo final : public juce::Component,
                         private juce::Timer
{
public:
    FlowerLogo();
    ~FlowerLogo() override;

    void paint (juce::Graphics& graphics) override;
    void mouseDown (const juce::MouseEvent& event) override;

    void setSpinning (bool shouldSpin) noexcept { spinning = shouldSpin; }
    bool isSpinning() const noexcept { return spinning; }

private:
    void timerCallback() override;

    float angle = 0.0f;
    bool spinning = true;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (FlowerLogo)
};
} // namespace kyro
