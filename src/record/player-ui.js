// Recording inside the player (docs/ROADMAP.md, Phase 9): a quiet ● Rec toggle next to
// play/pause, a strip on the stage while recording or playing a take back, take playback on
// the sampled piano with the score following, and the review overlay (./review.js, lazy).
//
//   const recording = attachRecording(api)   (src/player.js passes its internals, see there)
//   recording.noteOn(n, velocity, time, source) / noteOff(n, time) / pedal(value, time)
//   recording.toggle() · loaded(entry) · leaving()
//
// Hash parameters on #/play/<id>: ?review=<takeId> opens that take's report once the piece is
// loaded; ?exam=<examId> continues a mock exam (./exam-ui.js).
import './record.css';
import {Recorder, trimLead} from './recorder.mjs';
import {newId} from './take.mjs';
import {duration} from './text.mjs';
import {buildReport, expectedNotes, playedNotes, takeSection} from './report.mjs';
import {alignTake, warpFns} from './align.mjs';
import * as store from './store.js';
import {hashParams, hashSongId, dropHashParam} from './hash.js';

const NOOP = {noteOn() {}, noteOff() {}, pedal() {}, toggle() {}, loaded() {}, leaving() {}};

/** How long each note of a take sounds (ms), holding it on while the sustain pedal is down. */
export function soundingDurations(take) {
  const pedal = take.pedal || [];
  return take.notes.map(([at, , , d]) => {
    let end = at + Math.max(d, 30);
    const before = pedal.filter(p => p[0] <= end).at(-1);
    if (before && before[1] >= 64) {
      const up = pedal.find(p => p[0] > end && p[1] < 64);
      end = up ? up[0] : end + 2500;
    }
    return Math.min(end - at, 10000);
  });
}

export function attachRecording(api) {
  const q = s => api.root.querySelector(s);
  const btn = q('#rec-btn'), strip = q('#rec-strip');
  if (!btn || !strip) return NOOP;
  const recorder = new Recorder();
  let rec = null, recTimer = 0, playback = null, hideTimer = 0, review = null, exam = null;

  // ───── the strip on the stage ─────
  function showStrip(parts, {timeout = 0, kind = ''} = {}) {
    clearTimeout(hideTimer);
    strip.className = 'rec-strip' + (kind ? ' is-' + kind : '');
    strip.replaceChildren(...parts.map(p => {
      if (typeof p === 'string') { const s = document.createElement('span'); s.textContent = p; return s; }
      if (p.el) return p.el;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rec-strip-btn' + (p.primary ? ' is-primary' : '');
      b.textContent = p.label; b.onclick = p.onClick;
      if (p.id) b.id = p.id;
      return b;
    }));
    strip.hidden = false;
    if (timeout) hideTimer = setTimeout(hideStrip, timeout);
  }
  function hideStrip() { clearTimeout(hideTimer); strip.hidden = true; strip.replaceChildren(); }
  const dot = cls => { const i = document.createElement('i'); i.className = cls; i.setAttribute('aria-hidden', 'true'); return {el: i}; };

  // ───── recording ─────
  function start({mode, exam: examInfo} = {}) {
    const song = api.song(), entry = api.current(), range = api.range();
    if (!song || !entry || !range) { api.flash('Open a piece first', 'bad'); return false; }
    stopPlayback();
    const busy = api.busy(), st = api.state();
    rec = {
      songId: entry.id, title: entry.title || song.title || '', composer: entry.composer || '',
      mode: mode || busy || 'free', section: [range.first, range.last],
      hands: busy === 'practice' ? st.hands : 'both', tempo: api.tempo(), exam: examInfo || null,
    };
    recorder.start(performance.now());
    btn.setAttribute('aria-pressed', 'true');
    btn.setAttribute('aria-label', 'Stop recording');
    btn.title = 'Stop recording (R)';
    api.root.classList.add('recording');
    const render = () => {
      if (!rec) return;
      const n = recorder.count, el = recorder.notes[0] ? performance.now() - recorder.t0 - recorder.notes[0][0] : 0;
      const label = rec.exam ? `Performing · ${duration(el)}` : n ? `Recording · ${duration(el)} · ${n} note${n === 1 ? '' : 's'}` : 'Recording · play when ready';
      if (!strip.hidden && strip.dataset.mode === 'rec') { strip.querySelector('.rec-strip-text').textContent = label; return; }
      showStrip([dot('rec-strip-dot'), {el: Object.assign(document.createElement('span'), {className: 'rec-strip-text', textContent: label})},
        rec.exam ? {label: 'Finish', primary: true, onClick: () => exam?.finish()} : {label: 'Stop', onClick: () => stop()}], {kind: 'rec'});
      strip.dataset.mode = 'rec';
    };
    render();
    recTimer = setInterval(render, 250);
    return true;
  }

  async function stop({save = true} = {}) {
    if (!rec) return null;
    const r = rec;
    rec = null;
    clearInterval(recTimer);
    strip.dataset.mode = '';
    const out = trimLead(recorder.stop(performance.now()));
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Record');
    btn.title = 'Record a take (R)';
    api.root.classList.remove('recording');
    if (!save) { hideStrip(); return null; }
    if (!out.notes.length) { if (!r.exam) { hideStrip(); api.flash('Nothing recorded.', 'bad'); } return {empty: true, ...r}; }
    const take = {
      id: newId(), songId: r.songId, title: r.title, composer: r.composer, name: r.exam ? 'Mock exam' : 'Take',
      at: Date.now(), durationMs: out.durationMs, tempo: r.tempo, section: r.section, hands: r.hands, mode: r.mode,
      source: out.source, notes: out.notes, pedal: out.pedal,
      ...(r.exam ? {exam: r.exam.id, examItem: r.exam.index} : {}),
    };
    // Compared now, while the piece it was played against is still the one loaded.
    const song = api.song();
    if (song && api.current()?.id === r.songId) {
      try { take.report = buildReport({song, take}); } catch (e) { console.warn('Could not compare the take with the score:', e); }
    }
    if (!r.exam) {
      let count = 0;
      try { count = (await store.listTakes(r.songId)).length; } catch {}
      take.name = `Take ${count + 1}`;
    }
    try { await store.saveTake(take); } catch (e) {
      showStrip([`Couldn’t save the take: ${e.message}`, {label: 'Dismiss', onClick: hideStrip}], {kind: 'warn'});
      return null;
    }
    if (!r.exam) {
      const acc = take.report ? ` · ${take.report.summary.accuracy}%` : '';
      showStrip([dot('rec-strip-saved'), `${take.name} saved${acc}`,
        {label: 'Review', primary: true, onClick: () => { hideStrip(); openReview({takeId: take.id}); }},
        {label: 'Play', onClick: () => play(take)}], {timeout: 12000});
    }
    return take;
  }
  const toggle = () => (rec ? stop() : start());
  btn.addEventListener('click', toggle);

  // ───── playback ─────
  function play(take) {
    const song = api.song();
    if (!take?.notes?.length) return;
    if (!song || api.current()?.id !== take.songId) {
      location.hash = '#/play/' + encodeURIComponent(take.songId) + '?review=' + take.id;
      return;
    }
    if (rec) stop();
    const [a, b] = takeSection(song, take), range = api.range();
    if (range.first !== a || range.last !== b) api.setRange(a, b);
    const al = alignTake(expectedNotes(song, take).notes, playedNotes(take), {tempo: take.tempo || song.tempo || 100});
    const {tAt} = warpFns(al.warp, al.mpq);
    const notes = take.notes, sound = soundingDurations(take);
    const lead = Math.max(0, notes[0][0] - 250);
    const t0 = performance.now() + 80;
    const elapsed = () => performance.now() - t0 + lead;
    let next = notes.findIndex(n => n[0] >= lead), lo = 0;
    if (next < 0) next = notes.length;
    const total = take.durationMs - lead;
    const state = {take, timer: 0};
    const text = Object.assign(document.createElement('span'), {className: 'rec-strip-text'});
    const tick = () => {
      if (playback !== state) return;
      const now = elapsed();
      while (next < notes.length && notes[next][0] < now + 150) {
        const [at, n, v] = notes[next];
        api.piano.tone(n, sound[next] / 1000, Math.min(1, v / 127), Math.max(0, (at - now) / 1000));
        next++;
      }
      while (lo < notes.length && notes[lo][0] + 12000 < now) lo++;
      const down = [];
      for (let i = lo; i < next && i < notes.length; i++) if (notes[i][0] <= now && now < notes[i][0] + Math.max(notes[i][3], 60)) down.push(notes[i][1]);
      api.keys(down);
      text.textContent = `Playing “${take.name || 'take'}” · ${duration(Math.max(0, now - lead))} / ${duration(total)}`;
      if (now > take.durationMs + 400) api.stopExternal();
    };
    playback = state;
    api.playExternal(() => tAt(elapsed()), () => {
      clearInterval(state.timer);
      if (playback === state) playback = null;
      api.keys([]);
      if (strip.dataset.mode === 'play') { strip.dataset.mode = ''; hideStrip(); api.setPrompt('Played back · press <b class="glyph">▶</b> to hear the score'); }
    });
    playback = state;
    showStrip([dot('rec-strip-play'), {el: text}, {label: 'Stop', onClick: () => api.stopExternal()},
      {label: 'Report', onClick: () => { api.stopExternal(); openReview({takeId: take.id}); }}]);
    strip.dataset.mode = 'play';
    api.setStatus(`Playing back · ${take.name || 'take'}`);
    api.setPrompt('Playing back your take · the score follows your timing');
    state.timer = setInterval(tick, 25);
    tick();
  }
  function stopPlayback() { if (playback) api.stopExternal(); }

  // ───── review overlay (lazy) ─────
  async function openReview(opts = {}) {
    const entry = api.current();
    if (!entry || !api.song()) return;
    try {
      const m = await import('./review.js');
      review?.close();
      review = m.openReview({host: document.getElementById('rec-review'), songId: entry.id, song: api.song(), entry, ctl, ...opts});
    } catch (e) { console.warn('Could not open the review:', e); api.flash('Couldn’t open the recordings', 'bad'); }
  }
  const ctl = {
    play, stopPlayback, start, stop, showStrip, hideStrip, openReview, api,
    get recording() { return !!rec; },
    get notesPlayed() { return rec ? recorder.count : 0; },
    get idleMs() { return rec && recorder.lastAt != null ? performance.now() - recorder.lastAt : 0; },
    practiseBars(first, last) { api.setRange(first, last); api.setLoop(true); api.flash(first === last ? `Looping ${api.measureName(first).toLowerCase()}` : 'Looping those bars'); },
  };
  q('#rec-list-btn')?.addEventListener('click', () => {
    q('#more-menu').hidden = true; q('#more-btn').setAttribute('aria-expanded', 'false');
    openReview();
  });

  // ───── mock exam (lazy) ─────
  async function examLoaded(entry, examId) {
    if (!examId && !exam) return;
    try {
      const m = await import('./exam-ui.js');
      exam ||= m.createExamRunner(ctl);
      exam.loaded(entry, examId);
    } catch (e) { console.warn('Mock exam unavailable:', e); }
  }

  function handleParams(entry) {
    const p = hashParams();
    if (hashSongId() !== entry.id) return;
    const take = p.get('review');
    if (take) { dropHashParam('review'); openReview({takeId: take}); }
    examLoaded(entry, p.get('exam'));
  }
  // A link to the piece that is already open (Progress → Recordings) doesn't reload it.
  window.addEventListener('hashchange', () => {
    const entry = api.current();
    if (entry && api.song() && hashSongId() === entry.id) handleParams(entry);
  });

  return {
    noteOn(n, velocity, time, source) { if (rec) recorder.noteOn(n, velocity, time, source); },
    noteOff(n, time) { if (rec) recorder.noteOff(n, time); },
    pedal(value, time) { if (rec) recorder.pedal(value, time); },
    toggle,
    loaded(entry) { handleParams(entry); },
    leaving() {
      if (rec) stop();
      stopPlayback();
      review?.close(); review = null;
      exam?.leaving?.();
      if (strip.dataset.mode !== 'rec') hideStrip();
    },
  };
}
