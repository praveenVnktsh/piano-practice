// Phase 19: suggested fingering on a score with none printed, never on one that has it, and the
// Larger notes option (on by default for a Beginner's Grade 0 piece, the student's choice wins).
// FINGERING_SHOT=<dir> also saves a screenshot of the suggested fingering there.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {VIEWPORTS, waitForSong} from './helpers.mjs';

const fresh = page => page.eval(`['piano-practice.progress.local', 'piano-practice.lessons', 'piano-practice:settings'].forEach(k => localStorage.removeItem(k)); 1`);
const toggle = (page, id, on) => page.eval(`(() => { const b = document.getElementById('${id}'); b.checked = ${on}; b.dispatchEvent(new Event('change')); return 1; })()`);
const suggested = page => page.eval(`[...document.querySelectorAll('#um-sheet g.sfing text')].map(t => t.textContent).join('')`);

export const tests = [{
  name: 'Suggested fingering: drawn where the score has none, hidden with Fingering numbers off',
  timeout: 90000,
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.desktop);
    await page.goto(base + '#/today');
    await fresh(page);
    await page.eval(`localStorage.setItem('piano-practice:settings', JSON.stringify({view: 'sheet', largeNotes: false})); 1`);
    await page.goto(base + '#/play/ode-to-joy');
    await waitForSong(page);
    await page.waitFor(`document.querySelectorAll('#um-sheet g.sfing').length > 20`, {what: 'suggested fingering on the score'});
    const digits = await suggested(page);
    assert.match(digits, /^[1-5]+$/);
    // The tune opens in C position: E E F G G F E D C.
    const rh = await page.eval(`(() => {
      const gs = [...document.querySelectorAll('#um-sheet g.sfing.h-r')];
      return gs.slice(0, 9).map(g => g.textContent.replace(/\\D/g, '')).join('');
    })()`);
    assert.equal(rh, '334554321');
    // Marked as suggested: a tooltip on the numbers and the key in Settings.
    assert.equal(await page.eval(`document.querySelector('#um-sheet g.sfing title').textContent`), 'Suggested fingering');
    assert.match(await page.eval(`document.getElementById('set-fing').closest('label').textContent`), /suggested/);
    // Right hand above its staff, left hand below its own.
    const placed = await page.eval(`(() => {
      const above = [...document.querySelectorAll('#um-sheet g.sfing.h-r')].every(g => {
        const head = g.closest('.measure').querySelector('.staff .notehead'); return g.getBoundingClientRect().bottom <= head.getBoundingClientRect().bottom;
      });
      return above;
    })()`);
    assert.ok(placed, 'right-hand numbers sit above the notes');
    if (process.env.FINGERING_SHOT) writeFileSync(join(process.env.FINGERING_SHOT, 'suggested-fingering-ode-to-joy.png'), await page.screenshot());
    await toggle(page, 'set-fing', false);
    assert.equal(await page.eval(`getComputedStyle(document.querySelector('#um-sheet g.sfing')).display`), 'none');
    await toggle(page, 'set-fing', true);
    assert.notEqual(await page.eval(`getComputedStyle(document.querySelector('#um-sheet g.sfing')).display`), 'none');

    // A generated exercise prints its fingering: nothing is suggested over it.
    await page.goto(base + '#/play/ex:scale:G:major:both:1:up-down');
    await waitForSong(page);
    await page.waitFor(`document.querySelectorAll('#um-sheet g.fing').length > 10`, {what: 'the printed fingering'});
    await page.eval(`new Promise(r => setTimeout(r, 300))`);
    assert.equal(await page.eval(`document.querySelectorAll('#um-sheet g.sfing').length`), 0);
  },
}, {
  name: 'Larger notes: on for a Beginner\'s Grade 0 piece, the student\'s choice sticks, the highlights still line up',
  timeout: 90000,
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.desktop);
    await page.goto(base + '#/today');
    await fresh(page);
    await page.eval(`localStorage.setItem('piano-practice:settings', JSON.stringify({view: 'sheet'})); 1`);
    await page.goto(base + '#/play/hot-cross-buns');
    await waitForSong(page);
    await page.waitFor(`document.getElementById('player').classList.contains('large-notes')`, {what: 'larger notes for a beginner', timeout: 10000});
    assert.equal(await page.eval(`document.getElementById('set-large').checked`), true);
    // Scaled about the centre: the notehead is bigger and its centre has not moved.
    const measure = () => page.eval(`(() => { const r = document.querySelector('#um-sheet .note .notehead').getBoundingClientRect(); return {w: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2}; })()`);
    const big = await measure();
    await toggle(page, 'set-large', false);
    const small = await measure();
    assert.ok(big.w > small.w * 1.2, `notehead ${big.w} vs ${small.w}`);
    assert.ok(Math.abs(big.cx - small.cx) < 1.5 && Math.abs(big.cy - small.cy) < 1.5, 'the notehead stays centred');
    assert.equal(await page.eval(`document.getElementById('player').classList.contains('large-notes')`), false);
    assert.equal(await page.eval(`JSON.parse(localStorage.getItem('piano-practice:settings')).largeNotes`), false);
    // Turned off on purpose: it stays off on the next beginner piece.
    await page.goto(base + '#/play/mary-had-a-little-lamb');
    await waitForSong(page);
    await page.eval(`new Promise(r => setTimeout(r, 300))`);
    assert.equal(await page.eval(`document.getElementById('player').classList.contains('large-notes')`), false);
    // And on with the student's say-so anywhere, letters inside the heads too.
    await toggle(page, 'set-large', true);
    await toggle(page, 'set-names', true);
    await page.waitFor(`document.querySelectorAll('#um-sheet .nh-name').length > 0`, {what: 'note names drawn'});
    const inside = await page.eval(`(() => { const t = document.querySelector('#um-sheet .nh-name'); const a = t.getBoundingClientRect(), b = t.closest('.notehead').getBoundingClientRect();
      return Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) < 2 && Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 3; })()`);
    assert.ok(inside, 'the letter stays inside its notehead');
  },
}];
