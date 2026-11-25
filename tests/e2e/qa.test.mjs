// Regressions from the QA pass over the student journeys (Today, Pieces, the player, sight-reading).
// The browser profile is shared by every e2e test: each test resets the storage it relies on.
import {VIEWPORTS, waitForRoute, waitForSong} from './helpers.mjs';

const state = page => page.eval('window.pianoPlayer.getState()');
const reset = (page, keys) => page.eval(`${JSON.stringify(keys)}.forEach(k => localStorage.removeItem(k)); 1`);

/** Plays the keys the player asks for on the on-screen keyboard until the results card shows. */
async function playThrough(page, sleep, max = 120) {
  for (let i = 0; i < max; i++) {
    if (await page.eval(`!document.getElementById('um-complete').hidden`)) return true;
    const notes = await page.eval(`[...document.querySelectorAll('#player .pkey.attack')].map(k => k.dataset.note)`);
    for (const n of notes) await page.tap(`#player .pkey[data-note="${n}"]`, {hold: 40});
    await sleep(notes.length ? 120 : 150);
  }
  return false;
}

export const tests = [
  {
    name: 'Pieces: filter counts follow the other filters, and the summary has no stray "null"',
    async run({base, page: open, assert, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/pieces', {settle: 100});
      await reset(page, ['piano-practice.pieces.filters', 'piano-practice.pieces.filter']);
      await page.goto(base + '?filters#/pieces');
      await page.waitFor(`document.querySelector('.pc-link')`, {what: 'the programme'});
      await page.click('[data-filter="grade"]');
      await page.eval(`[...document.querySelectorAll('.pc-fopt')].find(b => b.textContent.startsWith('Grade 2')).id = 'qa-g2'`);
      await page.click('#qa-g2');
      await sleep(200);
      await page.click('[data-filter="period"]');
      // Every period offered has pieces at Grade 2, and its count is the number of pieces it leaves.
      const opts = await page.eval(`[...document.querySelectorAll('.pc-fopt:not([disabled])')].slice(1).map(b => ({label: b.firstChild.textContent, n: +b.querySelector('.pc-fn').textContent}))`);
      assert.ok(opts.length > 0, 'some period has Grade 2 pieces');
      for (const o of opts) assert.ok(o.n > 0, `${o.label} offered with no pieces`);
      await page.eval(`document.querySelectorAll('.pc-fopt:not([disabled])')[1].id = 'qa-p'`);
      await page.click('#qa-p');
      await sleep(200);
      const shown = await page.eval(`document.querySelectorAll('.pc-work').length`);
      assert.equal(shown, opts[0].n, 'the count promised the pieces shown');
      const summary = await page.eval(`document.querySelector('.pc-summary').textContent`);
      assert.doesNotMatch(summary, /null/, 'summary: ' + summary);
      await reset(page, ['piano-practice.pieces.filters']);
    },
  },
  {
    name: 'player shortcuts still work after tapping the hands switch or Loop',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      await page.eval(`[...document.querySelectorAll('#section-bar label')].find(l => l.textContent.trim() === 'R').id = 'qa-r'`);
      await page.click('#qa-r');
      assert.equal(await page.eval(`document.activeElement.type`), 'radio', 'the hands radio has focus');
      const metro = () => page.eval(`document.getElementById('menu-metro').checked`);
      const before = await metro();
      await page.key('k', {code: 'KeyK', keyCode: 75, text: 'k'});
      await sleep(100);
      assert.equal(await metro(), !before, 'K toggles the metronome from a focused radio');
      await page.click('#sec-loop');
      const loop = (await state(page)).loop;
      await page.key('l', {code: 'KeyL', keyCode: 76, text: 'l'});
      await sleep(100);
      assert.equal((await state(page)).loop, !loop, 'L toggles the loop from the focused checkbox');
      await page.key('k', {code: 'KeyK', keyCode: 75, text: 'k'}); // leave the metronome as it was
    },
  },
  {
    name: 'Today: after a clean warm-up the card offers the next step, not "Once more"',
    timeout: 120000,
    async run({base, page: open, assert, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/today', {settle: 100});
      await reset(page, ['piano-practice.progress.local']);
      await page.goto(base + '?warm#/today');
      await page.waitFor(`document.querySelector('.td-action.btn-primary')`, {what: 'the warm-up'});
      const first = await page.eval(`document.querySelector('.td-card .td-title').textContent`);
      assert.match(await page.eval(`document.querySelector('.td-card .td-action').textContent`), /Begin the warm-up/);
      // Today re-renders once progress has loaded; a click that lands on the replaced card does
      // nothing, so retry until the player actually opens (seen on slower CI machines).
      for (let attempt = 0; ; attempt++) {
        await page.click('.td-card .td-action');
        await sleep(400);
        if (await page.eval(`document.documentElement.dataset.route === 'play'`)) break;
        if (attempt >= 4) throw new Error('the warm-up button did not open the player');
      }
      await waitForSong(page);
      await page.eval(`window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('both'); 1`);
      await page.click('#um-practice');
      await page.click('#um-play');
      assert.ok(await playThrough(page, sleep), 'the results card');
      assert.match(await page.eval(`document.getElementById('um-acc').textContent`), /100/);
      // The exercise is the whole piece: there is no next section to offer.
      assert.equal(await page.eval(`document.getElementById('um-complete-next').hidden`), true, 'no dead "Next section"');
      await page.click('#um-complete-close');
      await page.click('#player-back');
      await waitForRoute(page, '#/today');
      await page.waitFor(`document.querySelector('.td-card .td-done')`, {what: 'warm-up marked done'});
      const title = await page.eval(`document.querySelector('.td-card .td-title').textContent`);
      assert.notEqual(title, first, 'the path moved on');
      assert.equal(await page.eval(`document.querySelector('.td-card .td-action').textContent.trim()`), 'Next step');
      await reset(page, ['piano-practice.progress.local']);
    },
  },
  {
    name: 'sight-reading reads from the score and offers "Another one" on the results card',
    timeout: 120000,
    async run({base, page: open, assert, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/today', {settle: 100});
      await page.eval(`localStorage.setItem('piano-practice:settings', JSON.stringify({...JSON.parse(localStorage.getItem('piano-practice:settings') || '{}'), view: 'falling'})); 1`);
      await page.goto(base + '?sr#/play/' + encodeURIComponent('sr:beginner:4821'));
      await waitForSong(page);
      assert.equal((await state(page)).view, 'sheet', 'sight-reading shows the score');
      await page.eval(`window.pianoPlayer.setMode('wait'); 1`);
      await page.click('#um-practice');
      await page.click('#um-play');
      assert.ok(await playThrough(page, sleep), 'the results card');
      assert.equal(await page.eval(`document.getElementById('um-complete-another').hidden`), false);
      assert.equal(await page.eval(`document.activeElement.id`), 'um-complete-another', 'the one primary action has focus');
      assert.equal(await page.eval(`document.querySelectorAll('#um-complete .primary-btn:not([hidden])').length`), 1, 'one primary button');
      const id = (await state(page)).songId;
      await page.click('#um-complete-another');
      await page.waitFor(`(() => { const s = window.pianoPlayer.getState(); return s.songId !== ${JSON.stringify(id)} && /^sr:beginner:/.test(s.songId) && s.measureCount > 0; })()`, {what: 'another piece'});
      // A piece without the hint gets the student's own view back.
      await page.eval(`location.hash = '#/play/ode-to-joy'`);
      await waitForSong(page);
      await page.waitFor(`window.pianoPlayer.getState().songId === 'ode-to-joy'`, {what: 'Ode to Joy'});
      assert.equal((await state(page)).view, 'falling', 'the saved view is back');
    },
  },
  {
    name: 'a practice strategy does not follow the student to another piece',
    async run({base, page: open, assert}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/fur-elise');
      await waitForSong(page);
      await page.eval(`window.pianoPlayer.setStrategy('memory'); 1`);
      assert.equal(await page.eval(`document.getElementById('player').classList.contains('memory')`), true);
      await page.eval(`location.hash = '#/play/ode-to-joy'`);
      await page.waitFor(`window.pianoPlayer.getState().songId === 'ode-to-joy' && window.pianoPlayer.getState().measureCount > 0`, {what: 'Ode to Joy'});
      assert.equal((await state(page)).strategy, 'off');
      assert.equal(await page.eval(`document.getElementById('player').classList.contains('memory')`), false, 'the new score is visible');
    },
  },
];
