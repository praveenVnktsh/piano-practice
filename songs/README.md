# Adding songs

Bundled songs live in `public/songs/` as MusicXML (or MEI) files, listed in
`public/songs/catalog.json`. This folder holds the hand-written sources
(`*.notes`) for some of them.

## 1. Licence first

Only add a song to the bundled catalog if **the file you add** may be shared:

- the composition is in the public domain (or openly licensed), **and**
- the engraving/transcription you start from is public domain or under an open
  licence (CC0, CC BY, CC BY-SA, …). A modern edition of an old piece can still
  be copyrighted; scans of commercial sheet music and files from sites without a
  clear licence are not OK.

Fill in `license`, `source` and `sourceUrl` for every catalog entry. If the
source is share-alike (e.g. CC BY-SA), the converted file carries the same
licence; say so in `license` and in the MusicXML `<rights>` element.

Copyrighted pieces you own a copy of go in **`public/songs/local/`** instead,
with their own `public/songs/local/catalog.json` (same format). That folder is
gitignored, so it never gets committed or published.

## 2. Get MusicXML

Pick whichever route fits:

### a) Mutopia Project (LilyPond)

[Mutopia](https://www.mutopiaproject.org/) has public-domain and CC-licensed
engravings of many classical pieces. Download the `.ly` file and run:

```sh
node tools/ly2musicxml.mjs piece.ly \
  --title "Für Elise" --composer "Ludwig van Beethoven" \
  --rights "Public Domain. Typeset by … for the Mutopia Project" \
  --source "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931" \
  [--tempo 72] > public/songs/fur-elise.musicxml
```

`ly2musicxml` understands the subset of LilyPond typical piano scores use
(see the comment at the top of `tools/ly2musicxml-core.mjs`): `\relative`,
`\fixed`, `\transpose`, note-name languages (`\language`, `\include
"english.ly"`), `\include` files, chord repetition `q`, variables, voices,
`\tag`/`\keepWithTag`, mid-piece `\key`, `\time` and `\partial`, cadenzas,
grace notes (written as MusicXML grace notes), trills, mordents, turns,
fermatas and arpeggios (as notations) and tremolos. Repeats are written out,
since the app plays scores straight through: `\repeat volta` with
`\alternative`, and repeats drawn with `\bar ".|:"` / `":|."` or
`\set Score.repeatCommands` (first and second endings included). Dynamics,
fingerings, slurs, pedal marks and other appearance-only markup are skipped.
Not supported: lyrics, chord names, Scheme music functions that generate
notes, and tuplets other than triplets are notated approximately (their timing
is exact). It prints a warning for what it could not read. Always check the
result (step 4).

The core (`tools/ly2musicxml-core.mjs`) has no Node imports, so the browser
uses it too (the experimental *Browse Mutopia* page, `src/mutopia/`).

#### The bundled Mutopia repertoire

`songs/repertoire.json` lists every bundled Mutopia piece: its `.ly` path in
the Mutopia GitHub repository (pinned to one commit), typesetter, licence,
grade, default tempo and section, and any `fixes` (plain engraving errors
corrected before conversion, each with its reason). Rebuild them with

```sh
node tools/build-repertoire.mjs [--cache DIR] [--only id,id]
```

which downloads the sources, converts them, writes `public/songs/<id>.musicxml`
and updates their entries in `catalog.json`. Credit new pieces in
`public/THIRD-PARTY-NOTICES.txt`.

#### The Mutopia catalogue (experimental)

`node tools/mutopia-index.mjs` rebuilds `public/songs/mutopia-index.json`, the
solo keyboard pieces of the Mutopia repository with an accepted licence
(Public Domain, CC0, CC BY, CC BY-SA). The *Browse Mutopia* page converts them
on demand and labels every one as an unverified conversion.

### b) Hand transcription (`.notes`)

For short or simple pieces, write a `songs/<id>.notes` file and compile every
one with:

```sh
npm run songs        # = node tools/notes2musicxml.mjs --all
```

This writes `public/songs/<id>.musicxml`. The beginner (Grade 0) arrangements are also listed
under `arrangements` in `songs/repertoire.json`; for those, `npm run songs` writes their catalog
entries too (`tests/beginner-songs.test.js` checks each one's measures, five-finger positions and
hands). The format:

```text
# comment
title: Minuet in G
composer: Christian Petzold (attr.)
time: 3/4            # default 4/4
key: 1               # fifths: 1 = one sharp, -1 = one flat (default 0)
tempo: 108           # optional, quarter notes per minute
pickup: yes          # first bar is a pickup (default no)
license: CC0-1.0
---
RH:  d5/4 g4/8 a4 b4 c5 | d5/4 g4 g4 |
LH:  [g3 b3 d4]/2 a3/4  | b3/2.      |
LH2:                    | r/4 d4/2   |
```

- Voices: `RH`, `RH2` (treble staff) and `LH`, `LH2` (bass staff). Repeated
  lines for a voice are joined together, so you can write a few bars per line.
- `|` ends a bar. Every voice needs the same number of bars. `RH2`/`LH2` are
  optional: leave a bar empty where that voice has nothing to play.
- Pitch = letter + optional `#`, `b`, `##`, `bb` or `n` + octave (`c4` is
  middle C). `r` = rest, `[c4 e4 g4]` = chord.
- Duration `/1 /2 /4 /8 /16 /32`, dots allowed (`/4.`). It carries over to the
  following notes until you change it.
- A trailing `~` ties the note to the next one (also across bar lines).
- A bar can start with `clef=bass` or `clef=treble` to change that staff's clef.
- `#` at the start of a line or after a space starts a comment.

Write pitches as they sound; the tool works out accidentals from the key
signature, beams eighths and shorter notes within each beat, and refuses to
compile a bar whose voices do not add up to the time signature.

Our own transcriptions of public-domain works are released as CC0.

### c) Notation software (MuseScore etc.)

Enter or open the piece in [MuseScore](https://musescore.org/) (or any
notation program) and export it as MusicXML, as described in
[Importing from MuseScore](#importing-from-musescore) below. Repeats, first and
second endings and pickup bars are fine: the app writes repeats out as it loads
a score. Only use a score you are allowed to share (see section 1). Many scores
on musescore.com are not.

## 3. Add a catalog entry

Add an object to `public/songs/catalog.json`, keeping the list ordered from
beginner to advanced:

```json
{
  "id": "minuet-in-g",
  "title": "Minuet in G, BWV Anh. 114",
  "composer": "Christian Petzold (attr.)",
  "difficulty": "easy",
  "grade": 1,
  "period": "Baroque",
  "file": "songs/minuet-in-g.musicxml",
  "license": "CC0-1.0",
  "source": "Piano Practice contributors – hand transcription",
  "sourceUrl": "https://github.com/…/songs/minuet-in-g.notes",
  "tempo": 108,
  "section": [0, 7]
}
```

`period` (`Baroque`, `Classical`, `Romantic` or `Modern`) is what the Pieces
filter row and the smart collections use; it follows the composer
(`periodOf()` in `src/collections/model.js`, which `tools/build-repertoire.mjs`
also uses), and entries without it get it from the composer as the catalog loads.
`difficulty` is one of `beginner`, `easy`, `intermediate`, `advanced`, and
`grade` (0–5) places the piece more precisely: 0 = beginner, 1–2 = easy,
3–4 = intermediate, 5 = advanced (roughly the exam grades of the same number).
`tempo` is the default quarter-note BPM. `section` is the default practice
range as **measure indices** (0-based, a pickup bar counts as index 0).
`file` is relative to `public/`.

## 4. Verify

1. `npm run dev`, open the song from the library, and play it through in
   Listen mode at a slow tempo. Watch for wrong octaves, missing bars, notes
   that do not stop (ties) and rhythms that drift.
2. Compare the sheet view against your source bar by bar, at least for the
   first page and anywhere the converter printed a warning.
3. Check that the default `section` starts and ends where you meant.
4. Run `npm test` so the converters still pass their tests.

For converted LilyPond, also check the source's own bar checks: convert with
`lilypondToEvents(src, {unfold: false})` and compare `score.checks.bars`
(every `|` in the source) and `score.checks.numbers` (`\barNumberCheck`) with
`measureGrid(score)` — every bar check must fall on a bar line. Count the
pitches in the source against the converted notes, so nothing was dropped.
Where an independent encoding of the piece exists, compare the pitches bar by
bar (read it only; don't add it to the project unless its licence allows).

For the bundled Mutopia repertoire there is always one: the MIDI file LilyPond
made from the same source, published next to it on mutopiaproject.org.

```sh
node tools/compare-mutopia-midi.mjs [--cache DIR] [--only id,id] [--bars 8-12]
```

compares every converted note with it (time and pitch). Grace notes and
appoggiaturas are timed differently by Verovio and LilyPond and count as
"shifted"; anything else that differs needs a look at the source. A MIDI file
can be older than a later fix of the `.ly` file (BWV Anh. 119, La Candeur:
check the file's history on GitHub), and it may play a *D.S.* that the app
doesn't (Streabbog's Waltz).

Then add the piece's measure count to `tests/repertoire.test.js`. That test
loads every bundled piece as the app does and checks that Verovio plays exactly
the notes the MusicXML file writes (Verovio reads a note's pitch from the
accidentals shown in the bar, in any octave or staff, rather than from
`<alter>`, which is why the converter writes cautionary accidentals where they
differ), that both hands play in a sensible range, that silent bars are written
rests, and that tempo, grade and section make sense.

## Importing from MuseScore

For your own scores (they stay private: Pieces → *Import a score*, kept on your
Mac or in the browser, never in the bundled catalog). The import dialog has a
short version of this under *How to export from MuseScore*.

1. **Open the score in MuseScore** (3 or 4). If you downloaded it from
   musescore.com, check its licence before sharing it with anyone.
2. **One piano part.** The app plays piano music: the top staff is the right
   hand and the staff below it the left. If the score has other instruments
   (a voice, a violin), either open the piano part on its own (*File → Parts…*)
   or delete the other instruments (*Instruments* panel). If you don't, the
   import keeps the piano part and says which parts it left out.
3. **Two staves, treble over bass.** A piano entered as two separate
   instruments ("Right hand", "Left hand", or a treble and a bass staff) is
   joined into one two-staff part on import, but it is cleaner to use one
   *Piano* instrument.
4. **Export.** *File → Export…*, format **Compressed MusicXML (`*.mxl`)** (plain
   `*.musicxml` works too). Leave "All layout" on if MuseScore asks; layout is
   ignored anyway, because the app engraves the score itself as one long line.
5. **Import.** Drop the file on the import dialog (or *Choose a file*). The
   score is checked before it is saved: if it can't be played you'll see why,
   and anything the import changed (parts left out or joined) is listed in the
   message afterwards.

What the import takes care of:

- **Repeat signs and first/second endings (voltas)** are written out, so bar
  numbers repeat ("Bar 3 (repeat)") and practice sections follow the playing
  order. Nothing to do in MuseScore. *D.C.*, *D.S.* and *Coda* jumps are not
  followed: if a piece depends on them, copy the repeated passage out in
  MuseScore before exporting.
- **Pickup bars** (an incomplete first bar) are labelled *Pickup* and counted
  in on the right beat.
- **Titles.** The work title, else the movement title, else the score's title
  text on the first page, else the file name. The composer comes from the
  score's composer field or its composer text.
- **Several parts:** the piano is kept (found by name, by its piano sound or by
  having two staves); percussion and empty parts are dropped; a piano in two
  one-staff parts is joined. With no piano at all, every part is kept and the
  top staff plays as the right hand.

What doesn't import well:

- Timewise MusicXML (rare; re-export as ordinary MusicXML).
- PDFs and images: use the *Recognize a PDF* option (needs the local Audiveris
  helper) and check every bar afterwards, or enter the notes in MuseScore.
- Scores made only of chord symbols or tablature, without notes.
- Ornaments are played as written in the file; a trill that is only a symbol
  sounds as its main note.

## Importing a MIDI file

Pieces → *Import a score* also takes `.mid` / `.midi` files (drop one on the
dialog or *Choose a file*). A MIDI file has notes and timing but no notation, so
the app writes a score for it (`src/midi-file/`), checks it like any other
import and saves it as MusicXML:

- **Grid.** Notes are snapped to 16th notes; a beat whose notes fit eighth-note
  triplets better is written as a triplet. Notes crossing a barline are tied,
  gaps become rests, notes starting and ending together become chords, and a
  held note under moving notes goes to a second voice.
- **Hands.** A file with two or more tracks (or channels) is split by track, the
  higher one being the right hand. A one-track file is split by pitch around
  middle C; notes near the split go to the hand that last played closest to
  them, so a melody dipping below C4 stays in the right hand.
- **Bars, key and tempo** come from the file's time signature, key signature and
  tempo events (4/4 and an estimated key when they are missing; a default
  "C major" that the notes clearly don't fit is replaced by the estimate).
  Sustain pedal becomes *Ped.* marks. Drums are left out.
- **Quality.** The import scores how well the notes fit the grid. A file
  written in a sequencer or exported from notation software fits (the sheet is
  engraved and opens as usual); a recorded performance doesn't, so the piece is
  marked *best in falling notes* and opens in falling notes. The sheet is still
  there, as a rough guide.

MIDI imports are labelled *From a MIDI file — unverified* in Pieces: spelling
(F♯ or G♭), voicing and the hand split are guesses. For real practice from the
sheet, prefer a MusicXML edition, or open the MIDI file in MuseScore, tidy it,
and export MusicXML.
