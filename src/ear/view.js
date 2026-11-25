// Ear training (#/exercises/ear): intervals, chords, cadences and melodies.
// mountEarTrainer(container) → {destroy()}.
//
// Each question plays on this view's own piano; "Play again" repeats it. Answer by tapping a
// choice (keys 1–5) or, for intervals, chords and melodies, by playing it on the piano (MIDI via
// window `piano:note`) or the on-screen keys. A round ends with `trainer:result` ({level: 'ear:<id>'}).
import '../theory/theory.css';
import './ear.css';
import {createPiano} from '../piano.js';
import {EAR_KINDS, EAR_LEVELS, earLevelById, makeRound, judgePlayed} from './levels.js';
import {createKeys} from '../theory/keys.js';
import {rng, newSeed, midiName} from '../theory/music.js';

const STORE_KEY = 'piano-practice.ear';
const loadSettings = () => { try { return {kind: 'intervals', levels: {}, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}')}; } catch { return {kind: 'intervals', levels: {}}; } };
const saveSettings = s => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {} };

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

export function mountEarTrainer(container) {
  const settings = loadSettings();
  const piano = createPiano(() => {});
  try { piano.load(); } catch {}
  let kind = EAR_KINDS.find(k => k.id === settings.kind) || EAR_KINDS[0];
  let level = null, round = null, keys = null;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const stopSound = () => { timers.forEach(clearTimeout); timers.clear(); try { piano.silence(); } catch {} };

  const tabs = el('div', {class: 'ear-kinds', role: 'tablist', 'aria-label': 'What to train'});
  const levelSel = el('select', {class: 'ear-select', 'aria-label': 'Level', onchange: e => { setLevel(e.target.value); e.target.blur(); }});
  const blurb = el('p', {class: 'ear-blurb'});
  const stage = el('div', {class: 'ear-stage'});
  const root = el('div', {class: 'th ear'},
    tabs,
    el('div', {class: 'ear-head'}, blurb, el('label', {class: 'ear-field'}, el('span', {class: 'label-caps', text: 'Level'}), levelSel)),
    stage);
  container.append(root);

  function drawTabs() {
    tabs.replaceChildren(...EAR_KINDS.map(k => el('button', {type: 'button', role: 'tab', class: 'ear-kind', 'aria-selected': String(k === kind), onclick: () => setKind(k.id)}, k.name)));
    levelSel.replaceChildren(...kind.levels.map((l, i) => el('option', {value: l.id}, `${i + 1}. ${l.name}`)));
    blurb.textContent = kind.blurb;
  }
  function setKind(id) {
    kind = EAR_KINDS.find(k => k.id === id) || EAR_KINDS[0];
    settings.kind = kind.id; saveSettings(settings);
    drawTabs();
    setLevel(settings.levels[kind.id]);
  }
  function setLevel(id) {
    level = earLevelById(id);
    if (!level || level.kind !== kind.id) level = EAR_LEVELS.find(l => l.kind === kind.id);
    settings.levels = {...settings.levels, [kind.id]: level.id}; saveSettings(settings);
    levelSel.value = level.id;
    newRound(false);
  }

  // ───── a round ─────
  function newRound(autoplay = true) {
    stopSound();
    round = {qs: makeRound(level, rng(newSeed())), i: 0, right: 0, wrong: 0, times: [], replays: 0, start: performance.now()};
    showQuestion(autoplay);
  }
  function play(q = round.current.q) {
    stopSound();
    const qms = 60000 / (q.tempo || 80);
    for (const s of q.sound) for (const m of s.notes) { try { piano.tone(m, s.len * qms / 1000, .66, (60 + s.at * qms) / 1000); } catch {} }
    const btn = stage.querySelector('.ear-listen');
    if (btn) {
      btn.classList.add('is-playing');
      const end = Math.max(...q.sound.map(s => s.at + s.len)) * qms + 60;
      later(() => btn.classList.remove('is-playing'), end);
    }
    round.current.heard = true;
  }
  function showQuestion(autoplay) {
    keys?.destroy(); keys = null;
    const q = round.qs[round.i];
    round.current = {q, answered: false, played: [], shownAt: performance.now(), heard: false};
    const listen = el('button', {type: 'button', class: 'ear-listen', onclick: () => { if (round.current.heard) round.replays++; play(); }, 'aria-label': 'Play the question'},
      el('span', {class: 'ear-listen-icon', 'aria-hidden': 'true', text: '▸'}), el('span', {class: 'ear-listen-label', text: 'Listen'}));
    const feedback = el('p', {class: 'th-feedback ear-feedback', 'aria-live': 'polite'});
    const next = el('button', {type: 'button', class: 'btn-primary th-next', hidden: true, onclick: () => advance()}, round.i === round.qs.length - 1 ? 'See how you did' : 'Next');
    const choices = q.choices ? el('div', {class: 'th-choices' + (q.choices.length >= 4 ? ' is-four' : '')}, q.choices.map((c, k) =>
      el('button', {type: 'button', class: 'th-choice', 'data-id': c.id, onclick: () => answerChoice(c.id)}, el('span', {class: 'th-choice-k', text: String(k + 1)}), el('span', {text: c.label})))) : null;
    if (q.playable) keys = createKeys({lo: 48, hi: 83, piano, onNote: n => answerNote(n)});
    const playNote = q.playable === 'melody' ? 'Play the tune on your piano or the keys below.'
      : q.playable === 'interval' ? 'Or play the two notes, from any starting note.'
        : q.playable === 'chord' ? 'Or play a chord of that kind, on any note.' : null;
    stage.replaceChildren(el('section', {class: 'th-card ear-card', 'aria-labelledby': 'ear-q-h'},
      el('div', {class: 'ear-card-top'},
        el('p', {class: 'th-eyebrow', text: `${level.name} · ${round.i + 1} of ${round.qs.length}`}),
        el('span', {class: 'th-score', text: `${round.right} right · ${round.wrong} missed`})),
      el('div', {class: 'ear-ask'}, listen, el('h2', {class: 'th-h th-prompt', id: 'ear-q-h', text: q.prompt})),
      choices,
      playNote ? el('p', {class: 'th-play-note', text: playNote}) : null,
      keys?.el,
      feedback,
      el('div', {class: 'th-nav ear-nav'}, el('button', {type: 'button', class: 'text-btn', onclick: () => { if (round.current.heard) round.replays++; play(); }}, 'Play again'), next)));
    Object.assign(round.current, {feedback, next});
    if (autoplay) later(() => play(q), 250);
  }
  function judge(ok, extra = '') {
    const c = round.current;
    if (c.answered) return;
    c.answered = true;
    if (ok) { round.right++; round.times.push(performance.now() - c.shownAt); } else round.wrong++;
    for (const b of stage.querySelectorAll('.th-choice')) b.disabled = true;
    choiceEl(c.q.answer)?.classList.add('is-right');
    c.feedback.dataset.tone = ok ? 'ok' : 'bad';
    c.feedback.replaceChildren(el('b', {text: ok ? 'Right.' : 'Not quite.'}), ' ', [extra, c.q.explain].filter(Boolean).join(' '));
    stage.querySelector('.th-score').textContent = `${round.right} right · ${round.wrong} missed`;
    if (c.q.playable === 'melody' && !ok) for (const m of c.q.target.notes) keys?.mark(m, 'target');
    c.next.hidden = false;
    c.next.focus({preventScroll: true});
  }
  const choiceEl = id => [...stage.querySelectorAll('.th-choice')].find(b => b.dataset.id === String(id));
  function answerChoice(id) {
    const c = round.current;
    if (c.answered) return;
    if (id !== c.q.answer) choiceEl(id)?.classList.add('is-wrong');
    judge(id === c.q.answer);
  }
  function answerNote(n) {
    const c = round.current;
    if (!c || c.answered || !c.q.playable) return;
    // Chords: notes played within a moment of each other belong together; a pause starts again.
    const now = performance.now();
    if (c.q.playable === 'chord' && c.lastAt && now - c.lastAt > 1500) c.played = [];
    if (c.q.playable === 'interval' && c.lastAt && now - c.lastAt > 2500) c.played = [];
    c.lastAt = now;
    c.played.push(n);
    const verdict = judgePlayed(c.q, c.played);
    if (verdict === 'pending') { keys?.mark(n, 'ok', 500); return; }
    keys?.mark(n, verdict === 'right' ? 'ok' : 'bad', 900);
    judge(verdict === 'right', verdict === 'wrong' ? `You played ${c.played.map(m => midiName(m).replace(/-?\d+$/, '')).join(' ')}.` : '');
  }
  function advance() {
    if (round.i < round.qs.length - 1) { round.i++; showQuestion(true); return; }
    finish();
  }
  function finish() {
    stopSound();
    keys?.destroy(); keys = null;
    const n = round.right + round.wrong;
    const accuracy = n ? Math.round(100 * round.right / n) : 0;
    const avgMs = round.times.length ? Math.round(round.times.reduce((a, b) => a + b, 0) / round.times.length) : null;
    window.dispatchEvent(new CustomEvent('trainer:result', {detail: {
      level: 'ear:' + level.id, right: round.right, wrong: round.wrong, accuracy, avgMs,
      durationMs: Math.round(performance.now() - round.start), at: Date.now(), levelName: `${kind.name}: ${level.name}`, replays: round.replays,
    }}));
    const nextLevel = kind.levels[kind.levels.indexOf(level) + 1];
    const verdict = accuracy >= 90 ? (nextLevel ? 'A good ear. Ready for the next level.' : 'A good ear.') : accuracy >= 70 ? 'Nearly there. Another round at this level.' : 'Stay with this level. Sing the notes back before you answer.';
    stage.replaceChildren(el('section', {class: 'th-card th-results', 'aria-live': 'polite'},
      el('p', {class: 'th-eyebrow', text: `${kind.name} · ${level.name}`}),
      el('h2', {class: 'th-h', text: 'Round complete'}),
      el('div', {class: 'th-res-big'}, el('b', {text: `${round.right} / ${n}`}), el('span', {text: `${accuracy}%${round.replays ? ` · ${round.replays} replay${round.replays === 1 ? '' : 's'}` : ''}`})),
      el('p', {class: 'th-res-verdict', text: verdict}),
      el('div', {class: 'th-nav th-res-actions'},
        nextLevel && accuracy >= 90 ? el('button', {type: 'button', class: 'text-btn', onclick: () => newRound()}, 'Another round') : null,
        nextLevel && accuracy >= 90 ? el('button', {type: 'button', class: 'btn-primary', onclick: () => { setLevel(nextLevel.id); newRound(); }}, `Next: ${nextLevel.name}`)
          : el('button', {type: 'button', class: 'btn-primary', onclick: () => newRound()}, 'Another round'))));
    stage.querySelector('.btn-primary')?.focus({preventScroll: true});
  }

  // ───── inputs ─────
  const onPianoNote = e => {
    const d = e.detail || {};
    if (typeof d.note !== 'number' || d.velocity === 0) return;
    if (!round?.current || round.current.answered || !round.current.q.playable) return;
    if (d.source !== 'screen') keys?.press(d.note);
    answerNote(d.note);
  };
  window.addEventListener('piano:note', onPianoNote);
  const onKey = e => {
    if (!root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input,select,textarea,[contenteditable]')) return;
    const c = round?.current;
    if (!c || c.answered || !c.q.choices) return;
    const k = +e.key;
    if (k >= 1 && k <= c.q.choices.length) { e.preventDefault(); answerChoice(c.q.choices[k - 1].id); }
  };
  window.addEventListener('keydown', onKey);

  drawTabs();
  setLevel(settings.levels[kind.id]);

  return {
    destroy() {
      stopSound();
      keys?.destroy();
      window.removeEventListener('piano:note', onPianoNote);
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
