#pragma once

#include "DiagnosticWindow.h"
#include "FlowerLogo.h"
#include "KyroButton.h"
#include "KyroTheme.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace kyro
{
class KyroIIIProcessor;

class MeterFace final : public juce::Component
{
public:
    explicit MeterFace (KyroIIIProcessor& processor);
    ~MeterFace() override = default;

    void paint (juce::Graphics& graphics) override;
    void resized() override;

    void setSnapshot (const MeterSnapshot& newSnapshot);

private:
    void updateWindows();

    KyroIIIProcessor& processor;

    FlowerLogo flower;
    DiagnosticWindow lowEndWindow;
    DiagnosticWindow correlationWindow;
    DiagnosticWindow lufsWindow;
    DiagnosticWindow dynamicsWindow;
    KyroButton resetButton { "RESET METERS" };

    MeterSnapshot snapshot;
    int lastSessionSecond = -1;
    bool lastClipping = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MeterFace)
};
} // namespace kyro
