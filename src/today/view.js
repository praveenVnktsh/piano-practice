// Today (#/, #/today): the home. A greeting, the daily goal, and one clear sequence of three
// movements (warm-up → your piece → a short reading drill), plus anything the teacher assigned
// and the teacher's latest note. The movements follow the graded path (src/curriculum/):
// the warm-up is the next technique requirement — or, for a Beginner who hasn't finished the
// first lessons (src/lessons/), the next lesson — the reading drill the next reading level, and
// polished pieces due for review (src/progress/mastery.js) are offered beside your piece.
// mountToday(container, {library, open}) → {destroy()}.
import './today.css';
import {el, ago} from '../app/dom.js';
import {playHref, navigate} from '../app/router.js';
import {CHANGE_EVENT, getProgress, startProgressTracking} from '../progress/store.js';
import {DEFAULT_GOAL_MIN, dayKey, isSkillLevel} from '../progress/model.js';
import {songStats, streaks, todayMinutes} from '../progress/stats.js';
import {dailyWarmup, isExerciseId} from '../exercises/index.js';
import {keyLabel} from '../exercises/theory.js';
import {levelById} from '../trainer/levels.js';
import {dueReviews, pieceMastery, STATUS_LABEL} from '../progress/mastery.js';
import {curriculum} from '../curriculum/levels.js';
import {lessonById, LESSONS} from '../lessons/lessons.js';
import {describeAction} from '../../teacher/actions.js';

const LAST_KEY = 'piano-practice.last-song';
const READING_KEY = 'trainer:reading:settings';
const ROMAN = ['I', 'II', 'III'];
const NUMBER_WORDS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

const lsJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsText = k => { try { return localStorage.getItem(k); } catch { return null; } };

/** "E♭ major" → ['E', <span class="acc">♭</span>, ' major']: accidentals set in a font that has them. */
function withAccidentals(text) {
  return String(text).split(/([♯♭♮])/).filter(Boolean).map(t => (/[♯♭♮]/.test(t) ? el('span', {class: 'acc', text: t}) : t));
}

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 4 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Pieces whose first measure is a pickup (anacrusis): measure index 0 is the pickup and index i
// is bar i, so "index + 1" would be one bar too many. Found from the score's first measure
// (MusicXML implicit="yes" / number="0", MEI metcon="false"), cached per file.
const pickupCache = new Map();
export function scoreHasPickup(text) {
  const head = String(text || '').slice(0, 200000);
  const m = /<measure\b[^>]*>/.exec(head);
  if (!m) return false;
  return /\bimplicit="yes"/.test(m[0]) || /\bnumber="0"/.test(m[0]) || /\bmetcon="false"/.test(m[0]);
}
function pickupOf(entry) {
  if (!entry?.file) return Promise.resolve(false);
  if (!pickupCache.has(entry.file)) {
    const base = (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');
    pickupCache.set(entry.file, fetch(base + entry.file).then(r => (r.ok ? r.text() : '')).then(scoreHasPickup).catch(() => false));
  }
  return pickupCache.get(entry.file);
}

/** 0-based measure range → the player's wording: "Bars 9–16", "Bar 4", "Pickup – bar 4". */
export function barsText(a, b, {pickup = false} = {}) {
  const label = i => String(pickup ? i : i + 1);
  if (pickup && a === 0) return b === 0 ? 'Pickup' : `Pickup – bar ${label(b)}`;
  return a === b ? `Bar ${label(a)}` : `Bars ${label(a)}–${label(b)}`;
}

/** Saved practice section for a piece → "Bars 9–16" (measure indices are 0-based). */
function sectionText(entry, pickup) {
  const live = (() => { try { return window.pianoPlayer?.getState?.(); } catch { return null; } })();
  const saved = lsJson('piano-practice:song:' + entry.id) || {};
  let [a, b] = Number.isInteger(saved.first) && Number.isInteger(saved.last) ? [saved.first, saved.last] : Array.isArray(entry.section) ? entry.section : [];
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  // The player has this piece open on the same section: use its own label.
  if (live?.songId === entry.id && live.sectionLabel && live.section?.[0] === a && live.section?.[1] === b) return live.sectionLabel;
  return barsText(a, b, {pickup});
}

/** Plain-text snippet from a teacher reply written in Markdown. */
function snippet(md, max = 220) {
  const text = String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~[\]]/g, '').replace(/\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[,;:.\s]+$/, '') + '…';
}

function ring(mins, goal) {
  const R = 52, C = 2 * Math.PI * R, frac = Math.min(1, mins / goal);
  const ticks = Array.from({length: 12}, (_, i) => {
    const a = (i / 12) * 2 * Math.PI;
    const x1 = 60 + 57 * Math.sin(a), y1 = 60 - 57 * Math.cos(a), x2 = 60 + 60 * Math.sin(a), y2 = 60 - 60 * Math.cos(a);
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }).join('');
  return `<svg viewBox="-2 -2 124 124" class="td-ring-svg" aria-hidden="true">
    <g class="td-ring-ticks">${ticks}</g>
    <circle cx="60" cy="60" r="${R}" class="td-ring-track"/>
    ${frac > 0 ? `<circle cx="60" cy="60" r="${R}" class="td-ring-arc${frac >= 1 ? ' done' : ''}" stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 60 60)"/>` : ''}
  </svg>`;
}

export function mountToday(container, {library, open} = {}) {
  startProgressTracking();
  let destroyed = false, loaded = false, doc = null, entries = null, teacher = null, assignments = [], token = 0;
  const pickups = new Map(); // entry id → has a pickup bar (resolved asynchronously)
  const notes = new Map();   // assignment id → short message after running its action
  const root = el('div', {class: 'td'});
  container.append(root);
  const go = id => (open ? open(id) : navigate(playHref(id)));
  const allEntries = () => (entries ? [...entries.bundled, ...entries.local, ...entries.imports] : []);
  const byId = id => allEntries().find(e => e.id === id);

  async function refresh() {
    const mine = ++token;
    const [d, lib] = await Promise.all([getProgress().catch(() => null), library?.ready.catch(() => null)]);
    if (destroyed || mine !== token) return;
    doc = d; entries = lib; loaded = true;
    render();
  }

  async function loadTeacher() {
    try {
      const res = await fetch('/__teacher', {cache: 'no-store'});
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw Error('no teacher');
      const data = await res.json();
      const replies = Array.isArray(data?.replies) ? data.replies : [];
      const letters = Array.isArray(data?.letters) ? data.letters : [];
      const unread = letters.filter(l => !l.readAt).sort((a, b) => b.id - a.id)[0];
      const latest = replies.slice().sort((a, b) => (new Date(b.at) - new Date(a.at)) || (b.id - a.id))[0];
      teacher = unread?.text ? {text: snippet(unread.text), at: unread.at, letter: true}
        : latest?.text ? {text: snippet(latest.text), at: latest.at} : null;
      assignments = (Array.isArray(data?.assignments) ? data.assignments : []).filter(a => a && !a.done);
    } catch { teacher = null; assignments = []; }
    if (!destroyed) render();
  }

  const targets = () => Object.fromEntries(allEntries().filter(e => e.tempo).map(e => [e.id, e.tempo]));

  // ───── what to practise ─────
  function piece(path) {
    const all = allEntries();
    const stats = doc ? songStats(doc) : [];
    const t = targets();
    // The most recent piece still being learnt (not yet polished).
    for (const s of stats) {
      const e = byId(s.id);
      if (!e) continue;
      const m = pieceMastery(doc, s.id, {target: t[s.id]});
      if (!['polished', 'maintained'].includes(m.status)) return {entry: e, stat: s, mastery: m};
    }
    // Everything practised is polished: the next piece on the path, else the latest piece.
    const pathPiece = path?.next.piece && byId(path.next.piece.id);
    if (pathPiece) return {entry: pathPiece, stat: null, path: true};
    for (const s of stats) { const e = byId(s.id); if (e) return {entry: e, stat: s, mastery: pieceMastery(doc, s.id, {target: t[s.id]})}; }
    const last = lsText(LAST_KEY);
    if (last && !isExerciseId(last) && byId(last)) return {entry: byId(last), stat: null};
    const first = all.find(e => e.difficulty === 'beginner') || all[0];
    return first ? {entry: first, stat: null, suggestion: true} : null;
  }

  function doneToday(now) {
    const today = dayKey(now);
    const evs = (doc?.events || []).filter(e => dayKey(e.at, e.tz) === today);
    return {
      warm: evs.some(e => isExerciseId(e.songId)),
      exercise: id => evs.some(e => e.songId === id),
      piece: id => evs.some(e => e.songId === id && e.type !== 'trainer:result'),
      // Only note-reading drills count here; rhythm / theory / ear rounds and lessons use prefixed levels.
      reading: evs.some(e => e.type === 'trainer:result' && !isSkillLevel(String(e.level || ''))),
      lesson: evs.some(e => e.type === 'trainer:result' && String(e.level || '').startsWith('lesson:')),
    };
  }

  function sectionFor(entry) {
    if (!pickups.has(entry.id)) {
      pickups.set(entry.id, false);
      pickupOf(entry).then(has => { if (has && !destroyed) { pickups.set(entry.id, true); render(); } });
    }
    return sectionText(entry, pickups.get(entry.id));
  }

  // ───── rendering ─────
  function card(i, {kind, title, music = false, titleClass = '', by, desc, meta, action, href, onAction, done, next, extra}) {
    const btnClass = next ? 'btn-primary' : 'text-btn';
    const act = href
      ? el('a', {class: `td-action ${btnClass}`, href}, action)
      : el('button', {type: 'button', class: `td-action ${btnClass}`, onclick: onAction}, action);
    return el('li', {class: 'td-card' + (next ? ' is-next' : '') + (done ? ' is-done' : '')},
      el('div', {class: 'td-card-head'},
        el('span', {class: 'td-num', 'aria-hidden': 'true', text: ROMAN[i]}),
        el('p', {class: 'td-kind', text: kind}),
        done ? el('span', {class: 'td-done', text: 'Done today'}) : null),
      el('h3', {class: 'td-title ' + titleClass}, ...(music ? withAccidentals(title) : [title])),
      by ? el('p', {class: 'td-by', text: by}) : null,
      el('p', {class: 'td-desc', text: desc}),
      meta ? el('p', {class: 'td-meta', text: meta}) : null,
      extra || null,
      el('div', {class: 'td-card-foot'}, act));
  }

  // A Beginner's first movement: the next of the first lessons, until they are all passed.
  function lessonCard(step, path, done, nextIdx) {
    const lesson = lessonById(step.id);
    const n = LESSONS.findIndex(l => l.id === step.id) + 1;
    return card(0, {
      kind: `First lessons · ${path.current.level.short}`, title: step.label,
      desc: `${lesson?.blurb || ''} A few minutes, checked as you play.`.trim(),
      meta: step.best != null ? `Lesson ${n} of ${LESSONS.length} · best so far ${Math.round(step.best)}%` : `Lesson ${n} of ${LESSONS.length}`,
      action: done.lesson ? 'Next lesson' : 'Begin the lesson', href: '#/exercises/lessons/' + step.id,
      done: done.lesson, next: nextIdx === 0,
    });
  }

  function warmupCard(path, done, nextIdx, now) {
    if (path?.next.lesson) return lessonCard(path.next.lesson, path, done, nextIdx);
    const step = path?.next.technique;
    if (step) {
      return card(0, {
        kind: `Warm-up · ${path.current.level.short}`, title: step.label.replace(/,.*$/, ''), music: true,
        desc: `${step.label.includes(',') ? step.label.slice(step.label.indexOf(',') + 2).replace(/^./, c => c.toUpperCase()) + '. ' : ''}Next on your path: one clean pass (90 %) ticks it off.`,
        meta: step.best != null ? `Best so far ${Math.round(step.best)}%` : 'About three minutes',
        // A clean pass moves the path on: the card then offers the next step, not "once more".
        action: !done.warm ? 'Begin the warm-up' : done.exercise(step.id) ? 'Once more' : 'Next step',
        onAction: () => go(step.id), done: done.warm, next: nextIdx === 0,
      });
    }
    const warm = dailyWarmup(new Date(now));
    return card(0, {
      kind: 'Warm-up', title: `${keyLabel(warm.key)} major`, music: true,
      desc: 'Scale in two octaves, hands together — the key of the day, around the circle of fifths.',
      meta: 'About three minutes', action: done.warm ? 'Once more' : 'Begin the warm-up', onAction: () => go(warm.items[0].id),
      done: done.warm, next: nextIdx === 0,
    });
  }

  function pieceCard(p, review, pieceDone, nextIdx, now) {
    if (!p) return card(1, {kind: 'Your piece', title: 'Choose a piece', desc: 'Find something you love in the library.', action: 'Open Pieces', href: '#/pieces', next: nextIdx === 1});
    const m = p.mastery;
    const status = m?.status ? STATUS_LABEL[m.status] : null;
    const tempoNote = m?.bestCleanTempo && m.target ? `♩ = ${m.bestCleanTempo} of ${m.target}` : null;
    const best = p.stat?.best != null ? `best so far ${Math.round(p.stat.best)}%` : null;
    const extra = review ? el('p', {class: 'td-also'}, 'Due for review: ',
      el('button', {type: 'button', class: 'text-btn inline', onclick: () => go(review.songId)}, review.title), ' — one calm play-through.') : null;
    return card(1, {
      kind: p.suggestion ? 'A first piece' : p.path ? 'Next on your path' : 'Your piece', title: p.entry.title, titleClass: 'is-work', by: p.entry.composer,
      desc: p.suggestion ? 'A gentle place to begin: listen once, then play it with one hand.'
        : p.path ? 'Listen once, then learn the first bars hands separately.'
          : [sectionFor(p.entry), p.stat?.lastAt ? `last practised ${ago(p.stat.lastAt, now)}` : null].filter(Boolean).join(' · ') || 'Pick up where you left off.',
      meta: [status, tempoNote || best].filter(Boolean).join(' · ').replace(/^./, c => c.toUpperCase()) || null,
      action: pieceDone ? 'Play again' : 'Practise', onAction: () => go(p.entry.id), done: pieceDone, next: nextIdx === 1, extra,
    });
  }

  function readingCard(path, done, nextIdx) {
    const step = path?.next.reading;
    const saved = (lsJson(READING_KEY) || {}).level || 'landmarks';
    const level = levelById(step ? step.id : saved);
    const openReading = () => {
      if (step) {
        try { localStorage.setItem(READING_KEY, JSON.stringify({...(lsJson(READING_KEY) || {}), level: step.id})); } catch {}
      }
      navigate('#/train/reading');
    };
    return card(2, {
      kind: step ? `Reading · ${path.current.level.short}` : 'Reading', title: 'Note reading',
      desc: 'Twenty notes on the staff, played on the keys — about two minutes.',
      meta: step ? `${level.name} · next on your path` : level.name,
      action: done.reading ? 'Read again' : 'Start reading', onAction: openReading,
      done: done.reading, next: nextIdx === 2,
    });
  }

  function assignedList(now) {
    if (!assignments.length) return null;
    const today = dayKey(now);
    const titleOf = id => byId(id)?.title || '';
    const sorted = assignments.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.id - b.id);
    return el('section', {class: 'td-assigned', 'aria-labelledby': 'td-assigned-h'},
      el('h2', {class: 'td-section-h', id: 'td-assigned-h', text: 'Assigned by your teacher'}),
      el('ul', {class: 'td-assign-list', role: 'list'}, sorted.map(a => {
        const due = a.due ? dueText(a.due, today) : null;
        const note = notes.get(a.id);
        return el('li', {class: 'td-assign'},
          el('button', {type: 'button', class: 'td-tick', 'aria-label': `Mark done: ${a.task}`, title: 'Mark done', onclick: () => markDone(a)}),
          el('div', {class: 'td-assign-main'},
            el('p', {class: 'td-assign-task', text: a.task}),
            el('p', {class: 'td-assign-meta'},
              due ? el('span', {class: due.overdue ? 'is-overdue' : '', text: due.text}) : null,
              a.action ? el('button', {type: 'button', class: 'text-btn inline', onclick: () => runAssignment(a)}, describeAction(a.action, titleOf)) : null,
              note ? el('span', {class: 'td-assign-note', text: note}) : null)));
      })));
  }

  function dueText(due, today) {
    const [y, m, d] = due.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = Math.round((Date.parse(due) - Date.parse(today)) / 864e5);
    const words = days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : days < 0 ? `was due ${date.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'})}`
      : `due ${date.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'})}`;
    return {text: words, overdue: days < 0};
  }

  async function markDone(a) {
    assignments = assignments.filter(x => x.id !== a.id);
    render();
    try {
      const res = await fetch(`/__teacher/assignments/${a.id}/done`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{"done":true}'});
      if (!res.ok) throw Error(res.status);
    } catch { loadTeacher(); }
  }

  async function runAssignment(a) {
    try {
      const {runAction} = await import('../teacher/run.js');
      notes.set(a.id, await runAction(a.action, {knownSong: id => !!byId(id)}));
    } catch (e) { notes.set(a.id, e.message); }
    render();
  }

  function render() {
    if (destroyed || !loaded) return;
    const now = Date.now();
    const goal = doc?.settings?.dailyGoalMin || DEFAULT_GOAL_MIN;
    const mins = doc ? todayMinutes(doc, now) : 0;
    const streak = doc ? streaks(doc, {now}) : {current: 0, todayDone: false};
    const done = doneToday(now);
    let path = null;
    try { path = curriculum(doc, {library: entries, targets: targets(), now}); } catch (e) { console.warn('Path unavailable:', e); }
    const p = piece(path);
    const review = doc ? dueReviews(doc, {targets: targets(), now}).find(r => r.songId !== p?.entry.id && byId(r.songId)) : null;
    const pieceDone = p ? done.piece(p.entry.id) : false;
    const lessonFirst = !!path?.next.lesson;
    const flags = [lessonFirst ? done.lesson : done.warm, pieceDone, done.reading];
    const nextIdx = flags.indexOf(false);

    const shownMin = mins > 0 && mins < 1 ? '<1' : String(Math.round(mins));
    const date = new Date(now).toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long'});
    const lead = nextIdx < 0 ? 'Everything for today is played. Well done — rest the hands, or keep going if you like.'
      : mins >= goal ? 'Today’s goal is met. Anything more is a gift.'
        : mins > 0 ? `${shownMin} minute${shownMin === '1' ? '' : 's'} so far. Carry on where you left off.`
          : lessonFirst ? 'Three short movements: a first lesson, a little tune, and some reading.'
            : 'Three short movements: a warm-up, your piece, and a little reading.';
    const streakText = streak.current > 1 ? `${NUMBER_WORDS[streak.current] ? NUMBER_WORDS[streak.current] + ' day' : `Day ${streak.current}`} in a row`
      : streak.current === 1 ? (streak.todayDone ? 'First day of a new streak' : 'Practise today to keep your streak') : 'Begin a streak today';

    const masthead = el('header', {class: 'td-mast'},
      el('div', {class: 'td-hello'},
        el('p', {class: 'td-date', text: date}),
        el('h1', {class: 'td-greet', text: greeting(new Date(now)) + '.'}),
        el('p', {class: 'td-lead', text: lead})),
      el('a', {class: 'td-goal', href: '#/progress', 'aria-label': `Today: ${shownMin} of ${goal} minutes. ${streakText}. See your progress.`},
        el('div', {class: 'td-ring', html: ring(mins, goal)},
          el('div', {class: 'td-ring-label'}, el('strong', {text: shownMin}), el('span', {text: `of ${goal} min`}))),
        el('p', {class: 'td-streak', text: streakText})));

    const cards = [warmupCard(path, done, nextIdx, now), pieceCard(p, review, pieceDone, nextIdx, now), readingCard(path, done, nextIdx)];

    const letter = teacher ? el('aside', {class: 'td-letter', 'aria-label': 'From your teacher'},
      el('p', {class: 'td-section-h', text: teacher.letter ? 'A letter from your teacher' : 'From your teacher'}),
      el('blockquote', {class: 'td-letter-text', text: teacher.text}),
      el('p', {class: 'td-letter-foot'},
        el('span', {text: teacher.at ? ago(new Date(teacher.at).getTime(), now) : ''}),
        teacher.letter ? el('a', {class: 'text-btn', href: '#/progress'}, 'Read the letter')
          : el('button', {type: 'button', class: 'text-btn', onclick: openTeacher}, 'Read the letter'))) : null;

    root.replaceChildren(...[
      masthead,
      el('section', {class: 'td-plan', 'aria-labelledby': 'td-plan-h'},
        el('h2', {class: 'td-section-h', id: 'td-plan-h', text: 'Today’s practice'}),
        el('ol', {class: 'td-cards', role: 'list'}, cards)),
      assignedList(now),
      letter,
      el('p', {class: 'td-coda'}, 'Most days, this is all you need. More in ', el('a', {href: '#/pieces', text: 'Pieces'}), ' and ', el('a', {href: '#/exercises', text: 'Exercises'}), '.'),
    ].filter(Boolean));
  }

  function openTeacher() {
    import('../teacher/index.js').then(m => m.mountTeacher(document.body).open())
      .catch(() => document.querySelector('.tch-fab')?.click());
  }

  const onFocus = () => { if (document.visibilityState === 'visible') { refresh(); loadTeacher(); } };
  window.addEventListener(CHANGE_EVENT, refresh);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  refresh();
  loadTeacher();

  return {
    destroy() {
      destroyed = true;
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      root.remove();
    },
  };
}
