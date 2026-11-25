// Progress sections for the learning path (docs/ROADMAP.md, Phases 3–4): letters from the
// teacher, "Your path" (the graded syllabus with ticks), goals with dates, and the practice
// journal. Each builder takes a context and returns a DOM node (or null when there's nothing
// to show). Used by ./view.js.
import {el} from '../app/dom.js';
import {renderMarkdown} from '../teacher/markdown.js';
import {exerciseName} from '../../teacher/actions.js';
import {levelById as readingLevel} from '../trainer/levels.js';
import {goalProgress, STATUS_LABEL} from './mastery.js';
import {dayKey, MAX_GOALS, MAX_JOURNAL_TEXT} from './model.js';
import {LEVELS} from '../curriculum/levels.js';

const dateOf = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const longDate = key => dateOf(key).toLocaleDateString(undefined, {day: 'numeric', month: 'long'});
const shortDate = at => new Date(at).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
const MOOD = {good: 'went well', okay: 'so-so', hard: 'hard going'};
const newId = () => { try { return crypto.randomUUID().replace(/-/g, ''); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); } };

const tick = done => el('span', {class: 'pg-tick' + (done ? ' is-done' : ''), 'aria-hidden': 'true'});
const head = (title, ...rest) => el('div', {class: 'pg-card-head'}, el('h3', {text: title}), ...rest);

// ───── Letters from your teacher ─────
/** ctx: {letters: [{id, at, text, readAt}], onRead(id)} */
export function lettersSection({letters, onRead}) {
  if (!letters?.length) return null;
  const sorted = letters.slice().sort((a, b) => b.id - a.id);
  const unread = sorted.filter(l => !l.readAt).length;
  return el('section', {class: 'pg-card pg-letters', id: 'letters', 'aria-label': 'Letters from your teacher'},
    head('Letters from your teacher', el('span', {class: 'pg-muted', text: unread ? `${unread} unread` : `${sorted.length} letter${sorted.length === 1 ? '' : 's'}`})),
    el('ol', {class: 'pg-letter-list', role: 'list'}, sorted.map(l => {
      const first = String(l.text).split('\n').find(line => line.trim())?.replace(/^#+\s*|[*_`]/g, '').trim() || 'A letter';
      const details = el('details', {class: 'pg-letter' + (l.readAt ? '' : ' is-unread')},
        el('summary', {},
          el('span', {class: 'pg-letter-date', text: shortDate(l.at)}),
          el('span', {class: 'pg-letter-title', text: first.length > 90 ? first.slice(0, 88) + '…' : first}),
          l.readAt ? null : el('span', {class: 'pg-letter-new', text: 'New'})),
        el('div', {class: 'pg-letter-body', html: renderMarkdown(l.text)}));
      details.addEventListener('toggle', () => { if (details.open && !l.readAt) { l.readAt = new Date().toISOString(); onRead?.(l.id); } });
      return el('li', {}, details);
    })));
}

// ───── Your path ─────
/** ctx: {path (curriculum()), open: id => void, expanded: Set<levelId>, toggle(id)} */
export function pathSection({path, expanded, toggle}) {
  if (!path) return null;
  const cur = path.current;
  const level = lp => {
    const isCur = lp === cur;
    const open = isCur || expanded.has(lp.level.id);
    const state = lp.done ? 'Complete' : lp.skipped ? 'Skipped' : isCur ? `${Math.round(lp.fraction * 100)}%` : '';
    const row = el('button', {type: 'button', class: 'pg-level-row', 'aria-expanded': String(open), disabled: isCur || null, onclick: () => toggle(lp.level.id)},
      tick(lp.done),
      el('span', {class: 'pg-level-name', text: lp.level.name}),
      el('span', {class: 'pg-leader', 'aria-hidden': 'true'}),
      el('span', {class: 'pg-level-state' + (isCur ? ' is-current' : ''), text: isCur && !lp.done ? `Now · ${state}` : state}));
    return el('li', {class: 'pg-level' + (isCur ? ' is-current' : '') + (lp.done ? ' is-done' : '')},
      row, open ? levelBody(lp) : null);
  };
  return el('section', {class: 'pg-card pg-path', 'aria-label': 'Your path'},
    head('Your path', el('span', {class: 'pg-muted', text: 'Beginner to Grade 5'})),
    el('p', {class: 'pg-path-lead'}, 'You are working on ', el('strong', {text: cur.level.name}), '. ', cur.level.blurb),
    el('ol', {class: 'pg-levels', role: 'list'}, path.levels.map(level)));
}

function levelBody(lp) {
  const pieces = lp.repertoire;
  const group = (title, note, items) => el('div', {class: 'pg-syl-group'},
    el('p', {class: 'pg-syl-h'}, title, note ? el('span', {class: 'pg-syl-note', text: note}) : null),
    el('ul', {class: 'pg-syl', role: 'list'}, items));
  const lessons = lp.lessons?.items || [];
  return el('div', {class: 'pg-level-body'},
    lessons.length ? group('First lessons', `${lessons.filter(l => l.done).length} of ${lessons.length}`,
      lessons.map(l => el('li', {},
        tick(l.done),
        el('a', {class: 'pg-syl-item', href: '#/exercises/lessons/' + l.id}, l.label),
        el('span', {class: 'pg-syl-status', text: l.best != null ? `best ${Math.round(l.best)}%` : ''})))) : null,
    group('Pieces', pieces.items.length ? `${pieces.have} of ${pieces.need} secure` : 'more pieces are coming to the library',
      pieces.items.map(p => el('li', {},
        tick(p.done),
        el('a', {class: 'pg-syl-work', href: '#/play/' + encodeURIComponent(p.id)}, el('em', {text: p.title})),
        el('span', {class: 'pg-syl-status', text: p.status ? STATUS_LABEL[p.status] : 'not started'})))),
    group('Technique', `${lp.technique.items.filter(t => t.done).length} of ${lp.technique.items.length}`,
      lp.technique.items.map(t => el('li', {},
        tick(t.done),
        el('a', {class: 'pg-syl-item', href: '#/play/' + encodeURIComponent(t.id), title: exerciseName(t.id)}, t.label),
        el('span', {class: 'pg-syl-status', text: t.best != null ? `best ${Math.round(t.best)}%` : ''})))),
    group('Reading', null,
      lp.reading.items.map(r => el('li', {},
        tick(r.done),
        el('a', {class: 'pg-syl-item', href: '#/train/reading'}, readingLevel(r.id).name),
        el('span', {class: 'pg-syl-status', text: r.best != null ? `best ${Math.round(r.best)}%` : ''})))));
}

/** The setting row: where the path starts. ctx: {start, onChange(id)} */
export function pathStartSetting({start, onChange}) {
  return el('div', {class: 'pg-setting'},
    el('p', {class: 'pg-setting-name', id: 'pg-path-l', text: 'Path starts at'}),
    el('select', {class: 'pg-select', 'aria-labelledby': 'pg-path-l', onchange: e => onChange(e.target.value)},
      LEVELS.map(l => el('option', {value: l.id, selected: l.id === start || null}, l.name))),
    el('p', {class: 'pg-setting-value', text: 'Skip levels you already play comfortably.'}));
}

// ───── Goals ─────
/** ctx: {doc, songs: [{id, title, tempo?}], adding, onAdd(goal), onRemove(id), setAdding(bool), now} */
export function goalsSection({doc, songs, adding, onAdd, onRemove, setAdding, now = Date.now()}) {
  const goals = doc.goals || [];
  const rows = goals.map(g => {
    const p = goalProgress(g, doc, {now});
    const note = p.met ? 'Reached. Well played.'
      : `${p.bestTempo ? `clean at ♩ = ${p.bestTempo}` : 'not yet played cleanly'} · ${p.overdue ? `was due ${longDate(g.by)}` : p.daysLeft === 0 ? 'due today' : `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left`}`;
    return el('li', {class: 'pg-goal' + (p.met ? ' is-met' : '') + (p.overdue ? ' is-overdue' : '')},
      el('p', {class: 'pg-goal-text'},
        el('em', {text: g.title || g.songId}), ` at ♩ = ${g.bpm} by ${longDate(g.by)}`),
      el('div', {class: 'pg-goal-bar', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': g.bpm, 'aria-valuenow': p.bestTempo || 0, 'aria-label': `Best clean tempo ${p.bestTempo || 0} of ${g.bpm}`},
        el('i', {style: `width:${Math.round(p.fraction * 100)}%`})),
      el('p', {class: 'pg-goal-foot'}, el('span', {text: note}),
        el('button', {type: 'button', class: 'pg-goal-del', 'aria-label': `Remove the goal for ${g.title || g.songId}`, onclick: () => onRemove(g.id)}, 'Remove')));
  });
  const form = adding ? goalForm({songs, onAdd, onCancel: () => setAdding(false), now}) : null;
  return el('section', {class: 'pg-card pg-goals', 'aria-label': 'Goals'},
    head('Goals', !adding && goals.length < MAX_GOALS ? el('button', {type: 'button', class: 'pg-link', onclick: () => setAdding(true)}, 'Add a goal') : null),
    rows.length ? el('ul', {class: 'pg-goal-list', role: 'list'}, rows)
      : adding ? null : el('p', {class: 'pg-empty', text: 'Set a goal with a date — “Für Elise at ♩ = 72 by 1 March” — and watch the line fill as your clean tempo rises.'}),
    form);
}

function goalForm({songs, onAdd, onCancel, now}) {
  const by = new Date(now + 42 * 864e5);
  const byKey = dayKey(by.getTime());
  const form = el('form', {class: 'pg-goal-form-add', onsubmit: e => {
    e.preventDefault();
    const f = e.target;
    const song = songs.find(s => s.id === f.song.value);
    const bpm = +f.bpm.value;
    if (!song || !(bpm >= 20 && bpm <= 300) || !f.by.value) return;
    onAdd({id: newId(), songId: song.id, title: song.title, bpm: Math.round(bpm), accuracy: 90, by: f.by.value, createdAt: Date.now()});
  }},
  el('label', {class: 'pg-field'}, el('span', {text: 'Piece'}),
    el('select', {name: 'song', class: 'pg-select', required: true, onchange: e => { const s = songs.find(x => x.id === e.target.value); if (s?.tempo) form.bpm.value = s.tempo; }},
      songs.map(s => el('option', {value: s.id}, s.title)))),
  el('label', {class: 'pg-field'}, el('span', {text: '♩ ='}),
    el('input', {name: 'bpm', type: 'number', min: 20, max: 300, step: 1, value: songs[0]?.tempo || 72, class: 'pg-input', required: true})),
  el('label', {class: 'pg-field'}, el('span', {text: 'by'}),
    el('input', {name: 'by', type: 'date', min: dayKey(now), value: byKey, class: 'pg-input pg-date', required: true})),
  el('div', {class: 'pg-goal-actions'},
    el('button', {type: 'submit', class: 'text-btn', text: 'Save goal'}),
    el('button', {type: 'button', class: 'text-btn', text: 'Cancel', onclick: onCancel})));
  return form;
}

// ───── Practice journal ─────
/** ctx: {journal: [entry], onAdd(text)} */
export function journalSection({journal, onAdd}) {
  const recent = (journal || []).slice(-8).reverse();
  const form = el('form', {class: 'pg-journal-form', onsubmit: e => {
    e.preventDefault();
    const text = e.target.note.value.trim();
    if (text) { onAdd(text); e.target.reset(); }
  }},
  el('input', {name: 'note', class: 'pg-journal-input', maxlength: MAX_JOURNAL_TEXT, autocomplete: 'off', placeholder: 'A line about today’s practice', 'aria-label': 'Journal note'}),
  el('button', {type: 'submit', class: 'text-btn', text: 'Add'}));
  return el('section', {class: 'pg-card pg-journal', 'aria-label': 'Practice journal'},
    head('Journal', el('span', {class: 'pg-muted', text: 'your teacher reads it too'})),
    recent.length ? el('ol', {class: 'pg-journal-list', role: 'list'}, recent.map(e => el('li', {},
      el('p', {class: 'pg-journal-meta'},
        el('span', {text: shortDate(e.at)}),
        e.title ? el('em', {text: e.title}) : null,
        e.mood ? el('span', {class: 'pg-mood is-' + e.mood, text: MOOD[e.mood]}) : null),
      e.text ? el('p', {class: 'pg-journal-text', text: e.text}) : null)))
      : el('p', {class: 'pg-empty', text: 'After you practise, a line about how it went lands here.'}),
    form);
}
