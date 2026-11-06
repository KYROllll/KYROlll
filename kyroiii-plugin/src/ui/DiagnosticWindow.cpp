#include "DiagnosticWindow.h"

#include <algorithm>
#include <cmath>

namespace kyro
{
void DiagnosticWindow::setReading (const DiagnosticReading& newReading)
{
    reading = newReading;
    repaint();
}

void DiagnosticWindow::paint (juce::Graphics& graphics)
{
    auto bounds = getLocalBounds().toFloat().reduced (1.0f);

    graphics.setColour (theme::panel);
    graphics.fillRoundedRectangle (bounds, 3.0f);

    graphics.setColour (theme::hairline);
    graphics.drawRoundedRectangle (bounds, 3.0f, 1.0f);

    graphics.setColour (theme::gold.withAlpha (0.42f));
    graphics.fillRect (bounds.getX() + 12.0f, bounds.getY() + 1.0f,
                       bounds.getWidth() - 24.0f, 1.0f);

    // Precision corner ticks.
    const auto tick = [&graphics, &bounds] (float x, float y, float dx, float dy)
    {
        graphics.setColour (theme::gold.withAlpha (0.45f));
        graphics.drawLine (x, y, x + dx, y, 1.0f);
        graphics.drawLine (x, y, x, y + dy, 1.0f);
    };

    tick (bounds.getX() + 6.0f, bounds.getY() + 6.0f, 9.0f, 9.0f);
    tick (bounds.getRight() - 6.0f, bounds.getY() + 6.0f, -9.0f, 9.0f);
    tick (bounds.getX() + 6.0f, bounds.getBottom() - 6.0f, 9.0f, -9.0f);
    tick (bounds.getRight() - 6.0f, bounds.getBottom() - 6.0f, -9.0f, -9.0f);

    auto content = bounds.reduced (16.0f, 14.0f);
    auto header = content.removeFromTop (16.0f);

    theme::drawTrackedText (graphics,
                            reading.title,
                            header,
                            2.2f,
                            juce::Justification::left,
                            theme::mono (9.0f),
                            theme::cream);

    auto lights = header.removeFromRight (46.0f);
    paintTrafficLights (graphics, lights);

    auto statusArea = header.removeFromRight (62.0f);
    theme::drawTrackedText (graphics,
                            juce::String (statusLabel (reading.status)).toUpperCase(),
                            statusArea,
                            1.4f,
                            juce::Justification::right,
                            theme::mono (7.5f),
                            theme::statusColour (reading.status));

    content.removeFromTop (8.0f);
    auto detailRow = content.removeFromBottom (32.0f);
    content.removeFromBottom (6.0f);

    const float graphWidth = content.getWidth() * 0.42f;
    auto graphArea = content.removeFromRight (graphWidth).reduced (0.0f, 4.0f);
    content.removeFromRight (10.0f);

    auto valueArea = content;

    const auto valueFont = theme::display (43.0f);
    graphics.setFont (valueFont);
    graphics.setColour (reading.value == "-" ? theme::dim : theme::cream);
    graphics.drawText (reading.value,
                       valueArea.removeFromTop (52.0f),
                       juce::Justification::centredLeft,
                       false);

    theme::drawTrackedText (graphics,
                            reading.unit,
                            valueArea.removeFromTop (14.0f),
                            1.8f,
                            juce::Justification::left,
                            theme::mono (7.5f),
                            theme::gold);

    theme::drawTrackedText (graphics,
                            "STATUS / " + juce::String (statusLabel (reading.status)).toUpperCase(),
                            valueArea.removeFromTop (14.0f),
                            1.5f,
                            juce::Justification::left,
                            theme::mono (7.5f),
                            theme::statusColour (reading.status));

    paintGraph (graphics, graphArea);

    auto detailLeft = detailRow.removeFromLeft (detailRow.getWidth() * 0.5f);
    paintDetail (graphics, detailLeft, reading.detailALabel, reading.detailAValue);

    graphics.setColour (theme::hairlineSoft);
    graphics.drawVerticalLine (juce::roundToInt (detailRow.getX()),
                               detailRow.getY(), detailRow.getBottom());

    paintDetail (graphics, detailRow.reduced (10.0f, 0.0f),
                 reading.detailBLabel, reading.detailBValue);
}

void DiagnosticWindow::paintGraph (juce::Graphics& graphics, juce::Rectangle<float> area) const
{
    if (area.getWidth() <= 4.0f || area.getHeight() <= 4.0f)
        return;

    graphics.setColour (theme::hairlineSoft);

    for (int i = 1; i < 4; ++i)
    {
        const float y = area.getY() + area.getHeight() * static_cast<float> (i) / 4.0f;
        graphics.drawHorizontalLine (juce::roundToInt (y), area.getX(), area.getRight());
    }

    for (int i = 1; i < 4; ++i)
    {
        const float x = area.getX() + area.getWidth() * static_cast<float> (i) / 4.0f;
        graphics.drawVerticalLine (juce::roundToInt (x), area.getY(), area.getBottom());
    }

    const int count = std::min (reading.historyCount, static_cast<int> (reading.history.size()));

    if (count < 2)
        return;

    const float range = std::max (0.0001f, reading.maxValue - reading.minValue);
    juce::Path line;
    juce::Path fill;
    bool started = false;
    bool fillStarted = false;
    float firstX = 0.0f;
    float lastX = 0.0f;
    juce::Point<float> lastPoint;

    for (int i = 0; i < count; ++i)
    {
        const float value = reading.history[static_cast<size_t> (i)];

        // Do not draw the warm-up placeholder (for example -120 LUFS).
        if (value < reading.minValue - 1.0f)
        {
            started = false;
            fillStarted = false;
            continue;
        }

        const float normalised = std::clamp ((value - reading.minValue) / range, 0.0f, 1.0f);
        const float x = area.getX() + area.getWidth() * static_cast<float> (i)
                                        / static_cast<float> (count - 1);
        const float y = area.getBottom() - normalised * area.getHeight();

        if (! started)
        {
            line.startNewSubPath (x, y);
            started = true;
            firstX = x;
        }
        else
        {
            line.lineTo (x, y);
        }

        if (! fillStarted)
        {
            fill.startNewSubPath (x, area.getBottom());
            fill.lineTo (x, y);
            fillStarted = true;
        }
        else
        {
            fill.lineTo (x, y);
        }

        lastX = x;
        lastPoint = { x, y };
    }

    if (line.isEmpty())
        return;

    if (fillStarted)
    {
        fill.lineTo (lastX, area.getBottom());
        fill.lineTo (firstX, area.getBottom());
        fill.closeSubPath();

        graphics.setGradientFill (juce::ColourGradient (theme::gold.withAlpha (0.20f),
                                                        area.getX(), area.getY(),
                                                        theme::gold.withAlpha (0.0f),
                                                        area.getX(), area.getBottom(),
                                                        false));
        graphics.fillPath (fill);
    }

    graphics.setColour (theme::gold.withAlpha (0.16f));
    graphics.strokePath (line, juce::PathStrokeType (5.0f));
    graphics.setColour (theme::goldBright);
    graphics.strokePath (line, juce::PathStrokeType (1.5f));

    graphics.setColour (theme::cream);
    graphics.fillEllipse (lastPoint.x - 2.0f, lastPoint.y - 2.0f, 4.0f, 4.0f);
}

void DiagnosticWindow::paintDetail (juce::Graphics& graphics,
                                    juce::Rectangle<float> area,
                                    const juce::String& label,
                                    const juce::String& value) const
{
    auto labelArea = area.removeFromTop (12.0f);
    theme::drawTrackedText (graphics, label, labelArea, 1.4f,
                            juce::Justification::left, theme::mono (7.0f), theme::muted);

    graphics.setFont (theme::mono (9.0f));
    graphics.setColour (theme::cream);
    graphics.drawText (value, area.removeFromTop (14.0f),
                       juce::Justification::centredLeft, false);
}

void DiagnosticWindow::paintTrafficLights (juce::Graphics& graphics,
                                           juce::Rectangle<float> area) const
{
    constexpr float lampSize = 8.0f;
    constexpr float gap = 7.0f;
    const float totalWidth = lampSize * 3.0f + gap * 2.0f;
    float x = area.getRight() - totalWidth;
    const float y = area.getCentreY() - lampSize * 0.5f;

    const Status lamps[] = { Status::good, Status::warn, Status::bad };

    for (const auto lamp : lamps)
    {
        const bool active = reading.status == lamp;

        if (active)
        {
            graphics.setColour (theme::statusColour (lamp).withAlpha (0.16f));
            graphics.fillEllipse (x - 3.0f, y - 3.0f, lampSize + 6.0f, lampSize + 6.0f);
        }

        graphics.setColour (active ? theme::statusColour (lamp)
                                   : theme::idle.withAlpha (0.55f));
        graphics.fillEllipse (x, y, lampSize, lampSize);

        graphics.setColour (active ? theme::statusColour (lamp).brighter (0.35f)
                                   : theme::hairline);
        graphics.drawEllipse (x, y, lampSize, lampSize, 0.8f);

        x += lampSize + gap;
    }
}
} // namespace kyro
