// Exercises hub (#/exercises) and technique builder (#/technique): pick an exercise type, key, mode, hands and octaves, then open
// the generated, fingered score in the player.  mountTechnique(container, {open}) → {destroy()}.
import '../theory/engrave.css';
import './exercises.css';
import {MAJOR_KEYS, MINOR_KEYS, CHROMATIC_STARTS, parseKey, pitchClass, keyFifths, keyLabel, chordFromNumeral, pitchName} from './theory.js';
import {scaleFingering, arpeggioFingering, fiveFingerFingering, chromaticFinger} from './fingering.js';
import {exerciseId, exerciseTitleFor, resolveExercise, dailyWarmup, listPresets, PROGRESSIONS} from './index.js';
import {readRecent} from '../app/sidebar.js';
import {engrave} from '../theory/engrave.js';

const STORE_KEY = 'piano-practice.technique';
const TYPES = [
  {id: 'scale', name: 'Scale', text: 'Up and down, in eighths'},
  {id: 'arpeggio', name: 'Arpeggio', text: 'Root position, broken chord'},
  {id: 'five-finger', name: 'Five-finger', text: 'One hand position, 1 to 5'},
  {id: 'progression', name: 'Chords', text: 'Block-chord progressions'},
  {id: 'chromatic', name: 'Chromatic', text: 'Every semitone, 1-3 fingering'},
];
const VARIANTS = [['natural-minor', 'Natural'], ['harmonic-minor', 'Harmonic'], ['melodic-minor', 'Melodic']];
const HANDS = [['left', 'Left'], ['both', 'Both'], ['right', 'Right']];
const DIFFICULTY = {beginner: 'Beginner', easy: 'Easy', intermediate: 'Intermediate', advanced: 'Advanced'};
const DEFAULTS = {type: 'scale', key: 'C', minor: false, variant: 'harmonic-minor', hands: 'both', octaves: 1, progression: {major: 'I-IV-V-I', minor: 'i-iv-V-i'}};

const load = () => { try { return {...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}')}; } catch { return {...DEFAULTS}; } };
const save = s => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {} };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter(c => c != null && c !== false));
  return node;
}

const sigLabel = (key, minor) => {
  try {
    const f = keyFifths(parseKey(key), minor ? 'harmonic-minor' : 'major');
    return f === 0 ? '—' : `${Math.abs(f)}${f > 0 ? '♯' : '♭'}`;
  } catch { return ''; }
};
const keysFor = s => (s.type === 'chromatic' ? CHROMATIC_STARTS : s.minor ? MINOR_KEYS : MAJOR_KEYS);
const hasMode = s => s.type !== 'chromatic';
const hasHands = s => s.type !== 'progression';
const maxOctaves = s => ({scale: 4, arpeggio: 4, chromatic: 2})[s.type] ?? 0;

/** Keep the key valid for the current type/mode: same name if offered, else the same pitch class. */
function fixKey(s) {
  const keys = keysFor(s);
  if (!keys.includes(s.key)) {
    const pc = pitchClass(parseKey(s.key) || {step: 'C', alter: 0});
    s.key = keys.find(k => pitchClass(parseKey(k)) === pc) || keys[0];
  }
  if (maxOctaves(s) && s.octaves > maxOctaves(s)) s.octaves = maxOctaves(s);
  const progs = PROGRESSIONS[s.minor ? 'minor' : 'major'];
  s.progression = {...DEFAULTS.progression, ...s.progression};
  if (!progs.includes(s.progression[s.minor ? 'minor' : 'major'])) s.progression[s.minor ? 'minor' : 'major'] = progs[0];
  return s;
}

function paramsOf(s) {
  const quality = s.minor ? 'minor' : 'major';
  switch (s.type) {
    case 'scale': return {type: 'scale', key: s.key, mode: s.minor ? s.variant : 'major', hands: s.hands, octaves: s.octaves};
    case 'arpeggio': return {type: 'arpeggio', key: s.key, quality, hands: s.hands, octaves: s.octaves};
    case 'five-finger': return {type: 'five-finger', key: s.key, quality, hands: s.hands};
    case 'progression': return {type: 'progression', key: s.key, mode: quality, progression: s.progression[quality]};
    case 'chromatic': return {type: 'chromatic', key: s.key, hands: s.hands, octaves: s.octaves};
  }
  return null;
}

/** One-octave fingering preview lines: [{hand: 'RH', fingers: '1 2 3 …'}], or chord names for progressions. */
function preview(s) {
  const p = paramsOf(s), pc = pitchClass(parseKey(s.key));
  const hands = s.hands === 'both' ? ['right', 'left'] : [s.hands];
  const line = (hand, f) => ({label: hand === 'right' ? 'RH' : 'LH', text: f.join(' ')});
  if (s.type === 'progression') {
    const chords = p.progression.split('-').map(n => chordFromNumeral(parseKey(s.key), p.mode, n));
    const name = c => pitchName(c.root) + ({minor: 'm', diminished: '°', augmented: '+'}[c.quality] ?? '');
    return [{label: 'Chords', text: chords.map(name).join(' – ')}];
  }
  return hands.map(h => {
    if (s.type === 'scale') { const f = scaleFingering(pc, p.mode, h, 1); return line(h, f.up); }
    if (s.type === 'arpeggio') return line(h, arpeggioFingering(pc, p.quality, h, 1).up);
    if (s.type === 'five-finger') return line(h, fiveFingerFingering(h));
    const f = Array.from({length: 13}, (_, i) => chromaticFinger(pc + i, h));
    if (h === 'right' && f[0] === 2) f[0] = 1;
    return line(h, f);
  });
}

export function mountTechnique(container, {open} = {}) {
  const state = fixKey(load());
  const go = id => { if (id) open?.(id); };
  const root = el('div', {class: 'tq'});
  container.append(root);

  // ───── daily warm-up ─────
  const warm = dailyWarmup();
  const warmup = el('section', {class: 'tq-card tq-warmup', 'aria-labelledby': 'tq-warm-h'},
    el('div', {class: 'tq-warmup-head'},
      el('p', {class: 'label-caps tq-label', text: 'Daily warm-up'}),
      el('h2', {id: 'tq-warm-h', class: 'tq-h2', text: `Today: ${keyLabel(warm.key)} major & ${keyLabel(warm.minor)} minor`}),
      el('p', {class: 'tq-note', text: 'A new key every day, around the circle of fifths.'})),
    el('ol', {class: 'tq-warm-list'}, ...warm.items.map((item, i) => el('li', {},
      el('button', {type: 'button', class: 'tq-warm-item', onclick: () => go(item.id)},
        el('span', {class: 'tq-warm-n', text: String(i + 1)}),
        el('span', {class: 'tq-warm-title', text: item.title}),
        el('span', {class: 'tq-warm-go', 'aria-hidden': 'true', text: '▸'}))))));

  // ───── builder ─────
  const builder = el('section', {class: 'tq-card tq-builder', 'aria-labelledby': 'tq-build-h'});
  const presets = el('section', {class: 'tq-presets', 'aria-labelledby': 'tq-presets-h'},
    el('h2', {id: 'tq-presets-h', class: 'tq-h2', text: 'Suggestions'}),
    ...listPresets().map(g => el('div', {class: 'tq-preset-group'},
      el('p', {class: 'label-caps tq-label', text: g.title}),
      el('div', {class: 'tq-preset-list'}, ...g.items.map(item =>
        el('button', {type: 'button', class: 'tq-preset', onclick: () => go(item.id)}, item.title))))));
  root.append(warmup, builder, presets);

  const choice = (label, options, current, onPick, cls = '') => el('div', {class: 'tq-field ' + cls, role: 'group', 'aria-label': label},
    el('p', {class: 'label-caps tq-label', text: label}),
    el('div', {class: 'tq-seg'}, ...options.map(([value, text, sub]) => el('button', {
      type: 'button', class: 'tq-opt', 'aria-pressed': String(value === current), 'data-value': value,
      onclick: () => onPick(value),
    }, el('span', {text}), sub ? el('small', {text: sub}) : null))));

  function update(change) {
    Object.assign(state, change);
    fixKey(state);
    save(state);
    render();
  }

  function render() {
    const focusedValue = builder.contains(document.activeElement) ? [document.activeElement.closest('.tq-field')?.getAttribute('aria-label'), document.activeElement.dataset.value] : null;
    const id = exerciseId(paramsOf(state));
    const resolved = resolveExercise(id);
    const fields = [
      el('div', {class: 'tq-field', role: 'group', 'aria-label': 'Exercise'},
        el('p', {class: 'label-caps tq-label', text: 'Exercise'}),
        el('div', {class: 'tq-types'}, ...TYPES.map(t => el('button', {
          type: 'button', class: 'tq-type', 'aria-pressed': String(t.id === state.type), 'data-value': t.id,
          onclick: () => update({type: t.id}),
        }, el('span', {class: 'tq-type-name', text: t.name}), el('span', {class: 'tq-type-text', text: t.text}))))),
      choice(state.type === 'chromatic' ? 'Starting note' : 'Key', keysFor(state).map(k => [k, keyLabel(k) + (state.type !== 'chromatic' && state.minor ? 'm' : ''), state.type === 'chromatic' ? null : sigLabel(k, state.minor)]),
        state.key, key => update({key}), 'tq-keys'),
    ];
    const row = [];
    if (hasMode(state)) row.push(choice('Mode', [['major', 'Major'], ['minor', 'Minor']], state.minor ? 'minor' : 'major', v => update({minor: v === 'minor'})));
    if (state.type === 'scale' && state.minor) row.push(choice('Minor form', VARIANTS, state.variant, variant => update({variant})));
    if (hasHands(state)) row.push(choice('Hands', HANDS, state.hands, hands => update({hands})));
    if (maxOctaves(state)) row.push(choice('Octaves', Array.from({length: maxOctaves(state)}, (_, i) => [String(i + 1), String(i + 1)]), String(state.octaves), v => update({octaves: +v})));
    if (state.type === 'progression') {
      const q = state.minor ? 'minor' : 'major';
      row.push(choice('Progression', PROGRESSIONS[q].map(p => [p, p.replace(/-/g, '–')]), state.progression[q], v => update({progression: {...state.progression, [q]: v}})));
    }
    fields.push(el('div', {class: 'tq-row'}, ...row));

    const lines = preview(state);
    const summary = el('div', {class: 'tq-summary'},
      el('div', {class: 'tq-summary-text'},
        el('h2', {id: 'tq-build-h', class: 'tq-title', text: exerciseTitleFor(id)}),
        el('p', {class: 'tq-meta'},
          resolved ? el('span', {class: 'label-caps', text: DIFFICULTY[resolved.entry.difficulty] || ''}) : null,
          resolved ? el('span', {text: `♩ = ${resolved.entry.tempo}`}) : null),
        el('dl', {class: 'tq-fingers'}, ...lines.flatMap(l => [el('dt', {class: 'label-caps', text: l.label}), el('dd', {text: l.text})]))),
      el('button', {type: 'button', class: 'tq-start', onclick: () => go(id)}, 'Start'));
    builder.replaceChildren(el('p', {class: 'label-caps tq-label tq-build-label', text: 'Build an exercise'}), ...fields, summary);
    if (focusedValue) builder.querySelector(`.tq-field[aria-label="${CSS.escape(focusedValue[0] || '')}"] [data-value="${CSS.escape(focusedValue[1] || '')}"]`)?.focus({preventScroll: true});
  }
  render();

  return {destroy() { root.remove(); }};
}

// ───────── Exercises hub (#/exercises): a few large cards ─────────

const STAFF = (x0, x1, y0, gap) => Array.from({length: 5}, (_, i) => `<line x1="${x0}" x2="${x1}" y1="${y0 + i * gap}" y2="${y0 + i * gap}"/>`).join('');
const head = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="5.6" ry="4" transform="rotate(-20 ${x} ${y})" class="ex-head"/>`;
// An ascending scale on a staff, stems up then down past the middle line.
const SCALE_ART = (() => {
  let notes = '';
  for (let i = 0; i < 8; i++) {
    const x = 34 + i * 24, y = 72 - i * 5;
    const up = y > 52;
    notes += head(x, y) + `<line x1="${x + (up ? 5.2 : -5.2)}" x2="${x + (up ? 5.2 : -5.2)}" y1="${y}" y2="${y + (up ? -30 : 30)}" class="ex-stem"/>`;
    if (y >= 72) notes += `<line x1="${x - 9}" x2="${x + 9}" y1="72" y2="72" class="ex-ledger"/>`;
  }
  return `<svg viewBox="0 0 240 100" aria-hidden="true" class="ex-art">${STAFF(10, 230, 32, 10)}<line x1="10" x2="10" y1="32" y2="72"/><line x1="230" x2="230" y1="32" y2="72"/>${notes}</svg>`;
})();
// Three notes over an octave of keys: read, then find.
const READING_ART = (() => {
  let keys = '';
  for (let i = 0; i < 8; i++) keys += `<rect x="${60 + i * 15}" y="70" width="15" height="26" class="ex-white"/>`;
  for (const i of [1, 2, 4, 5, 6]) keys += `<rect x="${60 + i * 15 - 4.5}" y="70" width="9" height="16" class="ex-black"/>`;
  return `<svg viewBox="0 0 240 100" aria-hidden="true" class="ex-art">${STAFF(10, 230, 10, 9)}${head(88, 37)}<line x1="93.2" x2="93.2" y1="37" y2="9" class="ex-stem"/>${head(124, 23)}<line x1="118.8" x2="118.8" y1="23" y2="51" class="ex-stem"/>${head(160, 50)}<line x1="153" x2="167" y1="55" y2="55" class="ex-ledger"/><line x1="165.2" x2="165.2" y1="50" y2="22" class="ex-stem"/><line x1="124" x2="124" y1="58" y2="68" class="ex-arrow"/>${keys}</svg>`;
})();

// A bar of rhythm on one line, and a short tune on a treble staff, engraved like the exercises themselves.
const RHYTHM_ART = (() => {
  const ev = (dur, extra = {}) => ({dur, ...extra});
  const {svg} = engrave({staff: 'line', time: [4, 4], measures: [[ev(1), ev(.5), ev(.5), ev(1.5), ev(.5)], [ev(1 / 3, {tuplet: 3}), ev(1 / 3, {tuplet: 3}), ev(1 / 3, {tuplet: 3}), ev(1), ev(2)]]});
  return svg.replace('<svg class="eg"', '<svg class="eg ex-art" aria-hidden="true"');
})();
const SIGHT_ART = (() => {
  const n = (dur, step, octave, alter = 0) => ({dur, pitches: [{step, alter, octave}]});
  const {svg} = engrave({staff: 'treble', key: 1, time: [3, 4], measures: [[n(1, 'D', 5), n(.5, 'B', 4), n(.5, 'C', 5), n(1, 'D', 5)], [n(1.5, 'G', 4), n(.5, 'A', 4), n(1, 'B', 4)], [n(3, 'G', 4)]]});
  return svg.replace('<svg class="eg"', '<svg class="eg ex-art" aria-hidden="true"');
})();
// The circle of fifths, quietly.
const THEORY_ART = (() => {
  const keys = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
  const cx = 120, cy = 50, R = 40;
  const labels = keys.map((k, i) => {
    const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return `<text x="${(cx + R * Math.cos(a)).toFixed(1)}" y="${(cy + R * Math.sin(a) + 3.5).toFixed(1)}" text-anchor="middle" class="ex-key${i === 0 ? ' on' : ''}">${k}</text>`;
  }).join('');
  return `<svg viewBox="0 0 240 100" aria-hidden="true" class="ex-art"><circle cx="${cx}" cy="${cy}" r="${R - 11}" class="ex-ring"/><circle cx="${cx}" cy="${cy}" r="${R + 9}" class="ex-ring"/>${labels}</svg>`;
})();
// Two notes heard, then named: a harmonic interval and a quiet arc of sound.
const EAR_ART = (() => {
  const n = (step, octave) => ({step, alter: 0, octave});
  const {svg} = engrave({staff: 'treble', clef: true, barlines: false, final: false, measures: [[{dur: 2, pitches: [n('C', 5)]}, {dur: 2, pitches: [n('C', 5), n('G', 5)]}]]});
  const arcs = [14, 22, 30].map(r => `<path d="M ${200 - r * .6} ${50 - r} A ${r} ${r} 0 0 1 ${200 - r * .6} ${50 + r}" class="ex-arc"/>`).join('');
  return `<svg viewBox="0 0 240 100" aria-hidden="true" class="ex-art"><g transform="translate(6 2) scale(.62)">${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>${arcs}</svg>`;
})();

export function mountExercises(container, {open} = {}) {
  const warm = dailyWarmup();
  const root = el('div', {class: 'exh'});
  const big = (href, kind, title, text, meta, art) => el('a', {class: 'exh-card', href},
    el('div', {class: 'exh-art'}), el('div', {class: 'exh-text'},
      el('p', {class: 'exh-kind', text: kind}),
      el('h2', {class: 'exh-title', text: title}),
      el('p', {class: 'exh-desc', text}),
      el('p', {class: 'exh-meta', text: meta})),
    el('span', {class: 'exh-go', 'aria-hidden': 'true', text: 'Open →'}));
  const tech = big('#/technique', 'Hands', 'Technique', 'Scales, arpeggios, five-finger patterns, chords and the chromatic scale — fingered, in any key.', `Today’s key: ${keyLabel(warm.key)} major`);
  const read = big('#/train/reading', 'Eyes', 'Note reading', 'A note appears on the staff; find it on the keys. From landmark notes to ledger lines.', 'Two minutes a day is plenty');
  const sight = big('#/exercises/sight-reading', 'Eyes and hands', 'Sight-reading', 'A new short piece at your level, every time. Read it once, then play it through in time.', 'Four to eight bars, never seen before');
  const rhythm = big('#/exercises/rhythm', 'Pulse', 'Rhythm', 'Read a line of rhythm and tap it on any key, after a bar of count-in.', 'From crotchets to triplets and 6/8');
  const theory = big('#/exercises/theory', 'Understanding', 'Theory', 'Short lessons with examples to hear: note values, keys, intervals, chords and cadences.', 'A few minutes each, with questions');
  const ear = big('#/exercises/ear', 'Ears', 'Ear training', 'Hear an interval, a chord or a cadence and name it — or play back a short melody.', 'Answer by playing or tapping');
  tech.querySelector('.exh-art').innerHTML = SCALE_ART;
  read.querySelector('.exh-art').innerHTML = READING_ART;
  sight.querySelector('.exh-art').innerHTML = SIGHT_ART;
  rhythm.querySelector('.exh-art').innerHTML = RHYTHM_ART;
  theory.querySelector('.exh-art').innerHTML = THEORY_ART;
  ear.querySelector('.exh-art').innerHTML = EAR_ART;
  root.append(
    el('p', {class: 'exh-lead', text: 'Everything that isn’t a piece. Short, regular and unhurried.'}),
    el('div', {class: 'exh-cards'}, tech, read, sight, rhythm, theory, ear),
  );
  const recent = readRecent().map(id => ({id, title: exerciseTitleFor(id)})).filter(r => r.title);
  if (recent.length) {
    root.append(el('section', {class: 'exh-recent', 'aria-labelledby': 'exh-recent-h'},
      el('h2', {class: 'exh-section-h', id: 'exh-recent-h', text: 'Recently practised'}),
      el('ol', {class: 'exh-recent-list', role: 'list'}, ...recent.map(r => el('li', {},
        el('button', {type: 'button', class: 'exh-recent-link', onclick: () => open?.(r.id)}, r.title))))));
  }
  container.append(root);
  return {destroy() { root.remove(); }};
}
