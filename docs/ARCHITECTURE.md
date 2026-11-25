# Architecture

A static, no-backend web app (Vite, plain ES modules, no framework). Everything
runs in the browser; songs are MusicXML/MEI files rendered and timed by
Verovio (WebAssembly).

```
index.html                 app shell markup (player + import dialog; the shell adds the nav)
src/main.js                boot: create shell, player, router
src/app/                   shell: router, navigation (sidebar.js), Pieces, catalog, imports, theme
src/today/                 Today, the home
src/player.js              createPlayer(root) – listen / practice / MIDI / settings
src/song.js                loadSong(source) – parse a score into a Song
src/highway.js             falling-notes renderer
src/piano.js               sampled grand piano
src/score-core.mjs         buildScore / passage / FollowNotes (pure logic)
src/verovio.js             shared Verovio WASM module
src/styles/                tokens.css, app.css (player), shell.css (navigation, views, dialog)
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
or `mxlBase64` instead of `data` for compressed MusicXML. A MIDI import (see "MIDI import" below)
adds `midi: true`, `quality` (0–1) and, when the timing was too loose for a clean score,
`view: 'falling'` (an entry hint: the player opens it in falling notes, for that piece only).

### Song loading (`src/song.js`)
`loadSong({url} | {data} | {mxlBase64}) → Promise<Song>` where
`Song = {measures, events, segments, marks, noteNames, fullSvg()}`; times are in quarter notes.
Each event/segment carries `staff` (1 = top) and `hand` (`'r'` | `'l'`, from the staff, not
the pitch); each measure carries `label`, `pickup`, `visit` (repeat pass) and
`meter: {count, unit}`. Practice passages from `passage()` mark notes held over from
before the section start as `carried` (they are not expected again).

### Player (`src/player.js`)
`createPlayer(root) → {load(entry, songPromise), stop(), current}`.
`load` shows a loading state, swaps the song, restores that song's saved
section/tempo (localStorage key per song id), and keeps global settings
(view, labels, loop, mute, playhead, pedal) shared across songs.
The player only touches elements inside `#player` and keeps the existing
element IDs (`#um-*`, `#sec-*`, `#settings`, …).

### Routing (`src/app/router.js`)
Four places (docs/DESIGN.md): `#/` or `#/today` (Today), `#/pieces`, `#/exercises`, `#/progress`;
sub-pages of Exercises: `#/technique`, `#/train/reading`; and `#/play/<id>` (the player, full width).
Unknown paths fall back to Today. The navigation is one `<nav class="nav">` (rail ≥ 900 px, tab bar below).
While the player is open, the shell turns the first button of the player's top bar
(`#player-back`, else `#open-library`) into "← <place>" leading back to where the piece was opened.
`<html data-route="place|play" data-view="<view>">` and `data-theme` (Auto / Paper / Concert hall,
localStorage `piano-practice.theme`, src/app/theme.js) are set by the shell.

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
- `#/`, `#/today` — Today: `mountToday(container, {library, open})` from `src/today/view.js`.
- `#/pieces` — the repertoire: `mountPieces(container, {library, head})` from `src/app/pieces.js`.
- `#/exercises` — exercises hub: `mountExercises(container, {open})` from `src/exercises/view.js`.
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
  mode: 'wait'|'timed', hands: 'both'|'right'|'left', view: 'falling'|'sheet'|'pages', playing, practicing, loop,
  strategy: 'off'|'ladder'|'dotted'|'reversed'|'blocked'|'memory', chain: {dir, section, goal} | null, latencyMs}`,
  `setSection(first, last)` (0-based measure indices), `setTempo(bpm)`, `setHands(h)`, `setMode(m)`, `setLoop(bool)`,
  `setStrategy(s)`, `listen()`, `practice()`, `stop()`. Each setter returns the new `getState()`.
- `practice:result` additionally carries `misses: [{measure: '<label>', expected: ['F♯4', ...], played: ['G4', ...]}]`
  (up to 50) so feedback can be specific.
- `practice:result` optional fields (phases 5–6; present only when they apply). Touch fields need a real keyboard
  (MIDI or relay velocities and note-offs), never on-screen taps:
  - `evenness` (exercises except progressions): `{score (0–100), timingSdMs, velocitySd, velocityMean, notes,
    msPerQuarter, hands: {r?: {velocityMean, velocitySd, notes}, l?: {…}}}`. Timing deviation is measured against
    a line fitted through the player's own onsets, so a steady delay or tempo costs nothing.
  - `dynamics` (pieces): `{velocityMean, marks: [{mark: 'p', bars: 'bars 5–8', played, expected}],
    hairpins: [{form: 'cres'|'dim', bars, change}], balance: {lhMinusRh, heavy: 'bars 5–6'|null} | null, remarks: [..]}`.
  - `articulation`: `{legatoPairs, detachedPairs, overlapMs (mean; + = keys overlap), staccato: {count, held},
    pedal?: {presses, marks, caught}, remarks: [..]}`. Legato is judged under slurs (pieces) or everywhere (exercises).
  - `strategy` ('ladder' | 'dotted' | 'reversed' | 'blocked' | 'memory') when a practice strategy was on;
    `chain: {dir: 'forward'|'backward', section: [first, last]}` (the whole passage being chained) while chaining.
  `remarks` are the short sentences the results card shows (at most two in total).
- Per-song localStorage (`piano-practice:song:<id>`) also keeps `best: {"<first>-<last>[:right|:left]": bpm}`,
  the highest play-along tempo with ≥ 95 % accuracy per section; global settings keep `latencyMs` (Settings → Calibrate).
- src/main.js lazily mounts the teacher: `import('./teacher/index.js').then(m => m.mountTeacher(document.body)).catch(() => {})`.
- Navigation from the teacher uses `location.hash` (routes above); progress comes from `getProgress()` in src/progress/store.js.

## Devices: home-screen app, relay, offline, backup (Phase 10/11)
- `src/pwa/index.js` is loaded from `index.html` `<head>` (independent of src/main.js). It sets
  `window.pianoPWA = {wakeLock, holdAwake(reason) → release()}`, keeps `<meta name="theme-color">`
  in step with the theme, and registers the service worker (production; `?sw=1` in dev).
- Wake Lock (`src/pwa/wakelock.js`) watches `#player.playing / .practicing`, the route
  (`#/play/…`, `#/train/reading`), `piano:note` / `practice:*` / `trainer:result` and input; a muted
  inline video stands in where the API is missing (iPad over plain http).
- MIDI relay status (`src/midi-relay.js`): `onRelayStatus(fn)` gets
  `{bridge, devices, state: 'connected'|'no-piano'|'waiting'|'stale'|'reconnecting', label, latencyMs, at}`
  on real changes; window `relay:status` events also carry label-only updates (latency).
- Backup (`backup/plugin.js`, `/__backup`, dev only) + `mountBackupControls(container)` from
  `src/pwa/backup.js` (export / validated import with confirmation).
- E2E: `npm run e2e` (tests/e2e/run.mjs + cdp.mjs, no dependencies) against `vite preview`.

## v3 additions (learning path, repertoire, devices)

- **Catalog entries** may carry `grade` (0–5, ABRSM-like) and `typesetter`. Bundled pieces are
  rebuilt from `songs/repertoire.json` by `tools/build-repertoire.mjs` (pinned Mutopia commit,
  documented per-bar `fixes`).
- **`mutopia:` ids** are unverified pieces from `public/songs/mutopia-index.json`, fetched from
  raw.githubusercontent.com and converted in the browser by `tools/ly2musicxml-core.mjs`
  (no Node imports); `catalog.resolveEntry` resolves them (async) via `src/mutopia/convert.js`.
  Route: `#/pieces/mutopia` → `mountMutopia(container, {open})`.
- **Mastery** (`src/progress/mastery.js`, pure): `barStats(songId, {measures})`,
  `sectionMastery`, `troubleSpots`, `plateaus`, `repertoire`, `dueReviews`, `goalProgress`.
  Thresholds are documented at the top of the file. `practice:result` events stored by the
  progress store carry `measureCount`.
- **Progress endpoints** (dev server): `POST /__progress/journal`, `PUT /__progress/goals`,
  `PUT /__progress/settings` (adds `pathStart`). The browser store keeps a localStorage backlog.
- **Curriculum** (`src/curriculum/`): levels Beginner–Grade 5 with repertoire, technique
  (`ex:` ids) and reading (trainer level ids); shown as "Your path" in Progress.
- **Teacher**: `teacher/cli.js` adds `assign`, `assignments`, `done`, `letter`, `letters`,
  `progress [--days N]`; endpoints `POST /__teacher/assignments/<id>/done` and
  `POST /__teacher/letters/<id>/read`; the thread includes `assignments` and `letters`.
- **Practice logic** (`src/practice-core.mjs`, pure): chaining, phrases, strategies, rhythm
  variations, evenness, latency. `getState()` adds `strategy`, `chain`, `latencyMs`; `view` may be
  `'pages'`; `window.pianoPlayer.setStrategy(s)`.
- **PWA** (`src/pwa/`): manifest + icons, wake lock (`window.pianoPWA.holdAwake(reason)` returns a
  release function), service worker in production builds only (`?sw=1` in dev), backup
  (`backup/plugin.js`, `mountBackupControls(container)` in Progress → Settings).
- **MIDI relay** status objects: `{bridge, devices, state: connected|no-piano|waiting|stale|reconnecting,
  label, latencyMs, at}` via `onRelayStatus` and the window `relay:status` event.
- **E2E**: `npm run e2e` builds to a temp dir, serves it with `vite preview`, and drives headless,
  muted Chrome over CDP (`tests/e2e/`). CI runs it.

## v4 additions (exercises, recordings, sound)

- **Exercise routes** (all under Exercises, back link "← Exercises"): `#/exercises/sight-reading`,
  `#/exercises/rhythm`, `#/exercises/theory` (+ `#/exercises/theory/<lesson>`), `#/exercises/ear`.
  A view's `mount` may return `{title}` to retitle the page; the view host passes the route arg.
- **`sr:<level>:<seed>` ids** are generated sight-reading pieces (`src/sightread/`), resolved by
  `catalog.resolveEntry`; entries carry `mode: 'timed'`, `intent: 'practice'` and `view: 'sheet'`
  hints that the player applies for that piece only (falling notes become the score; the student's
  own Notation / Pages choice is kept). The results card's primary action is "Another one ↻".
- **`trainer:result` levels** are prefixed for the new drills: `rhythm:<id>`, `theory:<id>`,
  `ear:<id>`; the progress model totals them under `totals.skills[skill]` (note reading stays in
  `totals.trainer`). Today's "Reading" step counts only note-reading drills.
- **Recordings** (`recordings/plugin.js`, dev server, `RECORDINGS_DIR` overrides
  `.data/recordings`): `GET /__recordings[?songId=]`, `GET|PUT|PATCH|DELETE /__recordings/takes/<id>`,
  `GET /__recordings/exams[/<id>]`, `PUT|DELETE /__recordings/exams/<id>`. Take shape:
  `{v, id, songId, title, composer, name, at, durationMs, tempo, section, hands, mode, source,
  notes: [[onMs, midi, vel, durMs]], pedal: [[ms, v]], report, exam?, examItem?, sentAt?}`.
  Production builds keep takes in localStorage (`piano-practice.recordings.*`). Backups include
  takes and exam sheets (restore only adds missing ones). Teacher CLI: `recordings`, `review <takeId>`.
- **Sound** (`src/piano.js` + `src/audio/`): Salamander Grand (5 velocity layers, release noises,
  sympathetic resonance, generated hall, equal-power stereo, limiter), VCSL harpsichord (Auto picks
  it for Baroque entries), synthesised metronome voices, optional microphone pitch input that emits
  `piano:note` with `source: 'mic'`. Settings live in localStorage `piano-practice:sound`;
  `window.pianoSound` exposes diagnostics. The service worker caches the large sample sets on first
  use (only the 2 MB single-layer piano is precached).

## v5 additions (collections, score study, performance, user MusicXML)

- **Catalog entries** carry `period` (`Baroque` | `Classical` | `Romantic` | `Modern`), from the composer
  (`periodOf()` in `src/collections/model.js`; `catalog.js` fills it in for entries without it).
- **Collections** (`src/collections/`): `model.js` (pure: document validation, favourites, ordered
  collections, periods, smart collections, Pieces filters), `store.js` (browser: dev server first,
  localStorage `piano-practice.collections` fallback, window event `collections:change`; setlists in play in
  sessionStorage `piano-practice.setlist`), `picker.js` ("Add to a collection" popover), `plugin.js`
  (dev server: `GET|PUT /__collections` → `.data/collections.json`; a PUT older than the file gets 409 + the
  newer doc). Document: `{version: 1, favourites: [pieceId], collections: [{id: 'c-…', name, items: [pieceId],
  createdAt, updatedAt}], updatedAt}`. Backups include it (validated on restore). Pieces remembers its filters
  in `piano-practice.pieces.filters` = `{grade, period, composer, status, fav}`.
- **Player**: ⋯ → Favourite / Add to a collection…; ⋯ → View → Harmony (setting `harmony`); Bars ▾ → Performance
  run; results card "Next in setlist →". Entry hints `mode` / `intent` / `view` apply to that piece only (never saved);
  `src/app/index.js` no longer applies them. `practice:result` may carry `performance: {score, accuracy, timing,
  evenness}`. Measures carry `key: {fifths, mode}` (score-core).
- **Analysis** (`src/analysis/`): `harmony.mjs` (approximate Roman-numeral analysis, method documented in the
  file), `performance.mjs` (performance-run scoring).
- **User MusicXML** (`src/musicxml.mjs`): `prepareMusicXml(text)` keeps the piano part / joins a two-part piano,
  drops percussion, marks pickups, finds a title; the import dialog prepares and test-loads every MusicXML
  import; `loadSong` prepares multi-part MusicXML. Guide: songs/README.md "Importing from MuseScore".

## v5 polish
- **Lazy engine**: `src/verovio.js` loads the Verovio WASM on first use and warms it when the app
  is idle, so the main bundle is ~270 kB; piano samples load with the first piece opened.
- **Pitch reading**: for MusicXML, `src/song.js` reads pitches from Verovio's MEI in one pass
  (spot-checked against Verovio, with a fallback).
- **Help & onboarding**: `src/help/` (Shift+/ anywhere, ⋯ → Help, rail "?", Progress → Settings)
  and `src/onboarding/` (five steps on first launch; `piano-practice.onboarded`).
- **Accessibility**: all token text pairs pass WCAG AA in both themes (`--brass-ink` for small
  brass text); modal dialogs trap focus and return it; reduced motion disables transitions,
  easing and timing-word animations.

## Phase 16: real hardware confidence

- **Diagnostics** (`src/diagnostics/`): `report.js` (pure: `buildReport(info)` → labelled sections,
  `formatReport(sections)` → the "Copy report" text), `collect.js` (reads the browser, the piano and the
  relay), `sheet.js` (`mountDiagnostics(root, {piano, midiAccess, latencyMs, openSettings, closeSettings})`
  adds Settings → This device → Diagnostics; the sheet stands in for Settings while open, and Escape goes back).
  Version and commit come from Vite `define` (`__APP_VERSION__`, `__APP_COMMIT__`; the `APP_COMMIT` env var overrides git).
- **Relay echo**: `midi-relay:echo` page → server → the same page `{id, t}`; `measureRelayRtt({timeoutMs})`
  in `src/midi-relay.js` → round-trip ms, or null (no dev server, or timeout).
- **Memory budget** (`src/audio/budget.js`, pure): `isSmallMemoryDevice`, `pianoProfile('auto'|'light'|'full')`,
  `allowedLayers`, `layerLoadOrder`, `decodedBytes`. `createPiano(onError, {profile})`, `piano.setProfile(v)`,
  `piano.memory()` → `{bytes, sets: {grand: {profile, layers, allowed, ready, samples, releases, bytes}, harpsichord, fallback}}`;
  `piano.loaded` adds `profile` and `allowed`. The sound setting `pianoProfile` lives in `piano-practice:sound`;
  `window.pianoSound.memory()`.
- **Error log** (`error-log/plugin.js`, dev server; `errorLog({dir})`, default `.data/`, `ERRORS_DIR` overrides):
  `POST /__errors` ← `{message, stack, url, ua, at, count?}` or an array (≤ 20; JSON or text/plain body ≤ 64 kB)
  → `{ok, added}`; `GET /__errors?limit=N` → `{errors}` (oldest first). JSON lines in `errors.log`, strings capped,
  oldest half dropped past 256 kB. Browser side `src/errors/reporter.js` (installed by `src/main.js`,
  `window.pianoErrors.stats`): the same error at most once a minute (with a repeat `count`), ≤ 10 a minute, ≤ 50 a session,
  and off for the session after the first failed post (production builds have no endpoint).
  `node tools/errors.mjs [-n N] [--follow] [--json] [--clear] [--dir PATH]`.

## v6 additions (learn a piece, guided — Phase 12)

- **`src/learn/`**: `plan.mjs` (pure: `buildPlan`, `resultMeets`, `listenMeets`, `currentStep`, `planProgress`,
  `isSetUp`, `listenSpan`), `first-look.mjs` (pure: `firstLook(song, {tempo})` → key, meter, tempo, hand ranges,
  `trickyBars`), `position.mjs` (pure: `startingKeys`), `guide.js` (`attachLearn(api)` from src/player.js:
  the "Next step" button `#learn-next` under the stage, Bars ▾ → `#learn-toggle`, the first-look card).
- **Plan steps** per phrase (`detectPhrases`; phrases that only replay a repeat are skipped): `listen` →
  `right` → `left` (only when both hands play) → `slow` (play along at 60 % of the target) → `tempo`
  (the slow-practice ladder to the target) → `join` (with the phrase before it); then `whole`.
  Step keys are `"<first>-<last>:<kind>"`. A step is done by a `practice:result` covering its bars with its
  hands, mode and tempo at ≥ 90 % accuracy, or (listen) by listening to the end of a covering section.
  "Next step" sets the step up through `window.pianoPlayer` (`setSection`, `setHands`, `setMode`,
  `setStrategy`, `setTempo`); once set up, the same button starts it.
- **Event `learn:step`** (window CustomEvent, recorded by the progress store):
  `detail: {songId, title, action: 'start' | 'done' | 'stop', key? (done step), total, next: {key, label} | null, at}`.
  The progress document aggregates it into `totals.learn[songId] = {title, active, done: [key], total, next,
  startedAt, lastAt}` (no practice time). Today shows the most recent active plan's `next` as the
  current piece ("Next step") and sets sessionStorage `piano-practice.learn.apply = <songId>` so the player
  sets that step up on opening.
- **Per-song localStorage** (`piano-practice:song:<id>`) adds `learnOn`, `learnDone: [key]` and
  `firstLookSeen` (the first-look card shows before the first play — no results yet — and never after it
  is dismissed or the piece is played). Exercises (`ex:`) and sight-reading (`sr:`) get neither.
- **Settings**: `piano-practice:settings.fingering` (default on) shows/hides Verovio's `g.fing`
  (MusicXML `<fingering>` / MEI `<fing>`) via `.no-fing` on `#player`.
- **Hand-position preview**: stopped at a section's start, the first five pitches of each practised hand
  are ghosted on the keyboard (`.pkey.ghost`).

## MIDI import (Phase 17)
- **`src/midi-file/parse.mjs`** (pure): `parseMidi(bytes)` reads Standard MIDI Files, format 0 and 1
  (running status, velocity-0 note-offs, tempo / time / key signature meta events, sustain CC64,
  SMPTE division) → `{format, division, tracks, notes: [{track, channel, n, vel, tick, end}], tempos,
  timeSigs, keySigs, pedal, title}`. Throws plain-words errors for files that aren't MIDI.
- **`src/midi-file/to-musicxml.mjs`** (pure): `midiToMusicXml(bytes | parsed, {title, fileName})` →
  `{xml, title, quality, fallingPreferred, warnings, stats}`. Quantises to 16ths (12 divisions per
  quarter; eighth-note triplets per beat in simple meters), splits hands by track (2+ tracks or
  channels with notes) else by pitch around C4 with hysteresis, up to two voices per staff, ties
  over barlines, key from the file or a Krumhansl–Kessler estimate, pedal as `<pedal>` directions
  placed by `<offset>`. `quality` = how well onsets fit the grid; below `FALLING_BELOW` (0.75)
  `fallingPreferred`. The output is ordinary two-staff MusicXML, played via `loadSong({data})`.
- **Import flow**: `recordFromFile` (`src/app/imports.js`) converts `.mid`/`.midi` (lazy-loaded
  module, 4 MB cap) into a record with `data` (MusicXML), `midi`, `quality` and `view: 'falling'`
  when preferred; the import dialog then checks and saves it like MusicXML. The song store
  (`/__songs`) keeps `midi`, `quality` and `view` on the entry (the file is `.musicxml`).
- **Player**: an entry `view: 'falling'` hint shows falling notes for that piece only (like the
  sight-reading `view: 'sheet'` hint); choosing a view while on it saves the student's choice.
- Pieces labels them "From a MIDI file — unverified". Guide: songs/README.md "Importing a MIDI file".
