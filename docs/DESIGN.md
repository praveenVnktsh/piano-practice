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

## Information architecture: few places, never overwhelming
The student should always know where they are and what to do next. There are
only **four top-level places**, shown as a quiet tab strip (sidebar on wide
screens, bottom bar on phone/iPad portrait):

1. **Today**: the home. One clear "Start practising" path: warm-up → current
   piece → short reading drill, plus the daily goal and anything the teacher
   assigned. Most days the student never needs to leave it.
2. **Pieces**: the repertoire library (bundled, your songs, imports) with
   status (learning / secure / polished).
3. **Exercises**: everything that isn't a piece: technique (scales, arpeggios…),
   note reading, and later rhythm/ear/theory, as a few large cards.
4. **Progress**: history, streaks, mastery, the teacher's weekly letter.

Everything else is **not** a top-level mode:
- The **player** opens when you start a piece or exercise and has a clear
  "← back" to where you came from. Inside it, one primary choice
  (Listen | Practise); advanced options live in the ⋯ menu and Settings.
- The **teacher** is a companion available from anywhere (one quiet button),
  not a destination.
- Settings, import, MIDI and the bridge are reached from ⋯ or the relevant
  place, never as extra tabs.

Rules: no more than four tabs, ever; no screen shows more than one primary
button; advanced features are progressive disclosure (off by default, revealed
when useful or asked for); every screen answers "what should I do now?".

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
