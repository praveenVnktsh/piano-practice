// Pure score logic shared by the player and tests: turn a loaded Verovio
// toolkit into measures + note events (times in quarter notes), pick a
// passage, and follow a player through it note group by note group.

// Builds the playable score from a toolkit that already holds a document.
// Repeats: load the data with `expandAlways: true` so Verovio unfolds them
// into a linear score (every measure visit is its own measure element).
export function buildScore(toolkit) {
  toolkit.redoLayout();
  toolkit.renderToMIDI();
  const timemap = toolkit.renderToTimemap({includeMeasures: true});
  const meiText = toolkit.getMEI();
  const mei = new DOMParser().parseFromString(meiText, 'application/xml');
  const attr = (e, k) => e.getAttribute(k);
  const {staffOf, handOf} = staves(mei);
  const meterOf = meters(mei);

  const measureEls = [...mei.getElementsByTagName('measure')];
  const known = new Set(measureEls.map(el => attr(el, 'xml:id')));
  const visits = timemap.filter(r => r.measureOn).map(r => r.measureOn);
  if (new Set(visits).size !== visits.length || visits.some(id => !known.has(id)))
    throw Error('This score has repeats that could not be unfolded. Unfold repeats in a notation editor and re-import it.');

  // Measure labels: the printed number, "Pickup" for an incomplete first bar,
  // and a visit count for measures played again after a repeat.
  const seen = new Map();
  const measures = measureEls.map((el, i) => {
    const n = attr(el, 'n') || String(i + 1);
    const visit = (seen.get(n) || 0) + 1;
    seen.set(n, visit);
    const pickup = i === 0 && attr(el, 'metcon') === 'false';
    return {id: attr(el, 'xml:id'), label: pickup ? 'Pickup' : n, index: i, visit, pickup, meter: meterOf.get(el)};
  });
  const starts = new Map(timemap.filter(r => r.measureOn).map(r => [r.measureOn, r.qstamp]));
  let last = 0;
  for (const m of measures) { m.start = starts.get(m.id) ?? last; last = m.start; }
  const end = timemap.length ? Math.max(...timemap.map(r => r.qstamp)) : 0;
  measures.forEach((m, i) => { m.end = measures[i + 1]?.start ?? end; });

  // Every sounding note piece (tied notes are several segments).
  const segments = [];
  const byId = new Map();
  for (const r of timemap) {
    for (const id of r.on || []) {
      const n = toolkit.getMIDIValuesForElement(id).pitch;
      if (!Number.isFinite(n)) continue;
      const staff = staffOf.get(id) ?? 1;
      const seg = {id, n, t: r.qstamp, end: r.qstamp, root: id, staff, hand: handOf(staff)};
      segments.push(seg);
      byId.set(id, seg);
    }
    for (const id of r.off || []) if (byId.has(id)) byId.get(id).end = r.qstamp;
  }

  // Ties: point every continuation at the first note of its chain.
  const ties = [...mei.getElementsByTagName('tie')]
    .map(e => [(attr(e, 'startid') || '').replace(/^#/, ''), (attr(e, 'endid') || '').replace(/^#/, '')])
    .filter(([a, b]) => a !== b && byId.has(a) && byId.has(b));
  const next = new Map(ties);
  const isTarget = new Set(ties.map(([, b]) => b));
  for (const [a] of ties) {
    if (isTarget.has(a)) continue; // only walk from chain heads
    const seenIds = new Set([a]);
    for (let b = next.get(a); b && !seenIds.has(b); b = next.get(b)) { seenIds.add(b); byId.get(b).root = a; }
  }

  const tail = new Map();
  for (const s of segments) tail.set(s.root, Math.max(tail.get(s.root) ?? -Infinity, s.end));
  const events = segments.filter(s => s.root === s.id).map(s => ({...s, d: tail.get(s.id) - s.t}));
  for (const seg of segments) seg.measure = measures.findIndex(m => m.start <= seg.t && seg.t < m.end);

  // Score tempo (quarter notes per minute) if the file states one.
  const bpm = +(meiText.match(/midi\.bpm="([\d.]+)"/)?.[1] ?? NaN);
  const tempo = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : null;

  return {measures, segments, events, end, tempo, mei: meiText};
}

export function passage(score, first, last) {
  if (first < 0 || last >= score.measures.length || first > last) throw Error('Choose a valid measure range');
  const start = score.measures[first].start, end = score.measures[last].end;
  const events = score.events
    .filter(e => e.t < end && e.t + e.d > start)
    .map(e => ({...e, t: Math.max(start, e.t), d: Math.min(end, e.t + e.d) - Math.max(start, e.t), carried: e.t < start}));
  const groups = [...new Set(events.map(e => e.t))].sort((a, b) => a - b).map(t => {
    const at = events.filter(e => e.t === t);
    return {t, events: at, notes: [...new Set(at.map(e => e.n))]};
  });
  return {start, end, events, groups, first, last};
}

export class FollowNotes {
  constructor(groups) { this.groups = groups; this.reset(); }
  reset() { this.index = 0; this.collected = new Set(); this.active = this.groups.length > 0; }
  get current() { return this.groups[this.index]; }
  // Move past the current group without playing it (groups the app plays).
  skip() {
    if (!this.active) return 'inactive';
    this.index++;
    this.collected.clear();
    if (this.index === this.groups.length) { this.active = false; return 'finished'; }
    return 'advanced';
  }
  attack(n) {
    if (!this.active) return 'inactive';
    if (!this.current.notes.includes(n)) return 'wrong';
    this.collected.add(n);
    if (this.current.notes.some(n => !this.collected.has(n))) return 'partial';
    this.index++;
    this.collected.clear();
    if (this.index === this.groups.length) { this.active = false; return 'finished'; }
    return 'advanced';
  }
}

// ───────── Staves and hands ─────────
// Which staff every note is drawn on (the note's own or its chord's @staff for
// cross-staff notes, else the enclosing <staff n>). Staff 1 is the right hand,
// staff 2 and below the left; a single bass-clef staff is the left hand.
function staves(mei) {
  const staffOf = new Map();
  for (const st of mei.getElementsByTagName('staff')) {
    const sn = parseInt(st.getAttribute('n'), 10) || 1;
    for (const note of st.getElementsByTagName('note')) {
      const cross = note.getAttribute('staff') || note.closest?.('chord')?.getAttribute('staff');
      staffOf.set(note.getAttribute('xml:id'), parseInt(cross, 10) || sn);
    }
  }
  const defs = [...mei.getElementsByTagName('staffDef')];
  const numbers = new Set(defs.map(d => d.getAttribute('n')).filter(Boolean));
  let single = null;
  if (numbers.size <= 1 && defs[0]) {
    const d = defs[0];
    single = d.getAttribute('clef.shape') || d.getElementsByTagName('clef')[0]?.getAttribute('shape') || 'G';
  }
  return {staffOf, handOf: staff => staffHand(staff, single)};
}
export const staffHand = (staff, singleStaffClef = null) =>
  singleStaffClef ? (singleStaffClef === 'F' ? 'l' : 'r') : staff >= 2 ? 'l' : 'r';

// The time signature in force at every measure, in document order.
function meters(mei) {
  const out = new Map();
  let meter = {count: 4, unit: 4};
  for (const el of mei.getElementsByTagName('*')) {
    const name = el.localName;
    if (name === 'meterSig' || el.hasAttribute('meter.count') || el.hasAttribute('meter.sym')) {
      const k = name === 'meterSig' ? '' : 'meter.';
      const sym = el.getAttribute(k + 'sym');
      const count = parseInt(el.getAttribute(k + 'count'), 10), unit = parseInt(el.getAttribute(k + 'unit'), 10);
      if (count > 0 && unit > 0) meter = {count, unit};
      else if (sym === 'common') meter = {count: 4, unit: 4};
      else if (sym === 'cut') meter = {count: 2, unit: 2};
    } else if (name === 'measure') out.set(el, meter);
  }
  return out;
}

// ───────── Beats (metronome) ─────────
// Beat length in quarter notes and beats per bar; compound meters (6/8, 9/8,
// 12/8, …) count dotted beats.
export function beatInfo({count = 4, unit = 4} = {}) {
  const compound = unit >= 8 && count > 3 && count % 3 === 0;
  const len = (compound ? 3 : 1) * 4 / unit, beats = compound ? count / 3 : count;
  return {len, beats, bar: len * beats};
}

// Beats inside one measure: [{t, beat (0-based in the bar), accent}]. A short
// first measure (pickup) is counted from the end so it lands on the last beats.
export function measureBeats(m) {
  const {len, bar} = beatInfo(m.meter);
  const anchor = (m.pickup || (m.index === 0 && m.end - m.start < bar - EPS)) ? m.end - bar : m.start;
  const out = [];
  for (let j = 0; ; j++) {
    const t = anchor + j * len;
    if (t >= m.end - EPS) break;
    if (t >= m.start - EPS) out.push({t, beat: j, accent: j === 0});
  }
  return out;
}

export const beatsOf = measures => measures.flatMap(measureBeats);

// The count-in before a measure: one full bar, plus the beats a pickup skips.
export function countIn(m) {
  const {len, bar} = beatInfo(m.meter);
  const first = measureBeats(m)[0];
  const anchor = first ? first.t - first.beat * len : m.start;
  const from = anchor - bar, out = [];
  for (let j = 0; from + j * len < m.start - EPS; j++) out.push({t: from + j * len, beat: j % Math.round(bar / len), accent: j % Math.round(bar / len) === 0});
  return {from, beats: out};
}
const EPS = 1e-6;

// ───────── Hands ─────────
// Practice groups for one hand (or both): `notes` are the pitches the player
// must play, `auto` the other hand's events, which the app plays itself.
// Notes carried into the passage from before it are neither.
export function handGroups(p, hands = 'both') {
  const want = handFilter(hands);
  const out = [];
  for (const g of p.groups) {
    const fresh = g.events.filter(e => !e.carried);
    const mine = fresh.filter(want), auto = fresh.filter(e => !want(e));
    if (!mine.length && !auto.length) continue;
    out.push({t: g.t, events: mine, notes: [...new Set(mine.map(e => e.n))], auto});
  }
  return out;
}
export const handFilter = hands => hands === 'right' ? e => e.hand !== 'l' : hands === 'left' ? e => e.hand === 'l' : () => true;

// ───────── Play-along timing ─────────
export const TIMING = {perfect: 120, window: 250}; // ms

// How far off (ms, negative = early) a note was: 'perfect', 'early', 'late',
// or null when outside the window (a miss).
export function classifyTiming(deltaMs, {perfect = TIMING.perfect, window = TIMING.window} = {}) {
  const a = Math.abs(deltaMs);
  if (a <= perfect) return 'perfect';
  if (a <= window) return deltaMs < 0 ? 'early' : 'late';
  return null;
}

// Grades a timed pass. Positions are in quarter notes; quarterMs converts
// them to milliseconds at the current tempo.
export class TimedGrader {
  constructor(notes, opts = {}) {
    this.opts = {...TIMING, ...opts};
    this.pending = [...notes].sort((a, b) => a.t - b.t);
    this.grades = new Map();
    this.counts = {perfect: 0, early: 0, late: 0, miss: 0, wrong: 0};
  }
  // A key press at position pos → {result, note}; result is 'perfect' |
  // 'early' | 'late' | 'wrong' (no expected note of that pitch nearby).
  attack(n, pos, quarterMs) {
    let best = null, bestAbs = Infinity;
    for (const note of this.pending) {
      if (note.n !== n) continue;
      const delta = (pos - note.t) * quarterMs;
      if (Math.abs(delta) <= this.opts.window && Math.abs(delta) < bestAbs) { best = note; bestAbs = Math.abs(delta); }
    }
    if (!best) { this.counts.wrong++; return {result: 'wrong', note: null}; }
    const result = classifyTiming((pos - best.t) * quarterMs, this.opts);
    this.pending.splice(this.pending.indexOf(best), 1);
    this.grades.set(best.id, result);
    this.counts[result]++;
    return {result, note: best, deltaMs: (pos - best.t) * quarterMs};
  }
  // Notes whose window has closed by pos become misses; returns them.
  sweep(pos, quarterMs) {
    const missed = this.pending.filter(note => (pos - note.t) * quarterMs > this.opts.window);
    return this.#miss(missed);
  }
  finish() { return this.#miss([...this.pending]); }
  #miss(notes) {
    for (const note of notes) {
      this.pending.splice(this.pending.indexOf(note), 1);
      this.grades.set(note.id, 'miss');
      this.counts.miss++;
    }
    return notes;
  }
  get summary() {
    const {perfect, early, late, miss, wrong} = this.counts;
    const right = perfect + early + late, bad = miss + wrong;
    return {right, wrong: bad, missed: miss, extra: wrong, accuracy: right + bad ? Math.round(100 * right / (right + bad)) : 100,
      timing: {early, late, onTime: perfect}};
  }
}

// ───────── Speed trainer ─────────
// After a clean pass (accuracy ≥ threshold) raise the tempo by `step`, at
// least 1 BPM, never past the target.
export function speedUpTempo(tempo, target, accuracy, {step = .05, threshold = 95} = {}) {
  if (!(accuracy >= threshold) || !(target > tempo)) return tempo;
  return Math.min(target, Math.max(tempo + 1, Math.round(tempo * (1 + step))));
}

// ───────── Mistakes ─────────
// Collects what went wrong in a pass, one entry per moment in the score:
// {measure: '<label>', expected: ['F♯4'], played: ['G4']}. Entries keep their
// first-seen order and the list is capped (default 50).
export class MissLog {
  constructor(limit = 50) { this.limit = limit; this.entries = new Map(); }
  add(key, measure, {expected = [], played = []} = {}) {
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.limit) return;
      entry = {measure: String(measure), expected: [], played: []};
      this.entries.set(key, entry);
    }
    for (const n of expected) if (!entry.expected.includes(n)) entry.expected.push(n);
    for (const n of played) if (!entry.played.includes(n)) entry.played.push(n);
  }
  list() { return [...this.entries.values()].map(e => ({...e, expected: [...e.expected], played: [...e.played]})); }
}
