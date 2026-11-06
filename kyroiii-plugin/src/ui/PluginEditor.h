#pragma once

#include "../ui/MeterFace.h"

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

namespace kyro
{
class KyroIIIProcessor;

class KyroIIIEditor final : public juce::AudioProcessorEditor,
                            private juce::Timer
{
public:
    explicit KyroIIIEditor (KyroIIIProcessor& processorToUse);
    ~KyroIIIEditor() override;

    void paint (juce::Graphics& graphics) override;
    void resized() override;

private:
    void timerCallback() override;

    KyroIIIProcessor& processor;
    MeterFace face;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (KyroIIIEditor)
};
} // namespace kyro
