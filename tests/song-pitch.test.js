// @vitest-environment jsdom
// loadSong() reads MusicXML pitches from Verovio's MEI in one pass (src/song.js, "Fast pitches")
// instead of asking Verovio note by note. They must be exactly Verovio's own.
import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {loadSong, meiNotePitch} from '../src/song.js';
import {createToolkit} from '../src/verovio.js';
import {buildScore} from '../src/score-core.mjs';

const OPTIONS = {breaks: 'none', expandAlways: true, svgViewBox: true, header: 'none', footer: 'none'};
async function verovioPitches(data) {
  const tk = await createToolkit();
  tk.setOptions(OPTIONS);
  tk.loadData(data);
  return buildScore(tk).segments.map(s => [s.t, s.n, s.staff]);
}
const ours = async data => (await loadSong({data})).segments.map(s => [s.t, s.n, s.staff]);

describe('meiNotePitch()', () => {
  test('letter, octave and gestural accidentals', () => {
    expect(meiNotePitch(' xml:id="a" pname="c" oct="4"')).toBe(60);
    expect(meiNotePitch(' pname="f" oct="4" accid.ges="s"')).toBe(66);
    expect(meiNotePitch(' pname="b" oct="3" accid="f"')).toBe(58);
    expect(meiNotePitch(' pname="c" oct="4"', '<accid accid.ges="s"/>')).toBe(61);
    expect(meiNotePitch(' pname="g" oct="4" oct.ges="5"')).toBe(79); // under an 8va line
    expect(meiNotePitch(' pname="d" oct="4"', '<accid accid="ff"/>')).toBe(60);
    expect(meiNotePitch(' pname="x" oct="4"')).toBeUndefined();
  });
});

describe('loadSong() pitches equal Verovio’s', () => {
  test.each(['mozart-sonata-k545-1', 'fur-elise', 'chopin-prelude-op28-20'])('%s', async id => {
    const {songs} = JSON.parse(readFileSync('public/songs/catalog.json', 'utf8'));
    const data = readFileSync('public/' + songs.find(s => s.id === id).file, 'utf8');
    expect(await ours(data)).toEqual(await verovioPitches(data));
  }, 60_000);

  test('octave lines and key-signature sharps', async () => {
    const n = (s, o, alter = '') => `<note><pitch><step>${s}</step>${alter}<octave>${o}</octave></pitch><duration>1</duration><type>quarter</type></note>`;
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><octave-shift type="down" size="8" number="1"/></direction-type></direction>${n('C', 5, '<alter>1</alter>')}${n('F', 5, '<alter>1</alter>')}<direction><direction-type><octave-shift type="stop" size="8" number="1"/></direction-type></direction>${n('F', 4, '<alter>1</alter>')}${n('G', 4)}</measure></part></score-partwise>`;
    const got = await ours(xml);
    expect(got.map(x => x[1])).toEqual([73, 78, 66, 67]);
    expect(got).toEqual(await verovioPitches(xml));
  }, 60_000);
});
