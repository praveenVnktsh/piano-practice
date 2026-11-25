// Musicality (Phase 15) on the results card: a pass played on a (fake) MIDI keyboard with real
// velocities shows the phrasing contour and one quiet hint, and practice:result carries it.
import {VIEWPORTS, waitForSong} from './helpers.mjs';

// A stand-in Web MIDI keyboard: window.__midi([status, note, velocity]) plays it.
const FAKE_MIDI = `(() => {
  const input = {id: 'e2e', name: 'E2E keys', state: 'connected', onmidimessage: null};
  const access = {inputs: new Map([['e2e', input]]), outputs: new Map(), onstatechange: null};
  Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => access});
  window.__midi = data => input.onmidimessage?.({data: new Uint8Array(data), timeStamp: performance.now()});
})();`;

export const tests = [
  {
    name: 'a pass on a MIDI keyboard shows phrasing on the results card',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.send('Page.addScriptToEvaluateOnNewDocument', {source: FAKE_MIDI});
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`document.getElementById('um-midi').click(); 1`);
      await page.eval(`window.pianoPlayer.setSection(0, 3); window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('right'); window.pianoPlayer.setLoop(false);
        window.__results = []; addEventListener('practice:result', e => __results.push(e.detail)); 1`);
      await page.click('#um-practice');
      await page.click('#um-play');
      await page.waitFor(`window.pianoPlayer.getState().practicing && document.querySelector('#player .pkey.attack')`, {what: 'a key to play', timeout: 20000});
      // Play every prompted note at one level: a flat line.
      for (let step = 0; step < 80; step++) {
        if (await page.eval(`!document.getElementById('um-complete').hidden`)) break;
        const notes = await page.eval(`[...document.querySelectorAll('#player .pkey.attack')].map(k => +k.dataset.note)`);
        for (const n of notes) await page.eval(`__midi([144, ${n}, 70]); 1`);
        await sleep(90);
        for (const n of notes) await page.eval(`__midi([128, ${n}, 0]); 1`);
        await sleep(60);
      }
      await page.waitFor(`!document.getElementById('um-complete').hidden`, {what: 'the results card'});
      const result = await page.eval(`__results.at(-1)`);
      assert.ok(result.musicality?.shape, 'practice:result carries the phrase shape');
      assert.equal(typeof result.musicality.shape.score, 'number');
      assert.ok(await page.eval(`!document.getElementById('um-music').hidden`), 'the musicality figure is shown');
      assert.match(await page.eval(`document.querySelector('#um-music .touch-label').textContent`), /Phrasing/);
      assert.ok(await page.eval(`document.querySelectorAll('#um-music polyline').length >= 2`), 'played and model contours');
      const hint = await page.eval(`document.querySelector('#um-music .music-hint')?.textContent || ''`);
      assert.match(hint, /arrive — the line peaks there\.$|^Taper the cadence in |rise and fall/);
      assert.doesNotMatch(hint, /!/);
      await page.click('#um-complete-close');
    },
  },
];
