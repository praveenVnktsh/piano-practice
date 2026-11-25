# Roadmap to "feature complete"

Goal: a private piano studio you use every day to learn piano properly, from first
notes to performing real repertoire. It runs on the Mac and on the iPad on the music
stand, with a teacher that knows your playing.

**How work proceeds.** Phases run roughly in order, and items inside a phase can run
in parallel. P0 = core to the experience, P1 = makes it excellent, P2 = nice to have.
Every phase ends with tests, lint and build passing, a muted headless-Chrome check at
desktop / iPad (1180×820, 820×1180) / phone sizes, and a PR merged to main.
Status is updated in place: ⏳ planned · 🔨 in progress · ✅ done.

---

## Phase 1: Land the v2 workstreams ✅
- [x] P0 Practice engine: hands separately (by staff), play-along timing mode, metronome + count-in, speed trainer, sheet zoom, events, `window.pianoPlayer`, misses in results
- [x] P0 Progress store + dashboard + routing for every view
- [x] P0 Technique generator: scales / arpeggios / five-finger / chromatic / progressions in all keys with fingering
- [x] P0 Note-reading trainer (10 levels, engraved SVG, weighted toward missed notes)
- [x] P0 Teacher inbox: in-app chat answered by a Claude Code teacher subagent
- [x] P0 Integration pass: everything works together, every route, no console errors

## Phase 2: "The Practice Room" redesign + simplification ✅ (docs/DESIGN.md)
- [x] P0 Information architecture: exactly four places (Today · Pieces · Exercises · Progress); player opens from them with ← back; teacher as a companion button; advanced options behind ⋯
- [x] P0 Tokens everywhere; light "Paper" and dark "Concert hall"; theme switch in ⋯
- [x] P0 One-line top bar, ⋯ menu, section strip, segmented Listen | Practise, ♩ = tempo
- [x] P0 Score stage, falling-notes roll in ink/brass, realistic ivory/ebony keyboard
- [x] P0 Sidebar as a concert programme (composer headings, serif titles)
- [x] P1 Progress / technique / trainer / teacher in the same language
- [ ] P1 Motion and micro-interactions (page turns, playhead, results) restrained and smooth
- [x] P1 Before/after screenshots and a design QA pass on every screen

## Phase 3: Teacher online 🔨
- [ ] P0 Teacher brief (persona, CLI, data sources, student.md) + watcher on .teacher/
- [ ] P0 First meeting: goals, level, available time, repertoire wishes → student.md
- [ ] P0 Feedback on attempts using misses and timing data; concrete next steps as action buttons
- [ ] P1 Weekly review letter (what improved, what to focus on), written to the Progress page
- [ ] P1 Assignments ("homework") that appear on the Today screen with due dates
- [ ] P1 Plateau detection: the teacher notices a section stuck below target for days and suggests a different practice strategy
- [ ] P2 Teacher reviews a recorded performance (Phase 9) bar by bar

## Phase 4: Today + learning path ⏳
- [ ] P0 "Today" home screen: warm-up (technique key of the day), current pieces, reading drill, assignments, daily-goal ring, streak
- [ ] P0 Repertoire status per piece: learning → secure → polished → maintained
- [ ] P0 Section mastery per bar range from results (accuracy and tempo vs target), shown as a quiet strip above the score
- [ ] P1 Graded curriculum (Beginner, then Grade 1–5 equivalents): each level mixes repertoire, technique, reading, theory and ear; completion criteria; next-step suggestions
- [ ] P1 Spaced-repetition review: polished pieces come back for maintenance at growing intervals
- [ ] P1 Practice journal: a short note per session (what went well, what to fix), visible to the teacher
- [ ] P2 Goals with dates ("Für Elise at 72 BPM by 1 March") and progress toward them

## Phase 5: Smarter practising ⏳
- [ ] P0 Trouble spots: per-bar accuracy heat strip on the score; "Practise my weak bars" loops the worst bars automatically
- [ ] P0 A–B looping with gradual expansion (add one bar each clean pass, the "chaining" method)
- [ ] P1 Practice strategies as modes: slow practice ladder, rhythm variations (dotted / reversed dotted), blocked chords from broken figures, start from the end (backward chaining), eyes-closed (hide score) memory check
- [ ] P1 Phrase detection: split pieces into phrases (rests, cadences, slurs) for chunked practice
- [ ] P1 Tempo ladder per piece: record the highest clean tempo per section and suggest the next step
- [ ] P2 "Performance run": the whole piece once, no stops, scored

## Phase 6: Touch, dynamics and evenness feedback ⏳
- [ ] P1 Evenness analysis for scales/arpeggios: timing and velocity deviation per note, drawn as a fine-line graph with an evenness score
- [ ] P1 Dynamics: compare played velocity with the score's dynamics (p / f / hairpins) and show when you're too loud or soft
- [ ] P1 Articulation: legato vs staccato from note-off timing; overlap check for legato
- [ ] P1 Pedal: read CC64 from MIDI and compare with the score's pedal marks
- [ ] P2 Hand balance: melody vs accompaniment loudness

## Phase 7: Repertoire ⏳
- [ ] P0 15–25 verified public-domain pieces across levels from Mutopia (Anna Magdalena Notebook, Burgmüller Op. 100, Czerny, Clementi sonatinas Op. 36, Schumann Album for the Young, Chopin Preludes, Tchaikovsky Album for the Young, Satie if available, Bach Inventions), each checked bar by bar and graded
- [ ] P1 Browse Mutopia (experimental tier): piano catalogue with search and filters, on-demand conversion with clear "unverified" labelling
- [ ] P1 Collections and setlists ("Grade 2 recital", "Bach"), favourites, period/composer/difficulty filters
- [ ] P1 Converter coverage: key/time changes mid-piece, grace notes, ornaments, tremolos
- [ ] P2 MuseScore import guide + better handling of user MusicXML (repeats, voltas, multiple parts)

## Phase 8: Reading, theory and ear ⏳
- [ ] P0 Sight-reading generator: fresh short pieces at your level (melody + simple LH), played in play-along mode
- [ ] P1 Rhythm trainer: read and tap rhythms (any key), from crotchets to syncopation and triplets
- [ ] P1 Theory lessons with interactive checks: note values, time signatures, key signatures, intervals, triads, inversions, cadences, circle of fifths explorer
- [ ] P1 Ear training: intervals, chord qualities, cadences, melodic dictation (play back what you hear)
- [ ] P2 Score study mode: harmonic analysis overlay (Roman numerals) for bundled pieces

## Phase 9: Record, review, perform ⏳
- [ ] P1 Record a performance from MIDI; play it back on the sampled piano with the score following
- [ ] P1 Compare a recording with the score: timing deviations per beat, wrong/missed notes, a printable report
- [ ] P1 Export recordings as MIDI; keep a history per piece
- [ ] P2 "Mock exam": a set list performed in order, with a results sheet

## Phase 10: iPad, devices, sound ⏳
- [ ] P0 Home-screen app (manifest, icons), screen stays awake while practising (Wake Lock), safe-area aware
- [ ] P0 Landscape and portrait layouts tuned for the music stand; touch targets ≥ 44 px
- [ ] P1 Page-turn mode (paged score with automatic turns) as an alternative to scrolling; Bluetooth page-turner pedal support (arrow keys / space)
- [ ] P1 MIDI relay robustness: auto-reconnect, relay status on the iPad, latency calibration
- [ ] P1 Audio latency calibration for play-along grading
- [ ] P1 Better piano: velocity layers, sympathetic pedal resonance; harpsichord voice for Baroque pieces; metronome sounds
- [ ] P2 Microphone input (monophonic pitch detection) for practising away from the MIDI piano
- [ ] P2 Offline cache (service worker) for engine, samples and songs

## Phase 11: Quality and docs ⏳
- [ ] P0 End-to-end test scripts (headless Chrome over CDP) checked into the repo and run in CI
- [ ] P1 Accessibility pass (keyboard navigation, focus, contrast, reduced motion)
- [ ] P1 Performance pass (long scores, many events, iPad memory)
- [ ] P1 Data backup/export (progress, journal, imports) and restore
- [ ] P1 User guide (README + in-app "?" overlay with shortcuts) and an onboarding tour on first launch
