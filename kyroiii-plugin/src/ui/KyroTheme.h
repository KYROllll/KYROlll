#pragma once

#include "../core/MeterTypes.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace kyro::theme
{
// Matte black / brushed gold / warm brown. This palette is scoped to the
// plugin workspace and deliberately does not use the storefront's grey audit.
inline const juce::Colour background   { 0xff0a0a0a };
inline const juce::Colour panel        { 0xff11100e };
inline const juce::Colour panelRaised  { 0xff171410 };
inline const juce::Colour hairline     { 0xff2b2419 };
inline const juce::Colour hairlineSoft { 0xff1d1913 };
inline const juce::Colour gold         { 0xffd4af37 };
inline const juce::Colour goldBright   { 0xffe5c158 };
inline const juce::Colour brown        { 0xff6b4a2e };
inline const juce::Colour brownDeep    { 0xff3a2a1c };
inline const juce::Colour cream        { 0xfff2ede3 };
inline const juce::Colour muted        { 0xff8a8175 };
inline const juce::Colour dim          { 0xff5c554b };
inline const juce::Colour good         { 0xff6fe08a };
inline const juce::Colour warn         { 0xffe5c158 };
inline const juce::Colour bad          { 0xffff5c4d };
inline const juce::Colour idle         { 0xff3a352e };

inline juce::Font display (float height)
{
    return juce::Font (juce::FontOptions ("Helvetica Neue", height, juce::Font::bold));
}

inline juce::Font label (float height)
{
    return juce::Font (juce::FontOptions ("Helvetica Neue", height, juce::Font::plain));
}

inline juce::Font mono (float height)
{
    return juce::Font (juce::FontOptions ("Menlo", height, juce::Font::plain));
}

inline juce::Colour statusColour (Status status) noexcept
{
    switch (status)
    {
        case Status::good: return good;
        case Status::warn: return warn;
        case Status::bad:  return bad;
        case Status::idle:
        default:           return idle;
    }
}

/** Draws ALL-CAPS display text with explicit letter-spacing. */
inline void drawTrackedText (juce::Graphics& graphics,
                             const juce::String& text,
                             juce::Rectangle<float> area,
                             float tracking,
                             juce::Justification justification,
                             const juce::Font& font,
                             juce::Colour colour)
{
    graphics.setFont (font);
    graphics.setColour (colour);

    const int length = text.length();
    float totalWidth = 0.0f;

    for (int i = 0; i < length; ++i)
    {
        const auto glyph = juce::String::charToString (text[i]);
        totalWidth += juce::GlyphArrangement::getStringWidth (font, glyph);

        if (i + 1 < length)
            totalWidth += tracking;
    }

    float x = area.getX();

    if (justification.testFlags (juce::Justification::horizontallyCentred))
        x = area.getCentreX() - totalWidth * 0.5f;
    else if (justification.testFlags (juce::Justification::right))
        x = area.getRight() - totalWidth;

    for (int i = 0; i < length; ++i)
    {
        const auto glyph = juce::String::charToString (text[i]);
        const float glyphWidth = juce::GlyphArrangement::getStringWidth (font, glyph);

        graphics.drawText (glyph,
                           juce::Rectangle<float> (x, area.getY(),
                                                   glyphWidth + 2.0f, area.getHeight()),
                           juce::Justification::centredLeft,
                           false);

        x += glyphWidth + tracking;
    }
}

inline juce::String formatDb (float value)
{
    if (! std::isfinite (value) || value <= -60.0f)
        return "-";

    return juce::String (value, 1);
}

inline juce::String formatSigned (float value, int decimals = 2)
{
    if (! std::isfinite (value))
        return "-";

    return (value > 0.0f ? "+" : "") + juce::String (value, decimals);
}
} // namespace kyro::theme
