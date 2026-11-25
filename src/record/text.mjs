// Plain-text views of takes, reports and exam sheets: for the teacher CLI
// (`node teacher/cli.js recordings | review`) and the compact summary sent to the teacher.
// Pure; tested in tests/record-report.test.js.
import {barLines} from './report.mjs';
import {compactMusicality, musicalityLines} from '../analysis/musicality.mjs';

const pct = v => (v == null ? '–' : `${Math.round(v)}%`);
const day = at => new Date(at).toISOString().slice(0, 16).replace('T', ' ');
export const duration = ms => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const sectionText = s => (Array.isArray(s) ? `section [${s[0]}, ${s[1]}]` : 'whole piece');

/** One line per take (from takeMeta()). */
export function takeLine(m) {
  const s = m.summary;
  return `${m.id} · ${day(m.at)} · ${m.title || m.songId} [${m.songId}]${m.name ? ` “${m.name}”` : ''} · ${duration(m.durationMs)} · ${m.notes} notes` +
    `${m.tempo ? ` · ♩ = ${m.tempo}` : ''} · ${m.mode}${m.exam ? ` (exam ${m.exam})` : ''}` +
    (s ? ` · accuracy ${pct(s.accuracy)}, timing ${s.timing ?? '–'}, ♩ ≈ ${s.tempo ?? '–'}` : ' · not compared yet') +
    (m.sentAt ? ' · sent to teacher' : '');
}

/** The comparison report as text, bar by bar. */
export function reportText(take, {bars = 60} = {}) {
  const r = take.report;
  const head = [
    `Take ${take.id}: ${take.title || take.songId}${take.composer ? ` (${take.composer})` : ''} [${take.songId}]`,
    `  ${take.name ? `“${take.name}” · ` : ''}${day(take.at)} · ${duration(take.durationMs)} · ${take.notes.length} notes · recorded at ♩ = ${take.tempo ?? '?'} · ${take.hands} hands · ${take.mode} · ${take.source}`,
  ];
  if (!r) return [...head, '', '  Not compared with the score yet: open the take once in the app (Progress → Recordings) to compute its report.'].join('\n');
  const s = r.summary, t = r.timing;
  const out = [...head,
    `  ${sectionText(r.section)} · ${r.verdict} · overall ${r.score}/100`,
    '',
    `Notes: ${pct(s.accuracy)} accuracy · ${s.right} of ${s.expected} right · ${s.missed} missed (${s.wrong} of them wrong notes) · ${s.extra} extra`,
    t.meanBpm ? `Timing: ♩ ≈ ${t.meanBpm} (written/recorded ${t.writtenBpm ?? '?'}) · ±${t.sdMs} ms from a steady local pulse · timing score ${t.score}/100` +
      `${t.drift ? ` · drift ♩ ${t.drift.from} → ${t.drift.to}` : ''}${t.rushed ? ` · hurried in ${t.rushed}` : ''}${t.slowed ? ` · held back in ${t.slowed}` : ''}` : 'Timing: too few matched notes to judge.',
  ];
  if (r.evenness) out.push(`Evenness: ${r.evenness.score}/100 · timing ±${r.evenness.timingSdMs} ms${r.evenness.velocitySd != null ? ` · velocity ±${r.evenness.velocitySd} (mean ${r.evenness.velocityMean})` : ''}`);
  if (r.dynamics?.marks?.length) out.push(`Dynamics: ${r.dynamics.marks.map(m => `${m.mark} in ${m.bars} played ${m.played} (aim ≈ ${m.expected})`).join('; ')}`);
  if (r.dynamics?.hairpins?.length) out.push(`Hairpins: ${r.dynamics.hairpins.map(h => `${h.form} in ${h.bars}: ${h.change > 0 ? '+' : ''}${h.change} velocity`).join('; ')}`);
  if (r.dynamics?.balance) out.push(`Balance: left minus right ${r.dynamics.balance.lhMinusRh} velocity${r.dynamics.balance.heavy ? ` (left heavy in ${r.dynamics.balance.heavy})` : ''}`);
  if (r.articulation) out.push(`Articulation: ${r.articulation.legatoPairs} legato pairs, ${r.articulation.detachedPairs} detached; staccato ${r.articulation.staccato.count} (${r.articulation.staccato.held} held long)`);
  if (r.pedal) out.push(`Pedal: ${r.pedal.presses} presses; caught ${r.pedal.caught} of ${r.pedal.marks} marked changes`);
  out.push(...musicalityLines(compactMusicality(r.musicality)));
  if (r.remarks?.length) out.push('', 'Remarks:', ...r.remarks.map(x => `  - ${x}`));
  const lines = barLines(r, {limit: bars});
  out.push('', lines.length ? 'Bar by bar (bars with problems):' : 'Bar by bar: no slips.');
  for (const b of lines) out.push(`  ${b.label} (${b.accuracy}%): ${b.text}`);
  const tempos = r.bars.filter(b => b.bpm != null);
  if (tempos.length) out.push('', 'Tempo by bar (♩): ' + tempos.map(b => `${b.label === 'Pickup' ? 'P' : b.label}:${b.bpm}`).join(' '));
  out.push('', 'Bar labels are the printed bar numbers; section indices are 0-based measure indices (use them in set_section actions).');
  return out.join('\n');
}

/** The compact summary attached to a "please review my recording" message (context.recording). */
export function compactSummary(take) {
  const r = take.report;
  const out = {takeId: take.id, songId: take.songId, title: take.title, name: take.name || undefined, at: new Date(take.at).toISOString(),
    durationMs: take.durationMs, tempo: take.tempo, section: r?.section ?? take.section, hands: take.hands, mode: take.mode, source: take.source};
  if (r) {
    out.accuracy = r.summary.accuracy; out.right = r.summary.right; out.missed = r.summary.missed; out.wrong = r.summary.wrong; out.extra = r.summary.extra;
    out.meanBpm = r.timing.meanBpm; out.timingSdMs = r.timing.sdMs; out.timingScore = r.timing.score; out.drift = r.timing.drift || undefined;
    out.evenness = r.evenness?.score; out.score = r.score; out.verdict = r.verdict;
    out.weakBars = r.bars.filter(b => b.notes >= 2 && b.accuracy < 85).sort((a, b) => a.accuracy - b.accuracy).slice(0, 6).map(b => ({label: b.label, accuracy: b.accuracy}));
    out.remarks = r.remarks;
    const music = compactMusicality(r.musicality);
    if (music) out.musicality = music;
  }
  return out;
}

/** The message text the student sends with a take. */
export function sendText(take) {
  const r = take.report;
  const what = `${take.title || take.songId}${take.name ? ` (“${take.name}”)` : ''}`;
  return r ? `Please review my recording of ${what}: ${r.summary.accuracy}% of notes, ♩ ≈ ${r.timing.meanBpm ?? '?'}. Take ${take.id}.`
    : `Please review my recording of ${what}. Take ${take.id}.`;
}

/** An exam results sheet as text. */
export function examText(exam) {
  const out = [`Mock exam ${exam.id} · ${day(exam.at)} · ${exam.total}/${exam.max} · ${exam.band}`];
  exam.items.forEach((it, i) => out.push(`  ${i + 1}. ${it.kind}: ${it.title}${it.takeId ? ` (take ${it.takeId})` : ''} — ${it.mark}/${it.max} ${it.band}. ${it.comment}`));
  for (const r of exam.remarks || []) out.push(`  ${r}`);
  return out.join('\n');
}
