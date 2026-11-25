// The score must not move while you play: wrong notes, the stuck hint and its loop offer, and the
// bar label above the score change text on every step, but never the layout (Für Elise, iPad portrait).
import {VIEWPORTS, waitForSong} from './helpers.mjs';

export const tests = [
  {
    name: 'steady score: playing (and slipping) in Wait never resizes or shifts the score',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.portrait);
      const song = catalog.songs.find(s => s.id === 'fur-elise') || catalog.songs[0];
      await page.goto(base + '#/today');
      await page.eval(`localStorage.setItem('piano-practice:settings', JSON.stringify({view: 'sheet'})); 1`);
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`window.pianoPlayer.setSection(0, 30); window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('both'); window.pianoPlayer.practice(); 1`);
      await page.waitFor(`window.pianoPlayer.getState().practicing && document.querySelector('#player .pkey.attack')`, {what: 'a key to play', timeout: 20000});
      await sleep(400);
      await page.eval(`window.__geo = new Set(); (function f(){ const h = document.getElementById('um-sheet'), s = h.querySelector('svg'); if (s) { const r = s.getBoundingClientRect(); __geo.add(h.clientHeight + ':' + Math.round(r.height) + ':' + Math.round(r.top)); } if (window.__geoOn !== false) requestAnimationFrame(f); })(); 1`);
      const visible = n => page.eval(`(() => { const k = document.querySelector('#player .pkey[data-note="${n}"]'); if (!k) return false; const r = k.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; })()`);
      for (let step = 0; step < 10; step++) {
        const notes = await page.eval(`[...document.querySelectorAll('#player .pkey.attack')].map(k => +k.dataset.note)`);
        if (step === 3) { // get stuck: three slips, the hint and the loop offer appear
          let n = notes[0] + 1, slips = 0;
          while (slips < 3 && n < notes[0] + 12) { if (!notes.includes(n) && await visible(n)) { await page.tap(`#player .pkey[data-note="${n}"]`, {hold: 30}); slips++; await sleep(120); } n++; }
          await page.waitFor(`document.getElementById('player').classList.contains('stuck')`, {what: 'the stuck hint'});
        }
        for (const n of notes) if (await visible(n)) await page.tap(`#player .pkey[data-note="${n}"]`, {hold: 30});
        await sleep(250);
      }
      const geo = await page.eval(`window.__geoOn = false; [...__geo]`);
      assert.equal(geo.length, 1, `the score kept one size and place, saw: ${geo.join(' | ')}`);
    },
  },
];
