// @vitest-environment jsdom
// User MusicXML (src/musicxml.mjs): parts, pickups, titles, errors — and that what it writes
// plays through buildScore() (Verovio), including repeats and voltas.
import {beforeAll, describe, expect, test} from 'vitest';
import {deflateRawSync} from 'node:zlib';

import {prepareMusicXml, unzipMxl, titleAndComposer} from '../src/musicxml.mjs';
import {buildScore} from '../src/score-core.mjs';
import {createToolkit} from '../src/verovio.js';

const note = (step, octave, dur, type, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${extra}<type>${type}</type></note>`;
const rest = (dur, type) => `<note><rest/><duration>${dur}</duration><type>${type}</type></note>`;
const attrs = ({div = 1, clef = 'G', fifths = 0, beats = 4} = {}) =>
  `<attributes><divisions>${div}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time>` +
  `<clef><sign>${clef}</sign><line>${clef === 'F' ? 4 : 2}</line></clef></attributes>`;

function score({parts, work = '<work><work-title>Test piece</work-title></work>', extra = ''}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">${work}${extra}
 <part-list>${parts.map(p => `<score-part id="${p.id}"><part-name>${p.name}</part-name>${p.program ? `<midi-instrument id="${p.id}-I1"><midi-program>${p.program}</midi-program></midi-instrument>` : ''}</score-part>`).join('')}</part-list>
 ${parts.map(p => `<part id="${p.id}">${p.measures.map((m, i) => `<measure number="${i + 1}"${p.implicit && i === 0 ? ' implicit="yes"' : ''}>${m}</measure>`).join('')}</part>`).join('\n ')}
</score-partwise>`;
}

// Two bars of C major, one staff.
const treble = [attrs() + note('C', 5, 1, 'quarter') + note('D', 5, 1, 'quarter') + note('E', 5, 1, 'quarter') + note('F', 5, 1, 'quarter'), note('G', 5, 4, 'whole')];
const bass = (div = 1) => [attrs({div, clef: 'F'}) + note('C', 3, 2 * div, 'half') + note('G', 2, 2 * div, 'half'), note('C', 3, 4 * div, 'whole')];
// A two-staff piano part.
const grand = [
  attrs().replace('<clef>', '<staves>2</staves><clef number="1">').replace('</clef></attributes>', '</clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>') +
    note('E', 5, 4, 'whole', '<voice>1</voice>').replace('<type>whole</type>', '<type>whole</type><staff>1</staff>') +
    '<backup><duration>4</duration></backup>' + note('C', 3, 4, 'whole', '<voice>5</voice>').replace('<type>whole</type>', '<type>whole</type><staff>2</staff>'),
  note('D', 5, 4, 'whole').replace('<type>whole</type>', '<type>whole</type><staff>1</staff>') +
    '<backup><duration>4</duration></backup>' + note('G', 2, 4, 'whole').replace('<type>whole</type>', '<type>whole</type><staff>2</staff>'),
];

let tk;
beforeAll(async () => { tk = await createToolkit(); }, 30_000);
function build(xml) {
  tk.setOptions({breaks: 'none', expandAlways: true});
  expect(tk.loadData(xml)).toBeTruthy();
  return buildScore(tk);
}

describe('prepareMusicXml(): parts', () => {
  test('a single-part score is left exactly as it is', () => {
    const xml = score({parts: [{id: 'P1', name: 'Piano', measures: treble}]});
    const r = prepareMusicXml(xml);
    expect(r.changed).toBe(false);
    expect(r.xml).toBe(xml);
    expect(r.warnings).toEqual([]);
    expect(r.title).toBe('Test piece');
  });

  test('keeps the two-staff piano part and leaves out the others, with a warning', () => {
    const xml = score({parts: [
      {id: 'P1', name: 'Violin', measures: treble},
      {id: 'P2', name: 'Piano', measures: grand},
    ]});
    const r = prepareMusicXml(xml);
    expect(r.changed).toBe(true);
    expect(r.info.kept).toEqual(['P2']);
    expect(r.warnings.join(' ')).toMatch(/Kept the piano part.*“Violin”/);
    const s = build(r.xml);
    expect(s.events.map(e => e.n).sort((a, b) => a - b)).toEqual([43, 48, 74, 76]);
    expect(new Set(s.events.map(e => e.hand))).toEqual(new Set(['r', 'l']));
  });

  test('a piano found by its General MIDI sound counts as the piano', () => {
    const xml = score({parts: [{id: 'P1', name: 'Flute', program: 74, measures: treble}, {id: 'P2', name: 'Instrument 2', program: 1, measures: bass()}]});
    const r = prepareMusicXml(xml);
    expect(r.info.kept).toEqual(['P2']);
    expect(build(r.xml).events.every(e => e.n < 60)).toBe(true);
  });

  test('joins a piano written as two one-staff parts into one grand staff (right hand above, left below)', () => {
    const xml = score({parts: [{id: 'P1', name: 'Piano RH', measures: treble}, {id: 'P2', name: 'Piano LH', measures: bass()}]});
    const r = prepareMusicXml(xml);
    expect(r.info.merged).toBe(true);
    expect(r.warnings[0]).toMatch(/Joined/);
    const s = build(r.xml);
    expect(s.measures.map(m => [m.start, m.end])).toEqual([[0, 4], [4, 8]]);
    const lh = s.events.filter(e => e.hand === 'l').map(e => [e.n, e.t, e.d]);
    const rh = s.events.filter(e => e.hand === 'r').map(e => [e.n, e.t]);
    expect(lh).toEqual([[48, 0, 2], [43, 2, 2], [48, 4, 4]]);
    expect(rh).toEqual([[72, 0], [74, 1], [76, 2], [77, 3], [79, 4]]);
  });

  test('joins parts with different divisions without changing the rhythm', () => {
    const xml = score({parts: [{id: 'P1', name: 'Right hand', measures: treble}, {id: 'P2', name: 'Left hand', measures: bass(3)}]});
    const r = prepareMusicXml(xml);
    expect(r.info.merged).toBe(true);
    const lh = build(r.xml).events.filter(e => e.hand === 'l').map(e => [e.t, e.d]);
    expect(lh).toEqual([[0, 2], [2, 2], [4, 4]]);
  });

  test('a treble part over a bass part with no names is taken as the two hands', () => {
    const xml = score({parts: [{id: 'P1', name: '', measures: treble}, {id: 'P2', name: '', measures: bass()}]});
    expect(prepareMusicXml(xml).info.merged).toBe(true);
  });

  test('no piano and no pair: every part is kept, with a warning', () => {
    const xml = score({parts: [{id: 'P1', name: 'Flute', measures: treble}, {id: 'P2', name: 'Oboe', measures: treble}, {id: 'P3', name: 'Cello', measures: bass()}]});
    const r = prepareMusicXml(xml);
    expect(r.info.kept).toEqual(['P1', 'P2', 'P3']);
    expect(r.warnings[0]).toMatch(/3 parts.*none is marked as piano/);
  });

  test('drops percussion parts', () => {
    const drum = [attrs({clef: 'percussion'}).replace('<line>2</line>', '') + '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>4</duration><type>whole</type></note>', rest(4, 'whole')];
    const r = prepareMusicXml(score({parts: [{id: 'P1', name: 'Piano', measures: treble}, {id: 'P2', name: 'Drums', measures: drum}]}));
    expect(r.info.kept).toEqual(['P1']);
    expect(r.warnings.join(' ')).toMatch(/percussion/);
    expect(r.xml).not.toContain('Drums');
  });
});

describe('prepareMusicXml(): pickups and titles', () => {
  const pickupMeasures = [
    attrs({beats: 3}) + note('G', 4, 1, 'quarter'),
    note('C', 5, 3, 'half').replace('<type>half</type>', '<type>half</type><dot/>'),
    note('E', 5, 3, 'half').replace('<type>half</type>', '<type>half</type><dot/>'),
  ];

  test('marks a short first bar as a pickup, so it is counted and labelled as one', () => {
    const xml = score({parts: [{id: 'P1', name: 'Piano', measures: pickupMeasures}]});
    const r = prepareMusicXml(xml);
    expect(r.info.pickup).toBe(true);
    expect(r.changed).toBe(true);
    const s = build(r.xml);
    expect(s.measures[0].pickup).toBe(true);
    expect(s.measures[0].label).toBe('Pickup');
    expect(s.measures.map(m => m.end - m.start)).toEqual([1, 3, 3]);
  });

  test('an already-marked pickup is left alone', () => {
    const xml = score({parts: [{id: 'P1', name: 'Piano', implicit: true, measures: pickupMeasures}]});
    const r = prepareMusicXml(xml);
    expect(r.info.pickup).toBe(true);
    expect(r.changed).toBe(false);
  });

  test('a full first bar is not a pickup', () => {
    expect(prepareMusicXml(score({parts: [{id: 'P1', name: 'Piano', measures: treble}]})).info.pickup).toBe(false);
  });

  test('titles without <work-title>: movement title, then the title credit, then the largest credit, then the file name', () => {
    const doc = s => new DOMParser().parseFromString(s, 'application/xml');
    const credit = (words, type, size) => `<credit page="1">${type ? `<credit-type>${type}</credit-type>` : ''}<credit-words font-size="${size}">${words}</credit-words></credit>`;
    expect(titleAndComposer(doc('<score-partwise><movement-title>Allegro</movement-title></score-partwise>')).title).toBe('Allegro');
    expect(titleAndComposer(doc(`<score-partwise>${credit('Arr. by me', '', 10)}${credit('Sonatina', 'title', 12)}</score-partwise>`)).title).toBe('Sonatina');
    expect(titleAndComposer(doc(`<score-partwise>${credit('Composer Name', '', 10)}${credit('Big Title', '', 24)}</score-partwise>`)).title).toBe('Big Title');
    expect(titleAndComposer(doc('<score-partwise/>'), 'my_lovely-piece.musicxml').title).toBe('my lovely piece');
    const r = prepareMusicXml(score({work: '', extra: '<identification><creator type="composer">A. Composer</creator></identification>', parts: [{id: 'P1', name: 'Piano', measures: treble}]}), {fileName: 'waltz.xml'});
    expect(r).toMatchObject({title: 'waltz', composer: 'A. Composer'});
  });
});

describe('prepareMusicXml(): clear errors', () => {
  test('not XML', () => expect(() => prepareMusicXml('<score-partwise><part>')).toThrow(/isn’t valid XML/));
  test('timewise MusicXML', () => expect(() => prepareMusicXml('<score-timewise version="3.1"><part-list/></score-timewise>')).toThrow(/timewise/));
  test('some other XML', () => expect(() => prepareMusicXml('<svg/>')).toThrow(/doesn’t look like MusicXML/));
  test('no notes', () => expect(() => prepareMusicXml(score({parts: [{id: 'P1', name: 'Piano', measures: [attrs() + rest(4, 'whole')]}]}))).toThrow(/no notes/));
  test('percussion only', () => {
    const drum = [attrs({clef: 'percussion'}) + '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>4</duration><type>whole</type></note>'];
    expect(() => prepareMusicXml(score({parts: [{id: 'P1', name: 'Drums', measures: drum}]}))).toThrow(/percussion/);
  });
  test('MEI passes through', () => {
    const mei = '<mei xmlns="http://www.music-encoding.org/ns/mei"><meiHead><fileDesc><titleStmt><title>An MEI piece</title></titleStmt></fileDesc></meiHead></mei>';
    expect(prepareMusicXml(mei)).toMatchObject({changed: false, xml: mei, title: 'An MEI piece'});
  });
});

describe('repeats and voltas (Verovio writes them out)', () => {
  test('|: 1 2 [1. 3 :] [2. 4] plays 1 2 3 1 2 4', () => {
    const fwd = '<barline location="left"><repeat direction="forward"/></barline>';
    const end1 = '<barline location="left"><ending number="1" type="start"/></barline>';
    const end1stop = '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>';
    const end2 = '<barline location="left"><ending number="2" type="start"/></barline>';
    const end2stop = '<barline location="right"><ending number="2" type="discontinue"/></barline>';
    const measures = [
      fwd + attrs() + note('C', 5, 4, 'whole'),
      note('D', 5, 4, 'whole'),
      end1 + note('E', 5, 4, 'whole') + end1stop,
      end2 + note('F', 5, 4, 'whole') + end2stop,
    ];
    const r = prepareMusicXml(score({parts: [{id: 'P1', name: 'Piano', measures}]}));
    const s = build(r.xml);
    expect(s.measures.map(m => m.label)).toEqual(['1', '2', '3', '1', '2', '4']);
    expect(s.measures.map(m => m.visit)).toEqual([1, 1, 1, 2, 2, 1]);
    expect(s.events.map(e => e.n)).toEqual([72, 74, 76, 72, 74, 77]);
  });
});

describe('unzipMxl()', () => {
  // A minimal zip writer (local headers + central directory), stored or deflated.
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const [name, text, deflate] of files) {
      const raw = enc.encode(text), data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw, nm = enc.encode(name);
      const local = new Uint8Array(30 + nm.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, deflate ? 8 : 0, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nm.length, true);
      local.set(nm, 30);
      const cen = new Uint8Array(46 + nm.length), cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, deflate ? 8 : 0, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, offset, true);
      cen.set(nm, 46);
      parts.push(local, data); central.push(cen);
      offset += local.length + data.length;
    }
    const size = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  const container = '<container><rootfiles><rootfile full-path="score/piece.musicxml"/></rootfiles></container>';

  test('reads the rootfile named in META-INF/container.xml (deflated)', async () => {
    const bytes = zip([['META-INF/container.xml', container, false], ['other.xml', '<nope/>', false], ['score/piece.musicxml', '<score-partwise>yes</score-partwise>', true]]);
    expect(await unzipMxl(bytes)).toBe('<score-partwise>yes</score-partwise>');
  });
  test('falls back to the first .musicxml / .xml outside META-INF', async () => {
    expect(await unzipMxl(zip([['a.musicxml', '<score-partwise/>', false]]))).toBe('<score-partwise/>');
  });
  test('says so when the zip is damaged or empty', async () => {
    await expect(unzipMxl(new Uint8Array([1, 2, 3]))).rejects.toThrow(/damaged/);
    await expect(unzipMxl(zip([['META-INF/container.xml', '<container/>', false]]))).rejects.toThrow(/no score/);
  });
});
