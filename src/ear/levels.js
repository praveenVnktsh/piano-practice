// Ear training: graded levels and question generation (pure, no DOM).
//
// Four kinds — intervals, chords, cadences, melodies (dictation) — each with a few levels.
// makeQuestion(level, r) → {
//   kind, level, prompt,
//   sound: [{notes: [midi], at (crotchets), len (crotchets)}], tempo,   what to play (replayable)
//   choices?: [{id, label}], answer,                                     tap an answer
//   playable?: 'interval' | 'chord' | 'melody',                          or play it back on the keys:
//   target?: {semis} | {quality} | {notes: [midi]}                       see judgePlayed()
//   explain,
// }
import {INTERVALS, intervalById, CHORDS, classifyChord, voiceProgression, midiName, pickOne, shuffle, weighted} from '../theory/music.js';
import {parseKey, scaleRun, midi, pitchName} from '../exercises/theory.js';

const ALL = ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];
const IV_LABEL = {A4: 'Tritone'};
export const intervalLabel = id => IV_LABEL[id] || cap(intervalById(id).name);
const cap = s => s[0].toUpperCase() + s.slice(1);

export const EAR_KINDS = [
  {id: 'intervals', name: 'Intervals', blurb: 'Two notes: name the distance between them, or play it back from any note.', levels: [
    {id: 'int-1', name: 'Seconds, thirds, fifths', intervals: ['M2', 'M3', 'P5', 'P8'], dirs: ['up']},
    {id: 'int-2', name: 'Major and minor', intervals: ['m2', 'M2', 'm3', 'M3', 'P4', 'P5'], dirs: ['up']},
    {id: 'int-3', name: 'Up and down', intervals: ALL, dirs: ['up', 'down']},
    {id: 'int-4', name: 'Together', intervals: ALL, dirs: ['harmonic']},
  ]},
  {id: 'chords', name: 'Chords', blurb: 'Three or four notes at once: bright, dark, tense or strange?', levels: [
    {id: 'chord-1', name: 'Major or minor', qualities: ['major', 'minor']},
    {id: 'chord-2', name: 'Four triads', qualities: ['major', 'minor', 'diminished', 'augmented']},
    {id: 'chord-3', name: 'Inversions', qualities: ['major', 'minor', 'diminished', 'augmented'], inversions: true},
    {id: 'chord-4', name: 'Sevenths', qualities: ['major', 'minor', 'dom7', 'maj7', 'min7']},
  ]},
  {id: 'cadences', name: 'Cadences', blurb: 'A phrase ending, after the key chord: finished, soft, open or a surprise?', levels: [
    {id: 'cad-1', name: 'Perfect or plagal', types: ['perfect', 'plagal']},
    {id: 'cad-2', name: 'Finished or not', types: ['perfect', 'imperfect']},
    {id: 'cad-3', name: 'All four', types: ['perfect', 'plagal', 'imperfect', 'interrupted']},
  ]},
  {id: 'melodies', name: 'Melodies', blurb: 'Hear a short tune, then play it back. The first note is given.', levels: [
    {id: 'dict-1', name: 'Three notes, by step', length: [3, 3], steps: {1: 1}, keys: ['C']},
    {id: 'dict-2', name: 'Four notes', length: [4, 4], steps: {1: 5, 2: 2}, keys: ['C', 'G', 'F']},
    {id: 'dict-3', name: 'Five notes, with leaps', length: [5, 5], steps: {1: 4, 2: 3, 3: 1, 4: 1}, keys: ['C', 'G', 'F', 'D']},
    {id: 'dict-4', name: 'Six notes', length: [6, 6], steps: {1: 4, 2: 3, 3: 1.2, 4: 1.2, 5: .4}, keys: ['C', 'G', 'F', 'D', 'Bb', 'A']},
  ]},
];
export const EAR_LEVELS = EAR_KINDS.flatMap(k => k.levels.map(l => ({...l, kind: k.id})));
export const earLevelById = id => EAR_LEVELS.find(l => l.id === id) || null;
export const QUESTIONS_PER_ROUND = {intervals: 10, chords: 10, cadences: 8, melodies: 6};

export const CADENCES = {
  perfect: {name: 'Perfect', chords: ['V', 'I'], explain: 'V – I: finished.'},
  plagal: {name: 'Plagal', chords: ['IV', 'I'], explain: 'IV – I: the soft “Amen”.'},
  imperfect: {name: 'Imperfect', chords: null, explain: 'Ending on V: open, like a comma.'},
  interrupted: {name: 'Interrupted', chords: ['V', 'vi'], explain: 'V – vi: the surprise.'},
};
const CHORD_LABEL = {major: 'Major', minor: 'Minor', diminished: 'Diminished', augmented: 'Augmented', dom7: 'Dominant 7th', maj7: 'Major 7th', min7: 'Minor 7th'};
export const chordLabel = q => CHORD_LABEL[q];
const shape = q => CHORDS[q].tones.map(id => (q === 'augmented' && id === 'm6' ? 8 : intervalById(id).semis));

export function makeQuestion(level, r) {
  const kind = level.kind;
  if (kind === 'intervals') {
    const id = pickOne(r, level.intervals), dir = pickOne(r, level.dirs), semis = intervalById(id).semis;
    const low = 55 + Math.floor(r() * (72 - 55 - Math.max(0, semis - 12)));
    const [a, b] = dir === 'down' ? [low + semis, low] : [low, low + semis];
    const sound = dir === 'harmonic' ? [{notes: [a, b], at: 0, len: 2.5}] : [{notes: [a], at: 0, len: 1}, {notes: [b], at: 1, len: 1.5}];
    return {kind, level: level.id, prompt: dir === 'harmonic' ? 'Two notes together. Which interval?' : `Which interval${dir === 'down' ? ', going down' : ''}?`,
      sound, tempo: 72, choices: level.intervals.map(x => ({id: x, label: intervalLabel(x)})), answer: id,
      playable: 'interval', target: {semis}, explain: `${midiName(a)} ${dir === 'harmonic' ? 'and' : dir === 'down' ? 'down to' : 'up to'} ${midiName(b)}: ${intervalById(id).name === 'augmented 4th' ? 'a tritone' : 'a ' + intervalById(id).name}.`};
  }
  if (kind === 'chords') {
    const quality = pickOne(r, level.qualities), root = 52 + Math.floor(r() * 12);
    let notes = shape(quality).map(s => root + s);
    let inv = 0;
    if (level.inversions) { inv = Math.floor(r() * 3); for (let i = 0; i < inv; i++) notes = [...notes.slice(1), notes[0] + 12]; }
    return {kind, level: level.id, prompt: 'Which kind of chord?', sound: [{notes, at: 0, len: 2.5}, ...notes.map((m, i) => ({notes: [m], at: 3 + i * .5, len: .5}))], tempo: 80,
      choices: level.qualities.map(q => ({id: q, label: CHORD_LABEL[q]})), answer: quality, playable: 'chord', target: {quality},
      explain: `${pitchNameOf(root)} ${CHORD_LABEL[quality].toLowerCase()}${inv ? `, ${inv === 1 ? 'first' : 'second'} inversion` : ''}.`};
  }
  if (kind === 'cadences') {
    const type = pickOne(r, level.types), key = pickOne(r, ['C', 'G', 'F', 'D', 'Bb', 'A']);
    const chords = CADENCES[type].chords || [pickOne(r, ['I', 'IV', 'ii']), 'V'];
    const v = voiceProgression(parseKey(key), 'major', ['I', ...chords]);
    const sound = [{notes: v[0].pitches.map(midi), at: 0, len: 1.6}, {notes: v[1].pitches.map(midi), at: 2.5, len: 1.4}, {notes: v[2].pitches.map(midi), at: 4, len: 2.4}];
    return {kind, level: level.id, prompt: 'The key chord, then a cadence. Which one?', sound, tempo: 72,
      choices: level.types.map(t => ({id: t, label: CADENCES[t].name})), answer: type,
      explain: `${pitchName(parseKey(key))} major, ${chords.join(' – ')}: ${CADENCES[type].explain}`};
  }
  // melodies: a short stepwise tune from the tonic, kept in an octave and a bit.
  const key = parseKey(pickOne(r, level.keys));
  const scale = scaleRun(key, 'major', key.step === 'C' || key.step === 'D' ? 4 : 3, 15).map(midi);
  const start = scale.findIndex(m => m >= 60);
  const len = level.length[0] + Math.floor(r() * (level.length[1] - level.length[0] + 1));
  const idx = [start];
  while (idx.length < len) {
    const s = +weighted(r, Object.entries(level.steps).map(([k, w]) => [k, w]));
    const cur = idx.at(-1);
    let dir = r() < .5 ? -1 : 1;
    if (cur + dir * s < 0 || cur + dir * s >= scale.length) dir = -dir;
    if (cur + dir * s < 0 || cur + dir * s >= scale.length) continue;
    if (idx.length >= 2 && Math.abs(cur - idx.at(-2)) >= 3 && Math.sign(cur - idx.at(-2)) === dir) dir = -dir; // recover from leaps
    const j = cur + dir * s;
    if (j < 0 || j >= scale.length) continue;
    idx.push(j);
  }
  const notes = idx.map(i => scale[i]);
  return {kind, level: level.id, prompt: `Play it back. It starts on ${midiName(notes[0]).replace(/-?\d+$/, '')}.`, tempo: 84,
    sound: notes.map((m, i) => ({notes: [m], at: i, len: i === notes.length - 1 ? 1.6 : .95})),
    playable: 'melody', target: {notes}, keyName: pitchName(key), explain: notes.map(m => midiName(m).replace(/-?\d+$/, '')).join(' – ') + '.'};
}
const pitchNameOf = m => midiName(m).replace(/-?\d+$/, '');

/** A round of questions for a level, avoiding the same answer three times running. */
export function makeRound(level, r, n = QUESTIONS_PER_ROUND[level.kind]) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 20) {
    const q = makeQuestion(level, r);
    if (q.answer && out.length >= 2 && out.at(-1).answer === q.answer && out.at(-2).answer === q.answer) continue;
    out.push(q);
  }
  return out;
}

/**
 * Judge notes the student played (MIDI numbers, in order) against a playable question.
 * → 'right' | 'wrong' | 'pending' (not enough notes yet).
 * interval: two notes, the same distance (either direction); chord: the same quality, any root and
 * voicing; melody: the same notes in order, in any octave.
 */
export function judgePlayed(q, played) {
  if (q.playable === 'interval') {
    if (played.length < 2) return 'pending';
    return Math.abs(played[1] - played[0]) === q.target.semis ? 'right' : 'wrong';
  }
  if (q.playable === 'chord') {
    const need = CHORDS[q.target.quality].tones.length;
    const pcs = new Set(played.map(m => m % 12));
    if (pcs.size < need) return 'pending';
    const c = classifyChord(played);
    return c && c.quality === q.target.quality ? 'right' : 'wrong';
  }
  if (q.playable === 'melody') {
    const want = q.target.notes;
    for (let i = 0; i < played.length && i < want.length; i++) if ((played[i] - want[i]) % 12 !== 0) return 'wrong';
    return played.length >= want.length ? 'right' : 'pending';
  }
  return 'pending';
}

export {INTERVALS, shuffle};
