// Recordings (Phase 9): record a take with the on-screen keys, see it saved, open the report
// from ⋯ → Recordings, play it back, delete it. `vite preview` has no dev-server store, so takes
// live in this throwaway profile's localStorage.
import {VIEWPORTS, waitForSong} from './helpers.mjs';

export const tests = [
  {
    name: 'record a take, review it, play it back and delete it',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      await page.click('#rec-btn');
      await page.waitFor(`document.getElementById('rec-btn').getAttribute('aria-pressed') === 'true'`, {what: 'recording'});
      assert.ok(await page.eval(`!document.getElementById('rec-strip').hidden`));
      for (const n of [60, 62, 64, 65, 67]) { await page.tap(`#player .pkey[data-note="${n}"]`, {hold: 90}); await sleep(120); }
      await page.click('#rec-btn');
      await page.waitFor(`document.querySelector('#rec-strip:not([hidden]) .rec-strip-saved')`, {what: 'take saved'});
      assert.match(await page.eval(`document.getElementById('rec-strip').textContent`), /Take 1 saved/);
      const stored = await page.eval(`JSON.parse(localStorage.getItem('piano-practice.recordings.index'))`);
      assert.equal(stored.length, 1);
      assert.equal(stored[0].notes, 5);
      assert.equal(stored[0].source, 'screen');

      await page.click('#more-btn');
      await page.click('#rec-list-btn');
      await page.waitFor(`document.querySelector('#rec-review:not([hidden]) .rec-note .rec-acc')`, {what: 'report'});
      assert.match(await page.eval(`document.querySelector('.rec-stats').textContent`), /Notes/);
      // Listen and compare: the score's bar on the sampler, then the take's (audio is muted).
      await page.waitFor(`document.querySelector('.rec-compare .rec-compare-bar')`, {what: 'listen and compare'});
      await page.eval(`[...document.querySelectorAll('.rec-compare button')].find(b => b.textContent === 'A then B').click()`);
      assert.match(await page.eval(`document.querySelector('.rec-compare-status').textContent`), /^The score, then your take, (bar \d+|the pickup)$/);

      await page.eval(`[...document.querySelectorAll('.rec-actions button')].find(b => b.textContent === 'Play take').click()`);
      await page.waitFor(`document.getElementById('player').classList.contains('playing-take')`, {what: 'playback'});
      await page.waitFor(`!document.getElementById('player').classList.contains('playing-take')`, {what: 'playback ends', timeout: 15000});

      await page.click('#more-btn');
      await page.click('#rec-list-btn');
      await page.waitFor(`document.querySelector('#rec-review:not([hidden]) .rec-actions')`, {what: 'report again'});
      await page.eval(`[...document.querySelectorAll('.rec-actions button')].find(b => b.textContent === 'Delete').click()`);
      await page.eval(`[...document.querySelectorAll('.rec-actions button')].find(b => b.textContent === 'Delete for good').click()`);
      await page.waitFor(`document.querySelector('.rec-empty-state')`, {what: 'no takes left'});
      assert.equal(await page.eval(`JSON.parse(localStorage.getItem('piano-practice.recordings.index')).length`), 0);
      await page.key('Escape');
      await page.waitFor(`document.getElementById('rec-review').hidden`, {what: 'overlay closed'});
    },
  },
];
