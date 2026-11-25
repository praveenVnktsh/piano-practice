// What a message to the teacher carries along: the player's state, the current route, the
// last few practice results (with their misses) and a short progress summary — now with
// mastery per piece, the open piece's weakest bars, due reviews, plateaus, the graded-path
// step, goals, the practice journal and open assignments.
import {loadCatalogs} from '../app/catalog.js';
import {barStatsFrom, dueReviews, goalProgress, plateaus, repertoire, troubleSpots} from '../progress/mastery.js';
import {curriculum} from '../curriculum/levels.js';
import {askAttachment, lastResultFor} from './comments.mjs';

const RESULTS_KEY = 'piano-practice.teacher.results';
const TRAINER_KEY = 'piano-practice.teacher.trainer';
const KEEP = 5;
const MAX_CONTEXT_CHARS = 60000; // the server refuses more than 64 KB

const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

/** Keeps the last few practice:result / trainer:result payloads; calls onResult(detail) for practice ones. */
export function trackResults(onResult = () => {}) {
  const onPractice = e => {
    const d = e.detail;
    if (!d || typeof d !== 'object') return;
    save(RESULTS_KEY, [d, ...recentResults()].slice(0, KEEP));
    onResult(d);
  };
  const onTrainer = e => e.detail && typeof e.detail === 'object' && save(TRAINER_KEY, e.detail);
  window.addEventListener('practice:result', onPractice);
  window.addEventListener('trainer:result', onTrainer);
  return () => {
    window.removeEventListener('practice:result', onPractice);
    window.removeEventListener('trainer:result', onTrainer);
  };
}

export const recentResults = () => {
  const r = load(RESULTS_KEY, []);
  return Array.isArray(r) ? r : [];
};

export function playerState() {
  try {
    const s = window.pianoPlayer?.getState?.();
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

// src/progress/ is another module; it may be missing, so it's looked up (not imported) here.
const progressModules = import.meta.glob(['../progress/store.js', '../progress/stats.js']);

/** A small summary of getProgress(), or null when progress isn't available. */
export async function progressSummary() {
  const loadStore = progressModules['../progress/store.js'],
    loadStats = progressModules['../progress/stats.js'];
  if (!loadStore) return null;
  try {
    const [store, stats] = await Promise.all([loadStore(), loadStats ? loadStats() : {}]);
    const doc = await store.getProgress();
    if (!doc) return null;
    const row = s => ({
      id: s.id,
      title: s.title,
      attempts: s.attempts,
      best: s.best,
      latest: s.latest,
      bestTempo: s.bestTempo || undefined,
      minutes: Math.round(s.minutes || 0),
      lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : undefined,
    });
    return {
      dailyGoalMin: doc.settings?.dailyGoalMin,
      todayMinutes: stats.todayMinutes ? Math.round(stats.todayMinutes(doc)) : undefined,
      totalMinutes: stats.totalMinutes ? Math.round(stats.totalMinutes(doc)) : undefined,
      streak: stats.streaks ? stats.streaks(doc) : undefined,
      recentSongs: stats.songStats ? stats.songStats(doc).slice(0, 6).map(row) : undefined,
      recentExercises: stats.exerciseStats ? stats.exerciseStats(doc).slice(0, 6).map(row) : undefined,
      reading: stats.readingSummary ? stats.readingSummary(doc) : undefined,
      ...(await learningSummary(doc)),
    };
  } catch {
    return null;
  }
}

let catalogPromise = null;
const catalog = () => (catalogPromise ||= loadCatalogs().then(c => [...c.bundled, ...c.local]).catch(() => []));
const iso = at => (at ? new Date(at).toISOString() : undefined);

/** Mastery, trouble bars, reviews, plateaus, path, goals and journal from a progress document. */
export async function learningSummary(doc, {library, now = Date.now(), player = playerState()} = {}) {
  try {
    const lib = library ?? (await catalog());
    const targets = Object.fromEntries(lib.filter(e => e.tempo).map(e => [e.id, e.tempo]));
    const mastery = repertoire(doc, {targets, now}).slice(0, 8).map(m => ({
      id: m.songId, title: m.title, status: m.status, attempts: m.attempts, best: m.best,
      bestCleanTempo: m.bestCleanTempo || undefined, targetTempo: m.target || undefined,
      coverage: m.measureCount ? Math.round(m.coverage * 100) : undefined, measureCount: m.measureCount || undefined,
      reviewDue: m.review ? m.review.due : undefined,
    }));
    const songId = player?.songId && !String(player.songId).startsWith('ex:') ? player.songId : mastery[0]?.id;
    const bars = songId ? {songId, weakest: troubleSpots(doc, songId, {n: 6}), practised: barStatsFrom(doc, songId).length} : undefined;
    const path = curriculum(doc, {library: lib, targets, now});
    const cur = path.current;
    return {
      mastery,
      bars,
      dueReviews: dueReviews(doc, {targets, now}).map(m => ({id: m.songId, title: m.title, due: m.review.due})),
      plateaus: plateaus(doc, {now, targets}).slice(0, 5),
      path: {
        level: cur.level.name, done: Math.round(cur.fraction * 100),
        pieces: cur.repertoire.items.map(p => ({id: p.id, title: p.title, status: p.status || 'not started'})),
        techniqueLeft: cur.technique.items.filter(t => !t.done).slice(0, 6).map(t => t.id),
        readingLeft: cur.reading.items.filter(r => !r.done).map(r => r.id),
      },
      goals: (doc.goals || []).map(g => ({...g, ...goalProgress(g, doc, {now})})),
      journal: (doc.journal || []).slice(-5).map(e => ({at: iso(e.at), text: e.text, mood: e.mood, title: e.title, minutes: e.minutes})),
    };
  } catch {
    return {};
  }
}

/** Open assignments from the dev server (the teacher wrote them), or undefined. */
async function openAssignments() {
  try {
    const res = await fetch('/__teacher', {cache: 'no-store'});
    if (!res.ok) return undefined;
    const data = await res.json();
    const list = (data?.assignments || []).filter(a => !a.done).map(({id, task, due, action}) => ({id, task, due, action}));
    return list.length ? list : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The whole context block sent with a message (trimmed to fit the server's limit).
 * `recording`: a take the student is sending for review (src/record/text.mjs compactSummary).
 */
export async function collectContext({recording} = {}) {
  const context = {
    ...(recording && typeof recording === 'object' ? {recording} : {}),
    route: location.hash || '#/',
    player: playerState(),
    recentResults: recentResults().slice(0, 3),
    trainer: load(TRAINER_KEY, null),
    progress: await progressSummary(),
    assignments: await openAssignments(),
    screen: {width: innerWidth, height: innerHeight},
    at: new Date().toISOString(),
  };
  // Trim the biggest parts until it fits.
  while (JSON.stringify(context).length > MAX_CONTEXT_CHARS && context.recentResults.length)
    context.recentResults.pop();
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS && context.progress) {
    delete context.progress.journal;
    delete context.progress.plateaus;
  }
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) context.progress = null;
  return context;
}

/** "Für Elise · bars 1–8 · ♩ = 72 · last attempt 86%" — what the student sees being shared. */
export function sharingLine(state = playerState(), last = recentResults()[0]) {
  const parts = [];
  if (state?.songId) {
    parts.push(state.title || state.songId);
    if (state.sectionLabel) parts.push(state.sectionLabel);
    else if (Array.isArray(state.section)) parts.push(`bars ${state.section[0] + 1}–${state.section[1] + 1}`);
    if (state.tempo) parts.push(`♩ = ${Math.round(state.tempo)}`);
  } else
    parts.push(
      location.hash.startsWith('#/train')
        ? 'note-reading trainer'
        : location.hash.startsWith('#/technique')
          ? 'technique'
          : 'no song open',
    );
  if (last && typeof last.accuracy === 'number' && (!state?.songId || last.songId === state.songId))
    parts.push(`last attempt ${Math.round(last.accuracy)}%`);
  return parts.join(' · ');
}

/**
 * The attachment for "Ask the teacher about bars X–Y" (context.ask; `node teacher/cli.js show`
 * prints it): the piece, the bars and the last practice pass over them — from this tab's recent
 * results, else from the progress store.
 * `d` = the `teacher:ask` event detail {songId, title, section, bars, tempo?, hands?, comments?}.
 */
export async function askContext(d) {
  let results = recentResults();
  if (!lastResultFor(results, d.songId, d.section)) {
    try {
      const store = await progressModules['../progress/store.js']?.();
      const doc = await store?.getProgress();
      const passes = (doc?.events || []).filter(e => e.type === 'practice:result' && e.songId === d.songId).sort((a, b) => b.at - a.at);
      results = [...results, ...passes];
    } catch {}
  }
  return askAttachment({...d, results, comments: d.comments || []});
}
