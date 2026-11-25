// The public site (Phase 18): a built copy has none of the Mac's /__ endpoints (src/app/mac.js), so
// nothing asks for them, the teacher stays away, and Progress → Backup takes the progress to the Mac.
import {VIEWPORTS, waitForRoute, waitForSong} from './helpers.mjs';

// Every fetch / EventSource / beacon the page makes, from before the app's first script.
const TRACK = `(() => {
  window.__calls = [];
  const f = window.fetch; window.fetch = (u, o) => { window.__calls.push(String(u?.url || u)); return f(u, o); };
  const E = window.EventSource; if (E) window.EventSource = class extends E { constructor(u, o) { window.__calls.push(String(u)); super(u, o); } };
  const b = navigator.sendBeacon?.bind(navigator); if (b) navigator.sendBeacon = (u, d) => { window.__calls.push(String(u)); return b(u, d); };
})()`;

export const tests = [
  {
    name: 'static site: no requests to the Mac, no teacher, one quiet line',
    async run({base, assert, page: open, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.send('Page.addScriptToEvaluateOnNewDocument', {source: TRACK});
      await page.goto(base + '#/today');
      await waitForRoute(page, '#/today');
      for (const hash of ['#/pieces', '#/exercises', '#/progress']) {
        await page.eval(`location.hash = '${hash}', true`);
        await waitForRoute(page, hash);
        await sleep(300);
      }
      await page.waitFor(`/The teacher lives on your Mac/.test(document.querySelector('.pg-settings > .pg-fine')?.textContent || '')`, {what: 'the quiet line in Progress'});
      assert.match(await page.eval(`document.querySelector('.bk-title').textContent`), /Take this progress to your Mac/);
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.eval(`location.hash = '#/play/${encodeURIComponent(song.id)}', true`);
      await waitForSong(page);
      await sleep(1500); // progress flush, teacher mount, bar comments would have fired by now
      assert.equal(await page.eval(`!!document.querySelector('.tch-fab')`), false, 'no teacher button');
      const calls = await page.eval(`window.__calls.filter(u => /\\/__[a-z]/.test(new URL(u, location.href).pathname))`);
      assert.deepEqual(calls, [], 'no requests to the Mac');
    },
  },
  {
    name: 'static site: a backup from another browser is added, nothing twice',
    async run({base, assert, page: open}) {
      const page = await open(VIEWPORTS.phone);
      await page.goto(base + '#/progress');
      await waitForRoute(page, '#/progress');
      const r = await page.eval(`(async () => {
        const m = await window.pianoPWA.backup();
        const now = Date.now();
        const ev = (id, at) => ({type: 'practice:session', id, songId: 'ode-to-joy', title: 'Ode to Joy', kind: 'practice', durationMs: 120000, at, tz: 0});
        const other = {version: 1, events: [ev('ipadevent1', now - 7200e3), ev('ipadevent2', now - 3600e3)], journal: [{id: 'ipadnote1', at: now - 3000e3, tz: 0, text: 'Steady'}], goals: []};
        const backup = {format: m.FORMAT, version: 1, exportedAt: new Date().toISOString(), server: null,
          browser: {localStorage: {'piano-practice.progress.local': JSON.stringify(other)}, imports: []}};
        const first = await m.mergeBackup(backup);
        const second = await m.mergeBackup(backup);
        const local = JSON.parse(localStorage.getItem('piano-practice.progress.local'));
        return {first, second, ids: local.events.map(e => e.id).filter(id => id.startsWith('ipad')), notes: local.journal.length};
      })()`);
      assert.deepEqual(r.first, {events: 2, journal: 1, goals: 0, imports: 0});
      assert.deepEqual(r.second, {events: 0, journal: 0, goals: 0, imports: 0});
      assert.deepEqual(r.ids, ['ipadevent1', 'ipadevent2']);
      assert.equal(r.notes, 1);
    },
  },
];
