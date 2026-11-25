// @vitest-environment jsdom
// Performance marks (dynamics, hairpins, pedal, slurs, staccato) read from the
// MEI Verovio makes of a MusicXML file.
import {beforeAll, describe, expect, test} from 'vitest';

import {buildScore, scoreMarks} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';

const n = (s, o, notations = '') =>
  `<note><pitch><step>${s}</step><octave>${o}</octave></pitch><duration>1</duration><type>quarter</type>${notations ? `<notations>${notations}</notations>` : ''}</note>`;
const dir = inner => `<direction placement="below"><direction-type>${inner}</direction-type></direction>`;
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${dir('<dynamics><p/></dynamics>')}${dir('<pedal type="start"/>')}
${n('C', 4, '<slur type="start" number="1"/>')}${n('D', 4)}${n('E', 4, '<slur type="stop" number="1"/>')}${n('F', 4, '<articulations><staccato/></articulations>')}
</measure><measure number="2">
${dir('<wedge type="crescendo"/>')}${n('G', 4)}${n('A', 4)}${dir('<wedge type="stop"/>')}${dir('<dynamics><f/></dynamics>')}${n('B', 4)}${dir('<pedal type="stop"/>')}${n('C', 5)}
</measure></part></score-partwise>`;

let score;
beforeAll(async () => {
  const tk = await createToolkit();
  tk.setOptions({expandAlways: true, breaks: 'none'});
  tk.loadData(xml);
  score = buildScore(tk);
});

describe('score marks', () => {
  test('dynamics at their beats', () => {
    expect(score.marks.dynamics).toEqual([{t: 0, mark: 'p', staff: 1}, {t: 6, mark: 'f', staff: 1}]);
  });
  test('hairpins with their end', () => {
    expect(score.marks.hairpins).toEqual([{t: 4, end: 6, form: 'cres', staff: 1}]);
  });
  test('pedal marks', () => {
    expect(score.marks.pedals.map(p => p.dir)).toEqual(['down', 'up']);
    expect(score.marks.pedals[0].t).toBe(0);
    expect(score.marks.pedals[1].t).toBeCloseTo(6.9, 5);
  });
  test('slurs from note to note', () => {
    expect(score.marks.slurs).toEqual([{start: 0, end: 2, staff: null}]);
  });
  test('staccato notes are flagged', () => {
    expect(score.events.filter(e => e.stacc).map(e => e.t)).toEqual([3]);
  });
  test('scoreMarks copes with a score without marks', () => {
    const doc = new DOMParser().parseFromString('<mei><measure xml:id="m"/></mei>', 'application/xml');
    expect(scoreMarks(doc, [{id: 'm', start: 0, end: 4}])).toEqual({dynamics: [], hairpins: [], pedals: [], slurs: []});
  });
});
