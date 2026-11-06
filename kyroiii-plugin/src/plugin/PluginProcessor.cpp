#include "PluginProcessor.h"

#include "../ui/PluginEditor.h"

namespace kyro
{
KyroIIIProcessor::KyroIIIProcessor()
    : juce::AudioProcessor (BusesProperties()
                                .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                                .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

void KyroIIIProcessor::prepareToPlay (double sampleRate, int)
{
    engine.prepare (sampleRate);
}

void KyroIIIProcessor::releaseResources()
{
}

bool KyroIIIProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto output = layouts.getMainOutputChannelSet();
    const auto input = layouts.getMainInputChannelSet();

    if (output != juce::AudioChannelSet::stereo() && output != juce::AudioChannelSet::mono())
        return false;

    return input == output;
}

void KyroIIIProcessor::processBlock (juce::AudioBuffer<float>& buffer,
                                     juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples = buffer.getNumSamples();
    const int numChannels = buffer.getNumChannels();

    if (numSamples <= 0 || numChannels <= 0)
        return;

    const float* left = buffer.getReadPointer (0);
    const float* right = numChannels > 1 ? buffer.getReadPointer (1) : left;

    // Metering is a pure observer: the audio buffer is never modified.
    engine.process (left, right, numSamples);
}

juce::AudioProcessorEditor* KyroIIIProcessor::createEditor()
{
    return new KyroIIIEditor (*this);
}

const juce::String KyroIIIProcessor::getName() const
{
    return "KYROIII MASTERING METER";
}
} // namespace kyro

// Shared entry point for the AU, VST3 and Standalone wrappers.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new kyro::KyroIIIProcessor();
}
