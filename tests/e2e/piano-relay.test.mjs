// The piano relay around the app (src/relay/). vite preview has no dev server, so the relay itself
// can't run here (tests/bridge.test.js runs it against fakes); this checks what the preview can:
// the iPad's "No piano?" line, the player connecting when Today's card was granted MIDI, and that
// the Mac-only "Piano & iPad" card stays away from a built copy.
import {VIEWPORTS, waitForRoute, waitForSong} from './helpers.mjs';

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const NO_WEB_MIDI = `(() => { try { delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess; } catch {} })();`;
const FAKE_MIDI = `(() => {
  const input = {id: 'e2e', name: 'E2E keys', state: 'connected', onmidimessage: null};
  const access = {inputs: new Map([['e2e', input]]), outputs: new Map(), onstatechange: null};
  Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => access});
  window.__midi = data => input.onmidimessage?.({data: new Uint8Array(data), timeStamp: performance.now()});
})();`;

const visible = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);

export const tests = [
  {
    name: 'iPad without Web MIDI: one quiet "No piano?" line, dismissable for good',
    async run({base, page: open, assert, catalog}) {
      const page = await open(VIEWPORTS.portrait);
      await page.send('Emulation.setUserAgentOverride', {userAgent: IPAD_UA, platform: 'iPad'});
      await page.send('Page.addScriptToEvaluateOnNewDocument', {source: NO_WEB_MIDI});
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      assert.equal(await page.eval(`typeof navigator.requestMIDIAccess`), 'undefined');
      await page.click('#more-btn');
      await page.waitFor(`(() => { const e = document.querySelector('#midi-chip .piano-hint'); return e && !e.hidden; })()`, {what: 'hint in the ⋯ menu'});
      assert.match(await page.eval(`document.querySelector('#midi-chip .piano-hint').textContent`), /No piano\? On the Mac run the relay.*Web MIDI Browser/);
      await page.click('#settings-btn');
      await page.waitFor(`!document.getElementById('settings').hidden`, {what: 'settings open'});
      assert.ok(await visible(page, '#settings .set-group .piano-hint'), 'hint in Settings → This device');
      assert.equal(await page.eval(`document.querySelectorAll('.piano-hint:not([hidden])').length`), 2);
      await page.click('#settings .set-group .piano-hint-ok');
      assert.equal(await page.eval(`document.querySelectorAll('.piano-hint:not([hidden])').length`), 0, 'Got it hides every copy');
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      assert.equal(await page.eval(`document.querySelectorAll('.piano-hint:not([hidden])').length`), 0, 'and stays hidden');
    },
  },
  {
    name: 'Mac browser: no hint, no relay card on a built copy, and the player connects when MIDI is granted elsewhere',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.send('Page.addScriptToEvaluateOnNewDocument', {source: FAKE_MIDI});
      await page.goto(base + '#/today');
      await waitForRoute(page, '#/today');
      await sleep(300);
      assert.equal(await page.eval(`[...document.querySelectorAll('.ipl')].filter(e => !e.hidden).length`), 0, 'the Piano & iPad card is for the Mac dev server only');
      assert.equal(await page.eval(`document.querySelectorAll('.piano-hint:not([hidden])').length`), 0, 'no hint where Web MIDI works');
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      assert.notEqual(await page.eval(`document.getElementById('midi-chip').dataset.state`), 'on');
      await page.eval(`window.dispatchEvent(new CustomEvent('piano:midi-granted')); 1`);
      await page.waitFor(`document.getElementById('midi-chip').dataset.state === 'on'`, {what: 'the player connected to the fake piano'});
      await page.eval(`window.__notes = []; addEventListener('piano:note', e => __notes.push(e.detail.source)); __midi([144, 60, 80]); __midi([128, 60, 0]); 1`);
      await sleep(50);
      assert.deepEqual(await page.eval(`__notes`), ['midi'], 'one note, once');
    },
  },
];
