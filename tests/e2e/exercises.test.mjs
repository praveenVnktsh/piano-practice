// Sight-reading, rhythm, theory and ear training (Phase 8) in a real browser.
import {VIEWPORTS, waitForRoute, waitForSong} from './helpers.mjs';

export const tests = [{
  name: 'sight-reading opens a generated piece in Play along',
  timeout: 60000,
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.desktop);
    await page.goto(base + '#/exercises/sight-reading');
    await waitForRoute(page, '#/exercises/sight-reading');
    await page.click('.sr-level[data-level="grade-1"]');
    await page.click('.sr-start');
    await waitForSong(page);
    const st = await page.eval('window.pianoPlayer.getState()');
    assert.match(st.songId, /^sr:grade-1:\d+$/);
    assert.equal(st.measureCount, 4);
    assert.equal(st.mode, 'timed');
    assert.equal(await page.eval(`document.getElementById('player').dataset.intent`), 'practice');
  },
}, {
  name: 'rhythm trainer counts in and grades taps',
  timeout: 60000,
  async run({base, page: open, assert, sleep}) {
    const page = await open(VIEWPORTS.portrait);
    await page.goto(base + '#/exercises/rhythm');
    await waitForRoute(page, '#/exercises/rhythm');
    await page.click('.rh-primary');
    for (let i = 0; i < 6; i++) { await sleep(900); await page.tap('.rh-pad', {hold: 40}); }
    await page.waitFor(`['ok', 'bad'].includes(document.querySelector('.rh-status').dataset.tone)`, {what: 'the rhythm graded', timeout: 20000});
    assert.ok(await page.eval(`document.querySelectorAll('.rh-staff .eg-ev[class*="is-"]').length > 0`), 'notes marked');
    assert.ok(await page.eval(`document.querySelectorAll('.rh-staff .rh-tap').length > 0`), 'taps drawn');
  },
}, {
  name: 'theory lesson: cards, then a question',
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.phone);
    await page.goto(base + '#/exercises/theory/intervals');
    await waitForRoute(page, '#/exercises/theory/intervals');
    for (let i = 0; i < 4; i++) await page.click('.th-next');
    await page.waitFor(`document.querySelector('.th-question')`, {what: 'the first question'});
    if (await page.eval(`!!document.querySelector('.th-choice')`)) await page.click('.th-choice');
    else await page.tap('.kb-key.kb-white[data-note="60"]', {hold: 40});
    await page.waitFor(`!document.querySelector('.th-question .th-next').hidden`, {what: 'the answer judged'});
    assert.match(await page.eval(`document.querySelector('.th-feedback').textContent`), /^(Right|Not quite)\./);
  },
}, {
  name: 'ear training: listen and answer',
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.desktop);
    await page.goto(base + '#/exercises/ear');
    await waitForRoute(page, '#/exercises/ear');
    await page.click('.ear-listen');
    await page.click('.th-choice');
    await page.waitFor(`document.querySelector('.ear-feedback').dataset.tone`, {what: 'the answer judged'});
    await page.click('.ear-kind:nth-child(3)');
    assert.equal(await page.eval(`document.querySelector('.ear-kind[aria-selected="true"]').textContent`), 'Cadences');
    assert.equal(await page.eval(`document.querySelectorAll('.kb-keys').length`), 0, 'cadences are tapped, not played');
  },
}];
