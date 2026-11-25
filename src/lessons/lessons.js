// First lessons for the absolute beginner (docs/ROADMAP.md, Phase 13): finding your way around
// the keys, finger numbers and posture, middle-C position, and first five-finger tunes.
// Pure data and logic (no DOM); src/lessons/view.js shows them and feeds in the keys played.
//
// lesson = {id, title, blurb, cards: [card], tasks: (r) => [task], next?: {href, label}}
// card   = {title, text: [paragraph], art?: art id (src/lessons/art.js), example?: engrave() example}
//          paragraphs may use *italic* and **bold**
// task   = one thing to play, checked note by note with step():
//   {kind: 'pc', pcs: [pitch class], count, prompt}          any `count` different keys of that name
//   {kind: 'group', size: 2 | 3, prompt}                     every black key of one group of two / three
//   {kind: 'note', midi, hand?, finger?, position?, prompt}  one exact key (octave matters)
//   {kind: 'tune', notes: [midi], fingers?: [n], hand, staff, durs?: [crotchets], prompt}
//                                                            the notes in order (a slip doesn't restart it)
// Each task also has `hint` (said after a wrong note) and may carry `art` (shown above the keys).
//
// A lesson's score: accuracy = right / (right + wrong) over every key played; PASS or more
// completes it. The view dispatches trainer:result with level 'lesson:<id>'.
import {rng, shuffle} from '../theory/music.js';

export const PASS = 80;
export const LEVEL_PREFIX = 'lesson:';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pcOf = n => ((n % 12) + 12) % 12;
export const noteName = n => NAMES[pcOf(n)];
export const isBlack = n => [1, 3, 6, 8, 10].includes(pcOf(n));
export const MIDDLE_C = 60;

/** The black-key group a key belongs to: {size: 2 | 3, id} (id is unique per group), or null for white keys. */
export function blackGroup(n) {
  const pc = pcOf(n), oct = Math.floor(n / 12);
  if (pc === 1 || pc === 3) return {size: 2, id: oct * 2};
  if (pc === 6 || pc === 8 || pc === 10) return {size: 3, id: oct * 2 + 1};
  return null;
}
const GROUP_PCS = {2: [1, 3], 3: [6, 8, 10]};

// ───────── Hand positions ─────────
// For each position and hand, the key under fingers 1–5.
export const POSITIONS = {
  c: {name: 'C position', r: [60, 62, 64, 65, 67], l: [55, 53, 52, 50, 48]},           // RH C4–G4, LH C3–G3 (5 on C3)
  'middle-c': {name: 'Middle-C position', r: [60, 62, 64, 65, 67], l: [60, 59, 57, 55, 53]}, // both thumbs on middle C
};
export const HAND = {r: 'Right hand', l: 'Left hand'};
/** The key a finger plays in a position: fingerNote('c', 'r', 3) → 64 (E4). */
export const fingerNote = (position, hand, finger) => POSITIONS[position]?.[hand]?.[finger - 1] ?? null;

// ───────── Checking what was played ─────────

export const startTask = () => ({played: [], pos: 0, group: null, done: false});

/**
 * One key played during a task → {state, verdict}: 'ok' (right, more to play), 'done' (right and
 * the task is complete), 'wrong', or 'ignore' (nothing to judge: the task is done, or the key
 * repeats one already counted).
 */
export function step(task, state, n) {
  const s = {...state, played: [...state.played]};
  if (s.done || typeof n !== 'number') return {state: s, verdict: 'ignore'};
  const finish = () => { s.done = true; return {state: s, verdict: 'done'}; };
  switch (task.kind) {
    case 'pc': {
      if (!task.pcs.includes(pcOf(n))) return {state: s, verdict: 'wrong'};
      if (s.played.includes(n)) return {state: s, verdict: 'ignore'};
      s.played.push(n);
      return s.played.length >= (task.count || 1) ? finish() : {state: s, verdict: 'ok'};
    }
    case 'group': {
      const g = blackGroup(n);
      if (!g || g.size !== task.size) return {state: s, verdict: 'wrong'};
      if (s.group !== g.id) { s.group = g.id; s.played = []; } // moved to another group: start it afresh
      if (s.played.includes(pcOf(n))) return {state: s, verdict: 'ignore'};
      s.played.push(pcOf(n));
      return s.played.length >= task.size ? finish() : {state: s, verdict: 'ok'};
    }
    case 'note':
      if (n !== task.midi) return {state: s, verdict: 'wrong'};
      s.played.push(n);
      return finish();
    case 'tune': {
      if (n !== task.notes[s.pos]) return {state: s, verdict: 'wrong'};
      s.played.push(n);
      s.pos++;
      return s.pos >= task.notes.length ? finish() : {state: s, verdict: 'ok'};
    }
  }
  return {state: s, verdict: 'ignore'};
}

/** Keys to light up as a hint, within [lo, hi]: where the answer is (after a slip), or the next tune note. */
export function targets(task, state = startTask(), lo = 48, hi = 84) {
  const out = [];
  for (let n = lo; n <= hi; n++) {
    if (task.kind === 'pc' && task.pcs.includes(pcOf(n)) && !state.played.includes(n)) out.push(n);
    if (task.kind === 'group' && GROUP_PCS[task.size].includes(pcOf(n))) out.push(n);
  }
  if (task.kind === 'note') out.push(task.midi);
  if (task.kind === 'tune' && state.pos < task.notes.length) out.push(task.notes[state.pos]);
  return out.filter(n => n >= lo && n <= hi);
}

/** Totals for a finished lesson: {right, wrong, accuracy (0–100), passed}. */
export function score(right, wrong) {
  const n = right + wrong;
  const accuracy = n ? Math.round(100 * right / n) : 0;
  return {right, wrong, accuracy, passed: n > 0 && accuracy >= PASS};
}

// ───────── Task builders ─────────
const fingerTask = (position, hand, finger) => {
  const midi = fingerNote(position, hand, finger);
  return {kind: 'note', midi, hand, finger, position, art: 'hand-' + hand,
    prompt: `${HAND[hand]}, finger ${finger}`,
    detail: `In ${POSITIONS[position].name}. Which key is under it?`,
    hint: `${HAND[hand]} finger ${finger} rests on ${noteName(midi)}${midi === MIDDLE_C ? ' — middle C' : ''}.`};
};
const Q = 1, H = 2, W = 4;
const tune = (title, hand, notes, fingers, durs, extra = {}) => ({
  kind: 'tune', title, hand, notes, fingers, durs, staff: hand === 'l' ? 'bass' : 'treble',
  prompt: title, detail: `${HAND[hand]}${extra.position ? `, ${extra.position}` : ''}. Read the notes and play them in order.`,
  hint: 'Find the note the brass key shows, then carry on from there.', ...extra,
});
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67;
const C3 = 48, D3 = 50, E3 = 52, F3 = 53, G3 = 55, A3 = 57, B3 = 59;

// ───────── The lessons ─────────
export const LESSONS = [
  {
    id: 'keyboard', title: 'Finding your way', blurb: 'The pattern of black keys, and how to find C, D and E anywhere on the piano.',
    cards: [
      {title: 'Twos and threes', art: 'groups', text: [
        'Look at the black keys: they come in **groups of two** and **groups of three**, all the way up the keyboard.',
        'This pattern is your map. Every white key is named by where it sits beside a group.']},
      {title: 'C, D and E', art: 'cde', text: [
        '**C** is the white key just to the left of a group of two black keys. **D** sits between the two, and **E** just to the right.',
        'There is a C beside every group of two — find them all, from the bottom of the piano to the top.']},
      {title: 'Middle C', art: 'middle-c', text: [
        '**Middle C** is the C nearest the middle of the piano, usually just in front of the maker’s name.',
        'It is home for both hands in your first pieces. On the keys below it is marked in brass.']},
    ],
    tasks(r) {
      const middle = shuffle(r, [
        {kind: 'pc', pcs: [2], count: 1, prompt: 'Play a D', detail: 'Any D on the piano.', hint: 'D sits between the two black keys.'},
        {kind: 'pc', pcs: [4], count: 1, prompt: 'Play an E', detail: 'Any E on the piano.', hint: 'E is just to the right of a group of two black keys.'},
        {kind: 'pc', pcs: [0], count: 3, prompt: 'Play three different Cs', detail: 'Three Cs in different places.', hint: 'Every C is just left of a group of two black keys.'},
      ]);
      return [
        {kind: 'group', size: 2, art: 'group-2', prompt: 'Play a group of two black keys', detail: 'Both keys of one group, one after the other.', hint: 'Look for two black keys close together.'},
        {kind: 'group', size: 3, art: 'group-3', prompt: 'Play a group of three black keys', detail: 'All three keys of one group.', hint: 'Look for three black keys close together.'},
        {kind: 'pc', pcs: [0], count: 1, prompt: 'Play a C', detail: 'Any C on the piano.', hint: 'C is the white key just left of a group of two black keys.'},
        ...middle,
        {kind: 'note', midi: MIDDLE_C, prompt: 'Play middle C', detail: 'The C nearest the middle of the piano.', hint: 'Middle C is the C nearest the centre — marked in brass below.'},
        {kind: 'pc', pcs: [2], count: 2, prompt: 'Play two different Ds', detail: 'In two different places.', hint: 'Each D sits between two black keys.'},
      ];
    },
  },
  {
    id: 'fingers', title: 'Fingers and posture', blurb: 'How to sit, the shape of the hand, and the finger numbers used in every score.',
    cards: [
      {title: 'Sitting at the piano', art: 'posture', text: [
        'Sit on the front half of the bench, facing middle C, feet flat on the floor.',
        'Your forearms should be about level with the keys, elbows a little in front of your body, shoulders loose.']},
      {title: 'The shape of the hand', art: 'hand-shape', text: [
        'Let your hands hang by your sides, then lift them to the keys without changing their shape: the fingers stay gently **curved**, as if holding a ball.',
        'Play on the tips of the fingers, and on the side tip of the thumb. Keep the wrist level and soft.']},
      {title: 'Finger numbers', art: 'hands', text: [
        'In piano music the fingers are numbered: the **thumb is 1**, then 2, 3, 4, and the **little finger is 5**. The same numbers for both hands.',
        'Small numbers above or below the notes tell you which finger to use.']},
      {title: 'C position', art: 'c-position', text: [
        'Put your **right thumb on middle C** and let the other fingers rest on D, E, F and G — one finger per key.',
        'For the left hand, put the **little finger on the C below** middle C; the thumb lands on G. This is *C position*.']},
    ],
    tasks(r) {
      // Eight different questions out of the ten fingers, so each hand comes up at least three times.
      const all = ['r', 'l'].flatMap(hand => [1, 2, 3, 4, 5].map(f => [hand, f]));
      return shuffle(r, all).slice(0, 8).map(([hand, f]) => fingerTask('c', hand, f));
    },
  },
  {
    id: 'middle-c', title: 'Middle-C position', blurb: 'Both thumbs share middle C: nine notes under ten fingers, read on the grand staff.',
    cards: [
      {title: 'Both thumbs on middle C', art: 'middle-c-position', text: [
        'Put **both thumbs on middle C**. The right hand rests on C D E F G; the left hand reaches down over B A G F.',
        'Together the hands cover nine white keys without moving.']},
      {title: 'On the grand staff', text: [
        'Right-hand notes are written on the **treble staff**, left-hand notes on the **bass staff**. Middle C sits on a little line of its own between them.',
        'Listen to the notes from the left hand’s little finger up to the right hand’s little finger.'],
      example: {staff: 'grand', time: null, barlines: false, final: false, play: 'notes', tempo: 100,
        measures: [[F3, G3, A3, B3, C4, D4, E4, F4, G4].map(m => ({dur: 1, pitches: [toPitch(m, m < C4 ? 'bass' : 'treble')]}))]}},
    ],
    tasks(r) {
      const fingers = shuffle(r, [['l', 2], ['l', 4], ['r', 3], ['r', 5], ['l', 5], ['r', 2]]).slice(0, 4).map(([h, f]) => fingerTask('middle-c', h, f));
      return [
        tune('Right hand up', 'r', [C4, D4, E4, F4, G4], [1, 2, 3, 4, 5], [Q, Q, Q, Q, W], {position: 'middle-C position'}),
        tune('Left hand down', 'l', [C4, B3, A3, G3, F3], [1, 2, 3, 4, 5], [Q, Q, Q, Q, W], {position: 'middle-C position', staff: 'bass'}),
        ...fingers,
        tune('Hand to hand', 'both', [G3, A3, B3, C4, D4, E4, D4, C4], [4, 3, 2, 1, 2, 3, 2, 1], [Q, Q, Q, Q, Q, Q, Q, Q],
          {position: 'middle-C position', staff: 'grand', hands: ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r'], detail: 'Left hand up to middle C, then the right hand takes over.'}),
      ];
    },
  },
  {
    id: 'first-tunes', title: 'First tunes', blurb: 'Five notes, five fingers: short tunes in C position, read from the staff.',
    cards: [
      {title: 'One finger per key', art: 'c-position', text: [
        'In C position every finger has its own key, so you never need to look down for long: the finger number tells you the note.',
        'Read each tune slowly. The next key lights up in brass if you lose your way.']},
      {title: 'Steps and skips', text: [
        'When the next note is on the neighbouring line or space it is a **step** — the next finger. When it jumps a line or space, it is a **skip** — miss out a finger.',
        'Hear the difference: steps first, then skips.'],
      example: {staff: 'treble', time: [4, 4], play: 'notes', tempo: 96, measures: [
        [{dur: 1, pitches: [toPitch(C4)]}, {dur: 1, pitches: [toPitch(D4)]}, {dur: 1, pitches: [toPitch(E4)]}, {dur: 1, pitches: [toPitch(F4)]}],
        [{dur: 1, pitches: [toPitch(C4)]}, {dur: 1, pitches: [toPitch(E4)]}, {dur: 2, pitches: [toPitch(G4)]}]]}},
    ],
    tasks() {
      return [
        tune('Up and down', 'r', [C4, D4, E4, F4, G4, F4, E4, D4, C4], [1, 2, 3, 4, 5, 4, 3, 2, 1], [Q, Q, Q, Q, H, Q, Q, Q, 3], {position: 'C position'}),
        tune('Hot Cross Buns', 'r', [E4, D4, C4, E4, D4, C4], [3, 2, 1, 3, 2, 1], [Q, Q, H, Q, Q, H], {position: 'C position'}),
        tune('Skipping', 'r', [C4, E4, G4, E4, C4], [1, 3, 5, 3, 1], [Q, Q, H, Q, 3], {position: 'C position'}),
        tune('Mary Had a Little Lamb', 'r', [E4, D4, C4, D4, E4, E4, E4], [3, 2, 1, 2, 3, 3, 3], [Q, Q, Q, Q, Q, Q, H], {position: 'C position'}),
        tune('Left hand up', 'l', [C3, D3, E3, F3, G3], [5, 4, 3, 2, 1], [Q, Q, Q, Q, W], {position: 'C position'}),
        tune('Au clair de la lune', 'l', [C3, C3, C3, D3, E3, D3], [5, 5, 5, 4, 3, 4], [Q, Q, Q, Q, H, H], {position: 'C position'}),
        tune('Ode to Joy', 'r', [E4, E4, F4, G4, G4, F4, E4, D4], [3, 3, 4, 5, 5, 4, 3, 2], [Q, Q, Q, Q, Q, Q, Q, Q], {position: 'C position'}),
      ];
    },
    next: {href: '#/play/hot-cross-buns', label: 'Your first piece: Hot Cross Buns'},
  },
];

/** MIDI → an engrave() pitch (white keys and sharps), with the staff for a grand-staff example. */
export function toPitch(m, clef) {
  const STEPS = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
  const [step, alter] = STEPS[pcOf(m)];
  return {step, alter, octave: Math.floor(m / 12) - 1, ...(clef ? {clef} : {})};
}

/** A tune task as an engrave() example (one bar per four crotchets), fingers as labels above. */
export function tuneExample(task) {
  const durs = task.durs || task.notes.map(() => 1);
  const grand = task.staff === 'grand';
  const measures = [];
  let bar = [], len = 0;
  task.notes.forEach((m, i) => {
    // On a grand staff each note goes to its hand's staff (middle C can be either).
    const hand = task.hands?.[i] ?? (m < C4 ? 'l' : 'r');
    bar.push({dur: durs[i], pitches: [toPitch(m, grand ? (hand === 'l' ? 'bass' : 'treble') : undefined)],
      ...(task.fingers ? {above: String(task.fingers[i])} : {})});
    len += durs[i];
    if (len >= 4 - 1e-9) { measures.push(bar); bar = []; len = 0; }
  });
  if (bar.length) {
    // Fill the last bar with a rest so it adds up.
    if (len > 0) bar.push({dur: 4 - len, rest: true});
    measures.push(bar);
  }
  return {staff: task.staff || 'treble', time: [4, 4], measures, play: 'notes', tempo: 92};
}

export const lessonById = id => LESSONS.find(l => l.id === id) || null;
/** A lesson's tasks for a seed (the same seed gives the same tasks). */
export const lessonTasks = (lesson, seed) => lesson.tasks(rng(seed));

/** 'lesson:keyboard' → 'keyboard' (null for other levels). */
export const lessonOfLevel = level => (typeof level === 'string' && level.startsWith(LEVEL_PREFIX) ? level.slice(LEVEL_PREFIX.length) : null);

/**
 * Lessons passed, from a progress document (src/progress/model.js): best accuracy per lesson id,
 * from the running totals (which survive pruning) and any raw events.
 */
export function lessonBests(doc) {
  const out = {...(doc?.totals?.skills?.lesson?.levels || {})};
  for (const e of doc?.events || []) {
    const id = e.type === 'trainer:result' ? lessonOfLevel(e.level) : null;
    if (id) out[id] = Math.max(out[id] ?? 0, e.accuracy ?? 0);
  }
  return out;
}
