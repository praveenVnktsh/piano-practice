// Sight-reading levels, one per step of the graded path (src/curriculum/data.js), loosely after
// the ABRSM sight-reading parameters for each grade. Pure data.
//
// level = {
//   id          the curriculum level it belongs to
//   keys        [[key id, 'major' | 'minor']]
//   times       time signatures to choose from
//   bars        4 or 8
//   range       [lowest, highest] MIDI note of the right-hand melody
//   steps       weights of melodic intervals in scale steps: {1: step, 2: third, 3: fourth, …}
//   cells       right-hand rhythm figures (src/rhythm/patterns.js tokens) with weights, per metre kind
//   lh          left-hand style: 'roots' (one long note a bar) | 'fifths' (root + fifth held) |
//               'walk' (root then fifth) | 'broken' (broken triad in crotchets) | 'alberti' (quavers)
//   tempo       crotchet BPM (6/8: the quaver pulse is twice that)
// }
export const SR_LEVELS = [
  {id: 'beginner', name: 'Beginner', short: 'Beginner', grade: 0,
    blurb: 'Four bars in C major, right hand in the five-finger position, a long note in the left hand.',
    keys: [['C', 'major']], times: [[4, 4]], bars: 4, range: [60, 67],
    steps: {0: .6, 1: 6, 2: 2},
    cells: {simple: [['q', 6], ['h', 3]]},
    lh: 'roots', tempo: 66},
  {id: 'grade-1', name: 'Grade 1', short: 'Grade 1', grade: 1,
    blurb: 'C, G and F major or A minor; 4/4 or 3/4; steps and skips over an octave; a held fifth in the left hand.',
    keys: [['C', 'major'], ['G', 'major'], ['F', 'major'], ['A', 'minor']], times: [[4, 4], [3, 4]], bars: 4, range: [60, 72],
    steps: {0: .5, 1: 6, 2: 3, 3: .8, 4: .6},
    cells: {simple: [['q', 6], ['h', 3], ['e e', 1.2], ['dh', .6]]},
    lh: 'fifths', tempo: 72},
  {id: 'grade-2', name: 'Grade 2', short: 'Grade 2', grade: 2,
    blurb: 'Keys to two sharps or flats; dotted rhythms and quavers; a walking left hand.',
    keys: [['C', 'major'], ['G', 'major'], ['D', 'major'], ['F', 'major'], ['Bb', 'major'], ['A', 'minor'], ['E', 'minor'], ['D', 'minor']],
    times: [[2, 4], [3, 4], [4, 4]], bars: 8, range: [59, 74],
    steps: {0: .4, 1: 6, 2: 3, 3: 1, 4: .8, 5: .2},
    cells: {simple: [['q', 6], ['h', 2.5], ['e e', 2.5], ['dq e', 1.2], ['rq', .3]]},
    lh: 'walk', tempo: 76},
  {id: 'grade-3', name: 'Grade 3', short: 'Grade 3', grade: 3,
    blurb: 'Keys to three sharps or flats, 6/8 time, leaps to a sixth, and broken chords in the left hand.',
    keys: [['C', 'major'], ['G', 'major'], ['D', 'major'], ['A', 'major'], ['F', 'major'], ['Bb', 'major'], ['Eb', 'major'],
      ['A', 'minor'], ['E', 'minor'], ['B', 'minor'], ['D', 'minor'], ['G', 'minor'], ['C', 'minor']],
    times: [[3, 4], [4, 4], [6, 8]], bars: 8, range: [57, 77],
    steps: {0: .4, 1: 6, 2: 3, 3: 1.2, 4: 1, 5: .5},
    cells: {simple: [['q', 5], ['h', 2], ['e e', 3], ['dq e', 1.5], ['rq', .3]], compound: [['dq', 3], ['q e', 4], ['e e e', 3], ['dh', .5]]},
    lh: 'broken', tempo: 80},
  {id: 'grade-4', name: 'Grade 4', short: 'Grade 4', grade: 4,
    blurb: 'Keys to four sharps or flats, syncopation, wider leaps, and an Alberti bass in quavers.',
    keys: [['G', 'major'], ['D', 'major'], ['A', 'major'], ['E', 'major'], ['F', 'major'], ['Bb', 'major'], ['Eb', 'major'], ['Ab', 'major'],
      ['E', 'minor'], ['B', 'minor'], ['Fs', 'minor'], ['D', 'minor'], ['G', 'minor'], ['C', 'minor'], ['F', 'minor']],
    times: [[2, 4], [3, 4], [4, 4], [6, 8]], bars: 8, range: [57, 79],
    steps: {0: .3, 1: 6, 2: 3, 3: 1.4, 4: 1.2, 5: .6, 7: .3},
    cells: {simple: [['q', 5], ['e e', 3.5], ['dq e', 1.5], ['e q e', 1], ['h', 1.5], ['re e', .4]], compound: [['dq', 2], ['q e', 4], ['e e e', 3.5], ['e q', .8]]},
    lh: 'alberti', tempo: 84},
  {id: 'grade-5', name: 'Grade 5', short: 'Grade 5', grade: 5,
    blurb: 'Any key to four sharps or flats, semiquavers, and an Alberti bass under a wider melody.',
    keys: [['D', 'major'], ['A', 'major'], ['E', 'major'], ['Bb', 'major'], ['Eb', 'major'], ['Ab', 'major'], ['Db', 'major'],
      ['B', 'minor'], ['Fs', 'minor'], ['Cs', 'minor'], ['G', 'minor'], ['C', 'minor'], ['F', 'minor']],
    times: [[2, 4], [3, 4], [4, 4], [6, 8]], bars: 8, range: [55, 81],
    steps: {0: .3, 1: 6, 2: 3, 3: 1.5, 4: 1.2, 5: .7, 7: .4},
    cells: {simple: [['q', 4], ['e e', 3.5], ['dq e', 1.5], ['e q e', 1], ['s s e', .8], ['e s s', .8], ['h', 1]], compound: [['dq', 1.5], ['q e', 4], ['e e e', 3.5], ['e q', .8]]},
    lh: 'alberti', tempo: 88},
];
export const srLevelById = id => SR_LEVELS.find(l => l.id === id) || null;
