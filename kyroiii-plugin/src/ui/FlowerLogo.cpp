#include "FlowerLogo.h"

#include <cmath>

namespace kyro
{
namespace
{
constexpr float twoPi = 6.28318530717958647692f;
}

FlowerLogo::FlowerLogo()
{
    setOpaque (false);
    setMouseCursor (juce::MouseCursor::PointingHandCursor);
    startTimerHz (30);
}

FlowerLogo::~FlowerLogo()
{
    stopTimer();
}

void FlowerLogo::timerCallback()
{
    if (! spinning)
        return;

    angle += 0.006f;

    if (angle > twoPi)
        angle -= twoPi;

    repaint();
}

void FlowerLogo::mouseDown (const juce::MouseEvent&)
{
    spinning = ! spinning;
    repaint();
}

void FlowerLogo::paint (juce::Graphics& graphics)
{
    const auto area = getLocalBounds().toFloat().reduced (2.0f);
    const auto centre = area.getCentre();
    const float radius = std::min (area.getWidth(), area.getHeight()) * 0.5f;

    if (radius <= 1.0f)
        return;

    juce::Graphics::ScopedSaveState save (graphics);

    graphics.setColour (theme::gold.withAlpha (0.035f));
    graphics.fillEllipse (centre.x - radius, centre.y - radius, radius * 2.0f, radius * 2.0f);

    graphics.addTransform (juce::AffineTransform::rotation (angle, centre.x, centre.y));

    for (int petalIndex = 0; petalIndex < 8; ++petalIndex)
    {
        juce::Path petal;
        petal.addEllipse (centre.x - radius * 0.225f,
                          centre.y - radius * 0.88f,
                          radius * 0.45f,
                          radius * 0.78f);

        petal.applyTransform (juce::AffineTransform::rotation (twoPi * petalIndex / 8.0f,
                                                               centre.x, centre.y));

        const float blend = 0.12f + 0.58f * static_cast<float> (petalIndex % 4) / 3.0f;
        const auto petalColour = theme::gold.interpolatedWith (theme::brown, blend);

        graphics.setColour (petalColour.withAlpha (0.94f));
        graphics.fillPath (petal);

        graphics.setColour (theme::goldBright.withAlpha (0.22f));
        graphics.strokePath (petal, juce::PathStrokeType (0.8f));
    }

    graphics.setColour (theme::background);
    graphics.fillEllipse (centre.x - radius * 0.34f,
                          centre.y - radius * 0.34f,
                          radius * 0.68f,
                          radius * 0.68f);

    graphics.setColour (theme::gold.withAlpha (0.85f));
    graphics.drawEllipse (centre.x - radius * 0.34f,
                          centre.y - radius * 0.34f,
                          radius * 0.68f,
                          radius * 0.68f,
                          1.2f);

    graphics.setColour (theme::goldBright);
    graphics.fillEllipse (centre.x - radius * 0.105f,
                          centre.y - radius * 0.105f,
                          radius * 0.21f,
                          radius * 0.21f);

    for (int dot = 0; dot < 8; ++dot)
    {
        const float dotAngle = twoPi * static_cast<float> (dot) / 8.0f;
        const float dotRadius = radius * 0.225f;
        const float x = centre.x + std::cos (dotAngle) * dotRadius;
        const float y = centre.y + std::sin (dotAngle) * dotRadius;

        graphics.setColour (theme::gold.withAlpha (0.55f));
        graphics.fillEllipse (x - radius * 0.022f, y - radius * 0.022f,
                              radius * 0.044f, radius * 0.044f);
    }

    graphics.setColour (theme::hairline);
    graphics.drawEllipse (centre.x - radius * 0.96f,
                          centre.y - radius * 0.96f,
                          radius * 1.92f,
                          radius * 1.92f,
                          0.8f);
}
} // namespace kyro
