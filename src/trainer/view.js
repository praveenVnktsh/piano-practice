// Note-reading trainer: a note appears on the staff, the reader plays it.
// mountReadingTrainer(container) → {destroy()} (see docs/ARCHITECTURE.md).
// Input: window `piano:note` events (MIDI, Mac relay, the player's keys) and
// this view's own on-screen keyboard. Output: a `trainer:result` event per round.

import './trainer.css';
import {createPiano} from '../piano.js';
import {keyForControl} from '../app/dom.js';
import {
  KEYS, LEVELS, candidates, keyById, levelById, levelSpan, loadStats, matches, midiLabel,
  pick, pitchLabel, recordAnswer, saveStats,
} from './levels.js';
import {renderStaff} from './render.js';

const SETTINGS_KEY = 'trainer:reading:settings';
const DEFAULTS = {level: 'landmarks', key: 'G', hint: true, anyOctave: false, retry: false, sound: true, length: 20};
const LENGTHS = [10, 20, 40];
const NEXT_MS = 420;      // after a right answer
const MISS_MS = 1500;     // after a wrong answer (when not retrying)

function loadSettings() {
  try { return {...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY))}; } catch { return {...DEFAULTS}; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const secs = ms => ms == null ? '–' : (ms / 1000).toFixed(1) + ' s';
const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);

export function mountReadingTrainer(container) {
  const settings = loadSettings();
  let stats = loadStats();
  const piano = createPiano(() => {});
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };

  const root = document.createElement('section');
  root.className = 'trainer';
  root.setAttribute('aria-label', 'Note-reading trainer');
  root.innerHTML = `
    <header class="tr-head">
      <div class="tr-title">
        <h1>Note reading</h1>
        <p class="tr-blurb"></p>
      </div>
      <div class="tr-controls">
        <label class="tr-field"><span>Level</span>
          <select data-ref="level">${LEVELS.map((l, i) => `<option value="${l.id}">${i + 1}. ${esc(l.name)}</option>`).join('')}</select>
        </label>
        <label class="tr-field" data-ref="keyField"><span>Key</span>
          <select data-ref="key">${KEYS.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select>
        </label>
        <label class="tr-field tr-field-short"><span>Notes</span>
          <select data-ref="length">${LENGTHS.map(n => `<option value="${n}">${n}</option>`).join('')}</select>
        </label>
      </div>
      <div class="tr-toggles" role="group" aria-label="Options">
        <button type="button" class="tr-toggle" data-opt="hint" title="Show the note name after a miss (H)">Name it</button>
        <button type="button" class="tr-toggle" data-opt="anyOctave" title="Accept the right note in any octave (O)">Any octave</button>
        <button type="button" class="tr-toggle" data-opt="retry" title="After a miss, wait until the right key is played">Retry misses</button>
        <button type="button" class="tr-toggle" data-opt="sound" title="Sound for the on-screen keys">Key sound</button>
      </div>
    </header>

    <div class="tr-stats" aria-live="off">
      <div class="tr-stat"><b data-ref="progress">0 / 20</b><span>Notes</span></div>
      <div class="tr-stat"><b data-ref="streak">0</b><span>Streak</span></div>
      <div class="tr-stat"><b data-ref="accuracy">–</b><span>Accuracy</span></div>
      <div class="tr-stat"><b data-ref="avg">–</b><span>Avg time</span></div>
      <div class="tr-bar" aria-hidden="true"><i data-ref="bar"></i></div>
    </div>

    <div class="tr-stage">
      <div class="tr-card" data-ref="card">
        <div class="tr-sheet" data-ref="sheet"></div>
        <div class="tr-feedback" data-ref="feedback" aria-live="polite"></div>
      </div>
      <div class="tr-results" data-ref="results" hidden></div>
    </div>

    <div class="tr-kb-wrap">
      <p class="tr-kb-note">Play on your piano (connect it in any piece: ⋯ → Connect piano) or tap the keys.</p>
      <div class="tr-kb" data-ref="kbScroll"><div class="tr-keys" data-ref="keys"></div></div>
    </div>`;
  container.append(root);
  const ref = name => root.querySelector(`[data-ref="${name}"]`);

  // ───────── State ─────────
  let level, items, round;

  function syncControls() {
    ref('level').value = settings.level;
    ref('key').value = settings.key;
    ref('length').value = String(settings.length);
    ref('keyField').hidden = !level.usesKey;
    root.querySelector('.tr-blurb').textContent = level.blurb + (level.usesKey ? ` ${keyById(settings.key).name}.` : '');
    for (const b of root.querySelectorAll('[data-opt]')) b.setAttribute('aria-pressed', String(!!settings[b.dataset.opt]));
  }

  function setup() {
    level = levelById(settings.level);
    settings.level = level.id;
    items = candidates(level, {key: settings.key});
    buildKeyboard();
    syncControls();
    newRound();
  }

  function newRound() {
    clearTimers();
    round = {
      n: settings.length, idx: 0, right: 0, wrong: 0, streak: 0, best: 0, times: [],
      missedItems: [], start: performance.now(), current: null, last: null, phase: 'ask',
    };
    ref('results').hidden = true;
    ref('card').hidden = false;
    next();
  }

  function next() {
    round.current = pick(items, {stats, last: round.last});
    round.got = new Set();
    round.missed = false;
    round.phase = 'ask';
    round.shownAt = performance.now();
    clearKeyMarks();
    ref('sheet').innerHTML = renderStaff({staff: level.staff, key: keyById(round.current.key).fifths, item: round.current});
    ref('card').dataset.state = '';
    setFeedback('');
    updateStats();
  }

  function setFeedback(html, tone = '') {
    const fb = ref('feedback');
    fb.innerHTML = html;
    fb.dataset.tone = tone;
  }

  function answerName(item = round.current) {
    return item.pitches.map(p => pitchLabel(p, {octave: !settings.anyOctave})).join(' + ');
  }

  // ───────── Answers ─────────
  function onNote(midi) {
    if (!round || round.phase !== 'ask') return;
    const target = round.current.pitches;
    const hit = target.findIndex((p, i) => !round.got.has(i) && matches(midi, p, settings.anyOctave));
    if (hit >= 0) {
      round.got.add(hit);
      markKey(midi, 'ok');
      if (round.got.size === target.length) correct();
      return;
    }
    // Repeating a note already got (in a two-note item) is harmless.
    if (target.some((p, i) => round.got.has(i) && matches(midi, p, settings.anyOctave))) return;
    miss(midi);
  }

  function correct() {
    const ms = performance.now() - round.shownAt;
    if (!round.missed) {
      round.right++;
      round.streak++;
      round.best = Math.max(round.best, round.streak);
      round.times.push(ms);
      stats = recordAnswer(stats, round.current.id, {correct: true, ms: Math.round(ms)});
      setFeedback(`<b>${esc(answerName())}</b> <span>${secs(ms)}</span>`, 'ok');
    } else setFeedback(`<b>${esc(answerName())}</b>`, 'ok');
    ref('card').dataset.state = 'ok';
    round.phase = 'wait';
    updateStats();
    later(advance, NEXT_MS);
  }

  function miss(midi) {
    markKey(midi, 'bad');
    for (const p of round.current.pitches) markTarget(p.midi);
    ref('card').dataset.state = 'bad';
    if (!round.missed) {
      round.missed = true;
      round.wrong++;
      round.streak = 0;
      round.missedItems.push(round.current);
      stats = recordAnswer(stats, round.current.id, {correct: false});
    }
    const played = `You played ${esc(midiLabel(midi))}`;
    const hint = settings.hint ? ` · this is <b>${esc(answerName())}</b>` : '';
    setFeedback(played + hint + (settings.retry ? ' · <em>play the marked key</em>' : ''), 'bad');
    updateStats();
    if (!settings.retry) {
      round.phase = 'wait';
      later(advance, MISS_MS);
    } else later(() => { if (round.phase === 'ask') ref('card').dataset.state = ''; }, 500);
  }

  function advance() {
    round.last = round.current;
    round.idx++;
    if (round.idx >= round.n) finish();
    else next();
  }

  function summary() {
    const answered = round.right + round.wrong;
    const avgMs = round.times.length ? Math.round(round.times.reduce((a, b) => a + b, 0) / round.times.length) : null;
    return {answered, accuracy: answered ? Math.round(100 * round.right / answered) : 0, avgMs};
  }

  function finish() {
    round.phase = 'done';
    saveStats(stats);
    clearKeyMarks();
    const {accuracy, avgMs} = summary();
    const detail = {
      level: level.id, right: round.right, wrong: round.wrong, accuracy, avgMs,
      durationMs: Math.round(performance.now() - round.start), at: Date.now(),
      // Extras beyond the contract, for the progress view.
      levelName: level.name, notes: round.n, anyOctave: settings.anyOctave,
      ...(level.usesKey ? {key: settings.key} : {}),
    };
    window.dispatchEvent(new CustomEvent('trainer:result', {detail}));
    updateStats();
    showResults(detail);
  }

  function showResults(d) {
    const idx = LEVELS.indexOf(level);
    const nextLevel = LEVELS[idx + 1];
    const verdict = d.accuracy >= 90 && (d.avgMs ?? 1e9) < 3000 ? 'Clean reading. Ready for the next level.'
      : d.accuracy >= 90 ? 'Accurate. Next, aim for under three seconds a note.'
        : d.accuracy >= 70 ? 'Nearly there. Another round at this level.' : 'Stay with this level; missed notes will return more often.';
    const missed = [...new Map(round.missedItems.map(it => [it.id, it])).values()].slice(0, 8);
    const box = ref('results');
    box.innerHTML = `
      <h2>Round complete</h2>
      <p class="tr-res-level">${esc(level.name)}${level.usesKey ? ' · ' + esc(keyById(settings.key).name) : ''}</p>
      <div class="tr-res-big"><b>${d.accuracy}%</b><span>accuracy</span></div>
      <div class="tr-res-grid">
        <div><b>${d.right}</b><span>right</span></div>
        <div><b>${d.wrong}</b><span>missed</span></div>
        <div><b>${secs(d.avgMs)}</b><span>avg time</span></div>
        <div><b>${round.best}</b><span>best streak</span></div>
      </div>
      ${missed.length ? `<p class="tr-res-missed">Missed: ${missed.map(it => `<span>${esc(it.pitches.map(p => pitchLabel(p)).join('+'))}<small>${it.clef === 'treble' ? '𝄞' : '𝄢'}</small></span>`).join('')}</p>` : ''}
      <p class="tr-res-verdict">${verdict}</p>
      <div class="tr-res-actions">
        <button type="button" class="tr-btn tr-btn-accent" data-act="again">Again <kbd>Enter</kbd></button>
        ${nextLevel ? `<button type="button" class="tr-btn" data-act="next">Next: ${esc(nextLevel.short)}</button>` : ''}
      </div>`;
    ref('card').hidden = true;
    box.hidden = false;
    box.querySelector('[data-act="again"]').focus({preventScroll: true});
  }

  function updateStats() {
    const {answered, accuracy, avgMs} = summary();
    const shown = Math.min(round.n, round.idx + (round.phase === 'done' ? 0 : 1));
    ref('progress').textContent = `${shown} / ${round.n}`;
    ref('streak').textContent = String(round.streak);
    ref('accuracy').textContent = answered ? accuracy + '%' : '–';
    ref('avg').textContent = secs(avgMs);
    ref('bar').style.width = (100 * (round.idx + (round.phase === 'ask' ? 0 : 1)) / round.n) + '%';
  }

  // ───────── On-screen keyboard ─────────
  function buildKeyboard() {
    let [lo, hi] = levelSpan(level, {key: settings.key});
    lo = Math.floor(lo / 12) * 12;              // down to a C
    hi = Math.ceil((hi + 1) / 12) * 12;         // up to the next C
    if (hi - lo < 24) hi = lo + 24;             // at least two octaves

    const whites = [];
    for (let n = lo; n <= hi; n++) if (!isBlack(n)) whites.push(n);
    const W = whites.length;
    const keys = ref('keys');
    keys.style.setProperty('--whites', W);
    let html = '';
    whites.forEach((n, i) => {
      const label = n % 12 === 0 ? `<span>${midiLabel(n)}</span>` : '';
      html += `<button type="button" class="tr-key tr-white${n === 60 ? ' tr-middle' : ''}" data-note="${n}" style="left:${(100 * i / W).toFixed(4)}%" aria-label="${midiLabel(n)}">${label}</button>`;
    });
    whites.forEach((n, i) => {
      if (n + 1 <= hi && isBlack(n + 1)) {
        html += `<button type="button" class="tr-key tr-black" data-note="${n + 1}" style="left:${(100 * (i + 1) / W).toFixed(4)}%" aria-label="${midiLabel(n + 1)}"></button>`;
      }
    });
    keys.innerHTML = html;
    // Centre the scroll position on middle C when the keyboard is wider than the screen.
    requestAnimationFrame(() => {
      const s = ref('kbScroll'), c = keys.querySelector('[data-note="60"]');
      if (s && c && s.scrollWidth > s.clientWidth) s.scrollLeft = c.offsetLeft + c.offsetWidth / 2 - s.clientWidth / 2;
    });
  }
  const keyEl = n => ref('keys').querySelector(`[data-note="${n}"]`);
  function markKey(n, cls) {
    const k = keyEl(n);
    if (!k) return;
    k.classList.remove('ok', 'bad');
    void k.offsetWidth; // restart the flash
    k.classList.add(cls);
    later(() => k.classList.remove(cls), cls === 'bad' ? 900 : 500);
  }
  function markTarget(n) {
    if (settings.anyOctave) {
      for (const k of ref('keys').querySelectorAll('.tr-key')) if ((+k.dataset.note - n) % 12 === 0) k.classList.add('target');
    } else keyEl(n)?.classList.add('target');
  }
  function clearKeyMarks() {
    for (const k of ref('keys').querySelectorAll('.target, .ok, .bad')) k.classList.remove('target', 'ok', 'bad');
  }

  ref('keys').addEventListener('pointerdown', e => {
    const k = e.target.closest('.tr-key');
    if (!k) return;
    e.preventDefault();
    const n = +k.dataset.note;
    k.classList.add('down');
    if (settings.sound) try { piano.tone(n, 1.2, .7); } catch {}
    onNote(n);
  });
  const up = e => { for (const k of ref('keys').querySelectorAll('.down')) if (!e || e.type !== 'pointerdown') k.classList.remove('down'); };
  ref('keys').addEventListener('pointerup', up);
  ref('keys').addEventListener('pointercancel', up);
  ref('keys').addEventListener('pointerleave', up);
  // Keyboard activation of a focused key (Enter/Space on a button fires click with detail 0).
  ref('keys').addEventListener('click', e => {
    const k = e.target.closest('.tr-key');
    if (!k || e.detail !== 0) return;
    if (settings.sound) try { piano.tone(+k.dataset.note, 1.2, .7); } catch {}
    onNote(+k.dataset.note);
  });

  // ───────── Controls ─────────
  ref('level').addEventListener('change', e => { settings.level = e.target.value; saveSettings(settings); setup(); e.target.blur(); });
  ref('key').addEventListener('change', e => { settings.key = e.target.value; saveSettings(settings); setup(); e.target.blur(); });
  ref('length').addEventListener('change', e => { settings.length = +e.target.value; saveSettings(settings); newRound(); e.target.blur(); });
  function toggle(opt) {
    settings[opt] = !settings[opt];
    saveSettings(settings);
    syncControls();
  }
  for (const b of root.querySelectorAll('[data-opt]')) b.addEventListener('click', () => toggle(b.dataset.opt));
  ref('results').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'again') newRound();
    if (act === 'next') {
      const nextLevel = LEVELS[LEVELS.indexOf(level) + 1];
      if (nextLevel) { settings.level = nextLevel.id; saveSettings(settings); setup(); }
    }
  });

  // ───────── Inputs from outside ─────────
  const onPianoNote = e => {
    const d = e.detail || {};
    if (typeof d.note !== 'number' || d.velocity === 0) return;
    if (d.source !== 'screen' || !root.contains(document.activeElement)) markDown(d.note);
    onNote(d.note);
  };
  function markDown(n) {
    const k = keyEl(n);
    if (!k) return;
    k.classList.add('down');
    later(() => k.classList.remove('down'), 180);
  }
  window.addEventListener('piano:note', onPianoNote);

  // Shortcuts (only while mounted): Enter = next round, H = name hint, O = any octave.
  const onKey = e => {
    if (!root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (keyForControl(e)) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter' && round?.phase === 'done' && !e.target.closest?.('button')) newRound();
    else if (k === 'h') toggle('hint');
    else if (k === 'o') toggle('anyOctave');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);

  try { piano.load(); } catch {} // no Web Audio (tests, very old browsers): keys stay silent
  setup();

  return {
    destroy() {
      clearTimers();
      if (round && round.phase !== 'done') saveStats(stats);
      window.removeEventListener('piano:note', onPianoNote);
      window.removeEventListener('keydown', onKey, true);
      piano.silence();
      root.remove();
    },
  };
}
