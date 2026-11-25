// The graded path (docs/ROADMAP.md, Phase 4): Beginner, then Grade 1–5 equivalents, loosely
// modelled on the ABRSM piano syllabus. Pure data; evaluated by ./levels.js.
//
// level = {
//   id, name, short, blurb,
//   grade:      number matched against an optional `grade` field in catalog entries, so pieces
//               added to the library later join the level automatically,
//   repertoire: {ids: [song ids, in suggested order], need: how many must be secure},
//               ids that aren't in the library are skipped; catalog pieces with a matching
//               `grade` that no level lists join their level automatically,
//   technique:  [{id: 'ex:…', label}]   — a pass at ≥ 90 % (a wider or both-hands version counts),
//   reading:    [trainer level ids]     — a drill at ≥ 90 % (src/trainer/levels.js),
//   lessons:    [first-lesson ids]      — optional; each passed once (≥ 80 %, src/lessons/lessons.js),
// }
// Exercise ids follow src/exercises/index.js (keys: s = sharp, b = flat).

const scale = (key, mode, oct, hands = 'both') => `ex:scale:${key}:${mode}:${hands}:${oct}:up-down`;
const arp = (key, quality, oct, hands = 'both') => `ex:arpeggio:${key}:${quality}:${hands}:${oct}`;
const NAME = {s: '♯', b: '♭'};
const keyName = k => k[0] + (NAME[k.slice(1)] || '');
const sc = (key, mode, oct, hands) => ({id: scale(key, mode, oct, hands), label: `${keyName(key)} ${mode === 'major' ? 'major' : 'minor'} scale, ${oct} octave${oct > 1 ? 's' : ''}${hands && hands !== 'both' ? `, ${hands} hand` : ''}`});
const ar = (key, quality, oct) => ({id: arp(key, quality, oct), label: `${keyName(key)} ${quality} arpeggio, ${oct} octave${oct > 1 ? 's' : ''}`});

export const LEVELS = [
  {
    id: 'beginner', name: 'Beginner', short: 'Beginner', grade: 0,
    blurb: 'Your first month: find your way around the keys, the finger numbers and middle C, then five-finger tunes — one hand, then the other, then both.',
    // The first lessons come first; then pieces in learning order (right hand alone, left hand
    // alone, hands taking turns, both hands) and a reading track from C position outwards.
    lessons: ['keyboard', 'fingers', 'middle-c', 'first-tunes'],
    repertoire: {ids: ['hot-cross-buns', 'mary-had-a-little-lamb', 'au-clair-de-la-lune', 'when-the-saints', 'old-macdonald', 'london-bridge',
      'yankee-doodle', 'lightly-row', 'jingle-bells', 'twinkle-twinkle', 'ode-to-joy', 'brahms-lullaby'], need: 6},
    technique: [
      {id: 'ex:five-finger:C:major:both', label: 'C major five-finger position'},
      {id: 'ex:five-finger:G:major:both', label: 'G major five-finger position'},
      sc('C', 'major', 1, 'right'),
      sc('C', 'major', 1, 'left'),
    ],
    reading: ['c-position', 'landmarks', 'treble'],
  },
  {
    id: 'grade-1', name: 'Grade 1', short: 'Grade 1', grade: 1,
    blurb: 'Hands together, simple dance pieces, and the first sharps and flats.',
    repertoire: {ids: ['minuet-in-g', 'bach-minuet-anh116', 'bach-minuet-anh113', 'schumann-melodie'], need: 3},
    technique: [
      sc('C', 'major', 1), sc('G', 'major', 1), sc('F', 'major', 1), sc('D', 'major', 1),
      sc('A', 'harmonic-minor', 1), sc('D', 'harmonic-minor', 1),
      ar('C', 'major', 1),
      {id: 'ex:progression:C:major:I-IV-V-I', label: 'C major cadence I–IV–V–I'},
    ],
    reading: ['bass', 'grand'],
  },
  {
    id: 'grade-2', name: 'Grade 2', short: 'Grade 2', grade: 2,
    blurb: 'Two octaves, steadier rhythm, and pieces with a singing melody over an accompaniment.',
    repertoire: {ids: ['bach-minuet-anh115', 'burgmuller-candeur', 'schumann-soldiers-march', 'tchaikovsky-old-french-song', 'bach-musette-anh126', 'tchaikovsky-morning-prayer', 'schumann-poor-orphan', 'schumann-wild-rider'], need: 3},
    technique: [
      sc('G', 'major', 2), sc('D', 'major', 2), sc('A', 'major', 2), sc('F', 'major', 2), sc('Bb', 'major', 2),
      sc('E', 'harmonic-minor', 2), sc('D', 'harmonic-minor', 2), sc('G', 'harmonic-minor', 2),
      ar('G', 'major', 2), ar('A', 'minor', 2),
      {id: 'ex:chromatic:C:both:1', label: 'Chromatic scale from C, 1 octave'},
    ],
    reading: ['treble-ledger', 'bass-ledger'],
  },
  {
    id: 'grade-3', name: 'Grade 3', short: 'Grade 3', grade: 3,
    blurb: 'Keys with more sharps and flats, Baroque counterpoint, and the first real Romantic miniatures.',
    repertoire: {ids: ['clementi-sonatina-op36-1', 'burgmuller-arabesque', 'bach-little-prelude-bwv939', 'schumann-happy-farmer', 'burgmuller-pastorale', 'tchaikovsky-wooden-soldiers', 'schumann-first-loss'], need: 3},
    technique: [
      sc('A', 'major', 2), sc('E', 'major', 2), sc('B', 'major', 2), sc('Eb', 'major', 2),
      sc('B', 'harmonic-minor', 2), sc('C', 'harmonic-minor', 2), sc('G', 'melodic-minor', 2),
      ar('D', 'major', 2), ar('E', 'minor', 2), ar('Bb', 'major', 2),
      {id: 'ex:chromatic:C:both:2', label: 'Chromatic scale from C, 2 octaves'},
    ],
    reading: ['grand-ledger', 'accidentals'],
  },
  {
    id: 'grade-4', name: 'Grade 4', short: 'Grade 4', grade: 4,
    blurb: 'Three octaves, flats beyond three, and pieces that ask for shape and colour.',
    repertoire: {ids: ['fur-elise', 'bach-prelude-in-c', 'burgmuller-ballade', 'chopin-prelude-op28-7', 'satie-gymnopedie-1', 'kuhlau-sonatina-op20-1', 'czerny-op821-1', 'grieg-albumblatt-op12-7'], need: 3},
    technique: [
      sc('Ab', 'major', 3), sc('Db', 'major', 3), sc('E', 'major', 3),
      sc('Fs', 'harmonic-minor', 3), sc('Cs', 'harmonic-minor', 3), sc('F', 'melodic-minor', 2),
      ar('Eb', 'major', 3), ar('C', 'minor', 3), ar('Fs', 'minor', 2),
      {id: 'ex:progression:A:minor:i-iv-V-i', label: 'A minor cadence i–iv–V–i'},
    ],
    reading: ['keys'],
  },
  {
    id: 'grade-5', name: 'Grade 5', short: 'Grade 5', grade: 5,
    blurb: 'All keys over four octaves, and repertoire you could play for friends.',
    repertoire: {ids: ['moonlight-sonata-1', 'bach-invention-1', 'chopin-prelude-op28-4', 'mozart-sonata-k545-1', 'beethoven-sonata-op49-2-1', 'bach-invention-8', 'chopin-prelude-op28-20'], need: 3},
    technique: [
      sc('B', 'major', 4), sc('Fs', 'major', 4), sc('Db', 'major', 4), sc('Bb', 'major', 4),
      sc('Gs', 'harmonic-minor', 4), sc('Bb', 'melodic-minor', 4), sc('Eb', 'harmonic-minor', 4),
      ar('B', 'major', 4), ar('Gs', 'minor', 4), ar('Db', 'major', 4),
      {id: 'ex:chromatic:Fs:both:2', label: 'Chromatic scale from F♯, 2 octaves'},
    ],
    reading: ['intervals'],
  },
];
