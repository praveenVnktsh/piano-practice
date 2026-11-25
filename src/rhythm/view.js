// Rhythm trainer (#/exercises/rhythm): read a line of rhythm, hear a bar of count-in, tap it.
// mountRhythmTrainer(container) → {destroy()}.
//
// Taps: any key on a MIDI piano (window `piano:note`), the tap pad, or Space while the view is open.
// A round is four rhythms; it ends with a `trainer:result` ({level: 'rhythm:<id>', right, wrong,
// accuracy, avgMs = mean timing error in ms, durationMs, at, timing: {early, late, onTime}, tempo}).
import '../theory/engrave.css';
import './rhythm.css';
import {createPiano} from '../piano.js';
import {keyForControl} from '../app/dom.js';
import {RHYTHM_LEVELS, rhythmLevelById, generateRhythm, gradeTaps, clickTrack, countLabels, onsetEvents, barLength} from './patterns.js';
import {engrave} from '../theory/engrave.js';
import {newSeed} from '../theory/music.js';

const SETTINGS_KEY = 'piano-practice.rhythm';
const PLAYER_SETTINGS = 'piano-practice:settings'; // the player's calibrated input latency (Settings → Calibrate)
const ROUND = 4;
const LEAD_MS = 250;      // between pressing Start and the first click
const TAIL_MS = 400;      // after the last beat before grading
const DEMO_NOTE = 72;     // C5, for "Hear it"

const loadSettings = () => { try { return {level: 'crotchets', counts: true, tempos: {}, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')}; } catch { return {level: 'crotchets', counts: true, tempos: {}}; } };
const saveSettings = s => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };
const latency = () => { try { const v = +JSON.parse(localStorage.getItem(PLAYER_SETTINGS) || '{}').latencyMs; return Number.isFinite(v) ? Math.max(0, Math.min(500, v)) : 0; } catch { return 0; } };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

export function mountRhythmTrainer(container) {
  const settings = loadSettings();
  const piano = createPiano(() => {});
  try { piano.load(); } catch {}
  let level = rhythmLevelById(settings.level);
  let pattern = null, layout = null, run = null, round = null, raf = 0;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); cancelAnimationFrame(raf); };
  const tempo = () => settings.tempos?.[level.id] || level.tempo;

  // ───── markup ─────
  const levelSel = el('select', {class: 'rh-select', 'aria-label': 'Level', onchange: e => { setLevel(e.target.value); e.target.blur(); }},
    RHYTHM_LEVELS.map((l, i) => el('option', {value: l.id}, `${i + 1}. ${l.name}`)));
  const tempoOut = el('output', {class: 'rh-tempo-value', 'aria-live': 'polite'});
  const countsBtn = el('button', {type: 'button', class: 'rh-toggle', onclick: () => {
    if (run && ['count', 'play', 'demo'].includes(run.phase)) return;
    settings.counts = !settings.counts; saveSettings(settings); drawStaff(); syncControls();
    if (run?.phase === 'graded') { run.phase = 'ready'; run.gradedBefore = false; setActions(); }
  }}, 'Show counting');
  const blurb = el('p', {class: 'rh-blurb'});
  const progress = el('p', {class: 'rh-progress'});
  const staff = el('div', {class: 'rh-staff'});
  const status = el('p', {class: 'rh-status', 'aria-live': 'polite'});
  const primary = el('button', {type: 'button', class: 'btn-primary rh-primary', onclick: () => onPrimary()});
  const hear = el('button', {type: 'button', class: 'text-btn rh-hear', onclick: () => demo()}, 'Hear it');
  const again = el('button', {type: 'button', class: 'text-btn rh-again', onclick: () => begin(), hidden: true}, 'Try again');
  const pad = el('button', {type: 'button', class: 'rh-pad', 'aria-label': 'Tap'}, el('span', {class: 'rh-pad-label', text: 'Tap'}), el('span', {class: 'rh-pad-hint', text: 'or any key on your piano · Space'}));
  const card = el('section', {class: 'rh-card'}, el('div', {class: 'rh-card-top'}, progress, countsBtn), staff, status,
    el('div', {class: 'rh-actions'}, primary, again, hear));
  const results = el('section', {class: 'rh-results', hidden: true, 'aria-live': 'polite'});
  const root = el('div', {class: 'rh'},
    el('div', {class: 'rh-head'},
      el('label', {class: 'rh-field'}, el('span', {class: 'label-caps', text: 'Level'}), levelSel),
      el('div', {class: 'rh-field rh-tempo', role: 'group', 'aria-label': 'Tempo'},
        el('span', {class: 'label-caps', text: 'Tempo'}),
        el('div', {class: 'rh-tempo-row'},
          el('button', {type: 'button', class: 'rh-step', 'aria-label': 'Slower', onclick: () => setTempo(tempo() - 4)}, '−'),
          tempoOut,
          el('button', {type: 'button', class: 'rh-step', 'aria-label': 'Faster', onclick: () => setTempo(tempo() + 4)}, '+')))),
    blurb, card, results, pad);
  container.append(root);

  function syncControls() {
    levelSel.value = level.id;
    blurb.textContent = level.blurb;
    tempoOut.textContent = `♩ = ${tempo()}`;
    countsBtn.setAttribute('aria-pressed', String(!!settings.counts));
  }
  function setLevel(id) {
    level = rhythmLevelById(id);
    settings.level = level.id; saveSettings(settings);
    syncControls();
    newRound();
  }
  function setTempo(v) {
    if (run?.phase === 'play' || run?.phase === 'count') return;
    settings.tempos = {...settings.tempos, [level.id]: Math.max(40, Math.min(160, Math.round(v)))};
    saveSettings(settings);
    syncControls();
  }

  // ───── rounds and rhythms ─────
  function newRound() {
    stop();
    round = {n: 0, right: 0, wrong: 0, timing: {early: 0, late: 0, onTime: 0}, absMs: [], start: performance.now()};
    results.hidden = true; card.hidden = false; pad.hidden = false;
    nextPattern();
  }
  function nextPattern() {
    pattern = generateRhythm(level.id, newSeed());
    run = {phase: 'ready'};
    drawStaff();
    progress.textContent = `Rhythm ${round.n + 1} of ${ROUND}`;
    setStatus('Read it through, then press Start. One bar of clicks, then tap.');
    setActions();
  }
  function drawStaff() {
    if (!pattern) return;
    const labels = settings.counts ? countLabels(pattern.time, pattern.bars) : [];
    let i = 0;
    const measures = pattern.bars.map(bar => bar.map(e => ({...e, label: labels[i++] || undefined})));
    const narrow = (staff.clientWidth || container.clientWidth || 800) < 560;
    layout = engrave({staff: 'line', time: pattern.time, measures, perLine: narrow && pattern.bars.length > 1 ? Math.ceil(pattern.bars.length / 2) : 0});
    staff.innerHTML = layout.svg;
    const svg = staff.querySelector('svg');
    svg.setAttribute('aria-label', `Rhythm in ${pattern.time.join('/')}, ${pattern.bars.length} bars`);
    const NS = 'http://www.w3.org/2000/svg';
    run.cursor = document.createElementNS(NS, 'rect');
    run.cursor.setAttribute('class', 'rh-cursor');
    run.cursor.setAttribute('width', '1.6');
    run.cursor.style.display = 'none';
    run.marks = document.createElementNS(NS, 'g');
    run.marks.setAttribute('class', 'rh-marks');
    svg.prepend(run.cursor);
    svg.append(run.marks);
  }
  const setStatus = (text, tone = '') => { status.textContent = text; status.dataset.tone = tone; };
  function setActions() {
    const ph = run?.phase;
    primary.textContent = ph === 'count' || ph === 'play' || ph === 'demo' ? 'Stop' : ph === 'graded' ? (round.n + 1 >= ROUND ? 'See results' : 'Next rhythm') : 'Start';
    again.hidden = ph !== 'graded';
    hear.hidden = ph === 'count' || ph === 'play';
    hear.textContent = ph === 'demo' ? 'Hearing…' : 'Hear it';
    root.dataset.phase = ph || '';
  }
  function onPrimary() {
    const ph = run?.phase;
    if (ph === 'count' || ph === 'play' || ph === 'demo') { stop(); run.phase = 'ready'; clearMarks(); setStatus('Stopped. Press Start when you’re ready.'); setActions(); return; }
    if (ph === 'graded') { round.n++; if (round.n >= ROUND) finish(); else nextPattern(); return; }
    begin();
  }

  // ───── timing ─────
  function schedule({demoNotes = false} = {}) {
    const qms = 60000 / tempo();
    const bar = barLength(pattern.time);
    const t0 = performance.now() + LEAD_MS;
    const startAt = t0 + bar * qms;
    for (const c of clickTrack(pattern.time, pattern.bars.length)) {
      const at = startAt + c.beat * qms;
      try { piano.click((at - performance.now()) / 1000, c.accent); } catch {}
    }
    if (demoNotes) {
      const flat = pattern.bars.flat();
      let t = 0, tied = false;
      for (const e of flat) {
        if (!e.rest && !tied) {
          let len = e.dur, k = flat.indexOf(e);
          while (flat[k]?.tie && flat[k + 1]) { len += flat[k + 1].dur; k++; }
          try { piano.tone(DEMO_NOTE, len * qms / 1000 * .9, .62, (startAt + t * qms - performance.now()) / 1000); } catch {}
        }
        tied = !e.rest && !!e.tie;
        t += e.dur;
      }
    }
    const total = pattern.bars.length * bar;
    return {qms, t0, startAt, endAt: startAt + total * qms, total};
  }
  function begin() {
    stop();
    clearMarks();
    const s = schedule();
    run = {...run, phase: 'count', ...s, taps: [], expected: pattern.onsets.map(o => s.startAt + o * s.qms)};
    setActions();
    animate();
    later(() => { if (run.phase === 'count') run.phase = 'play'; setActions(); }, s.startAt - performance.now() - 250);
    later(grade, s.endAt - performance.now() + TAIL_MS);
  }
  function demo() {
    if (run?.phase === 'count' || run?.phase === 'play') return;
    stop();
    clearMarks();
    const s = schedule({demoNotes: true});
    run = {...run, phase: 'demo', ...s};
    setActions();
    animate();
    later(() => { if (run.phase !== 'demo') return; run.phase = run.gradedBefore ? 'graded' : 'ready'; hideCursor(); setStatus(run.gradedBefore ? run.lastVerdict : 'Now you: press Start and tap it.'); setActions(); }, s.endAt - performance.now() + 200);
  }
  function stop() {
    clearTimers();
    try { piano.stopClicks(); piano.silence(); } catch {}
    hideCursor();
  }
  const hideCursor = () => { if (run?.cursor) run.cursor.style.display = 'none'; };

  // Cursor: crotchet position → x, interpolated between engraved events (per system line).
  function xAt(q) {
    const ev = layout.events;
    let k = ev.findIndex((e, i) => q >= e.start - 1e-6 && (i === ev.length - 1 || q < ev[i + 1].start - 1e-6));
    if (k < 0) k = q < 0 ? 0 : ev.length - 1;
    const e = ev[k], nx = ev[k + 1];
    const frac = Math.max(0, Math.min(1, (q - e.start) / e.dur));
    const x2 = nx && nx.line === e.line ? nx.x : e.x + 16;
    return {x: e.x + (x2 - e.x) * frac, y0: e.y0, y1: e.y1};
  }
  function animate() {
    cancelAnimationFrame(raf);
    const tick = () => {
      if (!run || !['count', 'play', 'demo'].includes(run.phase)) return;
      const now = performance.now();
      const q = (now - run.startAt) / run.qms;
      if (q < 0) {
        const beatLen = pattern.time[1] === 8 && pattern.time[0] % 3 === 0 ? .5 : 4 / pattern.time[1];
        const n = Math.floor((q + barLength(pattern.time)) / beatLen) + 1;
        setStatus(n >= 1 ? String(n) : '', 'count');
        hideCursor();
      } else if (q <= run.total) {
        if (status.dataset.tone === 'count') setStatus(run.phase === 'demo' ? 'Listen…' : 'Tap!', 'go');
        const {x, y0, y1} = xAt(q);
        run.cursor.style.display = '';
        run.cursor.setAttribute('x', (x - .8).toFixed(1));
        run.cursor.setAttribute('y', y0.toFixed(1));
        run.cursor.setAttribute('height', (y1 - y0).toFixed(1));
      } else hideCursor();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ───── taps ─────
  function tap(time = performance.now()) {
    pad.classList.remove('hit'); void pad.offsetWidth; pad.classList.add('hit');
    if (!run || (run.phase !== 'count' && run.phase !== 'play')) return;
    const t = time - latency();
    if (t < run.startAt - 250) return; // tapping along with the count-in is fine
    run.taps.push(t);
    const q = (t - run.startAt) / run.qms;
    if (q <= run.total + .5) {
      const {x, y0} = xAt(Math.max(0, Math.min(run.total, q)));
      const NS = 'http://www.w3.org/2000/svg';
      const m = document.createElementNS(NS, 'rect');
      m.setAttribute('class', 'rh-tap');
      m.setAttribute('x', (x - 1).toFixed(1)); m.setAttribute('y', (y0 + 2).toFixed(1));
      m.setAttribute('width', '2'); m.setAttribute('height', '7');
      run.marks.append(m);
    }
  }
  function clearMarks() {
    run?.marks?.replaceChildren();
    for (const g of staff.querySelectorAll('.eg-ev')) g.classList.remove('is-perfect', 'is-early', 'is-late', 'is-miss');
  }

  function grade() {
    if (!run || run.phase !== 'play') return;
    hideCursor();
    const g = gradeTaps(run.expected, run.taps);
    const evIdx = onsetEvents(pattern.bars);
    g.notes.forEach((n, i) => staff.querySelector(`.eg-ev[data-i="${evIdx[i]}"]`)?.classList.add('is-' + n.result));
    round.right += g.right; round.wrong += g.wrong;
    for (const k of ['early', 'late', 'onTime']) round.timing[k] += g.timing[k];
    for (const n of g.notes) if (n.delta != null) round.absMs.push(Math.abs(n.delta));
    const missed = g.notes.filter(n => n.result === 'miss').length;
    const verdict = g.accuracy === 100 && g.timing.early + g.timing.late === 0 ? 'Clean.'
      : g.accuracy === 100 ? `Every note. ${[g.timing.early && `${g.timing.early} early`, g.timing.late && `${g.timing.late} late`].filter(Boolean).join(', ')}.`
        : [missed && `${missed} missed`, g.extra && `${g.extra} extra ${g.extra === 1 ? 'tap' : 'taps'}`, g.timing.early && `${g.timing.early} early`, g.timing.late && `${g.timing.late} late`].filter(Boolean).join(' · ') + '.';
    run.phase = 'graded'; run.gradedBefore = true; run.lastVerdict = verdict;
    setStatus(verdict, g.accuracy >= 90 ? 'ok' : 'bad');
    setActions();
    primary.focus({preventScroll: true});
  }

  function finish() {
    const answered = round.right + round.wrong;
    const accuracy = answered ? Math.round(100 * round.right / answered) : 0;
    const avgMs = round.absMs.length ? Math.round(round.absMs.reduce((a, b) => a + b, 0) / round.absMs.length) : null;
    const detail = {level: 'rhythm:' + level.id, right: round.right, wrong: round.wrong, accuracy, avgMs,
      durationMs: Math.round(performance.now() - round.start), at: Date.now(),
      levelName: level.name, timing: {...round.timing}, tempo: tempo(), patterns: ROUND};
    window.dispatchEvent(new CustomEvent('trainer:result', {detail}));
    const idx = RHYTHM_LEVELS.indexOf(level), next = RHYTHM_LEVELS[idx + 1];
    const verdict = accuracy >= 95 && round.timing.onTime >= round.right * .8 ? 'Steady and exact. Ready for the next level.'
      : accuracy >= 90 ? 'Accurate. Next, aim for every tap inside the beat.'
        : accuracy >= 70 ? 'Nearly there. Another round, perhaps a little slower.' : 'Stay with this level, and try it slower with the counting shown.';
    results.replaceChildren(
      el('h2', {text: 'Round complete'}),
      el('p', {class: 'rh-res-level', text: `${level.name} · ♩ = ${tempo()}`}),
      el('div', {class: 'rh-res-big'}, el('b', {text: `${accuracy}%`}), el('span', {text: 'accuracy'})),
      el('div', {class: 'rh-res-grid'},
        [[round.timing.onTime, 'on time'], [round.timing.early, 'early'], [round.timing.late, 'late'], [avgMs == null ? '–' : `${avgMs} ms`, 'average error']]
          .map(([v, k]) => el('div', {}, el('b', {text: String(v)}), el('span', {text: k})))),
      el('p', {class: 'rh-res-verdict', text: verdict}),
      el('div', {class: 'rh-res-actions'},
        el('button', {type: 'button', class: 'btn-primary', onclick: () => newRound()}, 'Another round'),
        next ? el('button', {type: 'button', class: 'text-btn', onclick: () => setLevel(next.id)}, `Next: ${next.short}`) : null));
    card.hidden = true; pad.hidden = true; results.hidden = false;
    results.querySelector('.btn-primary').focus({preventScroll: true});
  }

  // ───── inputs ─────
  pad.addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
  pad.addEventListener('click', e => { if (e.detail === 0) tap(); }); // keyboard activation
  const onNote = e => { const d = e.detail || {}; if (typeof d.note !== 'number' || d.velocity === 0) return; tap(typeof d.time === 'number' ? d.time : performance.now()); };
  window.addEventListener('piano:note', onNote);
  const onKey = e => {
    if (!root.isConnected || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (keyForControl(e)) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (e.target.closest?.('button') && e.target !== pad && !(run && (run.phase === 'count' || run.phase === 'play'))) return;
      e.preventDefault(); e.stopPropagation();
      tap();
    } else if (e.key === 'Enter' && !e.target.closest?.('button')) { e.preventDefault(); (results.hidden ? onPrimary : newRound)(); }
  };
  window.addEventListener('keydown', onKey, true);
  let resizeT = 0;
  // Re-flow the staff (one or two lines) when the width changes, unless a rhythm is running or marked.
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (run?.phase === 'ready') drawStaff(); }, 150); };
  window.addEventListener('resize', onResize);

  syncControls();
  newRound();

  return {
    destroy() {
      stop();
      clearTimeout(resizeT);
      window.removeEventListener('piano:note', onNote);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      root.remove();
    },
  };
}
