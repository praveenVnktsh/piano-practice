// Technique builder (#/technique): pick an exercise type, key, mode, hands and octaves, then open
// the generated, fingered score in the player.  mountTechnique(container, {open}) → {destroy()}.
import './exercises.css';
import {MAJOR_KEYS, MINOR_KEYS, CHROMATIC_STARTS, parseKey, pitchClass, keyFifths, keyLabel, chordFromNumeral, pitchName} from './theory.js';
import {scaleFingering, arpeggioFingering, fiveFingerFingering, chromaticFinger} from './fingering.js';
import {exerciseId, exerciseTitleFor, resolveExercise, dailyWarmup, listPresets, PROGRESSIONS} from './index.js';

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
