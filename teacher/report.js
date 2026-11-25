// A plain-text progress report for the teacher (`node teacher/cli.js progress`), built from the
// progress document on disk (.data/progress.json) and the song catalogs — so the teacher can
// write a weekly letter or notice a plateau without waiting for a message from the app.
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeDoc, dayKey} from '../src/progress/model.js';
import {lastDays, readingSummary, streaks, totalMinutes, exerciseStats} from '../src/progress/stats.js';
import {dueReviews, goalProgress, plateaus, repertoire, troubleSpots, sectionMastery} from '../src/progress/mastery.js';
import {curriculum} from '../src/curriculum/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROGRESS_FILE = process.env.PROGRESS_FILE || join(ROOT, '.data', 'progress.json');
export const CATALOGS = [join(ROOT, 'public', 'songs', 'catalog.json'), join(ROOT, 'public', 'songs', 'local', 'catalog.json')];

export function readProgressDoc(file = PROGRESS_FILE) {
  try {
    return normalizeDoc(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return normalizeDoc(null);
  }
}

export function readCatalog(files = CATALOGS) {
  const out = [];
  for (const f of files) {
    try {
      const json = JSON.parse(readFileSync(f, 'utf8'));
      for (const s of json?.songs || []) if (s?.id) out.push(s);
    } catch {}
  }
  return out;
}

const pct = v => (typeof v === 'number' ? `${Math.round(v)}%` : '–');
const bars = s => (Array.isArray(s) ? `[${s[0]}, ${s[1]}] (bars ${s[0] + 1}–${s[1] + 1})` : '?');

/** The report as text. `days` = how far back the "recent" sections look. */
export function progressReport(doc, catalog = [], {now = Date.now(), days = 7} = {}) {
  const targets = Object.fromEntries(catalog.filter(e => e.tempo).map(e => [e.id, e.tempo]));
  const out = [];
  const week = lastDays(doc, days, now);
  const st = streaks(doc, {now});
  out.push(`Progress as of ${dayKey(now)} (daily goal ${doc.settings?.dailyGoalMin ?? '?'} min)`);
  out.push(`  last ${days} days: ${Math.round(week.reduce((a, d) => a + d.minutes, 0))} min on ${week.filter(d => d.minutes > 0).length} days · streak ${st.current} (longest ${st.longest}) · ${Math.round(totalMinutes(doc))} min in all`);
  out.push(`  per day: ${week.map(d => `${d.day.slice(5)} ${Math.round(d.minutes)}`).join(' · ')}`);

  const rep = repertoire(doc, {targets, now});
  out.push('', 'Repertoire (status: learning → secure → polished → maintained)');
  if (!rep.length) out.push('  (nothing practised yet)');
  for (const m of rep.slice(0, 15)) {
    out.push(`  ${m.title} [${m.songId}]: ${m.status} · ${m.attempts} passes · best ${pct(m.best)}` +
      `${m.bestCleanTempo ? ` · clean (≥90%) up to ${m.bestCleanTempo} BPM` : ''}${m.target ? ` · target ${m.target}` : ''}` +
      `${m.measureCount ? ` · ${Math.round(m.coverage * 100)}% of ${m.measureCount} bars secure` : ''}` +
      `${m.review ? ` · review due ${m.review.due}${m.review.isDue ? ' (DUE)' : ''}, ${m.review.reviews} done` : ''}`);
    const weak = troubleSpots(doc, m.songId, {n: 4});
    if (weak.length) out.push(`      weakest bars: ${weak.map(b => `${b.label} (${b.accuracy}% of ${b.attempts})`).join(', ')}`);
    const secs = sectionMastery(doc, m.songId, {target: m.target}).slice(0, 3);
    for (const s of secs) out.push(`      section ${bars(s.section)}: ${s.status}, ${s.attempts} passes on ${s.days} day(s), best ${pct(s.best)}`);
  }

  const due = dueReviews(doc, {targets, now});
  if (due.length) out.push('', `Due for review: ${due.map(m => `${m.title} [${m.songId}] (due ${m.review.due})`).join(', ')}`);

  const stuck = plateaus(doc, {now, targets});
  if (stuck.length) {
    out.push('', 'Plateaus (same section, 3+ days, not improving — suggest a different strategy):');
    for (const p of stuck) out.push(`  ${p.title} [${p.songId}] section ${bars(p.section)}: ${p.days} days since ${p.since}, best ${pct(p.firstBest)} → ${pct(p.lastBest)}${p.bestTempo ? ` at up to ${p.bestTempo} BPM` : ''}`);
  }

  const ex = exerciseStats(doc).slice(0, 8);
  if (ex.length) out.push('', 'Technique: ' + ex.map(e => `${e.id} best ${pct(e.best)}`).join('; '));
  const rd = readingSummary(doc);
  if (rd.drills) out.push(`Note reading: ${rd.drills} drills, ${pct(rd.accuracy)}, ${Math.round(rd.avgMs || 0)} ms per note`);

  const path = curriculum(doc, {library: catalog, targets, now});
  const cur = path.current;
  out.push('', `Graded path: ${cur.level.name} (${Math.round(cur.fraction * 100)}% done${path.start !== 'beginner' ? `, started at ${path.start}` : ''})`);
  out.push(`  pieces: ${cur.repertoire.have}/${cur.repertoire.need} secure — ${cur.repertoire.items.map(p => `${p.title} ${p.status || 'not started'}`).join(', ') || 'none in the library yet'}`);
  const techLeft = cur.technique.items.filter(t => !t.done);
  out.push(`  technique left: ${techLeft.map(t => `${t.label} [${t.id}]${t.best != null ? ` best ${pct(t.best)}` : ''}`).join('; ') || 'none'}`);
  out.push(`  reading left: ${cur.reading.items.filter(r => !r.done).map(r => r.id).join(', ') || 'none'}`);

  if (doc.goals?.length) {
    out.push('', 'Goals:');
    for (const g of doc.goals) {
      const p = goalProgress(g, doc, {now});
      out.push(`  ${g.title || g.songId} at ${g.bpm} BPM by ${g.by}: ${p.met ? 'MET' : `best clean ${p.bestTempo ?? '–'} BPM (${Math.round(p.fraction * 100)}%), ${p.daysLeft} days left`}`);
    }
  }
  const since = now - days * 864e5;
  const notes = (doc.journal || []).filter(e => e.at >= since);
  if (notes.length) {
    out.push('', 'Practice journal:');
    for (const e of notes.slice(-12)) out.push(`  ${dayKey(e.at, e.tz)}${e.title ? ` · ${e.title}` : ''}${e.mood ? ` · ${e.mood}` : ''}: ${e.text || '(no words)'}`);
  }
  return out.join('\n');
}
