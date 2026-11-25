# Architecture

A static, no-backend web app (Vite, plain ES modules, no framework). Everything
runs in the browser; songs are MusicXML/MEI files rendered and timed by
Verovio (WebAssembly).

```
index.html                 app shell markup (sidebar + player)
src/main.js                boot: create shell, player, router
src/app/                   shell: router, library sidebar, catalog, imports
src/player.js              createPlayer(root) – listen / practice / MIDI / settings
src/song.js                loadSong(source) – parse a score into a Song
src/highway.js             falling-notes renderer
src/piano.js               sampled grand piano
src/score-core.mjs         buildScore / passage / FollowNotes (pure logic)
src/verovio.js             shared Verovio WASM module
src/styles/                app.css (player), shell.css (layout + sidebar)
public/songs/              bundled songs + catalog.json (open licences only)
public/songs/local/        your private songs (gitignored) + catalog.json
songs/*.notes              hand transcriptions (compiled by tools/notes2musicxml.mjs)
tools/                     ly2musicxml.mjs (Mutopia LilyPond → MusicXML), notes2musicxml.mjs
tests/                     unit tests (Vitest)
```

## Contracts

### Catalog entry (`public/songs/catalog.json`, `public/songs/local/catalog.json`)

```json
{
  "id": "fur-elise",
  "title": "Für Elise",
  "composer": "Ludwig van Beethoven",
  "difficulty": "intermediate",          // beginner | easy | intermediate | advanced
  "file": "songs/fur-elise.musicxml",    // relative to the site root (public/)
  "license": "Public Domain",            // licence of the *file*, not just the work
  "source": "Mutopia Project – typeset by Stelios Samelis",
  "sourceUrl": "https://www.mutopiaproject.org/...",
  "tempo": 72,                           // optional default BPM (quarter note)
  "section": [1, 8]                      // optional default measure-index range
}
```
`catalog.json` is `{"songs": [entry, ...]}`. The local catalog has the same
shape and is optional (404 is fine).

### Imported songs (IndexedDB, owned by `src/app/`)
`{id: "import:<uuid>", title, composer?, added: <ms>, data: "<MusicXML or MEI text>"}`
or `mxlBase64` instead of `data` for compressed MusicXML.

### Song loading (`src/song.js`)
`loadSong({url} | {data} | {mxlBase64}) → Promise<Song>` where
`Song = {measures, events, segments, fullSvg()}`; times are in quarter notes.

### Player (`src/player.js`)
`createPlayer(root) → {load(entry, songPromise), stop(), current}`.
`load` shows a loading state, swaps the song, restores that song's saved
section/tempo (localStorage key per song id), and keeps global settings
(view, labels, loop, mute, playhead, pedal) shared across songs.
The player only touches elements inside `#player` and keeps the existing
element IDs (`#um-*`, `#sec-*`, `#settings`, …).

### Routing (`src/app/router.js`)
Hash routes: `#/` (library, no song open) and `#/play/<id>`.

## Rules
- Bundled songs must be public domain or openly licensed, with `license`,
  `source` and `sourceUrl` filled in. Copyrighted pieces go in
  `public/songs/local/` only.
- No new runtime dependencies without discussion; the app ships as static files.

## Learning features (v2)

Four modules, each owning its own files, connected only through these contracts.

### Events (window CustomEvents)
- `piano:note` — every key the user plays, from any source.
  `detail: {note: <midi>, velocity, source: 'midi' | 'relay' | 'screen', time: performance.now()}`.
  Fired by src/player.js for local Web MIDI, the Mac relay, and on-screen keys,
  whether or not the player is visible.
- `practice:result` — a practice pass finished (section completed in practice mode).
  `detail: {songId, title, section: [first, last], mode: 'wait' | 'timed', hands: 'both' | 'right' | 'left',
  tempo, right, wrong, accuracy (0–100), timing: {early, late, onTime} | null, durationMs, at: Date.now()}`.
- `practice:session` — the player stopped listening/practising (stop, pause, song switch, page hidden).
  `detail: {songId, title, kind: 'listen' | 'practice', durationMs, at}`. Durations under 3 s are not sent.
- `trainer:result` — a note-reading drill finished.
  `detail: {level, right, wrong, accuracy, avgMs, durationMs, at}`.

### Views and routes (src/app/router.js)
- `#/play/<id>` — the player (existing). Exercise ids start with `ex:` (see below).
- `#/technique` — exercise builder: `mountTechnique(container, {open: id => void})` from `src/exercises/view.js`.
- `#/progress` — progress dashboard: `mountProgress(container)` from `src/progress/view.js`.
- `#/train/reading` — note-reading trainer: `mountReadingTrainer(container)` from `src/trainer/view.js`.
Each `mount*` returns `{destroy()}`. The router shows one view at a time in the main area
(hiding `#player` and calling `player.stop()` when leaving it), and each view imports its own CSS.

### Exercises (src/exercises/)
Exercise ids encode their parameters, e.g. `ex:scale:C:major:both:2:up-down`,
`ex:arpeggio:Fs:minor:right:2`, `ex:five-finger:G:major:both`, `ex:progression:Bb:major:I-IV-V-I`.
`src/app/catalog.js` resolves `ex:` ids through `resolveExercise(id)` from `src/exercises/index.js`,
which returns `{entry, source: {data: '<MusicXML>'}}` with a generated, fingered score.
Keys in ids are written with `s` for sharp and `b` for flat (`Fs`, `Bb`) so ids are URL-safe.

### Progress storage (src/progress/)
`progress-store/plugin.js` (dev server, like song-store) persists to `.data/progress.json`
(gitignored); falls back to localStorage in a production build.

### Teacher hooks (v2.1)
- `window.pianoPlayer` (set by src/player.js once created) — a small control API the AI teacher's tools call:
  `getState() → {songId, title, composer, section: [first, last], sectionLabel, measureCount, tempo, targetTempo,
  mode: 'wait'|'timed', hands: 'both'|'right'|'left', view: 'falling'|'sheet', playing, practicing, loop}`,
  `setSection(first, last)` (0-based measure indices), `setTempo(bpm)`, `setHands(h)`, `setMode(m)`, `setLoop(bool)`,
  `listen()`, `practice()`, `stop()`. Each setter returns the new `getState()`.
- `practice:result` additionally carries `misses: [{measure: '<label>', expected: ['F♯4', ...], played: ['G4', ...]}]`
  (up to 50) so feedback can be specific.
- src/main.js lazily mounts the teacher: `import('./teacher/index.js').then(m => m.mountTeacher(document.body)).catch(() => {})`.
- Navigation from the teacher uses `location.hash` (routes above); progress comes from `getProgress()` in src/progress/store.js.
