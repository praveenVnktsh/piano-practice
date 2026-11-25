// Settings → Diagnostics: the row opens a sheet with every section, Copy report works (clipboard or
// the fallback text), Escape returns to Settings, and "Lighter piano" changes the layer budget.
// vite preview has no /__errors endpoint, so nothing here can reach .data/errors.log.
import {VIEWPORTS, overflow, waitForSong} from './helpers.mjs';

const rows = page => page.eval(`Object.fromEntries([...document.querySelectorAll('#diag .diag-group')].map(g => [g.querySelector('h3').textContent,
  Object.fromEntries([...g.querySelectorAll('.diag-rows > div')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]))]))`);

async function openDiagnostics(page) {
  await page.click('#more-btn');
  await page.click('#settings-btn');
  await page.waitFor(`!document.getElementById('settings').hidden`, {what: 'settings open'});
  await page.click('#diag-open');
  await page.waitFor(`!document.getElementById('diag').hidden && document.getElementById('settings').hidden`, {what: 'diagnostics open'});
  await page.waitFor(`document.getElementById('diag-text').value.includes('Decoded sample memory')`, {what: 'report ready'});
}

export const tests = [
  {
    name: 'diagnostics sheet from Settings',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      await openDiagnostics(page);
      const r = await rows(page);
      for (const t of ['App', 'MIDI', 'Mac relay', 'Audio', 'Samples', 'Storage', 'Device']) assert.ok(r[t], `section ${t}`);
      assert.match(r.App.Version, /^\d+\.\d+\.\d+/);
      assert.match(r['Mac relay'].Relay, /not available/, 'no relay in a production build');
      assert.match(r.Storage.Used, /B$/, 'storage estimate');
      assert.match(r.Device['User agent'], /Chrome/);
      assert.ok(r.Samples['Decoded sample memory']);

      // A key typed in the sheet does not reach the player.
      const loop = await page.eval(`window.pianoPlayer.getState().loop`);
      await page.key('l', {code: 'KeyL', text: 'l'});
      await sleep(100);
      assert.equal(await page.eval(`window.pianoPlayer.getState().loop`), loop);

      await page.click('#diag-copy');
      await page.waitFor(`/Copied|Select all/.test(document.getElementById('diag-status').textContent)`, {what: 'copy feedback'});
      const text = await page.eval(`document.getElementById('diag-text').value`);
      assert.match(text, /^Piano practice diagnostics\n/);

      await page.key('Escape', {code: 'Escape', keyCode: 27});
      await page.waitFor(`document.getElementById('diag').hidden && !document.getElementById('settings').hidden`, {what: 'back to settings'});
      assert.equal(await page.eval(`document.activeElement.id`), 'diag-open');
      await page.key('Escape', {code: 'Escape', keyCode: 27});
      await page.waitFor(`document.getElementById('settings').hidden`, {what: 'settings closed'});
    },
  },
  {
    name: 'lighter piano keeps three layers',
    async run({base, page: open, assert, catalog}) {
      const page = await open(VIEWPORTS.phone);
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      const small = await page.eval(`navigator.deviceMemory <= 4`);
      assert.equal(await page.eval(`window.pianoSound.loaded.profile`), small ? 'light' : 'full', 'Auto follows navigator.deviceMemory in Chrome');
      await page.click('#more-btn');
      await page.click('#settings-btn');
      await page.click('input[name="sound-profile"][value="light"] + span');
      assert.equal(await page.eval(`window.pianoSound.loaded.profile`), 'light');
      assert.deepEqual(await page.eval(`window.pianoSound.loaded.allowed`), [true, false, true, false, true]);
      await page.click('#diag-open');
      await page.waitFor(`document.getElementById('diag-text').value.includes('lighter piano: 3 of 5 layers')`, {what: 'lighter piano in the report'});
      assert.deepEqual(await overflow(page), [], 'no sideways scroll on a phone');
      await page.click('#diag-close');
      await page.click('input[name="sound-profile"][value="auto"] + span');
      assert.equal(await page.eval(`JSON.parse(localStorage.getItem('piano-practice:sound')).pianoProfile`), 'auto');
    },
  },
];
