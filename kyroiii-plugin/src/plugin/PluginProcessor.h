#pragma once

#include "../core/MeterEngine.h"

#include <juce_audio_processors/juce_audio_processors.h>

namespace kyro
{
class KyroIIIProcessor final : public juce::AudioProcessor
{
public:
    KyroIIIProcessor();
    ~KyroIIIProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override;
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "DEFAULT"; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override {}
    void setStateInformation (const void*, int) override {}

    void reset() override { engine.requestReset(); }

    MeterEngine& getEngine() noexcept { return engine; }

private:
    MeterEngine engine;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (KyroIIIProcessor)
};
} // namespace kyro
