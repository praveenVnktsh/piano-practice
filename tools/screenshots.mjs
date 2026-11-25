// README screenshots: npm run screenshots [-- <name filter>] [--no-build] [--list]
//
// Builds the app into a temporary folder, serves it with `vite preview` (never the dev server, so
// none of the Mac's private data — .data/, .teacher/, public/songs/local/ — is reachable) and
// photographs it in headless, muted Chrome (tests/e2e/cdp.mjs) at retina scale. The pages are
// filled with made-up demo practice (a few weeks on bundled public-domain pieces) seeded into the
// throwaway profile's localStorage, and the teacher panel gets an obviously generic sample letter.
// Output: docs/screenshots/<name>.png (each kept under ~600 KB; larger shots are downscaled with
// macOS `sips` when it is there).
import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchChrome, sleep} from '../tests/e2e/cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/screenshots');
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js');
const args = process.argv.slice(2);
const filter = args.find(a => !a.startsWith('--'));
const MAX_BYTES = 600 * 1024;

const DESKTOP = {width: 1280, height: 820, scale: 2};
const IPAD_PORTRAIT = {width: 820, height: 1180, scale: 2, mobile: true};
const IPAD_LANDSCAPE = {width: 1180, height: 820, scale: 2, mobile: true};
const PHONE = {width: 390, height: 844, scale: 2, mobile: true};

// ───────────────────────── demo data ─────────────────────────

const PIECES = {
  minuet: {id: 'minuet-in-g', title: 'Minuet in G, BWV Anh. 114', bars: 32, tempo: 108},
  elise: {id: 'fur-elise', title: 'Für Elise', bars: 126, tempo: 72},
  clementi: {id: 'clementi-sonatina-op36-1', title: 'Sonatina in C, Op. 36 No. 1 — 1st movement', bars: 76, tempo: 108},
  arabesque: {id: 'burgmuller-arabesque', title: 'Arabesque, Op. 100 No. 2', bars: 55, tempo: 112},
};

// A small deterministic random source, so every run seeds the same history.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Four weeks of believable practice ending today → the localStorage progress document. */
function demoProgress(now = Date.now()) {
  const r = rng(7);
  const events = [], journal = [];
  const tz = new Date(now).getTimezoneOffset();
  let n = 0;
  const id = () => 'demo' + String(++n).padStart(6, '0');
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const at = (daysAgo, hour, min = 0) => day0.getTime() - daysAgo * 864e5 + (hour * 60 + min) * 60e3;
  const skip = new Set([26, 23, 19]); // a few missed days early on; the streak since is unbroken
  const session = (t, p, kind, minutes) => events.push({type: 'practice:session', id: id(), at: t, tz, songId: p.id, title: p.title, kind, durationMs: Math.round(minutes * 60e3)});
  const result = (t, p, section, {accuracy, tempo, mode = 'wait', hands = 'both', misses = []}) => {
    const notes = (section[1] - section[0] + 1) * 7;
    const wrong = Math.round(notes * (100 - accuracy) / 100);
    events.push({type: 'practice:result', id: id(), at: t, tz, songId: p.id, title: p.title, section, mode, hands, tempo,
      accuracy, right: notes - wrong, wrong, measureCount: p.bars, durationMs: notes * 900,
      timing: mode === 'timed' ? {early: Math.round(wrong / 2), late: Math.round(wrong / 3), onTime: notes - wrong} : null, misses});
  };
  const trainer = (t, level, accuracy, avgMs = 1400) => {
    const right = Math.round(20 * accuracy / 100);
    events.push({type: 'trainer:result', id: id(), at: t, tz, level, accuracy, right, wrong: 20 - right, avgMs, durationMs: 150e3});
  };

  for (let d = 27; d >= 0; d--) {
    if (skip.has(d)) continue;
    const progress = (27 - d) / 27; // 0 → 1 over the four weeks
    let t = d ? at(d, d % 3 ? 18 : 8, Math.floor(r() * 40)) : Math.min(Date.now() - 50 * 60e3, at(0, 7, 30));
    // Warm-up and reading.
    trainer(t, Math.min(6, 1 + Math.floor(progress * 6)), 78 + Math.round(progress * 16 + r() * 4), 1800 - progress * 700);
    t += 4 * 60e3;
    if (d % 4 === 1) { trainer(t, 'theory:intervals', 80 + Math.round(r() * 15)); t += 3 * 60e3; }
    if (d % 5 === 2) { trainer(t, 'ear:intervals', 70 + Math.round(r() * 20)); t += 3 * 60e3; }
    if (d % 6 === 3) { trainer(t, 'rhythm:quavers', 85 + Math.round(r() * 12)); t += 3 * 60e3; }

    // Technique: a scale or arpeggio most days, around the circle of fifths.
    if (d % 2 === 0 || d < 6) {
      const keys = ['C:major', 'G:major', 'F:major', 'D:major', 'A:minor', 'E:minor'];
      const key = keys[(27 - d) % keys.length];
      const ex = {id: `ex:scale:${key}:both:1:up-down`, title: key.replace(':', ' ') + ' scale', bars: 4};
      result(t, ex, [0, 3], {accuracy: 88 + Math.round(r() * 12), tempo: 80});
      t += 3 * 60e3;
    }
    // Minuet in G: learnt in the first fortnight, polished, then reviewed now and then.
    if (d >= 13 || (d % 5 === 0 && d > 0)) {
      const p = PIECES.minuet;
      session(t, p, d > 24 ? 'listen' : 'practice', 6 + r() * 6);
      if (d <= 24) {
        const learnt = d <= 16;
        const sections = learnt ? [[0, 31]] : [[0, 7], [8, 15], [16, 23], [24, 31]].slice(0, 1 + Math.floor((27 - d) / 2));
        for (const s of sections) {
          const acc = learnt ? 95 + Math.round(r() * 5) : 82 + Math.round(r() * 12);
          const tempo = learnt ? p.tempo : Math.round(p.tempo * (0.6 + 0.3 * progress));
          result(t += 90e3, p, s, {accuracy: acc, tempo, mode: learnt ? 'timed' : 'wait'});
          if (learnt) result(t += 90e3, p, s, {accuracy: 96 + Math.round(r() * 4), tempo, mode: 'timed'});
        }
      }
      t += 8 * 60e3;
    }
    // Für Elise: the main piece from three weeks ago, bars 1–40 coming along, the B section harder.
    if (d <= 21) {
      const p = PIECES.elise;
      if (d === 21 || d === 20) session(t, p, 'listen', 4);
      session(t, p, 'practice', d ? 9 + r() * 8 : 7);
      const reach = Math.min(48, 8 + (21 - d) * 2);
      for (let a = 0; a < reach; a += 8) {
        const b = Math.min(reach, a + 8) - 1;
        const fresh = reach - a <= 8;
        const hard = a >= 24;
        const acc = Math.min(97, (fresh ? 74 : 88) + Math.round(r() * 9) - (hard ? 8 : 0) + (21 - d > 12 ? 4 : 0));
        const misses = hard ? [{measure: String(a + 6), expected: ['E5', 'D#5'], played: ['E5', 'D5']}, {measure: String(a + 7), expected: ['A4'], played: ['B4']}] : [];
        result(t += 100e3, p, [a, b], {accuracy: acc, tempo: Math.round(p.tempo * (fresh ? 0.6 : 0.8 + 0.15 * progress)), mode: fresh ? 'wait' : 'timed', misses});
        if (fresh) result(t += 80e3, p, [a, b], {accuracy: Math.min(97, acc + 6), tempo: Math.round(p.tempo * 0.6), hands: r() > 0.5 ? 'right' : 'left'});
      }
      t += 12 * 60e3;
    }
    // Clementi: started ten days ago with the guided plan.
    if (d <= 10 && d > 0 && d % 2 === 0) {
      const p = PIECES.clementi;
      session(t, p, 'practice', 7 + r() * 5);
      result(t += 120e3, p, [0, 3], {accuracy: 86 + Math.round(r() * 10), tempo: 72, hands: 'right'});
      if (d <= 6) result(t += 120e3, p, [0, 3], {accuracy: 80 + Math.round(r() * 10), tempo: 72, hands: 'left'});
      if (d <= 2) result(t += 120e3, p, [0, 7], {accuracy: 84 + Math.round(r() * 8), tempo: 76});
    }
    // Arabesque: listened to this week.
    if (d === 4 || d === 1) session(t + 20 * 60e3, PIECES.arabesque, 'listen', 3.5);
  }
  // The Clementi learning plan (src/learn/plan.mjs step keys).
  const c = PIECES.clementi;
  const learn = (daysAgo, action, key, next) => events.push({type: 'learn:step', id: id(), at: at(daysAgo, 18, 1), tz, songId: c.id, title: c.title, action, ...(key ? {key} : {}), total: 14, next});
  learn(10, 'start', null, {key: '0-3:listen', label: 'Listen to bars 1–4'});
  learn(10, 'done', '0-3:listen', {key: '0-3:right', label: 'Right hand, bars 1–4'});
  learn(8, 'done', '0-3:right', {key: '0-3:left', label: 'Left hand, bars 1–4'});
  learn(4, 'done', '0-3:left', {key: '0-3:together', label: 'Hands together, bars 1–4, slowly'});

  const note = (daysAgo, hour, text, mood, p, minutes) => journal.push({id: id(), at: at(daysAgo, hour, 50), tz, text, mood, ...(p ? {songId: p.id, title: p.title} : {}), minutes});
  note(15, 19, 'Minuet in G at full tempo for the first time. The left hand finally keeps going on its own.', 'good', PIECES.minuet, 24);
  note(8, 19, 'Für Elise: the B section (bar 30 onwards) still trips me up. Slow practice, hands separately tomorrow.', 'hard', PIECES.elise, 21);
  note(2, 19, 'Clementi hands together for the first four bars. Counting out loud helps.', 'okay', PIECES.clementi, 18);

  events.sort((a, b) => a.at - b.at);
  return {
    version: 1, settings: {dailyGoalMin: 20, pathStart: 'grade-1'}, events, journal,
    goals: [{id: 'demogoal01', songId: PIECES.elise.id, title: PIECES.elise.title, bpm: 72, accuracy: 90,
      by: new Date(now + 24 * 864e5).toISOString().slice(0, 10), createdAt: at(12, 19)}],
    updatedAt: now,
  };
}

/** Everything the page's localStorage holds before the app starts. */
function demoStorage({theme = 'light'} = {}) {
  const song = (extra = {}) => JSON.stringify({firstLookSeen: true, ...extra});
  return {
    'piano-practice.onboarded': 'demo',
    'piano-practice.theme': theme,
    'piano-practice.progress.local': JSON.stringify(demoProgress()),
    'piano-practice.journal.prompt': JSON.stringify({lastAt: Date.now()}),
    'piano-practice.last-song': PIECES.elise.id,
    ...Object.fromEntries(Object.values(PIECES).map(p => ['piano-practice:song:' + p.id, song()])),
  };
}

// A generic sample conversation for the Teacher panel, fed through a stand-in EventSource (vite
// preview has no /__teacher). Nothing here comes from a real teacher.
const SAMPLE_THREAD = () => {
  const t = m => new Date(Date.now() - m * 60e3).toISOString();
  return {
    messages: [{id: 1, at: t(42), text: 'The B section of Für Elise keeps falling apart around bar 30. Any ideas?'}],
    replies: [{id: 1, replyTo: 1, at: t(38), text:
      'That passage changes hand position twice in two bars, so it is worth slowing right down.\n\n' +
      '- Play bars **30–33** right hand alone in *Wait* until three clean passes in a row.\n' +
      '- Then hands together at **♩ = 50**, and let *speed up after clean passes* take it from there.\n\n' +
      'Keep the wrist loose on the repeated E–D♯: it is a turn, not a trill.',
    actions: [
      {type: 'plan', label: 'This week', items: [
        {label: 'Bars 30–33, right hand, Wait', minutes: 5},
        {label: 'Bars 30–33, hands together at ♩ = 50', minutes: 5},
        {label: 'Whole A section, Play along', minutes: 5},
      ]},
    ]}],
    status: {thinking: null},
  };
};

// Stand-ins installed before the app starts: a Web MIDI keyboard (window.__midi([status, note,
// velocity]) plays it) and, with `teacher`, an EventSource that hands the panel the sample thread
// (and the page is told it is on the Mac, so the teacher is mounted).
const fakes = ({teacher = false} = {}) => `(() => {
  const input = {id: 'demo', name: 'Digital Piano', manufacturer: 'Demo', state: 'connected', onmidimessage: null};
  const access = {inputs: new Map([['demo', input]]), outputs: new Map(), onstatechange: null};
  Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => access});
  window.__midi = data => input.onmidimessage?.({data: new Uint8Array(data), timeStamp: performance.now()});
  ${teacher ? `try { sessionStorage.setItem('piano-practice.where', 'mac'); } catch {} // a built copy is a static site (src/app/mac.js): show the Mac's teacher
  const thread = ${JSON.stringify(SAMPLE_THREAD())};
  const json = v => Promise.resolve(new Response(JSON.stringify(v), {headers: {'content-type': 'application/json'}}));
  const realFetch = window.fetch;
  window.fetch = (u, o) => { const p = new URL(String(u), location.href).pathname;
    return p === '/__teacher' ? json(thread) : p.startsWith('/__teacher/') ? json({}) : realFetch(u, o); };
  window.EventSource = class { addEventListener() {} removeEventListener() {} close() {} };` : ''}
})();`;

// ───────────────────────── capture ─────────────────────────

let base, browser;

async function open(viewport, {theme = 'light', teacher = false, storage = {}} = {}) {
  const page = await browser.newPage(viewport);
  const seed = {...demoStorage({theme}), ...storage};
  // Seed once per tab (sessionStorage survives reloads of the tab, not new tabs).
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `try { if (!sessionStorage.getItem('demo-seeded')) {
    localStorage.clear(); const s = ${JSON.stringify(seed)}; for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem('demo-seeded', '1'); } } catch {}`});
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source: fakes({teacher})});
  // No caret blinking or half-finished transitions in a photograph.
  await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `addEventListener('DOMContentLoaded', () => { const s = document.createElement('style');
    s.textContent = '*, *::before, *::after { caret-color: transparent !important; transition-duration: 0s !important; animation-duration: 0s !important; animation-delay: 0s !important; }'; document.head.append(s); });`});
  await page.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: theme === 'dark' ? 'dark' : 'light'}, {name: 'prefers-reduced-motion', value: 'reduce'}]});
  return page;
}

async function go(page, hash) {
  await page.goto(base + hash, {settle: 300});
  const play = hash.startsWith('#/play/');
  await page.waitFor(play
    ? `(() => { const s = window.pianoPlayer?.getState?.(); return s && s.songId && s.measureCount > 0 && document.querySelectorAll('#player .pkey').length > 20; })()`
    : `(() => { const h = [...document.querySelectorAll('.view-host')].find(v => !v.hidden); return document.documentElement.dataset.route === 'place' && h && h.children.length > 0; })()`,
  {what: 'route ' + hash, timeout: 30000});
  await fontsReady(page);
}

const fontsReady = page => page.eval(`document.fonts.ready.then(() => true)`);
const js = (page, src) => page.eval(`(() => { ${src}; return true; })()`);

/** Plays the prompted notes on the fake keyboard until the results card shows (Practise, Wait). */
async function playThrough(page, {velocity = i => 64, wrongAt = new Set(), steps = 200} = {}) {
  await page.waitFor(`window.pianoPlayer.getState().practicing && document.querySelector('#player .pkey.attack')`, {what: 'a key to play', timeout: 20000});
  for (let i = 0; i < steps; i++) {
    if (await page.eval(`!document.getElementById('um-complete').hidden`)) return;
    const notes = await page.eval(`[...document.querySelectorAll('#player .pkey.attack')].map(k => +k.dataset.note)`);
    if (!notes.length) { await sleep(60); continue; }
    if (wrongAt.has(i)) { await page.eval(`__midi([144, ${notes[0] + 1}, 60]); 1`); await sleep(60); await page.eval(`__midi([128, ${notes[0] + 1}, 0]); 1`); }
    for (const n of notes) await page.eval(`__midi([144, ${n}, ${Math.round(velocity(i, n))}]); 1`);
    await sleep(110);
    for (const n of notes) await page.eval(`__midi([128, ${n}, 0]); 1`);
    await sleep(50);
  }
}

async function shoot(page, name, {full = false, maxHeight = 2400} = {}) {
  if (full) {
    // The whole page (up to maxHeight CSS px): the view scrolls inside .view-host or the document.
    const h = await page.eval(`Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll('.view-host:not([hidden]) .view-scroll')].map(v => v.scrollHeight + v.getBoundingClientRect().top))`);
    const vp = await page.eval(`({width: innerWidth, height: innerHeight, scale: devicePixelRatio})`);
    await page.setViewport({width: vp.width, height: Math.min(maxHeight, Math.max(vp.height, h)), scale: vp.scale});
    await sleep(400);
  }
  await sleep(250);
  const file = join(OUT, name + '.png');
  writeFileSync(file, await page.screenshot());
  let size = statSync(file).size;
  // Too heavy: scale down (macOS sips), 10 % at a time.
  const {width} = await page.eval(`({width: innerWidth * devicePixelRatio})`);
  for (let w = Math.round(width * 0.9); size > MAX_BYTES && w > 600; w = Math.round(w * 0.9)) {
    if (spawnSync('sips', ['--resampleWidth', String(w), file, '--out', file], {stdio: 'ignore'}).status !== 0) break;
    size = statSync(file).size;
  }
  console.log(`  ${name}.png  ${(size / 1024).toFixed(0)} KB${size > MAX_BYTES ? '  (over the size budget)' : ''}`);
}

const ELISE = '#/play/fur-elise';

/** name → async () => void. Each opens its own tab, so its state is its own. */
const SHOTS = {
  async today() {
    const page = await open(DESKTOP);
    await go(page, '#/today');
    await sleep(600);
    await shoot(page, 'today');
  },
  async 'today-dark'() {
    const page = await open(DESKTOP, {theme: 'dark'});
    await go(page, '#/today');
    await sleep(600);
    await shoot(page, 'today-dark');
  },
  async pieces() {
    const page = await open(DESKTOP);
    await go(page, '#/pieces');
    await sleep(800);
    await js(page, `const h = [...document.querySelectorAll('h2, h3')].find(e => /Beethoven/.test(e.textContent)); h.scrollIntoView({block: 'start'}); h.closest('.view-scroll').scrollTop -= 40`);
    await shoot(page, 'pieces');
  },
  async player() {
    const page = await open(DESKTOP);
    await go(page, ELISE);
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `window.pianoPlayer.setSection(8, 15); window.pianoPlayer.setMode('wait'); window.pianoPlayer.setLoop(true)`);
    await sleep(800);
    await js(page, `window.pianoPlayer.listen()`);
    await sleep(3500);
    await page.click('#um-play');
    await sleep(500);
    await shoot(page, 'player');
  },
  async 'player-dark'() {
    const page = await open(DESKTOP, {theme: 'dark'});
    await go(page, ELISE);
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `window.pianoPlayer.setSection(8, 15); window.pianoPlayer.setLoop(true)`);
    await sleep(800);
    await js(page, `window.pianoPlayer.listen()`);
    await sleep(3500);
    await page.click('#um-play');
    await shoot(page, 'player-dark');
  },
  async falling() {
    for (const theme of ['light', 'dark']) {
      const page = await open(DESKTOP, {theme});
      await go(page, ELISE);
      await page.eval(`document.querySelector('input[name="menu-view"][value="falling"]').click(), true`);
      await js(page, `window.pianoPlayer.setSection(0, 7); window.pianoPlayer.setLoop(true)`);
      await sleep(800);
      await js(page, `window.pianoPlayer.listen()`);
      await sleep(4200);
      await page.click('#um-play');
      await shoot(page, theme === 'dark' ? 'falling-notes-dark' : 'falling-notes');
    }
  },
  async 'first-look'() {
    const page = await open(DESKTOP);
    await go(page, '#/play/burgmuller-pastorale');
    await page.waitFor(`document.querySelector('#player .first-look')`, {what: 'the first-look card'});
    await shoot(page, 'first-look');
  },
  async learn() {
    const page = await open(DESKTOP);
    await go(page, '#/play/minuet-in-g');
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await page.click('#section-btn');
    await page.click('#learn-toggle');
    await page.waitFor(`!document.getElementById('learn-next').hidden`, {what: 'the Next step button'});
    await shoot(page, 'learn-step');
  },
  async results() {
    const page = await open(DESKTOP);
    await go(page, ELISE);
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `document.getElementById('um-midi').click()`);
    await sleep(500);
    await js(page, `window.pianoPlayer.setSection(0, 7); window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('right'); window.pianoPlayer.setLoop(false)`);
    await page.click('#um-practice');
    await page.click('#um-play');
    // A gentle rise and fall over each phrase, and two slips.
    await playThrough(page, {velocity: i => 58 + 22 * Math.sin((i % 12) / 12 * Math.PI) + (i % 3) * 3, wrongAt: new Set([17, 30])});
    await page.waitFor(`!document.getElementById('um-complete').hidden`, {what: 'the results card'});
    await sleep(600);
    await shoot(page, 'results');
  },
  async evenness() {
    const page = await open(DESKTOP);
    await go(page, '#/play/' + encodeURIComponent('ex:scale:G:major:right:2:up-down'));
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `document.getElementById('um-midi').click()`);
    await sleep(500);
    await js(page, `window.pianoPlayer.setMode('wait'); window.pianoPlayer.setLoop(false)`);
    await page.click('#um-practice');
    await page.click('#um-play');
    // Fairly even, with the thumb-under a touch heavy.
    await playThrough(page, {velocity: i => 66 + (i % 8 === 3 ? 12 : 0) + (i % 2) * 4});
    await page.waitFor(`!document.getElementById('um-complete').hidden`, {what: 'the results card'});
    await sleep(600);
    await shoot(page, 'results-evenness');
  },
  async exercises() {
    const page = await open(DESKTOP);
    await go(page, '#/exercises');
    await sleep(500);
    await shoot(page, 'exercises');
  },
  async technique() {
    const page = await open(DESKTOP);
    await go(page, '#/play/' + encodeURIComponent('ex:scale:D:major:both:2:up-down'));
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await sleep(1200);
    await shoot(page, 'technique-scale');
  },
  async reading() {
    const page = await open(DESKTOP);
    await go(page, '#/train/reading');
    await sleep(500);
    await shoot(page, 'reading');
  },
  async lessons() {
    const page = await open(DESKTOP);
    await go(page, '#/exercises/lessons/keyboard');
    await sleep(500);
    await shoot(page, 'lessons');
  },
  async theory() {
    const page = await open(DESKTOP);
    await go(page, '#/exercises/theory/intervals');
    await sleep(500);
    await shoot(page, 'theory');
  },
  async ear() {
    const page = await open(DESKTOP);
    await go(page, '#/exercises/ear');
    await sleep(500);
    await shoot(page, 'ear');
  },
  async progress() {
    const page = await open(DESKTOP);
    await go(page, '#/progress');
    await sleep(800);
    await shoot(page, 'progress');
    await js(page, `const h = [...document.querySelectorAll('.view-host:not([hidden]) *')].find(e => e.children.length === 0 && /^last 14 days$/i.test(e.textContent.trim())); const sc = h.closest('.view-scroll'); sc.scrollTop += h.getBoundingClientRect().top - 60`);
    await sleep(400);
    await shoot(page, 'progress-charts');
  },
  async recording() {
    const page = await open(DESKTOP);
    await go(page, ELISE);
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `document.getElementById('um-midi').click()`);
    await sleep(500);
    await page.click('#rec-btn');
    await page.waitFor(`document.getElementById('rec-btn').getAttribute('aria-pressed') === 'true'`, {what: 'recording'});
    // Shadow the score while it plays: each key the player lights is pressed on the fake keyboard,
    // a little late or early now and then, with a gently shaped touch.
    await js(page, `window.pianoPlayer.setSection(0, 8); window.pianoPlayer.setLoop(false); window.pianoPlayer.setTempo(66);
      let prev = new Set(), i = 0;
      window.__shadow = setInterval(() => {
        const keys = [...document.querySelectorAll('#player .pkey.attack, #player .pkey.held')].map(k => +k.dataset.note);
        const now = new Set(keys);
        for (const n of now) if (!prev.has(n)) { const v = 56 + Math.round(18 * Math.sin(i++ / 5)); setTimeout(() => __midi([144, n, v]), (i * 37 % 11) * 9); }
        for (const n of prev) if (!now.has(n)) __midi([128, n, 0]);
        prev = now;
      }, 5)`);
    await js(page, `window.pianoPlayer.listen()`);
    await sleep(500);
    await page.waitFor(`!window.pianoPlayer.getState().playing`, {what: 'the passage played', timeout: 60000});
    await js(page, `clearInterval(window.__shadow)`);
    await sleep(300);
    await page.click('#rec-btn');
    await page.waitFor(`document.querySelector('#rec-strip:not([hidden]) .rec-strip-saved')`, {what: 'take saved'});
    await page.click('#more-btn');
    await page.click('#rec-list-btn');
    await page.waitFor(`document.querySelector('#rec-review:not([hidden]) .rec-note .rec-acc')`, {what: 'report'});
    await sleep(800);
    await shoot(page, 'recording-review');
  },
  async settings() {
    const page = await open(DESKTOP);
    await go(page, ELISE);
    await page.click('#more-btn');
    await page.click('#settings-btn');
    await page.waitFor(`!document.getElementById('settings').hidden`, {what: 'settings open'});
    await sleep(400);
    await shoot(page, 'settings');
    await page.click('#diag-open');
    await page.waitFor(`!document.getElementById('diag').hidden && document.getElementById('diag-text').value.includes('Decoded sample memory')`, {what: 'diagnostics'});
    await sleep(400);
    await shoot(page, 'diagnostics');
  },
  async teacher() {
    const page = await open(DESKTOP, {teacher: true});
    await go(page, ELISE);
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `window.pianoPlayer.setSection(29, 33)`);
    await page.waitFor(`document.querySelector('.tch-fab:not([hidden])')`, {what: 'the Teacher button'});
    await sleep(600);
    await page.click('.tch-fab');
    await page.waitFor(`document.querySelector('.tch-panel:not([hidden]) .tch-letter')`, {what: 'the sample letter'});
    await sleep(500);
    await shoot(page, 'teacher');
  },
  async 'ipad-portrait'() {
    const page = await open(IPAD_PORTRAIT);
    await go(page, ELISE);
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `window.pianoPlayer.setSection(8, 15); document.getElementById('zoom-out').click(); document.getElementById('zoom-out').click()`);
    await sleep(1500);
    await shoot(page, 'ipad-portrait');
  },
  async 'ipad-landscape'() {
    const page = await open(IPAD_LANDSCAPE);
    await go(page, ELISE);
    await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
    await js(page, `window.pianoPlayer.setSection(16, 23)`);
    await sleep(1500);
    await shoot(page, 'ipad-landscape');
  },
  async phone() {
    const page = await open(PHONE);
    await go(page, '#/today');
    await sleep(600);
    await shoot(page, 'phone-today');
  },
};

// ───────────────────────── server ─────────────────────────

function run(cmd, argv, env) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, argv, {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => code === 0 ? done(out) : fail(new Error(`${cmd} exited ${code}\n${out.slice(-3000)}`)));
  });
}

const freePort = () => new Promise((done, fail) => {
  const srv = createServer();
  srv.once('error', fail);
  srv.listen(0, '127.0.0.1', () => { const {port} = srv.address(); srv.close(() => done(port)); });
});

async function main() {
  if (args.includes('--list')) { console.log(Object.keys(SHOTS).join('\n')); return 0; }
  const tmp = mkdtempSync(join(tmpdir(), 'pp-shots-'));
  // TEACHER_DIR etc. point into the temp folder: nothing can reach the real .data/ or .teacher/.
  const env = {...process.env, TEACHER_DIR: join(tmp, 'teacher'), RECORDINGS_DIR: join(tmp, 'recordings'), ERRORS_DIR: join(tmp, 'errors'), BROWSER: 'none'};
  delete env.INCLUDE_LOCAL_SONGS;
  delete env.ANNOTATE;
  const outDir = args.includes('--no-build') ? join(ROOT, 'dist') : join(tmp, 'dist');
  let preview;
  try {
    if (!args.includes('--no-build')) {
      process.stdout.write('building… ');
      await run(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], env);
      console.log('done');
    }
    const port = await freePort();
    preview = spawn(process.execPath, [VITE, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {cwd: ROOT, env, stdio: 'ignore'});
    base = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await sleep(150); }
    browser = await launchChrome({profileRoot: tmp}); // headless, --mute-audio
    mkdirSync(OUT, {recursive: true});
    let failed = 0;
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (filter && !name.includes(filter)) continue;
      try { await Promise.race([shot(), sleep(120000).then(() => { throw new Error('timed out'); })]); }
      catch (e) { failed++; console.log(`✗ ${name}: ${String(e.stack || e).split('\n').slice(0, 4).join('\n    ')}`); }
    }
    return failed ? 1 : 0;
  } finally {
    await browser?.close().catch(() => {});
    preview?.kill('SIGTERM');
    rmSync(tmp, {recursive: true, force: true});
  }
}

let code = 1;
try { code = await main(); } catch (e) { console.error(e); }
process.exit(code);
