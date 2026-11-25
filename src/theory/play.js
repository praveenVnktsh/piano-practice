// Plays engraved examples (src/theory/engrave.js measures) on a createPiano() instance.
//
//   playExample(piano, example, {onEvent}) → total duration in ms
// example: {measures, tempo (crotchet BPM), play: 'notes' | 'rhythm'}. Tied notes sound once;
// 'rhythm' plays every note on one pitch. onEvent(i, delayMs, lengthMs) is called for each
// sounding event (index into the flattened measures) so a view can light it up as it plays.
import {midi} from '../exercises/theory.js';

export const RHYTHM_PITCH = 72;

/** Sounding events: [{i, start, len (crotchets), notes: [midi]}], ties merged. */
export function soundingEvents(example) {
  const flat = (example.measures || []).flat();
  const out = [];
  let t = 0, tiedFrom = null;
  flat.forEach((e, i) => {
    if (!e.rest && !e.cls?.includes('eg-hide')) {
      if (tiedFrom) tiedFrom.len += e.dur;
      else out.push({i, start: t, len: e.dur, notes: example.play === 'rhythm' || !e.pitches ? [RHYTHM_PITCH] : e.pitches.map(midi)});
      tiedFrom = e.tie ? (tiedFrom || out.at(-1)) : null;
    } else tiedFrom = null;
    t += e.dur;
  });
  return out;
}

export function playExample(piano, example, {onEvent, velocity = .62} = {}) {
  const qms = 60000 / (example.tempo || 80);
  const evs = soundingEvents(example);
  const lead = 60;
  for (const e of evs) {
    const at = lead + e.start * qms, len = e.len * qms;
    for (const m of e.notes) { try { piano.tone(m, len / 1000 * .92, velocity, at / 1000); } catch {} }
    onEvent?.(e.i, at, len);
  }
  const end = evs.reduce((a, e) => Math.max(a, e.start + e.len), 0);
  return lead + end * qms;
}

/** Plays MIDI notes: one after another (gapMs apart) or together (gapMs = 0). */
export function playNotes(piano, notes, {gapMs = 650, lenMs = 900, velocity = .62, delayMs = 60} = {}) {
  notes.forEach((m, i) => { try { piano.tone(m, lenMs / 1000, velocity, (delayMs + i * gapMs) / 1000); } catch {} });
  return delayMs + (notes.length - 1) * gapMs + lenMs;
}
