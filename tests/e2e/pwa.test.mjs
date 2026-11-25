// Home-screen app: manifest and icons are served and valid; the service worker installs and the
// app loads offline; the screen is kept awake while listening.
import {VIEWPORTS, waitForRoute, waitForSong} from './helpers.mjs';

const pngSize = buf => ({w: buf.readUInt32BE(16), h: buf.readUInt32BE(20)});

export const tests = [
  {
    name: 'manifest and icons',
    async run({base, assert, page: open}) {
      const res = await fetch(base + 'manifest.webmanifest');
      assert.equal(res.status, 200);
      const m = await res.json();
      for (const k of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color', 'icons']) assert.ok(m[k], `manifest.${k}`);
      assert.equal(m.name, 'Piano Practice');
      assert.ok(m.icons.some(i => i.purpose === 'maskable'), 'a maskable icon');
      for (const icon of m.icons) {
        const r = await fetch(new URL(icon.src, base + 'manifest.webmanifest'));
        assert.equal(r.status, 200, icon.src);
        assert.equal(r.headers.get('content-type').split(';')[0], icon.type, icon.src);
        if (icon.type === 'image/png') {
          const {w, h} = pngSize(Buffer.from(await r.arrayBuffer()));
          assert.equal(`${w}x${h}`, icon.sizes, icon.src);
        }
      }
      const page = await open(VIEWPORTS.portrait);
      await page.goto(base);
      const head = await page.eval(`({
        manifest: document.querySelector('link[rel=manifest]')?.href,
        touch: document.querySelector('link[rel=apple-touch-icon]')?.href,
        capable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
        viewport: document.querySelector('meta[name=viewport]')?.content,
      })`);
      assert.ok(head.manifest.endsWith('/manifest.webmanifest'));
      assert.equal(head.capable, 'yes');
      assert.match(head.viewport, /viewport-fit=cover/);
      const touch = await fetch(head.touch);
      assert.deepEqual(pngSize(Buffer.from(await touch.arrayBuffer())), {w: 180, h: 180});
      // Chrome's own parse of the manifest: no errors.
      const parsed = await page.send('Page.getAppManifest');
      assert.deepEqual(parsed.errors, [], 'manifest parse errors');
    },
  },
  {
    name: 'service worker caches the app for offline use',
    timeout: 120000,
    async run({base, assert, page: open, catalog}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/today');
      await page.waitFor(`navigator.serviceWorker.ready.then(r => !!r.active)`, {what: 'service worker active', timeout: 60000});
      await page.waitFor(`caches.keys().then(async ks => { const k = ks.find(k => k.startsWith('piano-practice-') && k !== 'piano-practice-dev'); if (!k) return false; const c = await caches.open(k); return (await c.keys()).length > 20; })`, {what: 'precache filled', timeout: 60000});
      const cached = await page.eval(`caches.keys().then(async ks => { const c = await caches.open(ks.find(k => k.startsWith('piano-practice-'))); return (await c.keys()).map(r => new URL(r.url).pathname); })`);
      assert.ok(cached.some(p => p.startsWith('/samples/piano/')), 'piano samples precached');
      assert.ok(cached.some(p => p === '/' + catalog.songs[0].file), 'bundled songs precached');
      assert.ok(cached.some(p => /^\/assets\/index-.*\.js$/.test(p)), 'app bundle precached');
      // Offline: reload and open a piece.
      await page.send('Network.enable');
      await page.send('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
      // A new document (the query string forces a real load, served from the cached shell).
      await page.goto(base + '?offline=1#/play/' + encodeURIComponent(catalog.songs[0].id));
      assert.equal(await page.eval('navigator.onLine'), false, 'really offline');
      await waitForRoute(page, '#/play/');
      await waitForSong(page);
      await page.send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
    },
    // Offline, Google Fonts and the dev-server endpoints fail to load: expected.
    allowErrors: [/ERR_INTERNET_DISCONNECTED/, /Failed to load resource/],
  },
  {
    name: 'screen stays awake while listening',
    async run({base, assert, page: open, catalog}) {
      const page = await open(VIEWPORTS.desktop);
      await page.goto(base + '#/play/' + encodeURIComponent(catalog.songs[0].id));
      await waitForSong(page);
      await page.eval(`window.pianoPWA.wakeLock.state().wanted`).then(v => assert.ok(v, 'wanted right after opening the player'));
      await page.click('#um-listen');
      await page.click('#um-play');
      await page.waitFor(`window.pianoPlayer.getState().playing`, {what: 'listening'});
      await page.waitFor(`window.pianoPWA.wakeLock.state().held`, {what: 'wake lock held'});
      await page.click('#um-play');
      // Leaving the player for a place lets the screen sleep again.
      await page.eval(`location.hash = '#/pieces'`);
      await waitForRoute(page, '#/pieces');
      await page.waitFor(`!window.pianoPWA.wakeLock.state().held`, {what: 'wake lock released'});
    },
  },
];

tests.push({
  name: 'backup: export and restore in the browser (no dev server)',
  async run({base, assert, page: open}) {
    const page = await open(VIEWPORTS.phone);
    await page.goto(base + '#/progress');
    await waitForRoute(page, '#/progress');
    const result = await page.eval(`(async () => {
      const m = await window.pianoPWA.backup();
      localStorage.setItem('piano-practice.theme', 'dark');
      const b = await m.exportBackup({download: false});
      localStorage.setItem('piano-practice.theme', 'light');
      const summary = m.summarize(b);
      const r = await m.restoreBackup(JSON.parse(JSON.stringify(b)));
      return {server: b.server, summary, restored: r, theme: localStorage.getItem('piano-practice.theme')};
    })()`);
    assert.equal(result.server, null, 'preview has no dev-server part');
    assert.equal(result.theme, 'dark', 'setting restored');
    assert.ok(result.summary.settings >= 1);
    // The controls render and reject a file that isn't a backup.
    await page.eval(`window.pianoPWA.backup().then(m => { const h = document.createElement('div'); h.id = 'bk-host'; document.body.append(h); m.mountBackupControls(h); })`);
    await page.waitFor(`document.querySelector('#bk-host .bk-btn')`);
  },
});
