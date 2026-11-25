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
  const keyOf = keySignatures(mei);

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
    return {id: attr(el, 'xml:id'), label: pickup ? 'Pickup' : n, index: i, visit, pickup, meter: meterOf.get(el), key: keyOf.get(el)};
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
  const stacc = staccatoIds(mei);
  const events = segments.filter(s => s.root === s.id).map(s => ({...s, d: tail.get(s.id) - s.t, ...(stacc.has(s.id) ? {stacc: true} : {})}));
  for (const seg of segments) seg.measure = measures.findIndex(m => m.start <= seg.t && seg.t < m.end);
  const marks = scoreMarks(mei, measures, id => byId.get(id)?.t);

  // Score tempo (quarter notes per minute) if the file states one.
  const bpm = +(meiText.match(/midi\.bpm="([\d.]+)"/)?.[1] ?? NaN);
  const tempo = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : null;

  return {measures, segments, events, end, tempo, marks, mei: meiText};
}

// ───────── Performance marks ─────────
// Dynamics, hairpins, pedal marks and slurs from the MEI, timed in quarter notes:
// {dynamics: [{t, mark, staff}], hairpins: [{t, end, form: 'cres' | 'dim', staff}],
//  pedals: [{t, dir: 'down' | 'up' | 'bounce'}], slurs: [{start, end, staff}]}.
// Control events are placed by @startid when it names a timed note, else by
// @tstamp (1-based beats of the meter's unit) in their measure; @tstamp2
// ("1m+2") or @endid gives a hairpin's or slur's end.
export function scoreMarks(mei, measures, timeOfId = () => undefined) {
  const out = {dynamics: [], hairpins: [], pedals: [], slurs: []};
  const byId = new Map(measures.map((m, i) => [m.id, i]));
  const ref = v => (v || '').trim().split(/\s+/)[0].replace(/^#/, '');
  const staffOf = el => parseInt(el.getAttribute('staff'), 10) || null;
  const beatTime = (mi, ts) => {
    const m = measures[mi];
    if (!m || !Number.isFinite(ts)) return undefined;
    const unit = m.meter?.unit || 4;
    return Math.min(m.end, m.start + Math.max(0, ts - 1) * 4 / unit);
  };
  const startOf = (el, mi) => timeOfId(ref(el.getAttribute('startid'))) ?? beatTime(mi, parseFloat(el.getAttribute('tstamp')));
  const endOf = (el, mi) => {
    const byEnd = timeOfId(ref(el.getAttribute('endid')));
    if (byEnd != null) return byEnd;
    const m2 = /^(?:(\d+)m\+)?([\d.]+)$/.exec((el.getAttribute('tstamp2') || '').trim());
    if (!m2) return undefined;
    return beatTime(Math.min(measures.length - 1, mi + (+m2[1] || 0)), parseFloat(m2[2]));
  };
  for (const el of mei.getElementsByTagName('measure')) {
    const mi = byId.get(el.getAttribute('xml:id'));
    if (mi == null) continue;
    for (const c of el.children) {
      const name = c.localName;
      if (name === 'dynam') {
        const t = startOf(c, mi), mark = (c.textContent || '').replace(/\s+/g, '').trim();
        if (t != null && mark) out.dynamics.push({t, mark, staff: staffOf(c)});
      } else if (name === 'hairpin') {
        const t = startOf(c, mi), end = endOf(c, mi), form = c.getAttribute('form') === 'dim' ? 'dim' : 'cres';
        if (t != null) out.hairpins.push({t, end: end != null && end > t ? end : measures[mi].end, form, staff: staffOf(c)});
      } else if (name === 'pedal') {
        const t = startOf(c, mi), dir = c.getAttribute('dir') || 'down';
        if (t != null) out.pedals.push({t, dir: dir === 'up' ? 'up' : dir === 'bounce' ? 'bounce' : 'down'});
      } else if (name === 'slur' || name === 'phrase') {
        const start = startOf(c, mi), end = endOf(c, mi);
        if (start != null && end != null && end > start) out.slurs.push({start, end, staff: staffOf(c)});
      }
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.t ?? a.start) - (b.t ?? b.start));
  return out;
}

// Notes marked staccato (or staccatissimo / spiccato): @artic on the note or a child <artic>.
function staccatoIds(mei) {
  const ids = new Set();
  const short = v => /\b(stacc|stacciss|spicc)\b/.test(v || '');
  for (const note of mei.getElementsByTagName('note')) {
    const id = note.getAttribute('xml:id');
    if (!id) continue;
    if (short(note.getAttribute('artic')) || [...note.getElementsByTagName('artic')].some(a => short(a.getAttribute('artic')))) ids.add(id);
  }
  return ids;
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

// The key signature in force at every measure, in document order: {fifths (−7…7, sharps > 0), mode}
// where mode is 'major' | 'minor' when the file says so, else null (src/analysis/harmony.mjs
// decides from the notes). Read from <keySig sig="2s" mode=…> or @key.sig / @key.mode on a
// scoreDef or staffDef; the first staff's signature wins when staves disagree.
function keySignatures(mei) {
  const out = new Map();
  let key = {fifths: 0, mode: null};
  const parse = (sig, mode) => {
    const m = /^(\d)([sf])$/.exec(String(sig || '').trim());
    const fifths = sig === '0' || sig === 0 ? 0 : m ? (m[2] === 's' ? 1 : -1) * +m[1] : null;
    if (fifths == null) return;
    key = {fifths, mode: mode === 'major' || mode === 'minor' ? mode : null};
  };
  let seenInDef = null;
  for (const el of mei.getElementsByTagName('*')) {
    const name = el.localName;
    if (name === 'scoreDef') seenInDef = el;
    if (name === 'keySig' && el.hasAttribute('sig')) {
      const def = el.closest?.('scoreDef');
      const staff = el.closest?.('staffDef')?.getAttribute('n');
      // Within one scoreDef take the first staff's signature (or one set for the whole score).
      if (def && def === seenInDef && staff && staff !== '1' && key.__def === def) continue;
      parse(el.getAttribute('sig'), el.getAttribute('mode'));
      if (def) key.__def = def;
    } else if (el.hasAttribute('key.sig')) parse(el.getAttribute('key.sig'), el.getAttribute('key.mode'));
    else if (name === 'measure') out.set(el, {fifths: key.fifths, mode: key.mode});
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

// The score's own spelling of a note event (B♭4 in G minor, not A♯4), with the written octave
// (C♭5 sounds as B4). `noteNames` is Song.noteNames (notehead id → {name}); null when unknown.
const ALTER = {'𝄫': -2, '♭': -1, '♯': 1, '𝄪': 2};
export function spelledName(noteNames, e) {
  const s = e && noteNames?.get?.(e.id)?.name;
  return s ? s + (Math.floor((e.n - (ALTER[s.slice(1)] || 0)) / 12) - 1) : null;
}
