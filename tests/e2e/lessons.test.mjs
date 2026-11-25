// The absolute beginner (Phase 13): first lessons under Exercises, surfaced on Today, and the
// beginner score aids on a Grade 0 piece.
import {VIEWPORTS, waitForRoute, waitForSong, overflow} from './helpers.mjs';

// A new student: no progress, no lessons, no saved player settings.
const fresh = page => page.eval(`['piano-practice.progress.local', 'piano-practice.lessons', 'piano-practice:settings'].forEach(k => localStorage.removeItem(k)); 1`);

export const tests = [{
  name: 'Exercises → First lessons → a lesson answered on the on-screen keys',
  timeout: 60000,
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.desktop);
    await page.goto(base + '#/exercises');
    await waitForRoute(page, '#/exercises');
    await fresh(page);
    assert.equal(await page.eval(`document.querySelector('.exh-card').getAttribute('href')`), '#/exercises/lessons', 'First lessons is the first card');
    await page.click('.exh-card.is-wide');
    await waitForRoute(page, '#/exercises/lessons');
    await page.waitFor(`document.querySelectorAll('.th-item').length > 0`, {what: 'the list of lessons'});
    assert.equal(await page.eval(`document.querySelectorAll('.th-item').length`), 4);
    await page.click('.th-item');
    await page.waitFor(`document.querySelector('.ls-art svg')`, {what: 'the first card with its drawing'});
    for (let i = 0; i < 3; i++) await page.click('.th-next');
    await page.waitFor(`document.querySelector('.ls-task')`, {what: 'the first task'});
    assert.equal(await page.eval(`document.querySelector('.th-prompt').textContent`), 'Play a group of two black keys');
    await page.tap('.kb-key.kb-black[data-note="61"]', {hold: 40});
    await page.tap('.kb-key.kb-black[data-note="63"]', {hold: 40});
    await page.waitFor(`document.querySelector('.th-feedback').dataset.tone === 'ok'`, {what: 'the task judged'});
    await page.waitFor(`document.querySelector('.th-prompt').textContent === 'Play a group of three black keys'`, {what: 'the next task, by itself', timeout: 5000});
    assert.deepEqual(await overflow(page), []);
  },
}, {
  name: 'Today offers the first lesson to a new student; a Grade 0 piece opens with note names',
  timeout: 90000,
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.portrait);
    await page.goto(base + '#/today');
    await fresh(page);
    await page.goto(base + '#/today');
    await waitForRoute(page, '#/today');
    await page.waitFor(`document.querySelector('.td-card .td-kind')?.textContent.startsWith('First lessons')`, {what: 'the lesson card on Today'});
    assert.equal(await page.eval(`document.querySelector('.td-card .td-title').textContent`), 'Finding your way');
    assert.equal(await page.eval(`document.querySelector('.td-card .td-action').getAttribute('href')`), '#/exercises/lessons/keyboard');
    // The first piece suggested is the first beginner arrangement.
    assert.equal(await page.eval(`document.querySelectorAll('.td-card')[1].querySelector('.td-title').textContent`), 'Hot Cross Buns');

    await page.goto(base + '#/play/hot-cross-buns');
    await waitForSong(page);
    await page.waitFor(`document.getElementById('player').classList.contains('show-names')`, {what: 'note names on for a beginner', timeout: 10000});
    // The student can still turn them off, and that sticks.
    await page.eval(`(() => { const b = document.getElementById('names-btn'); b.checked = false; b.dispatchEvent(new Event('change')); })()`);
    assert.equal(await page.eval(`document.getElementById('player').classList.contains('show-names')`), false);
    assert.equal(await page.eval(`JSON.parse(localStorage.getItem('piano-practice:settings')).beginnerAids`), false);
  },
}];
