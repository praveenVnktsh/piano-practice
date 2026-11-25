// Theory lessons: a few short cards of explanation with engraved, playable examples, then quick
// questions. Pure data and generators (no DOM); src/theory/view.js shows them.
//
// lesson   = {id, title, blurb, cards: [card], questions: (r) => [question]}   (5–10 questions)
// card     = {title, text: [paragraph], example?: example, widget?: 'circle-of-fifths'}
//            paragraphs may use *italic* and **bold**
// example  = {staff, key, time, measures, …engrave() options, play?: 'notes' | 'rhythm', tempo?}
//            'rhythm' plays every note on one pitch (for the one-line rhythm staff)
// question = {prompt, example?, choices: [{id, label}], answer: id, explain}
//          | {prompt, example?, play: {pcs: [pitch classes], count, name}, explain}  — answered on the keys
import {rng, shuffle, pickOne, intervalAbove, intervalById, INTERVALS, chordTones, invert, CHORDS, noteLabel, voiceProgression} from './music.js';
import {parseKey, keyFifths, pitchClass, relativeMinor, pitchName, midi} from '../exercises/theory.js';
import {generateRhythm} from '../rhythm/patterns.js';

const P = (step, octave, alter = 0) => ({step, alter, octave});
const n = (dur, ...pitches) => ({dur, pitches});
const q = dur => ({dur});
const rest = dur => ({dur, rest: true});
const labelled = (ev, label) => ({...ev, label});

/** Choices for a question: the answer plus distractors, shuffled. */
function choose(r, answer, pool, k = 4, label = x => x) {
  const others = shuffle(r, pool.filter(x => x !== answer)).slice(0, k - 1);
  return {choices: shuffle(r, [answer, ...others]).map(x => ({id: String(x), label: label(x)})), answer: String(answer)};
}

// ───────── Keys ─────────
export const CIRCLE = [
  {major: 'C', minor: 'A'}, {major: 'G', minor: 'E'}, {major: 'D', minor: 'B'}, {major: 'A', minor: 'Fs'},
  {major: 'E', minor: 'Cs'}, {major: 'B', minor: 'Gs'}, {major: 'Fs', minor: 'Ds'}, {major: 'Db', minor: 'Bb'},
  {major: 'Ab', minor: 'F'}, {major: 'Eb', minor: 'C'}, {major: 'Bb', minor: 'G'}, {major: 'F', minor: 'D'},
].map(k => ({...k, fifths: keyFifths(parseKey(k.major))}));
const keyName = id => pitchName(parseKey(id));
export function keySignatureText(fifths) {
  if (!fifths) return 'no sharps or flats';
  const list = fifths > 0 ? ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, fifths).map(s => s + '♯') : ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, -fifths).map(s => s + '♭');
  return `${Math.abs(fifths)} ${fifths > 0 ? 'sharp' : 'flat'}${Math.abs(fifths) > 1 ? 's' : ''}: ${list.join(' ')}`;
}
/** The tonic chord of a major key, root position around middle C (for the circle explorer). */
export function tonicTriad(keyId) {
  const t = parseKey(keyId);
  const root = {...t, octave: midi({...t, octave: 4}) > 66 ? 3 : 4};
  return chordTones(root, 'major');
}

// ───────── Lessons ─────────
export const LESSONS = [
  {
    id: 'note-values', title: 'Note values', blurb: 'How long each note lasts: semibreves to semiquavers, dots, rests and ties.',
    cards: [
      {title: 'Counting in beats', text: ['Note values tell you how long to hold each note, counted in beats. In most music the beat is a **crotchet** (♩).',
        'A **minim** lasts two crotchets and a **semibreve** four. A **quaver** is half a crotchet; two of them share a beat and are often joined by a beam.'],
      example: {staff: 'line', time: [4, 4], play: 'rhythm', tempo: 84, measures: [[labelled(q(4), '4')], [labelled(q(2), '2'), labelled(q(2), '2')], [labelled(q(1), '1'), q(1), q(1), q(1)], [labelled(q(.5), '½'), q(.5), q(.5), q(.5), q(.5), q(.5), q(.5), q(.5)]]}},
      {title: 'Dots', text: ['A dot after a note adds **half its value** again.', 'A dotted minim lasts three beats; a dotted crotchet one and a half, so the quaver after it falls on the “and” of the next beat.'],
      example: {staff: 'line', time: [3, 4], play: 'rhythm', tempo: 84, measures: [[labelled(q(3), '3')], [labelled(q(1.5), '1½'), labelled(q(.5), '½'), labelled(q(1), '1')]]}},
      {title: 'Rests', text: ['Every note value has a matching **rest**: a silence of the same length. Count through rests just as carefully as notes.',
        'A semibreve rest hangs below a line; a minim rest sits on top of one.'],
      example: {staff: 'line', time: [4, 4], play: 'rhythm', tempo: 84, measures: [[q(1), rest(1), q(1), rest(1)], [q(2), rest(2)], [q(1), rest(.5), q(.5), q(2)]]}},
      {title: 'Ties', text: ['A **tie** joins two notes of the same pitch into one longer sound: play the first and hold it through the second.',
        'Ties let a note last across a bar line, or across the middle of a bar.'],
      example: {staff: 'line', time: [4, 4], play: 'rhythm', tempo: 84, measures: [[q(1), q(1), q(1), {dur: 1, tie: true}], [q(2), q(2)]]}},
    ],
    questions(r) {
      const BEATS = [[4, 'semibreve'], [3, 'dotted minim'], [2, 'minim'], [1.5, 'dotted crotchet'], [1, 'crotchet'], [.5, 'quaver']];
      const fmt = v => (v === .5 ? '½' : v === 1.5 ? '1½' : String(v));
      const qs = [];
      for (const [beats, name] of shuffle(r, BEATS).slice(0, 4)) {
        qs.push({prompt: 'How many crotchet beats does this note last?', example: {staff: 'line', measures: [[q(beats)]], barlines: false, final: false, play: 'rhythm', tempo: 84},
          ...choose(r, beats, [4, 3, 2, 1.5, 1, .5], 4, fmt), explain: `A ${name}: ${fmt(beats)} beat${beats === 1 ? '' : 's'}.`});
      }
      qs.push({prompt: 'How many quavers make a minim?', ...choose(r, 4, [2, 3, 4, 8]), explain: 'Two quavers to a crotchet, two crotchets to a minim: four.'});
      qs.push({prompt: 'What does a dot after a note do?', choices: shuffle(r, [{id: 'half', label: 'Adds half its value'}, {id: 'double', label: 'Doubles it'}, {id: 'short', label: 'Plays it short'}, {id: 'beat', label: 'Adds one beat'}]), answer: 'half', explain: 'A dot adds half the note’s value again.'});
      const rests = [[4, 'semibreve rest'], [2, 'minim rest'], [1, 'crotchet rest'], [.5, 'quaver rest']];
      const [rb, rn] = pickOne(r, rests);
      qs.push({prompt: 'How many beats of silence?', example: {staff: 'line', measures: [[rest(rb)]], barlines: false, final: false}, ...choose(r, rb, [4, 2, 1, .5], 4, fmt), explain: `A ${rn}: ${fmt(rb)} beat${rb === 1 ? '' : 's'}.`});
      qs.push({prompt: 'Tied notes: how many times do you play the key?', example: {staff: 'line', measures: [[{dur: 2, tie: true}, q(1)]], barlines: false, final: false, play: 'rhythm', tempo: 84},
        ...choose(r, 1, [1, 2, 3]), explain: 'Once: the tie holds the first note through the second.'});
      return shuffle(r, qs).slice(0, 8);
    },
  },
  {
    id: 'time-signatures', title: 'Time signatures', blurb: 'What the two numbers mean, and the feel of 2/4, 3/4, 4/4 and 6/8.',
    cards: [
      {title: 'Two numbers', text: ['The **top number** says how many beats are in each bar. The **bottom number** says what kind of note gets the beat: 4 is a crotchet, 2 a minim, 8 a quaver.',
        'So 3/4 means three crotchet beats in a bar: the waltz.'],
      example: {staff: 'line', time: [3, 4], play: 'rhythm', tempo: 100, measures: [[q(1), q(1), q(1)], [q(2), q(1)], [q(3)]]}},
      {title: 'Two, three and four', text: ['**2/4** marches (strong–weak), **3/4** dances (strong–weak–weak), and **4/4**, *common time*, has a strong first beat and a lighter third.',
        'Listen for where the strong beat falls: that is beat one.'],
      example: {staff: 'line', time: [2, 4], play: 'rhythm', tempo: 100, measures: [[q(1), q(1)], [q(.5), q(.5), q(1)], [q(2)]]}},
      {title: 'Compound time', text: ['In **6/8** there are six quavers in a bar, felt as **two beats** of three: “one-and-a, two-and-a”. Each beat is a dotted crotchet.',
        'Quavers are beamed in threes to show the beats.'],
      example: {staff: 'line', time: [6, 8], play: 'rhythm', tempo: 120, measures: [[q(.5), q(.5), q(.5), q(.5), q(.5), q(.5)], [q(1), q(.5), q(1.5)]]}},
    ],
    questions(r) {
      const qs = [];
      const opts = ['2/4', '3/4', '4/4', '6/8'];
      for (const t of shuffle(r, opts).slice(0, 3)) {
        const time = t.split('/').map(Number);
        const levels = t === '6/8' ? 'compound' : 'quavers';
        let bar = null;
        for (let k = 0; k < 20 && !bar; k++) {
          const g = generateRhythm(levels, Math.floor(r() * 1e6) + 1, {bars: 1});
          if (g.time.join('/') === t) bar = g.bars;
        }
        if (!bar) bar = [time[1] === 8 ? [q(1.5), q(1.5)] : Array.from({length: time[0]}, () => q(4 / time[1]))];
        qs.push({prompt: 'Which time signature fits this bar?', example: {staff: 'line', time, showTime: false, measures: bar, play: 'rhythm', tempo: 96}, ...choose(r, t, opts), explain: `The bar adds up to ${t === '6/8' ? 'six quavers, in two groups of three' : `${time[0]} crotchet beats`}: ${t}.`});
      }
      const [t, beats] = pickOne(r, [['3/4', 3], ['2/4', 2], ['4/4', 4], ['2/2', 4], ['3/8', 1.5]]);
      qs.push({prompt: `How many crotchet beats fit in a bar of ${t}?`, ...choose(r, beats, [1.5, 2, 3, 4, 6], 4, v => (v === 1.5 ? '1½' : String(v))), explain: `${t}: ${t.split('/')[0]} ${{2: 'minims', 4: 'crotchets', 8: 'quavers'}[t.split('/')[1]]} = ${beats === 1.5 ? '1½' : beats} crotchets.`});
      qs.push({prompt: 'In 6/8, how many main beats are there in a bar?', ...choose(r, 2, [2, 3, 6]), explain: 'Two dotted-crotchet beats, each split into three quavers.'});
      qs.push({prompt: 'What does the bottom number 4 mean?', choices: shuffle(r, [{id: 'q', label: 'The beat is a crotchet'}, {id: 'b', label: 'Four beats in a bar'}, {id: 'm', label: 'The beat is a minim'}, {id: 'f', label: 'Play four times'}]), answer: 'q', explain: 'The bottom number names the beat: 4 = crotchet, 2 = minim, 8 = quaver.'});
      qs.push({prompt: 'Which is called common time?', ...choose(r, '4/4', opts), explain: '4/4, sometimes written as a C.'});
      return shuffle(r, qs).slice(0, 7);
    },
  },
  {
    id: 'key-signatures', title: 'Key signatures', blurb: 'Sharps and flats at the start of each line, the circle of fifths and relative minors.',
    cards: [
      {title: 'Why key signatures?', text: ['A scale of G major needs one sharp: F♯. Rather than write it every time, the **key signature** puts it at the start of every line.',
        'Every F in the piece is then played as F♯, unless an accidental says otherwise.'],
      example: {staff: 'treble', key: 1, play: 'notes', tempo: 132, measures: [[n(.5, P('G', 4)), n(.5, P('A', 4)), n(.5, P('B', 4)), n(.5, P('C', 5)), n(.5, P('D', 5)), n(.5, P('E', 5)), n(.5, P('F', 5, 1)), n(.5, P('G', 5))], [n(4, P('G', 4), P('B', 4), P('D', 5))]]}},
      {title: 'Sharp keys', text: ['Sharps are always added in the same order: **F C G D A E B**.', 'To name a sharp key, go up a semitone from the last sharp: three sharps end on G♯, so the key is **A major**.'],
      example: {staff: 'treble', key: 3, barlines: false, final: false, measures: [[{dur: 4, rest: true, cls: 'eg-hide'}]]}},
      {title: 'Flat keys', text: ['Flats come in the opposite order: **B E A D G C F**.', 'The key is the second-to-last flat: three flats (B♭ E♭ A♭) give **E♭ major**. One flat is F major.'],
      example: {staff: 'treble', key: -3, barlines: false, final: false, measures: [[{dur: 4, rest: true, cls: 'eg-hide'}]]}},
      {title: 'The circle of fifths', text: ['Each step clockwise is a fifth higher and adds one sharp; anticlockwise adds one flat. Tap a key to see its signature and hear its chord.'],
        widget: 'circle-of-fifths'},
      {title: 'Relative minors', text: ['Every major key shares its key signature with a **relative minor**, three semitones below: C major and A minor have no sharps or flats; G major and E minor both have F♯.',
        'In the harmonic minor the seventh note is raised with an accidental: G♯ in A minor.'],
      example: {staff: 'treble', key: 0, play: 'notes', tempo: 132, measures: [[n(.5, P('A', 4)), n(.5, P('B', 4)), n(.5, P('C', 5)), n(.5, P('D', 5)), n(.5, P('E', 5)), n(.5, P('F', 5)), n(.5, P('G', 5, 1)), n(.5, P('A', 5))], [n(4, P('A', 4), P('C', 5), P('E', 5))]]}},
    ],
    questions(r) {
      const qs = [];
      const pool = CIRCLE.filter(k => Math.abs(k.fifths) <= 5);
      for (const k of shuffle(r, pool).slice(0, 3)) {
        qs.push({prompt: 'Which major key has this key signature?', example: {staff: 'treble', key: k.fifths, barlines: false, final: false, measures: [[{dur: 4, rest: true, cls: 'eg-hide'}]]},
          ...choose(r, k.major, pool.map(x => x.major), 4, id => `${keyName(id)} major`), explain: `${keySignatureText(k.fifths)} — ${keyName(k.major)} major.`});
      }
      const m = pickOne(r, pool.filter(k => k.fifths));
      qs.push({prompt: 'Which minor key has this key signature?', example: {staff: 'treble', key: m.fifths, barlines: false, final: false, measures: [[{dur: 4, rest: true, cls: 'eg-hide'}]]},
        ...choose(r, m.minor, pool.map(x => x.minor), 4, id => `${keyName(id)} minor`), explain: `It shares ${keyName(m.major)} major’s signature: the relative minor is ${keyName(m.minor)} minor.`});
      const t = pickOne(r, pool.filter(k => k.fifths));
      qs.push({prompt: `Play the keynote (tonic) of ${keyName(t.major)} major.`, play: {pcs: [pitchClass(parseKey(t.major))], count: 1, name: keyName(t.major)}, explain: `${keyName(t.major)} — any octave.`});
      const c = pickOne(r, pool.filter(k => k.fifths));
      qs.push({prompt: `How many ${c.fifths > 0 ? 'sharps' : 'flats'} are there in ${keyName(c.major)} major?`, ...choose(r, Math.abs(c.fifths), [1, 2, 3, 4, 5]), explain: `${keyName(c.major)} major: ${keySignatureText(c.fifths)}.`});
      qs.push({prompt: 'What is the relative minor of C major?', ...choose(r, 'A', ['A', 'E', 'D', 'C'], 4, id => `${id} minor`), explain: 'A minor: no sharps or flats either.'});
      return shuffle(r, qs).slice(0, 7);
    },
  },
  {
    id: 'intervals', title: 'Intervals', blurb: 'The distance between two notes: its number, and whether it is major, minor or perfect.',
    cards: [
      {title: 'Counting letters', text: ['An interval is the distance between two notes. Count the **letter names** from the lower note to the upper, including both: C up to E is C–D–E, a **3rd**.',
        'Same letter, eight apart, is an **octave**.'],
      example: {staff: 'treble', play: 'notes', tempo: 96, measures: [[labelled(n(1, P('C', 4), P('D', 4)), '2nd'), labelled(n(1, P('C', 4), P('E', 4)), '3rd'), labelled(n(1, P('C', 4), P('F', 4)), '4th'), labelled(n(1, P('C', 4), P('G', 4)), '5th')], [labelled(n(1, P('C', 4), P('A', 4)), '6th'), labelled(n(1, P('C', 4), P('B', 4)), '7th'), labelled(n(2, P('C', 4), P('C', 5)), '8ve')]]}},
      {title: 'Major and perfect', text: ['From the keynote of a major scale up to each note of the scale, the 2nd, 3rd, 6th and 7th are **major**; the 4th, 5th and octave are **perfect**.'],
      example: {staff: 'treble', play: 'notes', tempo: 96, measures: [[labelled(n(1, P('C', 4), P('E', 4)), 'M3'), labelled(n(1, P('C', 4), P('G', 4)), 'P5'), labelled(n(1, P('C', 4), P('A', 4)), 'M6'), labelled(n(1, P('C', 4), P('B', 4)), 'M7')]]}},
      {title: 'Minor intervals', text: ['Make a major interval one semitone smaller, keeping the letter names, and it becomes **minor**: C–E is a major 3rd, C–E♭ a minor 3rd.',
        'Major sounds bright, minor darker. Listen to both.'],
      example: {staff: 'treble', play: 'notes', tempo: 80, measures: [[labelled(n(2, P('C', 4), P('E', 4)), 'major 3rd'), labelled(n(2, P('C', 4), P('E', 4, -1)), 'minor 3rd')]]}},
      {title: 'Melodic and harmonic', text: ['Notes played one after the other make a **melodic** interval; played together, a **harmonic** one. The name is the same either way.'],
      example: {staff: 'treble', play: 'notes', tempo: 84, measures: [[n(1, P('D', 4)), n(1, P('A', 4)), n(2, P('D', 4), P('A', 4))]]}},
    ],
    questions(r) {
      const qs = [];
      const ids = ['M2', 'm3', 'M3', 'P4', 'P5', 'M6', 'm6', 'M7', 'P8'];
      const lows = ['C', 'D', 'E', 'F', 'G', 'A'].map(s => P(s, 4));
      for (let i = 0; i < 4; i++) {
        const id = pickOne(r, ids), low = pickOne(r, lows), high = intervalAbove(low, id);
        if (Math.abs(high.alter) > 1) { i--; continue; }
        const iv = intervalById(id);
        qs.push({prompt: 'Name this interval.', example: {staff: 'treble', play: 'notes', tempo: 72, barlines: false, final: false, measures: [[n(2, low, high)]]},
          ...choose(r, id, ids.filter(x => Math.abs(intervalById(x).degree - iv.degree) <= 2), 4, x => cap(intervalById(x).name)), explain: `${noteLabel(low)} up to ${noteLabel(high)}: a ${iv.name}.`});
      }
      for (let i = 0; i < 2; i++) {
        const id = pickOne(r, ['M3', 'P5', 'P4', 'M6', 'm3']), low = pickOne(r, lows.slice(0, 5)), high = intervalAbove(low, id);
        qs.push({prompt: `Play a ${intervalById(id).name} above ${noteLabel(low)}.`, example: {staff: 'treble', play: 'notes', barlines: false, final: false, measures: [[n(2, low)]]},
          play: {pcs: [pitchClass(high)], count: 1, name: noteLabel(high)}, explain: `${noteLabel(high)}: ${intervalById(id).semis} semitones above ${noteLabel(low)}.`});
      }
      qs.push({prompt: 'C up to G: what number is that interval?', ...choose(r, '5th', ['3rd', '4th', '5th', '6th']), explain: 'C D E F G: five letters, a 5th.'});
      qs.push({prompt: 'A major 3rd made one semitone smaller is a…', ...choose(r, 'minor 3rd', ['minor 3rd', 'perfect 3rd', 'major 2nd', 'diminished 4th']), explain: 'Same letters, one semitone smaller: a minor 3rd.'});
      return shuffle(r, qs).slice(0, 8);
    },
  },
  {
    id: 'triads', title: 'Triads and inversions', blurb: 'Three-note chords: major, minor, diminished and augmented, and how inversions change the bass.',
    cards: [
      {title: 'Stacked thirds', text: ['A **triad** is three notes stacked in thirds: the **root**, the **third** and the **fifth**. On C: C, E, G.',
        'In root position the notes sit on three lines or three spaces in a row: easy to spot.'],
      example: {staff: 'treble', play: 'notes', tempo: 72, measures: [[labelled(n(2, P('C', 4), P('E', 4), P('G', 4)), 'C'), labelled(n(2, P('F', 4), P('A', 4), P('C', 5)), 'F')], [labelled(n(2, P('G', 4), P('B', 4), P('D', 5)), 'G'), labelled(n(2, P('C', 4), P('E', 4), P('G', 4)), 'C')]]}},
      {title: 'Four qualities', text: ['**Major**: a major 3rd then a minor 3rd — bright. **Minor**: minor then major — darker.',
        '**Diminished** has two minor 3rds (tense), **augmented** two major 3rds (unsettled).'],
      example: {staff: 'treble', play: 'notes', tempo: 66, measures: [[labelled(n(2, P('C', 4), P('E', 4), P('G', 4)), 'major'), labelled(n(2, P('C', 4), P('E', 4, -1), P('G', 4)), 'minor')], [labelled(n(2, P('C', 4), P('E', 4, -1), P('G', 4, -1)), 'dim.'), labelled(n(2, P('C', 4), P('E', 4), P('G', 4, 1)), 'aug.')]]}},
      {title: 'Inversions', text: ['Move the lowest note up an octave and the chord is **inverted**. With the third in the bass it is in **first inversion**; with the fifth in the bass, **second inversion**.',
        'The chord keeps its name: these are all C major.'],
      example: {staff: 'treble', play: 'notes', tempo: 66, measures: [[labelled(n(2, P('C', 4), P('E', 4), P('G', 4)), 'root'), labelled(n(2, P('E', 4), P('G', 4), P('C', 5)), '1st inv.'), labelled(n(2, P('G', 4), P('C', 5), P('E', 5)), '2nd inv.')]]}},
    ],
    questions(r) {
      const qs = [];
      const roots = ['C', 'D', 'E', 'F', 'G', 'A'].map(s => P(s, 4));
      const QUAL = ['major', 'minor', 'diminished', 'augmented'];
      for (let i = 0; i < 3; i++) {
        const quality = i === 0 ? 'major' : i === 1 ? 'minor' : pickOne(r, QUAL), root = pickOne(r, roots);
        const tones = chordTones(root, quality);
        if (tones.some(t => Math.abs(t.alter) > 1)) { i--; continue; }
        qs.push({prompt: 'What kind of triad is this?', example: {staff: 'treble', play: 'notes', tempo: 66, barlines: false, final: false, measures: [[n(2, ...tones)]]},
          choices: QUAL.map(x => ({id: x, label: cap(x)})), answer: quality, explain: `${tones.map(t => noteLabel(t)).join(' ')}: ${noteLabel(root)} ${quality}.`});
      }
      for (let i = 0; i < 2; i++) {
        const inv = Math.floor(r() * 3), root = pickOne(r, roots.slice(0, 5)), quality = pickOne(r, ['major', 'minor']);
        const tones = invert(chordTones(root, quality), inv);
        qs.push({prompt: 'Which position is this chord in?', example: {staff: 'treble', play: 'notes', tempo: 66, barlines: false, final: false, measures: [[n(2, ...tones)]]},
          choices: [{id: '0', label: 'Root position'}, {id: '1', label: 'First inversion'}, {id: '2', label: 'Second inversion'}], answer: String(inv),
          explain: `${noteLabel(root)} ${quality} with ${noteLabel(tones[0])} in the bass: ${['root position', 'first inversion', 'second inversion'][inv]}.`});
      }
      for (let i = 0; i < 2; i++) {
        const root = pickOne(r, roots), quality = i === 0 ? 'major' : 'minor', tones = chordTones(root, quality);
        qs.push({prompt: `Play ${noteLabel(root)} ${quality === 'major' ? 'major' : 'minor'} — all three notes.`, play: {pcs: tones.map(pitchClass), count: 3, name: tones.map(t => noteLabel(t)).join(' ')},
          explain: `${tones.map(t => noteLabel(t)).join(', ')} in any octave or order.`});
      }
      qs.push({prompt: 'A triad with the fifth in the bass is in…', choices: [{id: '0', label: 'Root position'}, {id: '1', label: 'First inversion'}, {id: '2', label: 'Second inversion'}], answer: '2', explain: 'Fifth in the bass: second inversion.'});
      return shuffle(r, qs).slice(0, 8);
    },
  },
  {
    id: 'cadences', title: 'Cadences', blurb: 'The two chords that end a phrase: perfect, plagal, imperfect and interrupted.',
    cards: [
      {title: 'Musical punctuation', text: ['A **cadence** is the pair of chords at the end of a phrase. Some sound like a full stop, others like a comma or a question.',
        'They are named by their chords, using numbers for the notes of the scale: I is the tonic chord, IV the subdominant, V the dominant.'],
      example: {staff: 'grand', play: 'notes', tempo: 60, measures: [cadence('C', 'major', ['I', 'IV', 'V', 'I'])]}},
      {title: 'Perfect: V – I', text: ['The **perfect cadence** goes from the dominant to the tonic. It sounds finished: the end of most pieces.'],
      example: {staff: 'grand', play: 'notes', tempo: 60, measures: [cadence('C', 'major', ['V', 'I'])]}},
      {title: 'Plagal: IV – I', text: ['The **plagal cadence** goes from the subdominant to the tonic: softer, the “Amen” at the end of a hymn.'],
      example: {staff: 'grand', play: 'notes', tempo: 60, measures: [cadence('C', 'major', ['IV', 'I'])]}},
      {title: 'Imperfect: ? – V', text: ['An **imperfect cadence** ends on the dominant, after any chord (often I or IV). It sounds unfinished, like a comma.'],
      example: {staff: 'grand', play: 'notes', tempo: 60, measures: [cadence('C', 'major', ['I', 'V'])]}},
      {title: 'Interrupted: V – vi', text: ['The **interrupted cadence** sets up a perfect cadence, then lands on chord vi instead of I: a surprise, and the music has to go on.'],
      example: {staff: 'grand', play: 'notes', tempo: 60, measures: [cadence('C', 'major', ['V', 'vi'])]}},
    ],
    questions(r) {
      const qs = [];
      const TYPES = {perfect: ['V', 'I'], plagal: ['IV', 'I'], imperfect: [pickOne(r, ['I', 'IV', 'ii']), 'V'], interrupted: ['V', 'vi']};
      const keys = ['C', 'G', 'F', 'D'];
      for (const type of shuffle(r, Object.keys(TYPES))) {
        const key = pickOne(r, keys), fifths = keyFifths(parseKey(key));
        qs.push({prompt: `Which cadence is this? (${keyName(key)} major)`, example: {staff: 'grand', key: fifths, play: 'notes', tempo: 60, measures: [cadence(key, 'major', TYPES[type], false)]},
          choices: Object.keys(TYPES).map(t => ({id: t, label: cap(t)})), answer: type, explain: `${TYPES[type].join(' – ')}: ${type}.`});
      }
      qs.push({prompt: 'Which cadence sounds most final?', choices: ['perfect', 'imperfect', 'interrupted'].map(t => ({id: t, label: cap(t)})), answer: 'perfect', explain: 'V – I, the perfect cadence.'});
      qs.push({prompt: 'An imperfect cadence ends on which chord?', ...choose(r, 'V', ['I', 'IV', 'V', 'vi']), explain: 'On V, the dominant: it sounds unfinished.'});
      const key = pickOne(r, ['G', 'F', 'D']);
      const v = voiceProgression(parseKey(key), 'major', ['V'])[0];
      qs.push({prompt: `In ${keyName(key)} major, play the root of chord V.`, play: {pcs: [pitchClass(v.chord.root)], count: 1, name: noteLabel(v.chord.root)}, explain: `${noteLabel(v.chord.root)}, the dominant of ${keyName(key)}.`});
      return shuffle(r, qs).slice(0, 7);
    },
  },
];

function cadence(key, mode, numerals, labels = true) {
  return voiceProgression(parseKey(key), mode, numerals).map(c => ({dur: numerals.length > 2 ? 1 : 2, pitches: c.pitches, label: labels ? c.numeral : undefined}));
}
const cap = s => s[0].toUpperCase() + s.slice(1);

export const lessonById = id => LESSONS.find(l => l.id === id) || null;
/** The questions for one attempt (seeded, so a test can reproduce them). */
export function lessonQuestions(lesson, seed = 1) {
  return lesson.questions(rng(seed));
}
/** Is a played set of MIDI notes the answer to a keyboard question? */
export function playedMatches(play, midis) {
  const pcs = new Set(midis.map(m => ((m % 12) + 12) % 12));
  return pcs.size === play.pcs.length && play.pcs.every(p => pcs.has(p));
}
export {INTERVALS, CHORDS, relativeMinor, midi};
