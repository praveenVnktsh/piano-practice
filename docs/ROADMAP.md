# Roadmap to "feature complete"

Goal: a private piano-learning app you can use every day to learn piano properly,
on the Mac and on the iPad on the music stand. Each phase ends with tests, lint
and build passing, a muted headless-Chrome check at desktop / iPad / phone sizes,
and a local checkpoint commit. Status is updated in place.

## Phase 1: Land the v2 workstreams  ⏳
- [ ] Practice engine: hands separately (by staff), play-along timing mode, metronome + count-in, speed trainer, sheet zoom, events, `window.pianoPlayer`
- [ ] Progress: store + dashboard + routing for all views
- [ ] Technique: scales/arpeggios/five-finger/chromatic/progressions in all keys with fingering
- [ ] Note-reading trainer
- [ ] Teacher inbox (in-app chat answered by a Claude Code teacher subagent in the developer's session)
- [ ] Integration pass: everything works together, no console errors, all routes

## Phase 2: Redesign + simplify ("The Practice Room", docs/DESIGN.md)  ⏳
- [ ] Tokens everywhere; light "Paper" and dark "Concert hall"
- [ ] One-line top bar, ⋯ menu, section strip, segmented Listen | Practise
- [ ] Score stage, falling-notes roll, keyboard, sidebar-as-programme
- [ ] Progress / technique / trainer / teacher in the same language
- [ ] Before/after screenshots

## Phase 3: Teacher online  ⏳
- [ ] Teacher brief (persona, CLI, data sources, student.md), watcher on .teacher/
- [ ] First-meeting flow (goals, level), feedback on attempts, daily plans

## Phase 4: A learning path  ⏳
- [ ] "Today" home: continue last piece, warm-up (technique key of the day), reading drill, goal ring
- [ ] Curriculum: graded levels (Beginner → Grade 1–5 equivalent) mixing repertoire, technique and reading, with unlock/completion
- [ ] Piece mastery states per section (learning → secure → polished) driven by results

## Phase 5: Repertoire  ⏳
- [ ] 15–25 verified public-domain pieces across levels from Mutopia (e.g. Anna Magdalena Notebook, Burgmüller Op. 100, Czerny, Clementi sonatinas, Schumann Album for the Young, Chopin Prelude in E minor, Satie if available), each checked bar by bar
- [ ] Browse Mutopia (experimental tier): catalogue of piano pieces, on-demand conversion

## Phase 6: iPad and daily-use polish  ⏳
- [ ] Add to Home Screen (manifest, icons), screen stays awake while practising (Wake Lock), landscape/portrait layouts, touch targets ≥ 44 px
- [ ] Offline cache for engine, samples and songs (service worker)
- [ ] Record a performance (MIDI) and play it back against the score

## Phase 7: Extra training (if time)  ⏳
- [ ] Rhythm trainer (tap rhythms), interval/chord ear training
- [ ] Accessibility pass, performance pass, user guide in README
