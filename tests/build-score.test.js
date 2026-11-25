// @vitest-environment jsdom
// buildScore() runs Verovio (WebAssembly, works under Node) and parses its MEI
// with DOMParser, which jsdom provides.
import {beforeAll, describe, expect, test} from 'vitest';

import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';

const note = (step, octave, dur, type, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${extra}<type>${type}</type></note>`;

// Two 4/4 measures (divisions = 1): C4 D4 E4 F4 | G4 (half, tied) G4 (quarter) r
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
 <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
 <part id="P1">
  <measure number="1">
   <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
   ${note('C', 4, 1, 'quarter')}${note('D', 4, 1, 'quarter')}${note('E', 4, 1, 'quarter')}${note('F', 4, 1, 'quarter')}
  </measure>
  <measure number="2">
   ${note('G', 4, 2, 'half', '<tie type="start"/>').replace('</note>', '<notations><tied type="start"/></notations></note>')}
   ${note('G', 4, 1, 'quarter', '<tie type="stop"/>').replace('</note>', '<notations><tied type="stop"/></notations></note>')}
   <note><rest/><duration>1</duration><type>quarter</type></note>
  </measure>
 </part>
</score-partwise>`;

let score;
beforeAll(async () => {
  const tk = await createToolkit();
  tk.setOptions({breaks: 'none'});
  expect(tk.loadData(xml)).toBeTruthy();
  score = buildScore(tk);
}, 30_000);

describe('buildScore()', () => {
  test('finds the measures with start/end times in quarters', () => {
    expect(score.measures.map(m => [m.label, m.start, m.end])).toEqual([
      ['1', 0, 4],
      ['2', 4, 8],
    ]);
  });

  test('merges tied notes into one event', () => {
    expect(score.events.map(e => [e.n, e.t, e.d])).toEqual([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2, 1],
      [65, 3, 1],
      [67, 4, 3],
    ]);
  });

  test('keeps tied pieces as segments, each with its measure index', () => {
    expect(score.segments.map(s => [s.n, s.t, s.measure])).toEqual([
      [60, 0, 0],
      [62, 1, 0],
      [64, 2, 0],
      [65, 3, 0],
      [67, 4, 1],
      [67, 6, 1],
    ]);
  });
});

// Grand staff in 3/4: staff 1 has a low note (still the right hand), staff 2 a
// high one (still the left hand); hands come from staves, not pitch.
const grand = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
 <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
 <part id="P1">
  <measure number="1">
   <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves>
    <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
   <note><pitch><step>E</step><octave>3</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
   <backup><duration>3</duration></backup>
   <note><pitch><step>G</step><octave>4</octave></pitch><duration>3</duration><voice>5</voice><type>half</type><dot/><staff>2</staff><notations><technical><fingering>3</fingering></technical></notations></note>
  </measure>
 </part>
</score-partwise>`;

describe('buildScore() staves, hands and meter', () => {
  let g;
  beforeAll(async () => {
    const tk = await createToolkit();
    tk.setOptions({breaks: 'none'});
    expect(tk.loadData(grand)).toBeTruthy();
    g = buildScore(tk);
  }, 30_000);

  test('every note carries its staff and hand', () => {
    expect(g.events.map(e => [e.n, e.staff, e.hand]).sort((a, b) => a[0] - b[0])).toEqual([[52, 1, 'r'], [67, 2, 'l']]);
  });

  test('measures carry their time signature', () => {
    expect(g.measures[0].meter).toEqual({count: 3, unit: 4});
    expect(score.measures[0].meter).toEqual({count: 4, unit: 4});
  });

  test('a single treble staff is the right hand', () => {
    expect(score.events.every(e => e.hand === 'r' && e.staff === 1)).toBe(true);
  });
});
