// Captures a performance as it is played: note on/off with velocity and the sustain pedal,
// timed in ms from the start of the take. Pure (the caller passes performance.now() times),
// so it is unit-tested. The take's notes are [onMs, midi, velocity, durationMs] rows
// (see ./take.mjs).
//
//   const r = new Recorder();  r.start(now);
//   r.noteOn(60, 80, t, 'midi'); r.noteOff(60, t2); r.pedal(127, t3);
//   const {notes, pedal, durationMs, source} = r.stop(now);

export class Recorder {
  constructor({maxNotes = 20000} = {}) {
    this.maxNotes = maxNotes;
    this.reset();
  }
  reset() {
    this.t0 = null; this.running = false;
    this.notes = []; this.held = new Map(); this.pedalLog = []; this.sources = new Set();
    this.lastAt = null; this.pedalValue = 0;
  }
  start(now) {
    this.reset();
    this.t0 = now; this.running = true;
  }
  rel(time) { return Math.max(0, Math.round(time - this.t0)); }
  noteOn(n, velocity, time, source = 'midi') {
    if (!this.running || this.notes.length >= this.maxNotes) return null;
    if (this.held.has(n)) this.noteOff(n, time); // re-struck without a release
    const row = [this.rel(time), n, Math.max(1, Math.min(127, Math.round(velocity) || 1)), null];
    this.notes.push(row);
    this.held.set(n, row);
    this.sources.add(source);
    this.lastAt = time;
    return row;
  }
  noteOff(n, time) {
    if (!this.running) return;
    const row = this.held.get(n);
    if (!row) return;
    row[3] = Math.max(0, this.rel(time) - row[0]);
    this.held.delete(n);
    this.lastAt = time;
  }
  /** Sustain pedal value 0–127 (CC 64); only changes across the half-way point are kept. */
  pedal(value, time) {
    if (!this.running) return;
    const v = Math.max(0, Math.min(127, Math.round(value) || 0));
    if ((v >= 64) === (this.pedalValue >= 64) && this.pedalLog.length) { this.pedalValue = v; return; }
    if (this.pedalLog.length >= 8000) return;
    this.pedalValue = v;
    this.pedalLog.push([this.rel(time), v >= 64 ? 127 : 0]);
  }
  get count() { return this.notes.length; }
  get elapsed() { return this.t0 == null ? 0 : this.lastAt == null ? 0 : this.lastAt - this.t0; }
  /** Ends the take → {notes, pedal, durationMs, source}. Keys still down are released now. */
  stop(now) {
    if (!this.running) return {notes: [], pedal: [], durationMs: 0, source: 'mixed'};
    for (const n of [...this.held.keys()]) this.noteOff(n, now);
    this.running = false;
    const notes = this.notes.map(r => [r[0], r[1], r[2], r[3] ?? 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const pedal = this.pedalLog.slice();
    const durationMs = Math.max(this.rel(now), ...notes.map(r => r[0] + r[3]), ...pedal.map(p => p[0]));
    const source = this.sources.size === 1 ? [...this.sources][0] : 'mixed';
    return {notes, pedal, durationMs, source};
  }
}

/** Drops the silence before the first note (keeps `lead` ms) → {notes, pedal, durationMs, trimmed, …the rest kept}. */
export function trimLead({notes, pedal = [], durationMs, ...rest}, lead = 300) {
  if (!notes.length) return {...rest, notes, pedal, durationMs, trimmed: 0};
  const cut = Math.max(0, notes[0][0] - lead);
  if (!cut) return {...rest, notes, pedal, durationMs, trimmed: 0};
  // A pedal already down before the cut is kept, moved to the new start.
  const before = pedal.filter(p => p[0] < cut).at(-1);
  const kept = pedal.filter(p => p[0] >= cut).map(p => [p[0] - cut, p[1]]);
  if (before && before[1] >= 64 && !(kept[0]?.[0] === 0)) kept.unshift([0, before[1]]);
  return {...rest, notes: notes.map(r => [r[0] - cut, r[1], r[2], r[3]]), pedal: kept, durationMs: Math.max(0, durationMs - cut), trimmed: cut};
}
