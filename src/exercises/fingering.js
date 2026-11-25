// Standard piano fingerings for scales, arpeggios, five-finger patterns and chromatic scales.
//
// Source: the conventional fingerings printed in the ABRSM "Piano Scales & Arpeggios" manuals
// (Grades 1–5) and Hanon, "The Virtuoso Pianist" Nos. 39 (scales) and 41 (arpeggios); these are
// the same fingerings found in most method books. Entries marked `uncertain: true` have more than
// one accepted fingering in common use; the one given is a standard choice, not the only one.
//
// Fingerings depend on the physical keys only, so tables are keyed by the tonic's pitch class
// (0 = C … 11 = B): F♯ and G♭ major share one entry, as do E♭ and D♯ minor.
//
// Scale entry: 'ddddddd|m|t' = fingers for degrees 1–7 ascending (degree 1 = the starting
// finger at the bottom), m = the finger on the tonic when the scale passes through it in a
// middle octave, t = the finger on the top tonic. Descending uses the same finger on each note.

const SCALES = {
  major: {
    rh: {
      0: '1231234|1|5', 1: '2312341|2|2', 2: '1231234|1|5', 3: '3123412|3|3', 4: '1231234|1|5', 5: '1234123|1|4',
      6: '2341231|2|2', 7: '1231234|1|5', 8: '3412312|3|3', 9: '1231234|1|5', 10: '2123123|4|4', 11: '1231234|1|5',
    },
    lh: {
      0: '5432132|1|1', 1: '3214321|3|3', 2: '5432132|1|1', 3: '3214321|3|3', 4: '5432132|1|1', 5: '5432132|1|1',
      6: '4321321|4|4', 7: '5432132|1|1', 8: '3214321|3|3', 9: '5432132|1|1', 10: '3214321|3|3', 11: '4321432|1|1',
    },
  },
  'harmonic-minor': {
    rh: {
      0: '1231234|1|5', 1: '3412312|3|3', 2: '1231234|1|5', 3: '3123412|3|3', 4: '1231234|1|5', 5: '1234123|1|4',
      6: '3412312|3|3', 7: '1231234|1|5', 8: '3412312|3|3', 9: '1231234|1|5', 10: '2123123|4|4', 11: '1231234|1|5',
    },
    lh: {
      0: '5432132|1|1', 1: '3214321|3|3', 2: '5432132|1|1', 3: '2143213|2|2', 4: '5432132|1|1', 5: '5432132|1|1',
      6: '4321321|4|4', 7: '5432132|1|1', 8: '3214321|3|3', 9: '5432132|1|1', 10: '2132143|2|2', 11: '4321432|1|1',
    },
  },
};
// Natural and melodic minor use the harmonic-minor fingering except where a changed note would
// put the thumb on a black key (G♯ natural minor LH: F♯ instead of F𝄪; F♯ and C♯ melodic
// minor RH ascending: D♯ / A♯ instead of D / A).
const OVERRIDES = {
  'natural-minor': {rh: {}, lh: {8: '3213214|3|3'}},
  'melodic-minor': {rh: {1: '2312341|2|2', 6: '2312341|2|2'}, lh: {}},
};

const UNCERTAIN_SCALES = new Set(['harmonic-minor:lh:10', 'harmonic-minor:lh:3', 'natural-minor:lh:8', 'melodic-minor:rh:1', 'melodic-minor:rh:6']);

function parseScaleEntry(s) {
  const [deg, mid, top] = s.split('|');
  return {degrees: [...deg].map(Number), mid: +mid, top: +top};
}

/** Table entry {degrees: [7], mid, top, uncertain} for a scale form ('major', '…-minor'). */
export function scaleTable(pc, mode, hand) {
  const h = hand === 'left' || hand === 'lh' ? 'lh' : 'rh';
  pc = ((pc % 12) + 12) % 12;
  const over = OVERRIDES[mode]?.[h]?.[pc];
  const base = SCALES[mode === 'major' ? 'major' : 'harmonic-minor'][h][pc];
  if (!base) throw Error('No fingering for ' + mode);
  return {...parseScaleEntry(over ?? base), uncertain: UNCERTAIN_SCALES.has(`${mode}:${h}:${pc}`)};
}

function ascending(entry, octaves) {
  const n = octaves * 7;
  return Array.from({length: n + 1}, (_, i) => (i === 0 ? entry.degrees[0] : i === n ? entry.top : i % 7 === 0 ? entry.mid : entry.degrees[i % 7]));
}

/**
 * Fingers for a scale up and back down: `up` has 7·octaves + 1 notes (bottom tonic to top tonic),
 * `down` has 7·octaves notes (the note below the top back to the bottom tonic). Melodic minor goes
 * up in the melodic form and down in the natural form; the top note takes the descending finger.
 */
export function scaleFingering(pc, mode, hand, octaves = 1) {
  const upMode = mode, downMode = mode === 'melodic-minor' ? 'natural-minor' : mode;
  const upSeq = ascending(scaleTable(pc, upMode, hand), octaves);
  const downSeq = ascending(scaleTable(pc, downMode, hand), octaves);
  upSeq[upSeq.length - 1] = downSeq[downSeq.length - 1];
  return {up: upSeq, down: downSeq.slice(0, -1).reverse()};
}

// Root-position arpeggios: start = finger on the bottom root, cycle = fingers on [third, fifth,
// root above] while the arpeggio continues, top = finger on the final top root.
const A = (start, cycle, top, uncertain) => ({start, cycle: [...cycle].map(Number), top, uncertain: !!uncertain});
const RH_WHITE = A(1, '231', 5), LH_WHITE = A(5, '421', 1);
const RH_BLACK = A(4, '124', 4), LH_BLACK = A(2, '142', 2);
const ARPEGGIOS = {
  major: {
    rh: {0: RH_WHITE, 1: RH_BLACK, 2: RH_WHITE, 3: RH_BLACK, 4: RH_WHITE, 5: RH_WHITE, 6: A(1, '231', 5, true), 7: RH_WHITE, 8: RH_BLACK, 9: RH_WHITE, 10: A(2, '124', 4, true), 11: RH_WHITE},
    lh: {0: LH_WHITE, 1: LH_BLACK, 2: LH_WHITE, 3: LH_BLACK, 4: LH_WHITE, 5: LH_WHITE, 6: A(5, '321', 1, true), 7: LH_WHITE, 8: LH_BLACK, 9: LH_WHITE, 10: A(3, '213', 3, true), 11: A(4, '321', 1)},
  },
  minor: {
    rh: {0: RH_WHITE, 1: RH_BLACK, 2: RH_WHITE, 3: A(1, '231', 5, true), 4: RH_WHITE, 5: RH_WHITE, 6: RH_BLACK, 7: RH_WHITE, 8: RH_BLACK, 9: RH_WHITE, 10: A(2, '312', 4, true), 11: RH_WHITE},
    lh: {0: LH_WHITE, 1: LH_BLACK, 2: LH_WHITE, 3: A(5, '321', 1, true), 4: LH_WHITE, 5: A(5, '421', 1, true), 6: LH_BLACK, 7: LH_WHITE, 8: LH_BLACK, 9: LH_WHITE, 10: A(3, '213', 3, true), 11: A(5, '421', 1, true)},
  },
};

export function arpeggioTable(pc, quality, hand) {
  const h = hand === 'left' || hand === 'lh' ? 'lh' : 'rh';
  return ARPEGGIOS[quality === 'minor' ? 'minor' : 'major'][h][((pc % 12) + 12) % 12];
}

/** Fingers for an arpeggio up (3·octaves + 1 notes) and back down (3·octaves notes). */
export function arpeggioFingering(pc, quality, hand, octaves = 1) {
  const t = arpeggioTable(pc, quality, hand);
  const n = octaves * 3;
  const up = Array.from({length: n + 1}, (_, i) => (i === 0 ? t.start : i === n ? t.top : t.cycle[(i - 1) % 3]));
  return {up, down: up.slice(0, -1).reverse()};
}

/** Five-finger position: RH 1-2-3-4-5, LH 5-4-3-2-1 (on degrees 1–5). */
export const fiveFingerFingering = hand => (hand === 'left' || hand === 'lh' ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5]);

/**
 * Chromatic scale: 3 on every black key, 1 on white keys, 2 on the white key that follows
 * another white key in the hand's ascending direction (RH: F and C; LH: E and B).
 * A white starting note that would take 2 in the right hand starts with the thumb.
 */
export function chromaticFinger(pc, hand) {
  pc = ((pc % 12) + 12) % 12;
  if (isBlack(pc)) return 3;
  const two = hand === 'left' || hand === 'lh' ? [4, 11] : [0, 5];
  return two.includes(pc) ? 2 : 1;
}
const isBlack = pc => [1, 3, 6, 8, 10].includes(pc);

/** RH close-position triad: root position 1-3-5, first inversion 1-2-5, second inversion 1-3-5. */
export const triadFingering = (inversion, hand = 'right') =>
  hand === 'left' || hand === 'lh' ? [[5, 3, 1], [5, 3, 1], [5, 2, 1]][inversion] : [[1, 3, 5], [1, 2, 5], [1, 3, 5]][inversion];
