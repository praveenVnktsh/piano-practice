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
(see the comment at the top of the file). Repeats are written out, since the
app plays scores straight through. It skips grace notes, ornaments, dynamics,
fingerings, pedal marks and anything else that only affects appearance, and
prints a warning for what it could not read. Things it does **not** handle:
`\transpose`, Scheme music functions that produce notes, lyrics, chord names,
tremolos (a tremolo plays once), and mid-piece key/time signature changes
(only the first key and time are used).
Always check the result (step 4).

### b) Hand transcription (`.notes`)

For short or simple pieces, write a `songs/<id>.notes` file and compile every
one with:

```sh
npm run songs        # = node tools/notes2musicxml.mjs --all
```

This writes `public/songs/<id>.musicxml`. The format:

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
notation program), then *File → Export → MusicXML* (`.musicxml`,
uncompressed). Before exporting, write out repeats and D.C./D.S. jumps
(MuseScore: *Tools → Unroll repeats*), because the app refuses scores with
repeats. Only use a score you are allowed to share (see section 1). Many scores
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
  "file": "songs/minuet-in-g.musicxml",
  "license": "CC0-1.0",
  "source": "Piano Practice contributors – hand transcription",
  "sourceUrl": "https://github.com/…/songs/minuet-in-g.notes",
  "tempo": 108,
  "section": [0, 7]
}
```

`difficulty` is one of `beginner`, `easy`, `intermediate`, `advanced`.
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
