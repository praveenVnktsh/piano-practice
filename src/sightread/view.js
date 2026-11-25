// Sight-reading (#/exercises/sight-reading): choose a level, then read a new piece in the player
// (Play along, a bar of count-in). mountSightReading(container, {open: id => void}) → {destroy()}.
import './sightread.css';
import {SR_LEVELS, srLevelById, sightReadingId, sightReadingTitle, parseSightReadingId} from './index.js';
import {getProgress} from '../progress/store.js';
import {keyLabel} from '../exercises/theory.js';

const STORE_KEY = 'piano-practice.sight-reading';
const LH = {roots: 'one long note a bar', fifths: 'a held fifth', walk: 'root, then fifth', broken: 'broken chords', alberti: 'Alberti bass in quavers'};
const TIPS = [
  ['Before you play', 'Look at the key and time signatures, find the first note of each hand, and spot anything unusual: accidentals, leaps, a change of rhythm.'],
  ['Count yourself in', 'The player counts one bar. Choose a tempo you can keep all the way through.'],
  ['Keep going', 'Don’t stop to fix a wrong note. Keeping the pulse matters more than every pitch.'],
];

const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } };
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
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

/** "C, G, F major · A minor" */
export function keysText(level) {
  const major = level.keys.filter(k => k[1] === 'major').map(k => keyLabel(k[0]));
  const minor = level.keys.filter(k => k[1] === 'minor').map(k => keyLabel(k[0]));
  return [major.length ? `${major.join(', ')} major` : '', minor.length ? `${minor.join(', ')} minor` : ''].filter(Boolean).join(' · ');
}

export function mountSightReading(container, {open} = {}) {
  const state = {level: null, recent: [], ...load()};
  let destroyed = false;
  const best = {};
  const root = el('div', {class: 'sr'});
  container.append(root);

  function start() {
    const id = sightReadingId(state.level);
    state.recent = [id, ...(state.recent || []).filter(r => r !== id)].slice(0, 6);
    save(state);
    open?.(id);
  }

  function render() {
    const level = srLevelById(state.level) || SR_LEVELS[0];
    const facts = [
      ['Keys', keysText(level)],
      ['Time', level.times.map(t => t.join('/')).join(' · ')],
      ['Length', `${level.bars} bars`],
      ['Left hand', LH[level.lh]],
      ['Tempo', `♩ = ${level.tempo}`],
    ];
    const recent = (state.recent || []).map(id => ({id, title: sightReadingTitle(id), level: srLevelById(parseSightReadingId(id)?.level)})).filter(r => r.title);
    root.replaceChildren(
      el('p', {class: 'sr-lead', text: 'A short piece you have never seen, written for your level. Read it once, then play it through in time.'}),
      el('section', {class: 'sr-card', 'aria-labelledby': 'sr-level-h'},
        el('p', {class: 'label-caps sr-label', id: 'sr-level-h', text: 'Level'}),
        el('div', {class: 'sr-levels', role: 'radiogroup', 'aria-labelledby': 'sr-level-h'}, SR_LEVELS.map(l => el('button', {
          type: 'button', role: 'radio', class: 'sr-level', 'aria-checked': String(l.id === level.id), 'data-level': l.id,
          onclick: () => { state.level = l.id; save(state); render(); root.querySelector(`[data-level="${l.id}"]`)?.focus({preventScroll: true}); },
        }, l.short))),
        el('div', {class: 'sr-about'},
          el('div', {class: 'sr-about-text'},
            el('h2', {class: 'sr-title', text: level.name}),
            el('p', {class: 'sr-blurb', text: level.blurb})),
          el('dl', {class: 'sr-facts'}, facts.flatMap(([k, v]) => [el('dt', {class: 'label-caps', text: k}), el('dd', {text: v})]))),
        el('div', {class: 'sr-go'},
          el('button', {type: 'button', class: 'btn-primary sr-start', onclick: start}, 'Read a new piece'),
          el('p', {class: 'sr-note', text: 'Opens in Play along with a bar of count-in.'}))),
      el('section', {class: 'sr-tips', 'aria-label': 'How to sight-read'},
        TIPS.map(([h, t], i) => el('div', {class: 'sr-tip'}, el('span', {class: 'sr-tip-n', text: String(i + 1)}), el('div', {}, el('h3', {text: h}), el('p', {text: t}))))),
      recent.length ? el('section', {class: 'sr-recent', 'aria-labelledby': 'sr-recent-h'},
        el('h2', {class: 'exh-section-h sr-section-h', id: 'sr-recent-h', text: 'Recently read'}),
        el('ol', {class: 'sr-recent-list', role: 'list'}, recent.map(r => el('li', {},
          el('button', {type: 'button', class: 'sr-recent-link', onclick: () => open?.(r.id)},
            el('span', {class: 'sr-recent-title', text: r.title}),
            el('span', {class: 'sr-recent-meta', text: [r.level?.short, best[r.id] != null ? `best ${Math.round(best[r.id])}%` : 'not played yet'].filter(Boolean).join(' · ')})))))) : null,
    );
  }

  // Default level: the one chosen last, else the current level of the graded path.
  const chosen = !!srLevelById(state.level);
  if (!chosen) state.level = SR_LEVELS[0].id;
  render();
  (async () => {
    let doc = null;
    try { doc = await getProgress(); } catch {}
    if (destroyed) return;
    for (const [id, s] of Object.entries(doc?.totals?.songs || {})) if (id.startsWith('sr:') && s.best != null) best[id] = s.best;
    if (!chosen && !srLevelById(load().level)) {
      try {
        const {curriculum} = await import('../curriculum/levels.js');
        const pathLevel = curriculum(doc, {}).current?.level?.id;
        if (srLevelById(pathLevel)) state.level = pathLevel;
      } catch {}
    }
    if (!destroyed) render();
  })();

  return {destroy() { destroyed = true; root.remove(); }};
}
