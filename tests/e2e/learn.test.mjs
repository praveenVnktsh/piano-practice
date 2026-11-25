// Learn a piece, guided (Phase 12): the first-look card before the first play, the step-by-step
// plan with its one "Next step" button, steps ticked off by practice:result, Today showing the
// current step, and the fingering toggle.
import {VIEWPORTS, overflow, waitForRoute, waitForSong} from './helpers.mjs';

const state = page => page.eval('window.pianoPlayer.getState()');

export const tests = [
  {
    name: 'first look: shown before the first play, Listen first starts listening, never shown again',
    async run({base, page: open, assert, catalog}) {
      const page = await open(VIEWPORTS.desktop);
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.waitFor(`document.querySelector('#player .first-look')`, {what: 'the first-look card'});
      const text = await page.eval(`document.querySelector('#player .first-look').textContent`);
      assert.match(text, /Key/);
      assert.match(text, /Time/);
      assert.match(text, /Right hand/);
      await page.click('#player .first-look .primary-btn');
      await page.waitFor(`window.pianoPlayer.getState().playing`, {what: 'listening'});
      assert.equal(await page.eval(`!!document.querySelector('#player .first-look')`), false);
      await page.click('#um-play');
      // Reopen the piece: no card.
      await page.goto(base + '#/today');
      await waitForRoute(page, '#/today');
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await new Promise(r => setTimeout(r, 800));
      assert.equal(await page.eval(`!!document.querySelector('#player .first-look')`), false, 'first look only once');
    },
  },
  {
    name: 'learn step by step: Next step sets the step up, a good result ticks it off, Today shows the step',
    async run({base, page: open, assert, catalog}) {
      const page = await open(VIEWPORTS.desktop);
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      // The browser profile is shared between tests: start this piece afresh.
      await page.goto(base + '#/today');
      await waitForRoute(page, '#/today');
      await page.eval(`localStorage.removeItem('piano-practice:song:' + ${JSON.stringify(song.id)}); localStorage.removeItem('piano-practice.progress.local'); 1`);
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.waitFor(`document.querySelector('#player .first-look .quiet-btn')`, {what: 'the first-look card'});
      await page.click('#player .first-look .quiet-btn'); // "Learn it step by step"
      await page.waitFor(`!document.getElementById('learn-next').hidden`, {what: 'the Next step button'});
      // Step 1 (listen) is set up: the button now starts it.
      let s = await state(page);
      assert.equal(s.hands, 'both');
      assert.match(await page.eval(`document.getElementById('learn-next').textContent`), /(Phrase 1 of \d+|Step 1 of \d+).*Listen/);
      // Finish the listen step quickly: tick it off by listening to the section's end.
      const sec = s.section;
      await page.eval(`window.pianoPlayer.setTempo(400); 1`);
      await page.click('#learn-next');
      await page.waitFor(`/Next step|Right hand/.test(document.getElementById('learn-next').textContent) && !window.pianoPlayer.getState().playing`, {what: 'the listen step done', timeout: 40000});
      // Step 2 (right hand) after Next step.
      if (/Next step/.test(await page.eval(`document.getElementById('learn-next').textContent`))) await page.click('#learn-next');
      s = await state(page);
      assert.deepEqual(s.section, sec);
      assert.equal(s.hands, 'right');
      assert.equal(s.mode, 'wait');
      // A clean right-hand result ticks it off.
      await page.eval(`dispatchEvent(new CustomEvent('practice:result', {detail: {songId: ${JSON.stringify(song.id)}, title: 'x', section: ${JSON.stringify(sec)}, mode: 'wait', hands: 'right', tempo: 60, right: 20, wrong: 0, accuracy: 100, timing: null, durationMs: 4000, at: Date.now()}})); 1`);
      await page.waitFor(`/Left hand/.test(document.getElementById('learn-next').textContent)`, {what: 'the left-hand step next'});
      assert.deepEqual(await page.eval(`JSON.parse(localStorage.getItem('piano-practice:song:' + ${JSON.stringify(song.id)})).learnDone.length`), 2);
      // Today shows the current step for this piece.
      await page.goto(base + '#/today');
      await waitForRoute(page, '#/today');
      await page.waitFor(`[...document.querySelectorAll('.td-card')].some(c => /step by step/i.test(c.textContent) && /Left hand alone/.test(c.textContent))`, {what: 'Today shows the plan step'});
      const btn = await page.eval(`[...document.querySelectorAll('.td-card')].find(c => /step by step/i.test(c.textContent)).querySelector('.td-action').textContent`);
      assert.equal(btn, 'Next step');
      assert.deepEqual(await overflow(page), []);
    },
  },
  {
    name: 'fingering numbers toggle in Settings; hand-position preview at the section start',
    async run({base, page: open, assert}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/' + encodeURIComponent('ex:scale:C:major:both:2:up-down'));
      await waitForSong(page);
      await page.waitFor(`document.querySelector('#um-sheet g.fing')`, {what: 'fingering in the score'});
      assert.equal(await page.eval(`getComputedStyle(document.querySelector('#um-sheet g.fing')).display !== 'none'`), true);
      await page.eval(`document.getElementById('set-fing').click(); 1`);
      assert.equal(await page.eval(`getComputedStyle(document.querySelector('#um-sheet g.fing')).display`), 'none');
      await page.eval(`document.getElementById('set-fing').click(); 1`);
      // Stopped at the start: the starting keys are ghosted; an exercise has no plan or first look.
      assert.ok(await page.eval(`document.querySelectorAll('#player .pkey.ghost').length >= 2`), 'ghosted starting keys');
      assert.equal(await page.eval(`document.getElementById('learn-next').hidden && !document.querySelector('#player .first-look')`), true);
    },
  },
];
