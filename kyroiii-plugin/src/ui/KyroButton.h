#pragma once

#include "KyroTheme.h"

namespace kyro
{
class KyroButton final : public juce::Button
{
public:
    explicit KyroButton (const juce::String& text)
        : juce::Button (text)
    {
        setMouseCursor (juce::MouseCursor::PointingHandCursor);
    }

    void paintButton (juce::Graphics& graphics,
                      bool shouldDrawButtonAsHighlighted,
                      bool shouldDrawButtonAsDown) override
    {
        auto bounds = getLocalBounds().toFloat().reduced (0.5f);

        graphics.setColour (shouldDrawButtonAsDown ? theme::brownDeep
                                                   : shouldDrawButtonAsHighlighted ? theme::panelRaised
                                                                                   : theme::panel);
        graphics.fillRoundedRectangle (bounds, 2.0f);

        graphics.setColour (theme::gold.withAlpha (shouldDrawButtonAsHighlighted ? 0.9f : 0.5f));
        graphics.drawRoundedRectangle (bounds, 2.0f, 1.0f);

        graphics.setColour (theme::gold.withAlpha (0.8f));
        graphics.fillRect (bounds.getX() + 6.0f, bounds.getY() + 1.0f,
                           bounds.getWidth() - 12.0f, 1.0f);

        theme::drawTrackedText (graphics,
                                getButtonText().toUpperCase(),
                                bounds.reduced (8.0f, 0.0f),
                                2.2f,
                                juce::Justification::centred,
                                theme::mono (9.0f),
                                shouldDrawButtonAsHighlighted ? theme::goldBright : theme::cream);
    }

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (KyroButton)
};
} // namespace kyro
