# Design direction: "The Practice Room"

The app should feel as if a concert pianist designed it for their own studio:
calm, precise, typographic, built around the score. No neon, no game chrome.
The music is the hero; controls recede until needed.

## Principles
1. **Score first.** The notation (or the falling-notes "roll") fills the stage.
   Everything else is quiet, small, and grouped at the edges.
2. **One primary action at a time.** Listen / Practise is a single, beautiful
   segmented control. Secondary actions live in compact menus.
3. **Engraving quality.** Hairline rules, generous whitespace, real typographic
   hierarchy, small caps for labels, true musical glyphs (♩ ♯ ♭ 𝄞 𝄢) where they
   carry meaning (e.g. tempo shown as "♩ = 72").
4. **Materials, not effects.** Ivory paper, ebony, a single brass accent. Shadows
   are soft and physical (paper on a stand), never glows.
5. **Feedback is musical and restrained.** Correct = a soft sage wash, missed =
   a muted oxblood underline, "play now" = brass. No shaking, no exclamation
   marks; praise is understated ("Clean." "Well played.").

## Tokens (src/styles/tokens.css — the only place colours/fonts are defined)
| Token | Light ("Paper", default) | Dark ("Concert hall") |
|---|---|---|
| `--paper` (app background) | #f4efe4 | #121110 |
| `--paper-raised` (cards, score) | #fbf8f1 | #1b1a18 |
| `--ink` (text, notation) | #1d1b18 | #ece6d8 |
| `--ink-soft` (secondary text) | #6d665b | #a59d8e |
| `--rule` (hairlines) | rgba(29,27,24,.14) | rgba(236,230,216,.14) |
| `--ebony` (black keys, primary button) | #151412 | #0b0b0a |
| `--ivory` (white keys) | #fdfbf6 | #e9e3d6 |
| `--brass` (single accent: "play now", playhead, active) | #a8833f | #c9a25a |
| `--sage` (correct) | #5f8a69 | #7fae89 |
| `--oxblood` (missed/wrong) | #8e3b3f | #c0656a |
| `--right-hand` | #3d5a80 (ink blue) | #8fb0d8 |
| `--left-hand` | #8a5a2b (walnut) | #d3a172 |

Typography: **Cormorant Garamond** (display: song titles, headings, big numbers),
**EB Garamond** italic for composers and musical terms, **Inter** (UI labels,
controls; small caps via `font-variant: all-small-caps; letter-spacing: .06em`).
Sizes on a modular scale (1.25). Numerals tabular in controls.

Radii: 6px (controls), 10px (cards). Motion: 160–240 ms ease-out, no bounces.

## Simplified layout
- **Top bar (one line):** ☰ library · *Title* in Cormorant with composer in
  italic beneath · centre: segmented `Listen | Practise` + play/pause ·
  right: `♩ = 72` (tap to edit) and a single `⋯` menu (MIDI, metronome, mute,
  view, note names, zoom, fullscreen, settings).
- **Section strip** (under the title, quiet): `Bars 9 – 16` (editable inline),
  loop toggle, hands `L · Both · R`, mode `Wait · Play along`. Presets move into
  a small popover on "Bars".
- **Stage:** score on a paper card with a brass playhead, or the falling-notes
  roll drawn as engraved ink/brass bars on paper (light) or graphite (dark).
- **Keyboard:** realistic ivory/ebony with subtle bevel; highlights are soft
  colour washes, not glows.
- **Sidebar library:** reads like a programme/concert booklet: composer
  headings, work titles in Cormorant, difficulty as small-caps text, not pills.
- **Progress, technique, trainer, teacher:** the same paper-and-ink language;
  charts as fine-line engravings; the teacher panel reads like letters/notes in
  the margin.
