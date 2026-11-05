#include "PluginEditor.h"

#include "../plugin/PluginProcessor.h"

namespace kyro
{
KyroIIIEditor::KyroIIIEditor (KyroIIIProcessor& processorToUse)
    : juce::AudioProcessorEditor (&processorToUse),
      processor (processorToUse),
      face (processorToUse)
{
    setOpaque (true);
    setSize (1100, 680);
    setResizable (false, false);

    addAndMakeVisible (face);
    startTimerHz (30);
}

KyroIIIEditor::~KyroIIIEditor()
{
    stopTimer();
}

void KyroIIIEditor::paint (juce::Graphics& graphics)
{
    graphics.fillAll (theme::background);
}

void KyroIIIEditor::resized()
{
    face.setBounds (getLocalBounds());
}

void KyroIIIEditor::timerCallback()
{
    face.setSnapshot (processor.getEngine().snapshot());
}
} // namespace kyro
