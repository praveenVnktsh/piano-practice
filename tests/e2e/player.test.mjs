// The player: open a piece from Pieces and go back; Listen starts and stops; Practise accepts
// the on-screen keys; a technique exercise opens.
import {VIEWPORTS, waitForRoute, waitForSong} from './helpers.mjs';

const state = page => page.eval('window.pianoPlayer.getState()');

export const tests = [
  {
    name: 'open a piece from Pieces and come back',
    async run({base, page: open, assert}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/pieces');
      await waitForRoute(page, '#/pieces');
      await page.waitFor(`document.querySelector('.pc-link')`, {what: 'a piece in the list'});
      const id = await page.eval(`document.querySelector('.pc-work').dataset.id`);
      await page.click('.pc-link');
      await waitForRoute(page, '#/play/');
      await waitForSong(page);
      assert.equal((await state(page)).songId, id);
      await page.click('#player-back');
      await waitForRoute(page, '#/pieces');
      assert.equal(await page.eval('location.hash'), '#/pieces');
    },
  },
  {
    name: 'listen starts and stops',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      await page.click('#um-listen');
      await page.click('#um-play');
      await page.waitFor(`window.pianoPlayer.getState().playing`, {what: 'listening'});
      assert.ok(await page.eval(`document.getElementById('player').classList.contains('playing')`));
      await sleep(800);
      await page.click('#um-play');
      await page.waitFor(`!window.pianoPlayer.getState().playing`, {what: 'stopped'});
    },
  },
  {
    name: 'practise accepts on-screen keys',
    async run({base, page: open, assert, catalog}) {
      const page = await open(VIEWPORTS.desktop);
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('both'); window.__notes = []; addEventListener('piano:note', e => __notes.push(e.detail)); 1`);
      await page.click('#um-practice');
      await page.click('#um-play');
      await page.waitFor(`window.pianoPlayer.getState().practicing && document.querySelector('#player .pkey.attack')`, {what: 'a key to play', timeout: 20000});
      // Play the expected notes three times over and watch the position move on.
      const before = await page.eval(`document.getElementById('um-measure').textContent + '|' + [...document.querySelectorAll('#player .pkey.attack')].map(k => k.dataset.note).join(',')`);
      let moved = false;
      for (let step = 0; step < 6 && !moved; step++) {
        const notes = await page.eval(`[...document.querySelectorAll('#player .pkey.attack')].map(k => k.dataset.note)`);
        for (const n of notes) await page.tap(`#player .pkey[data-note="${n}"]`, {hold: 60});
        await new Promise(r => setTimeout(r, 250));
        const now = await page.eval(`document.getElementById('um-measure').textContent + '|' + [...document.querySelectorAll('#player .pkey.attack')].map(k => k.dataset.note).join(',')`);
        moved = now !== before;
      }
      const notes = await page.eval('__notes');
      assert.ok(notes.length > 0 && notes.every(n => n.source === 'screen'), 'piano:note events from the screen keys');
      assert.ok(moved, 'practice moved on after the right keys');
      await page.click('#um-play');
      await page.waitFor(`!window.pianoPlayer.getState().practicing`, {what: 'practice stopped'});
    },
  },
  {
    name: 'a technique exercise opens in the player',
    async run({base, page: open, assert}) {
      const page = await open(VIEWPORTS.portrait);
      await page.goto(base + '#/technique');
      await waitForRoute(page, '#/technique');
      await page.waitFor(`document.querySelector('.tq-start')`, {what: 'the Start button'});
      await page.click('.tq-start');
      await waitForRoute(page, '#/play/');
      await waitForSong(page);
      const s = await state(page);
      assert.match(s.songId, /^ex:/);
      assert.ok(s.title, 'exercise has a title');
    },
  },
  {
    name: 'a piece opens on the whole piece; the quick passages pick a passage in one tap',
    async run({base, page: open, assert}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/fur-elise');
      await waitForSong(page);
      const {section, measureCount} = await state(page);
      assert.deepEqual(section, [0, measureCount - 1], 'the whole piece');
      await page.click('#quick-bars button[data-for*="four"]');
      await page.waitFor(`window.pianoPlayer.getState().section[1] - window.pianoPlayer.getState().section[0] <= 4`, {what: 'four bars'});
      await page.click('#quick-bars button[data-for*="whole"]');
      await page.waitFor(`window.pianoPlayer.getState().section[1] === ${measureCount - 1} && window.pianoPlayer.getState().section[0] === 0`, {what: 'the whole piece again'});
    },
  },
];
