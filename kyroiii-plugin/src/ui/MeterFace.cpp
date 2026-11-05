#include "MeterFace.h"

#include "../plugin/PluginProcessor.h"

#include <cmath>

namespace kyro
{
MeterFace::MeterFace (KyroIIIProcessor& processorToUse)
    : processor (processorToUse)
{
    setOpaque (true);

    addAndMakeVisible (flower);
    addAndMakeVisible (lowEndWindow);
    addAndMakeVisible (correlationWindow);
    addAndMakeVisible (lufsWindow);
    addAndMakeVisible (dynamicsWindow);
    addAndMakeVisible (resetButton);

    resetButton.onClick = [this]
    {
        processor.getEngine().requestReset();
    };

    updateWindows();
}

void MeterFace::setSnapshot (const MeterSnapshot& newSnapshot)
{
    snapshot = newSnapshot;
    updateWindows();

    const int sessionSecond = static_cast<int> (std::floor (snapshot.sessionSeconds));

    if (sessionSecond != lastSessionSecond || snapshot.clipping != lastClipping)
    {
        lastSessionSecond = sessionSecond;
        lastClipping = snapshot.clipping;
        repaint();
    }
}

void MeterFace::updateWindows()
{
    DiagnosticReading lowEnd;
    lowEnd.title = "LOW-END WEIGHT";
    lowEnd.value = theme::formatDb (snapshot.lowEndDb);
    lowEnd.unit = "DB / 20-120 HZ";
    lowEnd.detailALabel = "BAND";
    lowEnd.detailAValue = "SUB / 20-120 HZ";
    lowEnd.detailBLabel = "TARGET";
    lowEnd.detailBValue = "-14 TO -3 DB";
    lowEnd.status = snapshot.lowEndStatus;
    lowEnd.history = snapshot.lowEndHistory;
    lowEnd.historyCount = snapshot.historyCount;
    lowEnd.minValue = -30.0f;
    lowEnd.maxValue = 0.0f;
    lowEndWindow.setReading (lowEnd);

    DiagnosticReading correlation;
    correlation.title = "STEREO CORRELATION";
    correlation.value = snapshot.correlationStatus == Status::idle
                            ? "-"
                            : theme::formatSigned (snapshot.correlation, 2);
    correlation.unit = "CORR / -1 TO +1";
    correlation.detailALabel = "PHASE";
    correlation.detailAValue = snapshot.correlationStatus == Status::idle
                                   ? "NO SIGNAL"
                                   : snapshot.correlation < -0.1f ? "OUT OF PHASE"
                                   : snapshot.correlation < thresholds::correlationGood ? "DIFFUSE"
                                                                                        : "IN PHASE";
    correlation.detailBLabel = "TARGET";
    correlation.detailBValue = "> +0.30";
    correlation.status = snapshot.correlationStatus;
    correlation.history = snapshot.correlationHistory;
    correlation.historyCount = snapshot.historyCount;
    correlation.minValue = -1.0f;
    correlation.maxValue = 1.0f;
    correlationWindow.setReading (correlation);

    DiagnosticReading lufs;
    lufs.title = "LUFS METERING";
    lufs.value = snapshot.loudnessReady ? theme::formatDb (snapshot.lufsIntegrated) : "-";
    lufs.unit = "LUFS / INTEGRATED";
    lufs.detailALabel = "MOMENTARY";
    lufs.detailAValue = theme::formatDb (snapshot.lufsMomentary) + " LUFS";
    lufs.detailBLabel = "SHORT-TERM";
    lufs.detailBValue = theme::formatDb (snapshot.lufsShortTerm) + " LUFS";
    lufs.status = snapshot.lufsStatus;
    lufs.history = snapshot.lufsHistory;
    lufs.historyCount = snapshot.historyCount;
    lufs.minValue = -36.0f;
    lufs.maxValue = 0.0f;
    lufsWindow.setReading (lufs);

    DiagnosticReading dynamics;
    dynamics.title = "DYNAMIC RANGE";
    dynamics.value = snapshot.dynamicsReady ? juce::String (snapshot.dynamicRangeLu, 1) : "-";
    dynamics.unit = "LU / P95-P10";
    dynamics.detailALabel = "PLR";
    dynamics.detailAValue = theme::formatDb (snapshot.peakToLoudnessDb) + " DB";
    dynamics.detailBLabel = "TRUE PEAK";
    dynamics.detailBValue = theme::formatDb (snapshot.truePeakDb) + " DBTP";
    dynamics.status = snapshot.dynamicRangeStatus;
    dynamics.history = snapshot.dynamicRangeHistory;
    dynamics.historyCount = snapshot.historyCount;
    dynamics.minValue = 0.0f;
    dynamics.maxValue = 20.0f;
    dynamicsWindow.setReading (dynamics);
}

void MeterFace::paint (juce::Graphics& graphics)
{
    graphics.fillAll (theme::background);

    juce::ColourGradient glow (theme::brownDeep.withAlpha (0.34f),
                               getWidth() * 0.10f, 0.0f,
                               theme::background.withAlpha (0.0f),
                               getWidth() * 0.62f, getHeight() * 0.78f,
                               true);
    graphics.setGradientFill (glow);
    graphics.fillAll();

    for (int y = 0; y < getHeight(); y += 4)
    {
        graphics.setColour (theme::cream.withAlpha (0.008f));
        graphics.drawHorizontalLine (y, 0.0f, static_cast<float> (getWidth()));
    }

    graphics.setColour (theme::hairline);
    graphics.drawRect (getLocalBounds(), 1);

    const float dividerY = 110.0f;
    juce::ColourGradient divider (theme::gold.withAlpha (0.0f), 24.0f, dividerY,
                                  theme::gold.withAlpha (0.55f), getWidth() * 0.5f, dividerY,
                                  false);
    divider.addColour (1.0, theme::gold.withAlpha (0.0f));
    graphics.setGradientFill (divider);
    graphics.fillRect (24.0f, dividerY, getWidth() - 48.0f, 1.0f);

    theme::drawTrackedText (graphics, "KYROIII",
                            { 116.0f, 12.0f, 620.0f, 45.0f },
                            4.2f, juce::Justification::left,
                            theme::display (34.0f), theme::cream);

    theme::drawTrackedText (graphics, "MASTERING METER / DIAGNOSTIC CONSOLE",
                            { 118.0f, 58.0f, 620.0f, 14.0f },
                            3.0f, juce::Justification::left,
                            theme::mono (8.5f), theme::gold);

    theme::drawTrackedText (graphics, "REFERENCE TARGET -14 LUFS // TRUE PEAK // DR",
                            { 118.0f, 76.0f, 620.0f, 12.0f },
                            1.7f, juce::Justification::left,
                            theme::mono (7.0f), theme::muted);

    const float rightX = static_cast<float> (getWidth()) - 268.0f;
    const float rightWidth = 244.0f;

    theme::drawTrackedText (graphics, "SESSION",
                            { rightX, 20.0f, rightWidth, 12.0f },
                            2.4f, juce::Justification::right,
                            theme::mono (7.0f), theme::muted);

    const int totalSeconds = static_cast<int> (std::floor (snapshot.sessionSeconds));
    const int hours = (totalSeconds / 3600) % 100;
    const int minutes = (totalSeconds / 60) % 60;
    const int seconds = totalSeconds % 60;
    const juce::String clock = juce::String::formatted ("%02d:%02d:%02d", hours, minutes, seconds);

    graphics.setFont (theme::mono (19.0f));
    graphics.setColour (theme::cream);
    graphics.drawText (clock, juce::Rectangle<float> (rightX, 32.0f, rightWidth, 24.0f),
                       juce::Justification::centredRight, false);

    theme::drawTrackedText (graphics,
                            juce::String (snapshot.sampleRate / 1000.0, 1) + " KHZ / AU + VST3",
                            { rightX, 60.0f, rightWidth, 12.0f },
                            1.7f, juce::Justification::right,
                            theme::mono (7.0f), theme::muted);

    auto clipBadge = juce::Rectangle<float> (rightX + rightWidth - 72.0f, 80.0f, 72.0f, 16.0f);
    graphics.setColour (snapshot.clipping ? theme::bad.withAlpha (0.16f) : theme::panel.withAlpha (0.55f));
    graphics.fillRoundedRectangle (clipBadge, 2.0f);
    graphics.setColour (snapshot.clipping ? theme::bad.withAlpha (0.8f) : theme::hairline);
    graphics.drawRoundedRectangle (clipBadge, 2.0f, 1.0f);
    theme::drawTrackedText (graphics, snapshot.clipping ? "CLIP LATCH" : "NO CLIP",
                            clipBadge.reduced (6.0f, 0.0f), 1.4f,
                            juce::Justification::centred,
                            theme::mono (7.0f),
                            snapshot.clipping ? theme::bad : theme::muted);

    const float footerY = static_cast<float> (getHeight()) - 56.0f;
    juce::ColourGradient footerLine (theme::gold.withAlpha (0.0f), 24.0f, footerY,
                                     theme::gold.withAlpha (0.45f), getWidth() * 0.5f, footerY,
                                     false);
    footerLine.addColour (1.0, theme::gold.withAlpha (0.0f));
    graphics.setGradientFill (footerLine);
    graphics.fillRect (24.0f, footerY, getWidth() - 48.0f, 1.0f);

    theme::drawTrackedText (graphics, "APPLE SILICON NATIVE // AU + VST3",
                            { 24.0f, footerY + 18.0f, 420.0f, 12.0f },
                            1.9f, juce::Justification::left,
                            theme::mono (7.0f), theme::muted);

    theme::drawTrackedText (graphics, "KYROIII PRECISION DIAGNOSTICS // V0.1.0",
                            { getWidth() * 0.5f - 180.0f, footerY + 18.0f, 360.0f, 12.0f },
                            1.6f, juce::Justification::centred,
                            theme::mono (7.0f), theme::gold.withAlpha (0.75f));
}

void MeterFace::resized()
{
    const int margin = 24;
    const int headerHeight = 110;
    const int footerHeight = 56;
    const int gap = 14;

    flower.setBounds (margin, 18, 76, 76);

    auto content = getLocalBounds()
                       .withTrimmedTop (headerHeight)
                       .withTrimmedBottom (footerHeight)
                       .reduced (margin, 10);

    const int columnWidth = (content.getWidth() - gap) / 2;
    const int rowHeight = (content.getHeight() - gap) / 2;

    lowEndWindow.setBounds (content.getX(), content.getY(), columnWidth, rowHeight);
    correlationWindow.setBounds (content.getX() + columnWidth + gap, content.getY(),
                                 columnWidth, rowHeight);
    lufsWindow.setBounds (content.getX(), content.getY() + rowHeight + gap,
                          columnWidth, rowHeight);
    dynamicsWindow.setBounds (content.getX() + columnWidth + gap,
                              content.getY() + rowHeight + gap,
                              columnWidth, rowHeight);

    resetButton.setBounds (getWidth() - margin - 144, getHeight() - footerHeight + 14,
                           144, 28);
}
} // namespace kyro
