// Stuck in Wait mode: three wrong notes on one chord show its names on the noteheads and call
// out its keys; playing the chord clears the hint.
import {VIEWPORTS, waitForSong} from './helpers.mjs';

export const tests = [
  {
    name: 'stuck: wrong notes show the notes on the score and the keys, playing them clears it',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/today');
      await page.eval(`localStorage.setItem('piano-practice:settings', JSON.stringify({view: 'sheet'})); 1`); // the score, whatever an earlier test chose
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('both'); 1`);
      await page.click('#um-practice');
      await page.click('#um-play');
      await page.waitFor(`window.pianoPlayer.getState().practicing && document.querySelector('#player .pkey.attack')`, {what: 'a key to play', timeout: 20000});
      const targets = await page.eval(`[...document.querySelectorAll('#player .pkey.attack')].map(k => +k.dataset.note)`);
      // Three visible keys that aren't in the chord.
      const wrong = await page.eval(`[...document.querySelectorAll('#player .pkey')].map(k => +k.dataset.note)
        .filter(n => !${JSON.stringify(targets)}.includes(n)).filter(n => { const r = document.querySelector('#player .pkey[data-note="' + n + '"]').getBoundingClientRect(); return r.width && r.left >= 0 && r.right <= innerWidth; }).slice(0, 3)`);
      for (const n of wrong.slice(0, 2)) { await page.tap(`#player .pkey[data-note="${n}"]`, {hold: 40}); await sleep(150); }
      assert.equal(await page.eval(`document.getElementById('player').classList.contains('stuck')`), false, 'two slips are not stuck yet');
      await page.tap(`#player .pkey[data-note="${wrong[2]}"]`, {hold: 40});
      await page.waitFor(`document.getElementById('player').classList.contains('stuck')`, {what: 'the stuck hint'});
      const hint = await page.eval(`JSON.stringify({heads: document.querySelectorAll('#player .sheet .note.s-hint').length, shown: [...document.querySelectorAll('#player .sheet .note.s-hint .nh-name')].filter(t => getComputedStyle(t).display !== 'none').length, prompt: document.getElementById('um-practice-status')?.textContent || ''})`);
      const h = JSON.parse(hint);
      assert.ok(h.heads >= 1, 'the chord is marked on the score');
      assert.ok(h.shown >= 1, 'its names show on the noteheads');
      assert.match(h.prompt, /Here (it is|they are)/);
      for (const n of targets) await page.tap(`#player .pkey[data-note="${n}"]`, {hold: 40});
      await page.waitFor(`!document.getElementById('player').classList.contains('stuck') && !document.querySelector('#player .s-hint')`, {what: 'the hint cleared on the next chord'});
    },
  },
];
