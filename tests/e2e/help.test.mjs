// The first-launch introduction (src/onboarding/) and the "?" help overlay (src/help/):
// shown once, keyboard-driven, Escape closes, focus comes back, keys don't leak to the player.
import {VIEWPORTS, waitForRoute, waitForSong} from './helpers.mjs';

const active = page => page.eval(`(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) + '|' + (a.textContent || '').trim().slice(0, 40) : ''; })()`);

export const tests = [
  {
    name: 'introduction on first launch: level and goal, then Today; shown once; reopened from Progress',
    async run({base, page: open, assert, sleep}) {
      const page = await open({...VIEWPORTS.desktop, onboarding: true});
      // The browser profile is shared by every test: start as a first launch.
      await page.goto(base + '#/progress', {settle: 100});
      await page.eval(`localStorage.removeItem('piano-practice.onboarded'); localStorage.removeItem('piano-practice.progress.local'); 1`);
      await page.goto(base + '?first#/progress');
      await page.waitFor(`document.querySelector('dialog.ob[open]')`, {what: 'the introduction'});
      assert.match(await active(page), /^ob-title\|The practice room/, 'focus starts on the heading');
      for (let i = 0; i < 3; i++) { await page.click('.ob-next'); await sleep(250); }
      // Your level and a daily goal: Grade 2, 20 minutes (keyboard-free clicks on the labels).
      await page.waitFor(`document.querySelector('input[name="ob-level"][value="grade-2"]')`, {what: 'the level step'});
      await page.click('input[name="ob-level"][value="grade-2"]');
      await page.click('input[name="ob-goal"][value="20"]');
      await page.click('.ob-next');
      await page.waitFor(`document.querySelector('.ob-body')?.dataset.step === 'done'`, {what: 'the last step'});
      await page.click('.ob-next');
      await page.waitFor(`!document.querySelector('dialog.ob')`, {what: 'the introduction to close'});
      await waitForRoute(page, '#/today');
      assert.ok(['#/', '#/today'].includes(await page.eval('location.hash')), 'lands on Today');
      // vite preview has no progress server: the settings live in this browser's progress document.
      await page.waitFor(`(JSON.parse(localStorage.getItem('piano-practice.progress.local') || '{}').settings || {}).pathStart === 'grade-2'`, {what: 'path start saved'});
      assert.equal(await page.eval(`JSON.parse(localStorage.getItem('piano-practice.progress.local')).settings.dailyGoalMin`), 20);

      // Shown once.
      await page.goto(base + '?again#/today', {settle: 1500});
      assert.equal(await page.eval(`!!document.querySelector('dialog.ob')`), false, 'not shown a second time');

      // Progress → Settings → "Show the introduction again"; Escape skips and focus returns.
      await page.eval(`location.hash = '#/progress'`);
      await waitForRoute(page, '#/progress');
      const again = `[...document.querySelectorAll('.pg-settings button')].find(b => /introduction again/.test(b.textContent))`;
      await page.waitFor(again, {what: 'the reopen button'});
      await page.eval(`${again}.focus(); ${again}.click(); 1`);
      await page.waitFor(`document.querySelector('dialog.ob[open]')`, {what: 'the introduction again'});
      await page.key('Escape', {code: 'Escape', keyCode: 27});
      await page.waitFor(`!document.querySelector('dialog.ob')`, {what: 'Escape to close it'});
      assert.match(await active(page), /introduction again/, 'focus back on the button');
    },
  },
  {
    name: 'help: ? anywhere, the rail button, the player ⋯ menu; Escape closes; keys stay inside',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/exercises');
      await waitForRoute(page, '#/exercises');
      await page.key('?', {code: 'Slash', text: '?'});
      await page.waitFor(`document.querySelector('dialog.hp[open]')`, {what: 'help from ?'});
      assert.match(await active(page), /^hp-title/);
      const text = await page.eval(`document.querySelector('dialog.hp').textContent`);
      for (const s of ['The four places', 'How practising works', 'Keyboard shortcuts', 'The iPad on the music stand', 'Where your data lives', 'Export my data'])
        assert.ok(text.includes(s), `help mentions “${s}”`);
      await page.key('Escape', {code: 'Escape', keyCode: 27});
      await page.waitFor(`!document.querySelector('dialog.hp')`, {what: 'help closed'});

      // The quiet "?" in the rail.
      await page.eval(`document.querySelector('.nav-help').focus(); 1`);
      await page.click('.nav-help');
      await page.waitFor(`document.querySelector('dialog.hp[open]')`, {what: 'help from the rail'});
      await page.click('.hp-close');
      await page.waitFor(`!document.querySelector('dialog.hp')`, {what: 'help closed by ×'});
      assert.match(await active(page), /nav-help/, 'focus back on the rail button');

      // In the player: ⋯ → Help & shortcuts; a shortcut key typed in help doesn't reach the player.
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      const loop = await page.eval(`window.pianoPlayer.getState().loop`);
      await page.click('#more-btn');
      await page.click('#help-btn');
      await page.waitFor(`document.querySelector('dialog.hp[open]')`, {what: 'help from ⋯'});
      assert.equal(await page.eval(`document.getElementById('more-menu').hidden`), true, '⋯ menu closed');
      await page.key('l', {code: 'KeyL', text: 'l'});
      await sleep(150);
      assert.equal(await page.eval(`window.pianoPlayer.getState().loop`), loop, 'L inside help did not toggle the loop');
      await page.key('Escape', {code: 'Escape', keyCode: 27});
      await page.waitFor(`!document.querySelector('dialog.hp')`, {what: 'help closed'});
      assert.match(await active(page), /^more-btn/, 'focus back on ⋯');
    },
  },
];
