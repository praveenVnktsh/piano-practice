// Today (#/, #/today): the home. A greeting, the daily goal, and one clear sequence of three
// movements (warm-up → your piece → a short reading drill), plus the teacher's latest note.
// mountToday(container, {library, open}) → {destroy()}.
import './today.css';
import {el, ago} from '../app/dom.js';
import {playHref, navigate} from '../app/router.js';
import {CHANGE_EVENT, getProgress, startProgressTracking} from '../progress/store.js';
import {DEFAULT_GOAL_MIN, dayKey} from '../progress/model.js';
import {songStats, streaks, todayMinutes} from '../progress/stats.js';
import {dailyWarmup, isExerciseId} from '../exercises/index.js';
import {keyLabel} from '../exercises/theory.js';
import {levelById} from '../trainer/levels.js';

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

/** Saved practice section for a piece → "Bars 9 – 16" (measure indices are 0-based). */
function sectionText(entry) {
  const saved = lsJson('piano-practice:song:' + entry.id) || {};
  let [a, b] = Number.isInteger(saved.first) && Number.isInteger(saved.last) ? [saved.first, saved.last] : Array.isArray(entry.section) ? entry.section : [];
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  return a === b ? `Bar ${a + 1}` : `Bars ${a + 1} – ${b + 1}`;
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
  let destroyed = false, loaded = false, doc = null, entries = null, teacher = null, token = 0;
  const root = el('div', {class: 'td'});
  container.append(root);
  const go = id => (open ? open(id) : navigate(playHref(id)));

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
      const latest = replies.slice().sort((a, b) => (new Date(b.at) - new Date(a.at)) || (b.id - a.id))[0];
      teacher = latest?.text ? {text: snippet(latest.text), at: latest.at} : null;
    } catch { teacher = null; }
    if (!destroyed) render();
  }

  // ───── what to practise ─────
  function piece() {
    const all = entries ? [...entries.bundled, ...entries.local, ...entries.imports] : [];
    const byId = id => all.find(e => e.id === id);
    const stats = doc ? songStats(doc) : [];
    for (const s of stats) {
      const e = byId(s.id);
      if (e) return {entry: e, stat: s};
    }
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
      piece: id => evs.some(e => e.songId === id && e.type !== 'trainer:result'),
      reading: evs.some(e => e.type === 'trainer:result'),
    };
  }

  // ───── rendering ─────
  function card(i, {kind, title, music = false, titleClass = '', by, desc, meta, action, href, onAction, done, next}) {
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
      el('div', {class: 'td-card-foot'}, act));
  }

  function render() {
    if (destroyed || !loaded) return;
    const now = Date.now();
    const goal = doc?.settings?.dailyGoalMin || DEFAULT_GOAL_MIN;
    const mins = doc ? todayMinutes(doc, now) : 0;
    const streak = doc ? streaks(doc, {now}) : {current: 0, todayDone: false};
    const done = doneToday(now);
    const warm = dailyWarmup(new Date(now));
    const p = piece();
    const pieceDone = p ? done.piece(p.entry.id) : false;
    const flags = [done.warm, pieceDone, done.reading];
    const nextIdx = flags.indexOf(false);
    const reading = levelById((lsJson(READING_KEY) || {}).level || 'landmarks');

    const shownMin = mins > 0 && mins < 1 ? '<1' : String(Math.round(mins));
    const date = new Date(now).toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long'});
    const lead = nextIdx < 0 ? 'Everything for today is played. Well done — rest the hands, or keep going if you like.'
      : mins >= goal ? 'Today’s goal is met. Anything more is a gift.'
        : mins > 0 ? `${shownMin} minute${shownMin === '1' ? '' : 's'} so far. Carry on where you left off.`
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

    const cards = [
      card(0, {
        kind: 'Warm-up', title: `${keyLabel(warm.key)} major`, music: true,
        desc: 'Scale in two octaves, hands together — the key of the day, around the circle of fifths.',
        meta: 'About three minutes', action: done.warm ? 'Once more' : 'Begin the warm-up', onAction: () => go(warm.items[0].id),
        done: done.warm, next: nextIdx === 0,
      }),
      p ? card(1, {
        kind: p.suggestion ? 'A first piece' : 'Your piece', title: p.entry.title, titleClass: 'is-work', by: p.entry.composer,
        desc: p.suggestion ? 'A gentle place to begin: listen once, then play it with one hand.'
          : [sectionText(p.entry), p.stat?.lastAt ? `last practised ${ago(p.stat.lastAt, now)}` : null].filter(Boolean).join(' · ') || 'Pick up where you left off.',
        meta: p.stat?.best != null ? `Best so far ${Math.round(p.stat.best)}%` : null,
        action: pieceDone ? 'Play again' : 'Practise', onAction: () => go(p.entry.id), done: pieceDone, next: nextIdx === 1,
      }) : card(1, {kind: 'Your piece', title: 'Choose a piece', desc: 'Find something you love in the library.', action: 'Open Pieces', href: '#/pieces', next: nextIdx === 1}),
      card(2, {
        kind: 'Reading', title: 'Note reading',
        desc: 'Twenty notes on the staff, played on the keys — about two minutes.',
        meta: reading.name, action: done.reading ? 'Read again' : 'Start reading', href: '#/train/reading',
        done: done.reading, next: nextIdx === 2,
      }),
    ];

    const letter = teacher ? el('aside', {class: 'td-letter', 'aria-label': 'From your teacher'},
      el('p', {class: 'td-section-h', text: 'From your teacher'}),
      el('blockquote', {class: 'td-letter-text', text: teacher.text}),
      el('p', {class: 'td-letter-foot'},
        el('span', {text: teacher.at ? ago(new Date(teacher.at).getTime(), now) : ''}),
        el('button', {type: 'button', class: 'text-btn', onclick: openTeacher}, 'Read the letter'))) : null;

    root.replaceChildren(...[
      masthead,
      el('section', {class: 'td-plan', 'aria-labelledby': 'td-plan-h'},
        el('h2', {class: 'td-section-h', id: 'td-plan-h', text: 'Today’s practice'}),
        el('ol', {class: 'td-cards', role: 'list'}, cards)),
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
