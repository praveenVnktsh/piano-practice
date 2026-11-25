// Progress dashboard (#/progress): today vs goal, streak, letters from the teacher, the graded
// path, goals, the practice journal, recent practice, songs (with repertoire status),
// technique keys and note-reading trend. mountProgress(container) → {destroy()}.
import './progress.css';
import {CHANGE_EVENT, addJournalEntry, getProgress, progressWhere, saveGoals, saveSettings, startProgressTracking} from './store.js';
import {goalsSection, journalSection, lettersSection, pathSection, pathStartSetting} from './learning.js';
import {pieceMastery, STATUS_LABEL} from './mastery.js';
import {curriculum} from '../curriculum/levels.js';
import {loadCatalogs} from '../app/catalog.js';
import {mountBackupControls} from '../pwa/backup.js';
import {MAC_ONLY, onMac} from '../app/mac.js';
import {mountRecordingsSection} from '../record/section.js';
import {getTheme, setTheme, THEMES, THEME_EVENT} from '../app/theme.js';
import {DEFAULT_GOAL_MIN} from './model.js';
import {openHelp} from '../help/index.js';
import {openOnboarding} from '../onboarding/index.js';
import {addDays, dayKey, keyStats, lastDays, minutesByDay, readingSummary, readingTrend, songStats, streaks, exerciseStats, skillSummary, STREAK_MIN_MINUTES} from './stats.js';
import {LESSONS} from '../lessons/lessons.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // only ever built from numbers and esc()'d text
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

const fmtMin = m => (m < 1 && m > 0 ? '<1' : String(Math.round(m)));
const fmtDuration = m => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${fmtMin(m)} min`);
const pct = v => (v == null ? '–' : `${Math.round(v)}%`);
const dateOf = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const weekday = key => dateOf(key).toLocaleDateString(undefined, {weekday: 'narrow'});
const longDay = key => dateOf(key).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});

function ago(at, now) {
  if (!at) return 'never';
  const today = dayKey(now), day = dayKey(at);
  if (day === today) return 'today';
  if (day === addDays(today, -1)) return 'yesterday';
  const days = Math.round((dateOf(today) - dateOf(day)) / 864e5);
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

// Circle of fifths: majors outside, relative minors inside; values are pitch classes.
const FIFTHS_MAJOR = [[0, 'C'], [7, 'G'], [2, 'D'], [9, 'A'], [4, 'E'], [11, 'B'], [6, 'F♯'], [1, 'D♭'], [8, 'A♭'], [3, 'E♭'], [10, 'B♭'], [5, 'F']];
const FIFTHS_MINOR = [[9, 'Am'], [4, 'Em'], [11, 'Bm'], [6, 'F♯m'], [1, 'C♯m'], [8, 'G♯m'], [3, 'E♭m'], [10, 'B♭m'], [5, 'Fm'], [0, 'Cm'], [7, 'Gm'], [2, 'Dm']];

export function mountProgress(container) {
  startProgressTracking();
  let destroyed = false, doc = null, where = 'browser', editingGoal = false, renderToken = 0;
  let library = [], letters = [], addingGoal = false;
  const expanded = new Set();
  // Export / import of all data (src/pwa/backup.js): mounted once, moved into Settings on each render.
  const backupHost = el('div', {class: 'pg-backup'});
  const bk = mountBackupControls(backupHost);
  // Recordings (src/record/section.js): mounted once, placed on each render like the backup controls.
  const recHost = el('div', {class: 'pg-recordings'});
  const recs = mountRecordingsSection(recHost);
  const root = el('div', {class: 'pg'});
  container.replaceChildren(root);

  async function refresh() {
    const token = ++renderToken;
    try {
      const [d, w, lib, tl] = await Promise.all([getProgress(), progressWhere(), loadLibrary(), loadLetters()]);
      if (destroyed || token !== renderToken) return;
      doc = d; where = w; library = lib; letters = tl;
    } catch (e) {
      console.warn('Progress unavailable:', e);
      if (!doc) doc = null;
    }
    render();
  }

  let libraryPromise = null;
  function loadLibrary() {
    return (libraryPromise ||= loadCatalogs().then(c => [...c.bundled, ...c.local]).catch(() => { libraryPromise = null; return []; }));
  }
  async function loadLetters() {
    if (!onMac()) return [];
    try {
      const res = await fetch('/__teacher', {cache: 'no-store'});
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return [];
      const data = await res.json();
      return Array.isArray(data?.letters) ? data.letters : [];
    } catch { return []; }
  }
  const markRead = id => fetch(`/__teacher/letters/${id}/read`, {method: 'POST'}).catch(() => {});
  const targets = () => Object.fromEntries(library.filter(e => e.tempo).map(e => [e.id, e.tempo]));

  function learningRow(now) {
    let path = null;
    try { path = curriculum(doc, {library, targets: targets(), now}); } catch (e) { console.warn('Path unavailable:', e); }
    const practised = songStats(doc).map(s => ({id: s.id, title: s.title}));
    const songs = [...library.map(e => ({id: e.id, title: e.title, tempo: e.tempo})), ...practised.filter(p => !library.some(e => e.id === p.id))];
    return el('div', {class: 'pg-grid pg-learn'},
      pathSection({path, expanded, toggle: id => { expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); }}),
      el('div', {class: 'pg-stack'},
        goalsSection({doc, songs, adding: addingGoal, now,
          setAdding: v => { addingGoal = v; render(); root.querySelector('.pg-goal-form-add select')?.focus(); },
          onAdd: async g => { addingGoal = false; doc.goals = await saveGoals([...(doc.goals || []), g]); render(); },
          onRemove: async id => { doc.goals = await saveGoals((doc.goals || []).filter(g => g.id !== id)); render(); }}),
        journalSection({journal: doc.journal, onAdd: text => addJournalEntry({text})})));
  }

  function render() {
    if (destroyed) return;
    if (!doc) { root.replaceChildren(el('div', {class: 'pg-card pg-loading', text: 'Loading your progress…'})); return; }
    const now = Date.now();
    const goal = doc.settings?.dailyGoalMin || DEFAULT_GOAL_MIN;
    const hasAny = Object.keys(doc.totals.days).length || Object.keys(doc.totals.songs).length;
    // A refresh redraws everything: keep the keyboard focus on the same control (e.g. after a dialog
    // hands focus back to the button that opened it).
    const was = root.contains(document.activeElement) && document.activeElement.matches('button, a') ? document.activeElement : null;
    const same = was && (e => e.tagName === was.tagName && e.className === was.className && e.textContent === was.textContent);
    root.replaceChildren(...[
      hasAny ? null : welcome(),
      el('div', {class: 'pg-grid pg-top'}, todayCard(now, goal), streakCard(now), weekCard(now)),
      lettersSection({letters, onRead: markRead}),
      learningRow(now),
      el('div', {class: 'pg-grid pg-mid'}, barsCard(now, goal), heatmapCard(now)),
      recHost,
      el('div', {class: 'pg-grid pg-bottom'}, songsCard(now), keysCard(now), readingCard()),
      settingsCard(goal),
    ].filter(Boolean));
    if (was && !was.isConnected) [...root.querySelectorAll(was.tagName)].find(same)?.focus({preventScroll: true});
  }

  function settingsCard(goal) {
    const theme = getTheme();
    return el('section', {class: 'pg-settings', 'aria-labelledby': 'pg-settings-h'},
      el('h3', {class: 'pg-rule-h', id: 'pg-settings-h', text: 'Settings'}),
      el('div', {class: 'pg-settings-rows'},
        el('div', {class: 'pg-setting'},
          el('p', {class: 'pg-setting-name', text: 'Daily goal'}),
          ...(editingGoal === 'settings' ? [goalForm(goal)] : [
            el('p', {class: 'pg-setting-value', text: `${goal} minutes a day`}),
            el('button', {class: 'text-btn', type: 'button', text: 'Change', onclick: () => editGoal('settings')})])),
        pathStartSetting({start: doc.settings?.pathStart || 'beginner', onChange: async id => { doc.settings = await saveSettings({pathStart: id}); render(); }}),
        el('div', {class: 'pg-setting'},
          el('p', {class: 'pg-setting-name', id: 'pg-theme-l', text: 'Appearance'}),
          el('div', {class: 'pg-theme', role: 'radiogroup', 'aria-labelledby': 'pg-theme-l'}, THEMES.map(t =>
            el('button', {type: 'button', role: 'radio', class: 'pg-theme-opt', 'aria-checked': String(t.id === theme), onclick: () => { setTheme(t.id); render(); }}, t.label)))),
        el('div', {class: 'pg-setting'},
          el('p', {class: 'pg-setting-name', text: 'Help'}),
          el('div', {class: 'pg-setting-actions'},
            el('button', {class: 'text-btn', type: 'button', 'aria-haspopup': 'dialog', text: 'Help & shortcuts', onclick: () => openHelp()}),
            el('button', {class: 'text-btn', type: 'button', 'aria-haspopup': 'dialog', text: 'Show the introduction again', onclick: () => openOnboarding()})))),
      backupHost,
      el('p', {class: 'pg-fine', text: where === 'disk' ? 'Your progress is kept on your Mac (.data/progress.json) and shared by every device using this dev server.' : onMac() ? 'Your progress is kept in this browser.' : `Your progress is kept in this browser. ${MAC_ONLY}`}),
    );
  }

  function welcome() {
    return el('section', {class: 'pg-card pg-welcome'},
      el('div', {},
        el('h3', {text: 'A blank page'}),
        el('p', {text: 'Practise a piece, a scale or a note-reading drill and your minutes, streak and accuracy will be written in here.'}),
        el('div', {class: 'pg-actions'},
          el('a', {class: 'btn-primary', href: '#/', text: 'Start today’s practice'}),
        ),
      ),
    );
  }

  function todayCard(now, goal) {
    const today = minutesByDay(doc)[dayKey(now)] || 0;
    const frac = Math.min(1, today / goal);
    const R = 44, C = 2 * Math.PI * R;
    const ring = `<svg viewBox="0 0 108 108" class="pg-ring" aria-hidden="true">
      <circle cx="54" cy="54" r="${R}" class="pg-ring-bg"/>
      ${frac > 0 ? `<circle cx="54" cy="54" r="${R}" class="pg-ring-fg${frac >= 1 ? ' done' : ''}" stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 54 54)"/>` : ''}
    </svg>`;
    const goalCtl = editingGoal === 'today' ? goalForm(goal)
      : el('button', {class: 'pg-link', type: 'button', text: `Daily goal ${goal} min · change`, onclick: () => editGoal('today')});
    return el('section', {class: 'pg-card pg-today', 'aria-label': 'Today'},
      el('div', {class: 'pg-ring-wrap', html: ring},
        el('div', {class: 'pg-ring-label'}, el('strong', {text: fmtMin(today)}), el('span', {text: `of ${goal} min`}))),
      el('div', {class: 'pg-today-text'},
        el('h3', {text: 'Today'}),
        el('p', {class: 'pg-big-note', text: frac >= 1 ? 'Goal reached. Well played.' : today > 0 ? `${fmtMin(goal - today)} min to go` : 'Not started yet'}),
        goalCtl),
    );
  }

  function goalForm(goal) {
    return el('form', {class: 'pg-goal-form', onsubmit: e => { e.preventDefault(); setGoal(+e.target.goal.value); }},
      el('input', {name: 'goal', type: 'number', min: 1, max: 600, step: 1, value: goal, 'aria-label': 'Daily goal in minutes', class: 'pg-input'}),
      el('span', {text: 'min'}),
      el('button', {class: 'text-btn', type: 'submit', text: 'Save'}),
      el('button', {class: 'text-btn', type: 'button', text: 'Cancel', onclick: () => { editingGoal = false; render(); }}));
  }
  function editGoal(where) {
    editingGoal = where;
    render();
    root.querySelector('.pg-goal-form input')?.select();
  }

  async function setGoal(v) {
    if (!(v >= 1 && v <= 600)) return;
    editingGoal = false;
    doc.settings = await saveSettings({dailyGoalMin: Math.round(v)});
    render();
  }

  function streakCard(now) {
    const s = streaks(doc, {now});
    return el('section', {class: 'pg-card pg-stat', 'aria-label': 'Streak'},
      el('div', {},
        el('h3', {text: 'Streak'}),
        el('p', {class: 'pg-big'}, el('strong', {text: String(s.current)}), el('span', {text: s.current === 1 ? ' day' : ' days'})),
        el('p', {class: 'pg-muted', text: `Longest ${s.longest} · days with ${STREAK_MIN_MINUTES}+ min${s.current && !s.todayDone ? ' · practise today to keep it' : ''}`})),
    );
  }

  function weekCard(now) {
    const week = lastDays(doc, 7, now);
    const total = week.reduce((a, d) => a + d.minutes, 0);
    const active = week.filter(d => d.minutes > 0).length;
    return el('section', {class: 'pg-card pg-stat', 'aria-label': 'Last 7 days'},
      el('div', {},
        el('h3', {text: 'Last 7 days'}),
        el('p', {class: 'pg-big'}, el('strong', {text: fmtDuration(total)})),
        el('p', {class: 'pg-muted', text: `${active} of 7 days practised`})),
    );
  }

  function barsCard(now, goal) {
    const data = lastDays(doc, 14, now);
    const W = 560, H = 180, pad = {l: 30, r: 8, t: 12, b: 24};
    const max = Math.max(goal * 1.25, ...data.map(d => d.minutes), 5);
    const bw = (W - pad.l - pad.r) / data.length;
    const y = m => pad.t + (H - pad.t - pad.b) * (1 - m / max);
    const ticks = [0, Math.round(max / 2), Math.round(max)];
    let svg = '<defs><pattern id="pg-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" class="pg-hatch-line"/></pattern></defs>';
    svg += ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="pg-grid-line"/><text x="${pad.l - 6}" y="${(y(t) + 4).toFixed(1)}" class="pg-axis" text-anchor="end">${t}</text>`).join('');
    data.forEach((d, i) => {
      const x = pad.l + i * bw + bw * 0.3, w = bw * 0.4;
      const segs = [['practice', d.practiceMin], ['listen', d.listenMin], ['reading', d.trainerMin]];
      let top = y(0);
      for (const [cls, m] of segs) {
        if (m <= 0) continue;
        const h = y(0) - y(m);
        top -= h;
        svg += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" class="pg-bar ${cls}"/>`;
      }
      svg += `<rect x="${(pad.l + i * bw).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${H - pad.t}" class="pg-hit"><title>${esc(longDay(d.day))}: ${fmtMin(d.minutes)} min</title></rect>`;
      svg += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" class="pg-axis${i === data.length - 1 ? ' today' : ''}" text-anchor="middle">${esc(weekday(d.day))}</text>`;
    });
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}" class="pg-goal-line"/><text x="${W - pad.r}" y="${(y(goal) - 4).toFixed(1)}" class="pg-axis goal" text-anchor="end">goal</text>`;
    return el('section', {class: 'pg-card pg-bars-card'},
      el('div', {class: 'pg-card-head'}, el('h3', {text: 'Last 14 days'}),
        el('div', {class: 'pg-legend'}, legend('practice', 'Practice'), legend('listen', 'Listening'), legend('reading', 'Note reading'))),
      el('div', {class: 'pg-chart', role: 'img', 'aria-label': `Minutes practised per day for the last 14 days: ${data.map(d => fmtMin(d.minutes)).join(', ')}`,
        html: `<svg viewBox="0 0 ${W} ${H}" class="pg-bars">${svg}</svg>`}),
    );
  }
  const legend = (cls, label) => el('span', {class: 'pg-legend-item'}, el('i', {class: cls}), label);

  function heatmapCard(now) {
    const mins = minutesByDay(doc);
    const today = dayKey(now);
    // 12 weeks, columns Monday-first, ending with the current week.
    const dow = (dateOf(today).getDay() + 6) % 7;
    const start = addDays(today, -dow - 7 * 11);
    const cells = [];
    for (let w = 0; w < 12; w++) for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const m = mins[day] || 0;
      const lvl = day > today ? 'future' : m <= 0 ? 0 : m < STREAK_MIN_MINUTES ? 1 : m < 15 ? 2 : m < 30 ? 3 : 4;
      cells.push(el('i', {class: `pg-heat-cell l${lvl}`, style: `grid-column:${w + 1};grid-row:${d + 1}`, title: day > today ? null : `${longDay(day)}: ${fmtMin(m)} min`}));
    }
    return el('section', {class: 'pg-card pg-heat-card'},
      el('div', {class: 'pg-card-head'}, el('h3', {text: '12 weeks'})),
      el('div', {class: 'pg-heat', role: 'img', 'aria-label': 'Practice calendar for the last 12 weeks'}, cells),
      el('div', {class: 'pg-heat-scale'}, el('span', {text: 'Less'}), ...[0, 1, 2, 3, 4].map(l => el('i', {class: `pg-heat-cell l${l}`})), el('span', {text: 'More'})),
    );
  }

  function songsCard(now) {
    const songs = songStats(doc).slice(0, 12);
    const t = targets();
    const statusOf = id => pieceMastery(doc, id, {target: t[id]}).status;
    const body = songs.length
      ? el('ul', {class: 'pg-songs'}, songs.map(s => el('li', {},
        el('a', {class: 'pg-song', href: '#/play/' + encodeURIComponent(s.id), title: `Open “${s.title}”`},
          el('span', {class: 'pg-song-main'},
            el('span', {class: 'pg-song-title', text: s.title}),
            el('span', {class: 'pg-muted'},
              statusOf(s.id) && s.attempts ? el('span', {class: 'pg-status is-' + statusOf(s.id), text: STATUS_LABEL[statusOf(s.id)]}) : null,
              statusOf(s.id) && s.attempts ? ' · ' : null,
              `${ago(s.lastAt, now)}${s.attempts ? ` · ${s.attempts} pass${s.attempts === 1 ? '' : 'es'}` : ''}${s.minutes >= 1 ? ` · ${fmtDuration(s.minutes)}` : ''}`)),
          s.best != null ? el('span', {class: 'pg-acc', title: `Best ${pct(s.best)} · latest ${pct(s.latest)}`},
            el('span', {class: 'pg-acc-bar'}, el('i', {style: `width:${Math.round(s.best)}%`})),
            el('strong', {text: pct(s.best)})) : el('span', {class: 'pg-muted pg-acc-none', text: 'listened'}),
        ))))
      : el('p', {class: 'pg-empty', text: 'Songs you practise show up here with your best accuracy.'});
    return el('section', {class: 'pg-card pg-songs-card'}, el('div', {class: 'pg-card-head'}, el('h3', {text: 'Songs'}), el('span', {class: 'pg-muted', text: 'best accuracy'})), body);
  }

  function keysCard(now) {
    const stats = keyStats(doc, {now});
    const any = Object.keys(stats).length;
    const S = 260, c = S / 2;
    const ring = (list, quality, r, size) => list.map(([pc, label], i) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const x = c + r * Math.cos(a), yy = c + r * Math.sin(a);
      const st = stats[`${quality}:${pc}`];
      const cls = !st ? 'none' : st.recent ? 'recent' : 'old';
      const tip = st ? `${label}${quality === 'major' ? ' major' : ' minor'}: ${st.attempts} pass${st.attempts === 1 ? '' : 'es'}${st.best != null ? `, best ${Math.round(st.best)}%` : ''}, ${ago(st.lastAt, now)}` : `${label}${quality === 'major' ? ' major' : ' minor'}: not practised yet`;
      return `<g class="pg-key ${cls}"><title>${esc(tip)}</title><circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="${size}"/><text x="${x.toFixed(1)}" y="${(yy + 4).toFixed(1)}" text-anchor="middle">${esc(label)}</text></g>`;
    }).join('');
    const recentCount = Object.values(stats).filter(s => s.recent).length;
    return el('section', {class: 'pg-card pg-keys-card'},
      el('div', {class: 'pg-card-head'}, el('h3', {text: 'Technique keys'}), el('a', {class: 'pg-link', href: '#/technique', text: 'Practise'})),
      el('div', {class: 'pg-fifths', role: 'img', 'aria-label': `Circle of fifths: ${recentCount} keys practised in the last 14 days`,
        html: `<svg viewBox="0 0 ${S} ${S}">${ring(FIFTHS_MAJOR, 'major', 104, 20)}${ring(FIFTHS_MINOR, 'minor', 62, 16)}</svg>`}),
      el('div', {class: 'pg-legend center'}, legend('key-recent', 'Last 14 days'), legend('key-old', 'Earlier'), legend('key-none', 'Not yet')),
      any ? el('p', {class: 'pg-muted pg-center', text: `${exerciseStats(doc).length} exercise${exerciseStats(doc).length === 1 ? '' : 's'} practised`}) : el('p', {class: 'pg-empty pg-center', text: 'Scales and arpeggios you practise light up their key.'}),
    );
  }

  function readingCard() {
    const trend = readingTrend(doc, {n: 14});
    const sum = readingSummary(doc);
    if (!trend.length) {
      return el('section', {class: 'pg-card pg-reading-card'},
        el('div', {class: 'pg-card-head'}, el('h3', {text: 'Note reading'}), el('a', {class: 'pg-link', href: '#/train/reading', text: 'Train'})),
        el('p', {class: 'pg-empty', text: 'Do a note-reading drill to see your accuracy and speed improve over time.'}),
        skillsLine());
    }
    const W = 300, H = 120, pad = {l: 8, r: 8, t: 12, b: 20};
    const n = trend.length;
    const x = i => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
    const yAcc = v => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
    const maxMs = Math.max(...trend.map(t => t.avgMs || 0), 500);
    const ySpd = v => pad.t + (H - pad.t - pad.b) * (1 - v / (maxMs * 1.1));
    const line = (fn, key) => trend.map((t, i) => (t[key] == null ? null : `${x(i).toFixed(1)},${fn(t[key]).toFixed(1)}`)).filter(Boolean).join(' ');
    const dots = (fn, key, cls) => trend.map((t, i) => (t[key] == null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${fn(t[key]).toFixed(1)}" r="3.5" class="${cls}"><title>${esc(longDay(t.day))}: ${key === 'accuracy' ? pct(t.accuracy) : `${Math.round(t.avgMs)} ms`}</title></circle>`)).join('');
    const svg = `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yAcc(100)}" y2="${yAcc(100)}" class="pg-grid-line"/><line x1="${pad.l}" x2="${W - pad.r}" y1="${yAcc(0)}" y2="${yAcc(0)}" class="pg-grid-line"/>
      <polyline points="${line(ySpd, 'avgMs')}" class="pg-line speed"/><polyline points="${line(yAcc, 'accuracy')}" class="pg-line acc"/>
      ${dots(ySpd, 'avgMs', 'pg-dot speed')}${dots(yAcc, 'accuracy', 'pg-dot acc')}
      <text x="${pad.l}" y="${H - 4}" class="pg-axis">${esc(longDay(trend[0].day))}</text><text x="${W - pad.r}" y="${H - 4}" class="pg-axis" text-anchor="end">${esc(longDay(trend[n - 1].day))}</text>`;
    const last = trend[n - 1];
    return el('section', {class: 'pg-card pg-reading-card'},
      el('div', {class: 'pg-card-head'}, el('h3', {text: 'Note reading'}), el('a', {class: 'pg-link', href: '#/train/reading', text: 'Train'})),
      el('div', {class: 'pg-reading-stats'},
        el('div', {}, el('strong', {class: 'acc', text: pct(last.accuracy)}), el('span', {class: 'pg-muted', text: 'accuracy'})),
        el('div', {}, el('strong', {class: 'speed', text: last.avgMs != null ? `${(last.avgMs / 1000).toFixed(1)} s` : '–'}), el('span', {class: 'pg-muted', text: 'per note'})),
        el('div', {}, el('strong', {text: String(sum.drills)}), el('span', {class: 'pg-muted', text: sum.drills === 1 ? 'drill' : 'drills'}))),
      el('div', {class: 'pg-chart small', role: 'img', 'aria-label': 'Note-reading accuracy and time per note by day', html: `<svg viewBox="0 0 ${W} ${H}" class="pg-trend">${svg}</svg>`}),
      el('div', {class: 'pg-legend'}, legend('acc', 'Accuracy'), legend('speed', 'Time per note')),
      skillsLine(),
    );
  }

  // Sight-reading · Rhythm · Theory · Ear: one compact line under the note-reading trend.
  function skillsLine() {
    const s = skillSummary(doc);
    const items = [
      s.sightReading && ['#/exercises/sight-reading', 'Sight-reading', `${s.sightReading.pieces} ${s.sightReading.pieces === 1 ? 'piece' : 'pieces'}`],
      s.rhythm && ['#/exercises/rhythm', 'Rhythm', pct(s.rhythm.lastAccuracy)],
      s.theory && ['#/exercises/theory', 'Theory', `${s.theory.levels} of 6 lessons`],
      s.ear && ['#/exercises/ear', 'Ear', pct(s.ear.lastAccuracy)],
      s.lesson && ['#/exercises/lessons', 'First lessons', `${s.lesson.levels} of ${LESSONS.length}`],
    ].filter(Boolean);
    if (!items.length) return null;
    return el('p', {class: 'pg-skills', 'aria-label': 'Other exercises'}, items.map(([href, name, value]) =>
      el('a', {class: 'pg-skill', href}, el('span', {class: 'pg-skill-name', text: name}), ' ', el('strong', {text: value}))));
  }

  const onTheme = () => render();
  window.addEventListener(THEME_EVENT, onTheme);
  const onChange = () => refresh();
  const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  render();
  refresh();

  return {
    destroy() {
      destroyed = true;
      bk?.destroy?.();
      recs?.destroy?.();
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener(THEME_EVENT, onTheme);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      root.remove();
    },
  };
}
