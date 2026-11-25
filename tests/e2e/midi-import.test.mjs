// Importing a .mid file: dropped on the import dialog, converted to a score, saved (in this
// browser: vite preview has no /__songs) and opened. A clean file opens on the score; a loosely
// timed one opens in falling notes and says so. Pieces labels both as unverified MIDI imports.
import {noteTrack, smf, tempo, timeSig} from '../midi-bytes.js';
import {VIEWPORTS, waitForSong} from './helpers.mjs';

const Q = 480;
const CLEAN = smf({tracks: [
  [0, ...tempo(100), 0, ...timeSig(3, 4)],
  noteTrack([[0, 72, Q], [Q, 74, Q], [2 * Q, 76, Q], [3 * Q, 77, 3 * Q]]),
  noteTrack([[0, 48, 3 * Q], [3 * Q, 43, 3 * Q]], {channel: 1}),
]});
const LOOSE = smf({format: 0, tracks: [noteTrack([[17, 60, 300], [431, 64, 200], [1013, 67, 333], [1290, 72, 410], [1771, 71, 150], [2049, 67, 380], [2500, 64, 300], [2911, 60, 500]])]});

async function dropMidi(page, bytes, name) {
  await page.goto(page.base + '#/pieces');
  await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Import a score')`, {what: 'import button'});
  await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Import a score').click()`);
  await page.waitFor(`document.getElementById('import-dialog').open`, {what: 'import dialog open'});
  await page.eval(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(${JSON.stringify([...bytes])})], ${JSON.stringify(name)}, {type: 'audio/midi'}));
    document.getElementById('import-drop').dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true}));
  })()`);
  await page.waitFor(`location.hash.startsWith('#/play/import')`, {what: 'imported piece opened', timeout: 30000});
  await waitForSong(page);
}

export const tests = [
  {
    name: 'a .mid file imports, plays, and loose timing opens in falling notes',
    async run({base, page: open, assert, catalog}) {
      const page = await open(VIEWPORTS.desktop);
      page.base = base;
      await dropMidi(page, CLEAN, 'Little Waltz.mid');
      let s = await page.eval(`window.pianoPlayer.getState()`);
      assert.equal(s.measureCount, 2);
      assert.equal(s.view, 'sheet', 'a clean MIDI file opens on its score');

      await dropMidi(page, LOOSE, 'my-take.mid');
      s = await page.eval(`window.pianoPlayer.getState()`);
      assert.equal(s.view, 'falling', 'loose timing opens in falling notes');
      assert.notEqual(await page.eval(`JSON.parse(localStorage.getItem('piano-practice:settings') || '{}').view ?? null`), 'falling', 'the hint is not saved as the student’s choice');

      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await page.waitFor(`window.pianoPlayer.getState().songId === ${JSON.stringify(catalog.songs[0].id)} && window.pianoPlayer.getState().measureCount > 0`, {what: 'bundled piece loaded'});
      assert.equal(await page.eval(`window.pianoPlayer.getState().view`), 'sheet', 'the next piece gets the student’s own view back');

      await page.goto(base + '#/pieces');
      await page.waitFor(`document.body.textContent.includes('From a MIDI file — unverified, best in falling notes')`, {what: 'loose import labelled'});
      assert.ok(await page.eval(`document.body.textContent.includes('Little Waltz')`));
    },
  },
];
