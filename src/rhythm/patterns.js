// Rhythm trainer: levels, pattern generation and tap grading (pure, no DOM).
//
// A pattern is a few bars of events {dur (crotchets), rest?, tie?, tuplet?} built from "cells":
// short figures that each fill one beat (or two), chosen at random (seeded) to fill each bar.
// Timing is graded with the play-along windows (src/score-core.mjs TIMING): within ±120 ms
// is on time, within ±250 ms early/late, otherwise a miss; taps that match no note are extra.
import {TIMING} from '../score-core.mjs';
import {rng, weighted} from '../theory/music.js';

// Cell tokens: w h dh q dq e de s (semibreve … semiquaver), t = triplet quaver, r-prefix = rest,
// ~ suffix = tied to the next note.
const TOKEN = {w: 4, dh: 3, h: 2, dq: 1.5, q: 1, de: .75, e: .5, s: .25, t: 1 / 3};
export function parseCell(text) {
  return text.trim().split(/\s+/).map(tok => {
    const m = /^(r?)(w|dh|h|dq|q|de|e|s|t)(~?)$/.exec(tok);
    if (!m) throw Error('Bad rhythm token ' + tok);
    const ev = {dur: TOKEN[m[2]]};
    if (m[1]) ev.rest = true;
    if (m[3]) ev.tie = true;
    if (m[2] === 't') ev.tuplet = 3;
    return ev;
  });
}
const cellLength = cell => cell.reduce((a, e) => a + e.dur, 0);

// cells: [text, weight]; `bars` per pattern; `times` time signatures; `tempo` crotchet BPM
// (compound time: the dotted crotchet beat is tempo / 1.5).
export const RHYTHM_LEVELS = [
  {id: 'crotchets', name: 'Crotchets and minims', short: 'Crotchets', times: [[4, 4]], bars: 2, tempo: 80,
    blurb: 'One tap for each note: crotchets are one beat, minims two. Rests are silent beats.',
    cells: [['q', 6], ['h', 3], ['rq', 1]]},
  {id: 'long-notes', name: 'Long notes', short: 'Long notes', times: [[4, 4], [3, 4]], bars: 2, tempo: 84,
    blurb: 'Dotted minims (three beats) and semibreves (four). Count through the long notes.',
    cells: [['q', 5], ['h', 3], ['dh', 2], ['w', 1], ['rq', 1], ['rh', .5]]},
  {id: 'quavers', name: 'Quavers', short: 'Quavers', times: [[2, 4], [3, 4], [4, 4]], bars: 2, tempo: 76,
    blurb: 'Two quavers share a beat: “one-and”.',
    cells: [['q', 4], ['e e', 4], ['h', 1.5], ['rq', 1]]},
  {id: 'dotted', name: 'Dotted rhythms', short: 'Dotted', times: [[3, 4], [4, 4]], bars: 2, tempo: 72,
    blurb: 'A dotted crotchet lasts a beat and a half; its quaver falls on the “and” of the next beat.',
    cells: [['dq e', 4], ['q', 4], ['e e', 3], ['h', 1.5], ['re e', 1.5]]},
  {id: 'syncopation', name: 'Syncopation', short: 'Syncopation', times: [[4, 4], [2, 4]], bars: 2, tempo: 72,
    blurb: 'Accents off the beat: quaver–crotchet–quaver, quaver rests and ties across the beat.',
    cells: [['e q e', 4], ['re e', 3], ['e e', 3], ['q', 3], ['e e~ e e', 2], ['dq e', 1.5], ['q~ e e', 1]]},
  {id: 'semiquavers', name: 'Semiquavers', short: 'Semiquavers', times: [[2, 4], [4, 4]], bars: 2, tempo: 66,
    blurb: 'Four semiquavers to a beat, and the dotted-quaver “skip”.',
    cells: [['s s s s', 3], ['e s s', 3], ['s s e', 2], ['de s', 2], ['e e', 3], ['q', 3]]},
  {id: 'triplets', name: 'Triplets', short: 'Triplets', times: [[2, 4], [3, 4], [4, 4]], bars: 2, tempo: 66,
    blurb: 'Three even quavers in the time of two. Keep them round, not lopsided.',
    cells: [['t t t', 4], ['q', 4], ['e e', 3], ['h', 1], ['rq', .7]]},
  {id: 'compound', name: 'Six-eight', short: '6/8', times: [[6, 8]], bars: 2, tempo: 96,
    blurb: 'Two dotted-crotchet beats in a bar, each split in three: “one-and-a, two-and-a”.',
    cells: [['dq', 3], ['q e', 4], ['e e e', 4], ['e q', 1.5], ['re e e', 1], ['dh', 1.5]]},
];
export const rhythmLevelById = id => RHYTHM_LEVELS.find(l => l.id === id) || RHYTHM_LEVELS[0];
export const barLength = ([beats, unit]) => beats * 4 / unit;
const beatOf = ([beats, unit]) => (unit === 8 && beats % 3 === 0 ? 1.5 : 4 / unit);

/**
 * One bar from a level's cells ({cells: [[text, weight]]}): fills the bar exactly, every figure starts
 * on a beat, the first bar doesn't open with a rest and the last doesn't end on one.
 */
export function fillBar(level, time, r, {first = false, last = false} = {}) {
  const len = barLength(time), beat = beatOf(time);
  const cells = level.cells.map(([text, w]) => ({cell: parseCell(text), w}));
  for (let attempt = 0; attempt < 200; attempt++) {
    const out = [];
    let pos = 0, ok = true;
    while (pos < len - 1e-6) {
      const room = len - pos;
      const options = cells.filter(({cell}) => {
        const l = cellLength(cell);
        if (l > room + 1e-6) return false;
        // Figures start on a beat; a minim in 4/4 doesn't start on beat 2 (it would hide the middle of the bar).
        if (Math.abs(pos / beat - Math.round(pos / beat)) > 1e-6) return false;
        if (time[0] === 4 && time[1] === 4 && l === 2 && cell.length === 1 && Math.abs(pos - 1) < 1e-6) return false;
        if (l === 3 && pos > 1e-6) return false;
        if (l === 4 && pos > 1e-6) return false;
        return true;
      });
      if (!options.length) { ok = false; break; }
      const {cell} = weighted(r, options.map(o => [o, o.w]));
      out.push(...cell.map(e => ({...e})));
      pos += cellLength(cell);
    }
    if (!ok) continue;
    if (first && out[0].rest) continue;
    if (out.every(e => e.rest)) continue;
    if (last && (out.at(-1).rest || out.at(-1).tie)) continue;
    if (out.at(-1).tie) continue;                              // ties stay inside the bar
    return out;
  }
  return [{dur: len}];
}

/** generateRhythm(levelId, seed) → {level, time, tempo, bars: [[event]], onsets: [crotchets], seed}. */
export function generateRhythm(levelId, seed = 1, {bars} = {}) {
  const level = rhythmLevelById(levelId);
  const r = rng(seed);
  const time = level.times[Math.floor(r() * level.times.length)];
  const n = bars ?? level.bars;
  const out = [];
  for (let i = 0; i < n; i++) out.push(fillBar(level, time, r, {first: i === 0, last: i === n - 1}));
  return {level: level.id, time, tempo: level.tempo, bars: out, onsets: onsetsOf(out), seed};
}

/** Start times (crotchets from the first beat) of every tapped note: not rests, not tied-over continuations. */
export function onsetsOf(bars) {
  const out = [];
  let t = 0, tiedIn = false;
  for (const bar of bars) for (const e of bar) {
    if (!e.rest && !tiedIn) out.push(+t.toFixed(6));
    tiedIn = !e.rest && !!e.tie;
    t += e.dur;
  }
  return out;
}
/** Which event (index in the flattened bars) starts each onset — for colouring the notes. */
export function onsetEvents(bars) {
  const out = [];
  let i = 0, tiedIn = false;
  for (const bar of bars) for (const e of bar) {
    if (!e.rest && !tiedIn) out.push(i);
    tiedIn = !e.rest && !!e.tie;
    i++;
  }
  return out;
}

/**
 * Grade taps (ms) against expected onsets (ms): each tap takes the nearest unclaimed note within
 * the window. → {notes: [{at, tap, delta, result: 'perfect'|'early'|'late'|'miss'}], extra, right,
 *   wrong, accuracy (0–100), timing: {early, late, onTime}, avgAbsMs}
 */
export function gradeTaps(expected, taps, {perfect = TIMING.perfect, window = TIMING.window} = {}) {
  const notes = expected.map(at => ({at, tap: null, delta: null, result: 'miss'}));
  let extra = 0;
  for (const tap of [...taps].sort((a, b) => a - b)) {
    let best = -1, bestAbs = Infinity;
    notes.forEach((n, i) => {
      if (n.tap != null) return;
      const d = Math.abs(tap - n.at);
      if (d <= window && d < bestAbs) { best = i; bestAbs = d; }
    });
    if (best < 0) { extra++; continue; }
    const n = notes[best];
    n.tap = tap; n.delta = Math.round(tap - n.at);
    n.result = Math.abs(n.delta) <= perfect ? 'perfect' : n.delta < 0 ? 'early' : 'late';
  }
  const hit = notes.filter(n => n.tap != null);
  const right = hit.length, wrong = notes.length - right + extra;
  const timing = {early: hit.filter(n => n.result === 'early').length, late: hit.filter(n => n.result === 'late').length, onTime: hit.filter(n => n.result === 'perfect').length};
  return {notes, extra, right, wrong, accuracy: right + wrong ? Math.round(100 * right / (right + wrong)) : 0, timing,
    avgAbsMs: hit.length ? Math.round(hit.reduce((a, n) => a + Math.abs(n.delta), 0) / hit.length) : null};
}

/** Clicks for a count-in and the pattern: [{beat (crotchets from the pattern start, negative = count-in), accent}]. */
export function clickTrack(time, bars, {countIn = 1} = {}) {
  const len = barLength(time), beat = beatOf(time);
  const compound = beat === 1.5;
  const out = [];
  // Count-in: in compound time click every quaver so the triple feel is heard.
  const step = compound ? .5 : beat;
  for (let t = -countIn * len; t < -1e-6; t += step) {
    const inBar = ((t % len) + len) % len;
    out.push({beat: +t.toFixed(6), accent: Math.abs(inBar) < 1e-6, count: true});
  }
  for (let t = 0; t < bars * len - 1e-6; t += beat) out.push({beat: +t.toFixed(6), accent: Math.abs(t % len) < 1e-6});
  return out;
}

/** A short spoken count for the figure, e.g. "1 2 & 3 4" — shown under the staff for beginners. */
export function countLabels(time, bars) {
  const beat = beatOf(time), out = [];
  for (const bar of bars) {
    let pos = 0;
    for (const e of bar) {
      const b = pos / beat, whole = Math.abs(b - Math.round(b)) < 1e-6;
      const frac = b - Math.floor(b + 1e-6);
      let label;
      if (whole) label = String(Math.round(b) + 1);
      else if (beat === 1.5) label = Math.abs(frac - 1 / 3) < 1e-3 ? '&' : 'a';
      else if (Math.abs(frac - .5) < 1e-3) label = '&';
      else if (e.tuplet) label = Math.abs(frac - 1 / 3) < 1e-3 ? 'la' : 'li';
      else label = Math.abs(frac - .25) < 1e-3 ? 'e' : 'a';
      out.push(e.rest ? `(${label})` : label);
      pos += e.dur;
    }
  }
  return out;
}
