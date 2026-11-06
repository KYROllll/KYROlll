#pragma once

#include "KyroTheme.h"

#include <juce_gui_basics/juce_gui_basics.h>

#include <array>

namespace kyro
{
struct DiagnosticReading
{
    juce::String title;
    juce::String value;
    juce::String unit;
    juce::String detailALabel;
    juce::String detailAValue;
    juce::String detailBLabel;
    juce::String detailBValue;

    Status status = Status::idle;
    std::array<float, 120> history {};
    int historyCount = 0;
    float minValue = 0.0f;
    float maxValue = 1.0f;
};

/** One modular traffic-light diagnostic window. */
class DiagnosticWindow final : public juce::Component
{
public:
    DiagnosticWindow() = default;

    void setReading (const DiagnosticReading& newReading);
    void paint (juce::Graphics& graphics) override;

private:
    void paintGraph (juce::Graphics& graphics, juce::Rectangle<float> area) const;
    void paintDetail (juce::Graphics& graphics, juce::Rectangle<float> area,
                      const juce::String& label, const juce::String& value) const;
    void paintTrafficLights (juce::Graphics& graphics, juce::Rectangle<float> area) const;

    DiagnosticReading reading;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DiagnosticWindow)
};
} // namespace kyro
