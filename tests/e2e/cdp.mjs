// A tiny Chrome DevTools Protocol driver for the end-to-end tests (no dependencies).
//
//   const browser = await launchChrome();           // always headless + --mute-audio
//   const page = await browser.newPage({width: 1180, height: 820});
//   await page.goto(url); await page.eval('document.title');
//   page.errors                                     // console errors, exceptions, failed loads
//   await browser.close();                          // kills Chrome and removes its profile
//
// Chrome is found through $CHROME_PATH, then the usual macOS / Linux locations.
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

export function findChrome() {
  const path = process.env.CHROME_PATH || CANDIDATES.find(p => existsSync(p));
  if (!path) throw new Error('Chrome not found: set CHROME_PATH');
  return path;
}

/** Launches headless Chrome with a throwaway profile. */
export async function launchChrome({profileRoot = process.env.E2E_PROFILE_ROOT || tmpdir(), args = []} = {}) {
  mkdirSync(profileRoot, {recursive: true});
  const profile = mkdtempSync(join(profileRoot, 'e2e-chrome-'));
  const chrome = spawn(findChrome(), [
    '--headless=new', '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
    ...(process.env.CI ? ['--no-sandbox'] : []), ...args, 'about:blank',
  ], {stdio: ['ignore', 'ignore', 'pipe']});
  const closed = new Promise(r => chrome.once('exit', r));
  // Chrome prints "DevTools listening on ws://…" on stderr once it's ready.
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start: ' + buf.slice(-500))), 20000);
    chrome.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}): ${buf.slice(-500)}`)); });
  });
  const httpBase = wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/.*$/, '');
  const pages = [];
  return {
    async newPage({width = 1180, height = 820, mobile = false, scale = 1} = {}) {
      const res = await fetch(`${httpBase}/json/new?about:blank`, {method: 'PUT'});
      const target = await res.json();
      const page = await connectPage(target.webSocketDebuggerUrl, {width, height, mobile, scale});
      pages.push(page);
      return page;
    },
    async close() {
      for (const p of pages) p.close();
      chrome.kill('SIGKILL');
      await Promise.race([closed, sleep(3000)]);
      try { rmSync(profile, {recursive: true, force: true, maxRetries: 3}); } catch {}
    },
  };
}

async function connectPage(wsUrl, viewport) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP socket failed')); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  const errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const {resolve, reject, method} = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) reject(new Error(`${method}: ${d.error.message}`)); else resolve(d.result);
      return;
    }
    const p = d.params;
    if (d.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    else if (d.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) errors.push('console.error: ' + p.args.map(a => a.value ?? a.description).join(' '));
    else if (d.method === 'Log.entryAdded' && p.entry.level === 'error') errors.push(`log: ${p.entry.text} ${p.entry.url || ''}`.trim());
    for (const fn of listeners) fn(d);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, {resolve, reject, method});
    ws.send(JSON.stringify({id: i, method, params}));
  });
  await Promise.all([send('Runtime.enable'), send('Log.enable'), send('Page.enable'), send('DOM.enable')]);

  const page = {
    errors, send,
    on: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    async setViewport({width, height, mobile = false, scale = 1}) {
      await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: scale, mobile});
      if (mobile) await send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
      else await send('Emulation.setTouchEmulationEnabled', {enabled: false});
    },
    /** Evaluates an expression (or `async () => …` source) in the page and returns its JSON value. */
    async eval(expr) {
      const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true, userGesture: true});
      if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200));
      return r.result.value;
    },
    async goto(url, {settle = 400} = {}) {
      const loaded = new Promise(r => { const off = page.on(d => { if (d.method === 'Page.loadEventFired') { off(); r(); } }); });
      const nav = await send('Page.navigate', {url});
      if (nav.errorText) throw new Error(`navigation to ${url} failed: ${nav.errorText}`);
      // Only a new document fires load; a fragment change (#/a → #/b) is same-document.
      if (nav.loaderId) await Promise.race([loaded, sleep(20000)]);
      await sleep(settle);
    },
    /** Polls `expr` until it is truthy; throws with `what` after `timeout` ms. */
    async waitFor(expr, {timeout = 15000, what = expr, interval = 100} = {}) {
      const end = Date.now() + timeout;
      let last;
      while (Date.now() < end) {
        try { last = await page.eval(expr); if (last) return last; } catch (e) { last = e.message; }
        await sleep(interval);
      }
      throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
    },
    /** A real (trusted) click in the middle of the element matching `selector`. */
    async click(selector) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
        el.scrollIntoView({block: 'center', inline: 'center'}); const r = el.getBoundingClientRect();
        return r.width && r.height ? {x: r.left + r.width / 2, y: r.top + r.height / 2} : null; })()`);
      if (!box) throw new Error(`nothing visible to click: ${selector}`);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {type, x: box.x, y: box.y, button: 'left', clickCount: 1});
    },
    /** Presses and releases a pointer on an element (pointerdown/up, as a finger on the on-screen keys). */
    async tap(selector, {hold = 120} = {}) {
      const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
        const r = el.getBoundingClientRect(); return r.width && r.height ? {x: r.left + r.width / 2, y: r.top + r.height * .75} : null; })()`);
      if (!box) throw new Error(`nothing visible to tap: ${selector}`);
      await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1});
      await sleep(hold);
      await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1});
    },
    async key(key, {code = key, keyCode = 0, text} = {}) {
      await send('Input.dispatchKeyEvent', {type: 'keyDown', key, code, text, windowsVirtualKeyCode: keyCode});
      await send('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode});
    },
    async screenshot() {
      const r = await send('Page.captureScreenshot', {format: 'png'});
      return Buffer.from(r.data, 'base64');
    },
    close() { try { ws.close(); } catch {} },
  };
  await page.setViewport(viewport);
  return page;
}
