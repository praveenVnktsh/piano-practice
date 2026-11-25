import {passage, spelledName, FollowNotes, handGroups, handFilter, TimedGrader, TIMING, beatsOf, countIn, measureBeats, beatInfo, speedUpTempo, MissLog} from './score-core.mjs';
import {createHighway} from './highway.js';
import {createPiano} from './piano.js';
import {keyForControl} from './app/dom.js';
import {mountSoundSettings} from './audio/sound-ui.js'; // [sound] instrument, room, metronome sound, microphone
import {mountDiagnostics} from './diagnostics/sheet.js';
import {onRelayMidi, onRelayStatus, relayAvailable} from './midi-relay.js';
import {setTheme as setAppTheme, getTheme, THEME_EVENT} from './app/theme.js';
import {attachRecording} from './record/player-ui.js';
import {playHref} from './app/router.js';
import {
  BarTally, normaliseBarStats, mergeBarStats, heatLevel, weakPassage, startChain, chainStep, detectPhrases, phraseAt, nextPhrase,
  rhythmVariation, blockChords, applyTiming, ladderRungs, ladderNext, recordBest, nextTempoStep, evenness, evennessRemark,
  dynamicsReport, articulationReport, pedalReport, measureLatency, clampLatency, paginate, pageAtTime, barsText,
} from './practice-core.mjs';
import {isFavourite, setFavourite} from './collections/model.js';
import {collections, loadCollections, updateCollections, setlistPosition, CHANGE_EVENT as COLLECTIONS_EVENT} from './collections/store.js';
import {performanceScore} from './analysis/performance.mjs';

// Per-bar statistics from the progress store (src/progress/mastery.js, owned by
// the learning-path module). Loaded lazily; a glob so the player still builds
// and runs when that file is absent.
const MASTERY = import.meta.glob('./progress/mastery.js');

const BLACK = [1, 3, 6, 8, 10];
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const name = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
const spelled = (song, e) => spelledName(song?.noteNames, e) ?? name(e.n);
const PRAISE = ['Clean.', 'Well played.', 'Good.', 'Yes.', 'Lovely.'];
const EPS = 1e-6;
const LOOKAHEAD_MS = 150, TICK_MS = 25; // audio scheduler
const HANDS = ['left', 'both', 'right'];
const GRADE_TEXT = {perfect: 'Perfect', early: 'Early', late: 'Late', miss: 'Miss'};
const THEME_KEY = 'piano-practice.theme'; // owned by src/app/theme.js; watched for other tabs
// Italian tempo marking for a quarter-note BPM, shown under the tempo slider.
const TEMPO_TERMS = [[40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [Infinity, 'Presto']];
const tempoTerm = bpm => TEMPO_TERMS.find(([max]) => bpm < max)[1];
const ZOOM_MIN = .6, ZOOM_MAX = 3;
const REDUCED = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};
const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, {detail}));
// Practice strategies (⋯ → Strategy), one at a time, off by default.
const STRATEGIES = {off: '', ladder: 'Slow-practice ladder', dotted: 'Dotted rhythm', reversed: 'Reversed dotted', blocked: 'Blocked chords', memory: 'Memory check'};
const VIEWS = ['sheet', 'pages', 'falling'];
const CLEAN = 95; // accuracy (%) that counts as a clean pass

// Settings shared by every song (view, labels, loop, mute, playhead, pedal,
// hand colours) and per-song state (section, tempo) keyed by song id.
const STORE = 'piano-practice:settings';
const SONG_STORE = id => 'piano-practice:song:' + id;
const LEGACY_STORE = 'una-mattina-player';
const read = key => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify({...read(key), ...v})); } catch {} };
const load = () => read(STORE);
const save = v => write(STORE, v);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

// Carry the old single-song app's global settings over once.
function migrateSettings() {
  // Before entry hints were per piece, the shell kept the player's own mode / Listen | Practise
  // choice here while a sight-reading piece overrode them: put it back as the saved choice.
  try {
    const before = JSON.parse(localStorage.getItem('piano-practice.mode-before-hint') || 'null');
    if (before) {
      const keep = {};
      if (before.mode === 'wait' || before.mode === 'timed') keep.mode = before.mode;
      if (before.intent === 'listen' || before.intent === 'practice') keep.intent = before.intent;
      save(keep);
    }
    localStorage.removeItem('piano-practice.mode-before-hint');
  } catch {}
  try {
    if (localStorage.getItem(STORE) != null || localStorage.getItem(LEGACY_STORE) == null) return;
    const old = read(LEGACY_STORE), keep = {};
    for (const k of ['view', 'labels', 'hands', 'playhead', 'pedal', 'loop', 'muted']) if (k in old) keep[k] = old[k];
    save(keep);
  } catch {}
}

// The song player. Every element it uses lives inside `root`.
//   const player = createPlayer(document.getElementById('player'));
//   player.load(entry, loadSong(source));
export function createPlayer(root) {
  const q = s => root.querySelector(s);
  migrateSettings();
  const piano = createPiano(() => setStatus('Audio unavailable · tap Listen to try again'));
  const tone = piano.tone;

  let song = null, range = null, points = [], pos = 0;
  let playing = false, finished = false, loop = false;
  let follow = null, practicing = false, rightCount = 0, wrongCount = 0;
  const matched = new Set();
  // Practice options: mode 'wait' | 'timed', hands 'both' | 'right' | 'left'.
  let mode = 'wait', hands = 'both', metronome = false, metroInWait = false, speedUp = false, zoom = 1;
  let practiceMode = 'wait';     // mode of the running practice
  let intent = 'listen';         // what play starts: 'listen' | 'practice'
  let clock = null;              // transport for Listen and Play along
  let grader = null;             // play-along grading
  const grades = new Map();      // event id -> perfect | early | late | miss
  let autoTimer = null, autoPlayed = new Set(), freeClick = null;
  let session = null, passStartedAt = 0, misses = new MissLog(50);
  // Smarter practising (docs/ROADMAP.md phase 5) and touch feedback (phase 6).
  let strategy = 'off', chain = null, latencyMs = 0, phrases = [];
  let barTally = new BarTally(), trouble = new Map();
  let played = [], pedalLog = [], pedalDown = false, memoryHints = 0;
  const screenDown = new Set();
  const wantHand = e => handFilter(hands)(e);
  const handClass = h => (h === 'l' ? 'lh' : 'rh');

  const tempo = () => +q('#um-tempo').value;
  const quarterMs = () => 60000 / tempo();
  const measureIndexAt = t => {
    const i = song.measures.findIndex(m => m.start <= t + EPS && t + EPS < m.end);
    return i < 0 || i > range.last ? range.last : Math.max(range.first, i);
  };

  // ───────── UI helpers ─────────
  const setStatus = t => { q('#um-status').textContent = t; };
  const setPrompt = html => { q('#um-practice-status').innerHTML = html; };
  let feedbackTimer = null;
  function flash(text, kind = 'good') {
    const el = q('#um-feedback');
    el.textContent = text; el.className = 'feedback show ' + kind;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { el.className = 'feedback ' + kind; }, 650);
  }
  function flashKey(n, cls) {
    const key = q(`.pkey[data-note="${n}"]`); if (!key) return;
    key.classList.remove(cls); void key.offsetWidth; key.classList.add(cls);
    setTimeout(() => key.classList.remove(cls), 450);
  }
  // One primary control: the Listen | Practise choice plus a single play/pause.
  function setButtons() {
    const busy = playing || practicing;
    const btn = q('#um-play');
    btn.classList.toggle('is-playing', busy);
    btn.querySelector('svg').innerHTML = busy ? '<path d="M8 5.5h2.6v13H8zM13.4 5.5H16v13h-2.6z"/>' : '<path d="M8 5.5v13l10.5-6.5z"/>';
    const what = intent === 'practice' ? (mode === 'timed' ? 'Play along' : 'Practise') : 'Listen';
    btn.setAttribute('aria-label', playing ? 'Pause' : practicing ? 'Stop practising' : what);
    btn.title = `${playing ? 'Pause' : practicing ? 'Stop' : what} (Space)`;
    q('#um-listen').setAttribute('aria-checked', String(intent === 'listen'));
    q('#um-practice').setAttribute('aria-checked', String(intent === 'practice'));
    root.dataset.intent = intent;
    root.classList.toggle('practicing', practicing);
    root.classList.toggle('playing', playing);
    root.classList.toggle('timed', practicing && practiceMode === 'timed');
  }
  // "Measure 12", "Pickup", "Measure 3 (repeat)".
  const shortName = m => m.label + (m.visit > 1 ? ' (repeat)' : '');
  const measureName = m => m.pickup ? 'Pickup' : 'Bar ' + shortName(m);
  const sectionLabel = () => {
    const a = song.measures[range.first], b = song.measures[range.last];
    if (a === b) return measureName(a);
    if (a.pickup) return `Pickup – bar ${shortName(b)}`;
    return `Bars ${shortName(a)}–${shortName(b)}`;
  };

  // ───────── Keyboard ─────────
  let keyboardRange = '', defaultLow = 40, defaultHigh = 72;
  function buildKeyboard(low = defaultLow, high = defaultHigh) {
    if (keyboardRange === low + ':' + high) return;
    keyboardRange = low + ':' + high;
    const keys = q('#um-keys');
    keys.replaceChildren();
    keys.setAttribute('aria-label', `Piano keyboard, ${name(low)} to ${name(high)}`);
    const whites = [];
    for (let n = low; n <= high; n++) if (!BLACK.includes(n % 12)) whites.push(n);
    const whiteW = 100 / whites.length;
    for (let n = low; n <= high; n++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pkey'; b.dataset.note = n; b.dataset.hand = n < 60 ? 'l' : 'r';
      b.tabIndex = -1; // 88 tab stops would trap Tab; the keys are for pointer and MIDI, the group is labelled
      b.setAttribute('aria-label', name(n));
      if (BLACK.includes(n % 12)) {
        b.classList.add('black');
        const idx = whites.filter(w => w < n).length;
        b.style.left = `calc(${idx * whiteW}% - ${whiteW * .3}%)`;
        b.style.width = `${whiteW * .6}%`;
      } else {
        b.innerHTML = `<span class="label${n % 12 === 0 ? ' c' : ''}">${name(n)}</span>`;
      }
      b.addEventListener('pointerdown', e => { e.preventDefault(); screenDown.add(n); userAttack(n, {source: 'screen', velocity: 96}); });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(type, () => { if (screenDown.delete(n)) userRelease(n); });
      keys.append(b);
    }
    root.classList.toggle('dense-keys', whites.length > 30);
    highway.layout();
  }
  const whiteBelow = n => { while (BLACK.includes(n % 12)) n--; return n; };
  const whiteAbove = n => { while (BLACK.includes(n % 12)) n++; return n; };

  // ───────── Section ─────────
  // `keep` keeps a running chain (the chain itself moves the section).
  function setRange(first, last, {quiet = false, keep = false} = {}) {
    stopAll();
    if (!keep) chain = null;
    first = Math.max(0, Math.min(song.measures.length - 1, first));
    last = Math.max(first, Math.min(song.measures.length - 1, last));
    range = varied(passage(song, first, last));
    points = [...new Set(range.events.map(e => e.t))].sort((a, b) => a - b);
    pos = points[0] ?? range.start;
    finished = false; matched.clear(); grades.clear();
    saveSong({first, last});
    highway.jump();
    markSection();
    draw();
    showSectionInputs();
    showStrategy(); showTempo();
    if (!quiet) { setStatus(sectionLabel()); setPrompt(promptIdle()); }
  }
  // Rhythm variations and blocked chords change the passage's timing itself, so
  // Listen, Play along and Wait all use the altered version.
  function varied(p) {
    if (strategy === 'dotted' || strategy === 'reversed') return applyTiming(p, rhythmVariation(p.events, strategy));
    if (strategy === 'blocked') return applyTiming(p, blockChords(p.events, song.measures.slice(p.first, p.last + 1)));
    return p;
  }

  // ───────── Drawing ─────────
  // ───────── Unrolled sheet music ─────────
  // The whole piece is one long system that scrolls under a fixed playhead.
  const sheetHost = q('#um-sheet');
  let sheetTrack = null, sheetSvg = null, sheetEls = new Map(), measureEls = new Map();
  let anchors = [], sheetX = 0, lit = new Set();
  let measureBoxes = [], pages = [], page = -1, manualPage = null, autoPage = -1;
  function mountSheet() {
    // The playhead stays the track's last child (scrollSheet / showPage move it).
    sheetHost.innerHTML = `<div class="sheet-track"><div class="trouble" aria-hidden="true"></div><div class="harmony" aria-hidden="true"></div>${song.fullSvg()}<div class="playhead"></div></div>` +
      '<div class="page-clef" aria-hidden="true" hidden></div>' +
      '<div class="sel-ruler" title="Drag across bars to loop them"><span>Drag across bars to loop</span></div>';
    sheetTrack = sheetHost.firstElementChild;
    sheetSvg = sheetTrack.querySelector('svg');
    sheetEls = new Map([...sheetSvg.querySelectorAll('.note')].map(el => [el.id, el]));
    measureEls = new Map([...sheetSvg.querySelectorAll('.measure')].map(el => [el.id, el]));
    for (const seg of song.segments) sheetEls.get(seg.id)?.classList.add(seg.hand === 'l' ? 'h-l' : 'h-r');
    labelled = false;
    layoutSheet();
  }
  // Letter names drawn inside each notehead (shown when "Note names" is on).
  let labelled = false;
  function labelNoteheads() {
    if (labelled || !sheetSvg || !sheetHost.clientHeight) return;
    labelled = true;
    const NS = 'http://www.w3.org/2000/svg';
    for (const [id, info] of song.noteNames ?? []) {
      const head = sheetEls.get(id)?.querySelector('.notehead');
      if (!head) continue;
      let box;
      try { box = head.getBBox(); } catch { continue; }
      if (!box.width) continue;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('class', 'nh-name' + (info.hollow ? ' hollow' : ''));
      t.setAttribute('x', box.x + box.width / 2);
      t.setAttribute('y', box.y + box.height / 2);
      t.setAttribute('font-size', box.height * (info.name.length > 1 ? .62 : .8));
      t.textContent = info.name;
      head.append(t);
    }
  }
  // Size the system to the card and map score time → horizontal position.
  function unmountSheet() {
    sheetHost.replaceChildren();
    sheetTrack = sheetSvg = null; sheetEls = new Map(); measureEls = new Map();
    anchors = []; sheetX = 0; lit = new Set();
    measureBoxes = []; pages = []; page = -1; manualPage = null; autoPage = -1; clefW = 0;
  }
  // The system's height: up to 300 px, or the whole card on a tablet standing upright (portrait),
  // so the music fills the paper instead of sitting small in it; less the strip the Harmony
  // overlay needs under the bass staff. Zoom out (⋯ → Zoom) to see more bars at once.
  function systemHeight() {
    const reserve = harmonyOn ? HARMONY_STRIP : 0;
    const avail = Math.max(80, sheetHost.clientHeight - reserve);
    // (Not in Pages: a page of whole bars must hold a phrase, not two bars.)
    const portrait = innerHeight > innerWidth * 1.15 && sheetHost.clientWidth >= 560 && root.dataset.view !== 'pages';
    return Math.round(Math.min(avail, portrait ? avail : 300) * zoom);
  }
  function layoutSheet() {
    if (!song || !sheetSvg || !sheetHost.clientHeight) return;
    const vb = sheetSvg.viewBox.baseVal;
    // Zoom scales the system height; taller than the card, it scrolls vertically.
    const h = systemHeight();
    sheetHost.classList.toggle('tall', h > sheetHost.clientHeight + 1);
    sheetSvg.style.height = h + 'px';
    sheetSvg.style.width = (h * vb.width / vb.height) + 'px';
    const base = sheetSvg.getBoundingClientRect().left;
    const byTime = new Map();
    for (const e of song.events) {
      const el = sheetEls.get(e.id); if (!el) continue;
      const r = (el.querySelector('.notehead') || el).getBoundingClientRect();
      if (!r.width) continue;
      const x = r.left - base + r.width / 2;
      byTime.set(e.t, Math.min(byTime.get(e.t) ?? Infinity, x));
    }
    const last = song.measures.at(-1);
    const lastEl = measureEls.get(last.id);
    if (lastEl) byTime.set(last.end, lastEl.getBoundingClientRect().right - base);
    anchors = [...byTime].sort((a, b) => a[0] - b[0]).filter(([, x], i, arr) => i === 0 || x > arr[i - 1][1]);
    sheetX = xAt(livePos() ?? 0);
    // Measure boxes on the system: for the trouble strip and for pages.
    measureBoxes = song.measures.map(m => {
      const r = measureEls.get(m.id)?.getBoundingClientRect();
      return r && r.width ? {x0: r.left - base, x1: r.right - base} : null;
    });
    clefW = buildPageClef(base);
    pages = paginate(measureBoxes, Math.max(200, sheetHost.clientWidth - 2 * PAGE_PAD - clefW));
    page = -1; manualPage = null; autoPage = -1;
    drawTrouble();
    drawHarmony();
  }
  const PAGE_PAD = 14;
  // Pages after the first begin with the system's clefs and key signature, as a printed page
  // does: a copy of the opening staves (staff lines, brace, clefs, key signature — no notes) set
  // in a strip at the page's left edge. Clef or key changes later in the piece aren't followed.
  let clefW = 0;
  function buildPageClef(base) {
    const holder = sheetHost.querySelector('.page-clef');
    if (!holder) return 0;
    holder.replaceChildren();
    const first = measureEls.get(song.measures[0]?.id);
    const parts = first ? [...first.querySelectorAll('.clef, .keySig')] : [];
    const system = first?.closest('.system');
    if (!parts.length || !system) return 0;
    const left = system.getBoundingClientRect().left - base;
    const right = Math.max(...parts.map(el => el.getBoundingClientRect().right)) - base;
    if (!(right > left)) return 0;
    const svg = sheetSvg.cloneNode(false);
    svg.removeAttribute('id');
    let into = svg;
    const chain = [];
    for (let n = system; n && n !== sheetSvg; n = n.parentNode) chain.unshift(n);
    for (const n of chain) { const c = n.cloneNode(false); into.append(c); into = c; }
    // The system's own marks (brace, opening barline), then the first bar without its music.
    for (const child of system.children) if (child.localName !== 'g' || child.classList.contains('grpSym')) into.append(child.cloneNode(true));
    const bar = first.cloneNode(true);
    bar.setAttribute('class', 'clef-bar');
    for (const child of [...bar.children]) {
      if (!child.classList.contains('staff')) { child.remove(); continue; }
      for (const g of [...child.children]) if (!(g.localName === 'path' || g.classList.contains('clef') || g.classList.contains('keySig'))) g.remove();
    }
    into.append(bar);
    for (const el of [svg, ...svg.querySelectorAll('[id]')]) el.removeAttribute('id');
    const w = Math.ceil(right - left + 10);
    svg.style.marginLeft = -left + 'px';
    holder.style.width = w + 'px';
    holder.append(svg);
    return w;
  }
  function xAt(t) {
    if (!anchors.length) return 0;
    if (t <= anchors[0][0]) return anchors[0][1];
    for (let i = 1; i < anchors.length; i++) {
      const [t1, x1] = anchors[i];
      if (t <= t1) { const [t0, x0] = anchors[i - 1]; return x0 + (x1 - x0) * (t - t0) / (t1 - t0); }
    }
    return anchors.at(-1)[1];
  }
  // Inverse of xAt: horizontal position on the system → score time.
  function tAt(x) {
    if (!anchors.length) return 0;
    if (x <= anchors[0][1]) return anchors[0][0];
    for (let i = 1; i < anchors.length; i++) {
      const [t1, x1] = anchors[i];
      if (x <= x1) { const [t0, x0] = anchors[i - 1]; return t0 + (t1 - t0) * (x - x0) / (x1 - x0); }
    }
    return anchors.at(-1)[0];
  }
  function scrollSheet() {
    requestAnimationFrame(scrollSheet);
    const view0 = root.dataset.view;
    if ((view0 !== 'sheet' && view0 !== 'pages') || !sheetTrack || !anchors.length) return;
    if (!labelled && root.classList.contains('show-names')) labelNoteheads();
    const p = livePos(); if (p == null) return;
    const target = xAt(p);
    sheetX = playing || scrub || REDUCED.matches || Math.abs(target - sheetX) > 2000 ? target : sheetX + (target - sheetX) * .2;
    if (view0 === 'pages' && pages.length) return showPage(p);
    const view = sheetHost.clientWidth;
    if (sheetTrack.style.clipPath) {
      sheetTrack.style.clipPath = ''; sheetTrack.lastElementChild.style.visibility = '';
      const holder = sheetHost.querySelector('.page-clef'); if (holder) holder.hidden = true;
    }
    // The playhead stays at a fixed spot on screen; the music slides under it.
    const offset = view * (root.dataset.playhead === 'left' ? .3 : .5) - sheetX;
    sheetTrack.style.transform = `translateX(${offset}px)`;
    sheetTrack.lastElementChild.style.left = sheetX + 'px';
  }
  new ResizeObserver(() => layoutSheet()).observe(sheetHost);

  // ───────── Page-turn mode (⋯ → View → Pages) ─────────
  // The long system cut into card-wide pages of whole bars. The page turns a
  // beat before its last note is due; ←/→ and PageUp/PageDown (what Bluetooth
  // page-turner pedals send) turn it by hand.
  const beatLenAt = t => beatInfo(song.measures[measureIndexAt(Math.max(range.start, Math.min(range.end - EPS, t)))].meter).len;
  function showPage(p) {
    const auto = pageAtTime(pages, song.measures, p, finished ? 0 : beatLenAt(p));
    if (auto !== autoPage) { autoPage = auto; manualPage = null; } // the music moved on: follow it again
    const i = Math.max(0, Math.min(pages.length - 1, manualPage ?? auto));
    if (i !== page) {
      const forward = i > page;
      page = i;
      sheetTrack.classList.remove('turn-fwd', 'turn-back'); void sheetTrack.offsetWidth;
      sheetTrack.classList.add(forward ? 'turn-fwd' : 'turn-back');
      q('#um-page').textContent = `Page ${i + 1} of ${pages.length}`;
    }
    const pg = pages[page];
    const clef = page > 0 && clefW > 0;
    const holder = sheetHost.querySelector('.page-clef');
    if (holder) { holder.hidden = !clef; holder.style.left = PAGE_PAD + 'px'; holder.style.top = sheetTrack.offsetTop + 'px'; holder.style.height = sheetSvg.getBoundingClientRect().height + 'px'; }
    sheetTrack.style.transform = `translateX(${PAGE_PAD + (clef ? clefW : 0) - pg.x0}px)`;
    // Only this page's bars: clip the neighbours' edges (the harmony strip hangs below the system).
    sheetTrack.style.clipPath = `inset(-40px ${Math.max(0, sheetTrack.offsetWidth - pg.x1 - 3)}px -${HARMONY_STRIP + 16}px ${page ? Math.max(0, pg.x0 - 3) : 0}px)`;
    const ph = sheetTrack.lastElementChild;
    ph.style.left = sheetX + 'px';
    ph.style.visibility = sheetX >= pg.x0 - 1 && sheetX <= pg.x1 + 1 ? '' : 'hidden';
  }
  // Reading from the paged score keeps the screen on even while idle (src/pwa: holdAwake).
  let releaseAwake = null;
  function holdPagesAwake(on) {
    if (on && !releaseAwake) { try { releaseAwake = window.pianoPWA?.holdAwake?.('page-turn') || null; } catch {} }
    else if (!on && releaseAwake) { try { releaseAwake(); } catch {} releaseAwake = null; }
  }
  function turnPage(d) {
    if (!song || !pages.length) return;
    const cur = page < 0 ? 0 : page, i = Math.max(0, Math.min(pages.length - 1, cur + d));
    if (i === cur) { flash(d > 0 ? 'Last page' : 'First page', 'good'); return; }
    if (playing || practicing) { manualPage = i; return; }
    // Idle: move to the first bar of that page (within the section when possible).
    const m = song.measures[Math.max(range.first, Math.min(range.last, pages[i].first))];
    if (pages[i].first > range.last || pages[i].last < range.first) { manualPage = i; return; }
    finished = false;
    pos = points.find(t => t >= m.start - EPS) ?? pos;
    manualPage = i; autoPage = pageAtTime(pages, song.measures, pos, beatLenAt(pos));
    draw();
    setStatus(`Page ${i + 1} of ${pages.length}`);
  }

  // ───────── Score study: harmony (⋯ → View → Harmony) ─────────
  // Roman numerals with chord symbols in a strip under the bass staff, from an approximate
  // analysis of the notes (src/analysis/harmony.mjs, computed once per piece when first shown).
  // Notation and Pages views only.
  const HARMONY_STRIP = 46;
  let harmonyOn = false, harmony = null, harmonyFor = null;
  async function ensureHarmony() {
    if (!harmonyOn || !song) return drawHarmony();
    if (harmonyFor === song) return drawHarmony();
    const s0 = song;
    let result = {keys: [], chords: []};
    try { result = (await import('./analysis/harmony.mjs')).analyseHarmony(s0); }
    catch (e) { console.warn('Harmony analysis failed:', e); }
    if (s0 !== song) return;
    harmony = result; harmonyFor = s0;
    drawHarmony();
  }
  function drawHarmony() {
    const tag = q('#um-harmony');
    const host = sheetTrack?.querySelector('.harmony');
    const ready = harmonyOn && song && harmonyFor === song && host && anchors.length;
    tag.hidden = !ready;
    if (!ready) { host?.replaceChildren(); return; }
    const names = [...new Set(harmony.keys.map(k => k.key.name))];
    tag.textContent = names.length ? `${names.join(' · ')} · approximate` : 'Harmony · approximate';
    tag.title = 'Roman numerals and chord symbols worked out from the notes; treat them as a guide, not an edition’s analysis';
    const xs = harmony.chords.map(c => xAt(c.t));
    host.replaceChildren(...harmony.chords.map((c, i) => {
      const el = document.createElement('span');
      const room = (xs[i + 1] ?? xs[i] + 200) - xs[i];
      el.className = 'hm' + (room < 34 ? ' tight' : '') + (song.measures[c.measure] && (c.measure < range?.first || c.measure > range?.last) ? ' out' : '');
      el.style.left = xs[i] + 'px';
      el.style.maxWidth = Math.max(18, room - 4) + 'px';
      const num = document.createElement('b');
      num.className = 'hm-rn';
      num.textContent = c.numeral;
      if (c.figure) {
        const [top, bottom] = c.figure.split('/');
        const fig = document.createElement('span');
        fig.className = 'hm-fig' + (bottom ? ' stack' : '');
        fig.innerHTML = bottom ? `<sup>${top}</sup><sub>${bottom}</sub>` : `<sup>${top}</sup>`;
        num.append(fig);
      }
      if (c.secondary) num.append(`/${c.secondary}`);
      const sym = document.createElement('i');
      sym.className = 'hm-sym';
      sym.textContent = c.symbol;
      el.title = `${c.label} · ${c.symbol} (${c.key.name})`;
      el.append(num, sym);
      return el;
    }));
  }
  function setHarmony(v, {persist = true} = {}) {
    harmonyOn = !!v;
    if (persist) save({harmony: harmonyOn});
    q('#harmony-btn').checked = harmonyOn;
    root.classList.toggle('show-harmony', harmonyOn);
    requestAnimationFrame(layoutSheet);
    ensureHarmony();
  }
  q('#harmony-btn').onchange = () => setHarmony(q('#harmony-btn').checked);

  // ───────── Trouble spots: a quiet per-bar accuracy strip ─────────
  // Above each bar of the score (and at the left edge of the falling notes):
  // sage = secure, brass = nearly, oxblood = needs work. From the progress
  // store's bar statistics, filled in with this session's own counts.
  function drawTrouble() {
    const host = sheetTrack?.querySelector('.trouble');
    if (!host || !song) return;
    host.replaceChildren(...[...trouble].filter(([i]) => measureBoxes[i]).map(([i, st]) => {
      const el = document.createElement('i'), b = measureBoxes[i];
      el.className = 'heat-' + heatLevel(st.accuracy);
      el.style.left = b.x0 + 'px'; el.style.width = Math.max(2, b.x1 - b.x0 - 2) + 'px';
      el.title = `${measureName(song.measures[i])} · ${st.accuracy}%`;
      return el;
    }));
  }
  let troubleTimer = 0;
  async function refreshTrouble() {
    if (!song || !current) return;
    const token = loadToken, id = current.id;
    let long = new Map();
    try {
      const mod = await MASTERY['./progress/mastery.js']?.();
      if (mod?.barStats) long = normaliseBarStats(await mod.barStats(id, {measures: song.measures}), song.measures);
    } catch {}
    if (token !== loadToken || !song) return;
    trouble = mergeBarStats(long, new Map(barTally.list().map(st => [st.index, st])));
    drawTrouble();
  }
  // After a pass the progress store needs a moment to take in practice:result.
  const refreshTroubleSoon = () => { clearTimeout(troubleTimer); troubleTimer = setTimeout(refreshTrouble, 400); };
  function noteStateAt(seg, root) {
    if (root && grades.has(root.id)) return grades.get(root.id);
    if (practicing && practiceMode === 'wait' && follow?.active && root && root.t === follow.current.t && wantHand(root))
      return follow.collected.has(root.n) ? 'matched' : 'expected';
    if (root && matched.has(root.id)) return 'matched';
    if (finished) return '';
    if (seg.t <= pos + EPS && pos + EPS < seg.end) return root?.t === pos ? 'attack' : 'held';
    return '';
  }
  function renderSheet() {
    if (!sheetSvg || !range) return;
    for (const el of lit) el.classList.remove('s-attack', 's-held', 's-expected', 's-matched', 's-perfect', 's-early', 's-late', 's-miss');
    lit = new Set();
    const roots = new Map(range.events.map(e => [e.id, e]));
    for (const seg of song.segments) {
      if (seg.measure < range.first || seg.measure > range.last) continue;
      const state = noteStateAt(seg, roots.get(seg.root));
      if (!state) continue;
      const el = sheetEls.get(seg.id); if (!el) continue;
      el.classList.add('s-' + state); lit.add(el);
    }
  }
  function markSection() {
    if (!song || !range) return;
    song.measures.forEach((m, i) => measureEls.get(m.id)?.classList.toggle('s-out', i < range.first || i > range.last));
    if (harmonyOn) drawHarmony();
  }
  function draw(sound = false) {
    if (!song || !range) return;
    buildKeyboard();
    const mi = measureIndexAt(pos), m = song.measures[mi];
    const active = finished ? [] : range.events.filter(e => e.t <= pos + EPS && pos + EPS < e.t + e.d);
    const att = active.filter(e => Math.abs(e.t - pos) < EPS);
    const waiting = practicing && practiceMode === 'wait' && follow?.active;
    const expected = waiting ? follow.current.notes : null;
    // Key colour follows the hand (staff) of the note it plays.
    const keyHand = new Map();
    for (const e of [...active, ...(waiting ? follow.current.events : [])]) keyHand.set(e.n, e.hand);
    const blind = strategy === 'memory' && practicing; // memory check: no key prompts
    root.querySelectorAll('.pkey').forEach(b => {
      const n = +b.dataset.note;
      b.dataset.hand = keyHand.get(n) ?? (n < 60 ? 'l' : 'r');
      b.classList.toggle('held', !blind && !expected && active.some(e => e.n === n));
      b.classList.toggle('attack', !blind && (expected ? expected.includes(n) && !follow.collected.has(n) : att.some(e => e.n === n)));
    });
    renderSheet();
    renderBeats(pos, mi);

    q('#um-measure').textContent = measureName(m);
    q('#um-detail').textContent = att.length ? att.map(e => spelled(song, e)).join(' + ') : '';
    q('#lesson-subtitle').textContent = sectionLabel();
    const span = range.end - range.start || 1;
    q('#um-progress').style.width = `${(finished ? 1 : (pos - range.start) / span) * 100}%`;
    if (sound) playChord(att, mi);
  }

  // Beat strip under the sheet: the beats of the measure from its time signature.
  function renderBeats(p, mi = measureIndexAt(Math.max(range.start, p))) {
    const m = song.measures[mi], list = measureBeats(m);
    const beats = beatInfo(m.meter).beats;
    const strip = q('#um-count');
    if (strip.children.length !== beats) {
      strip.replaceChildren(...Array.from({length: beats}, (_, i) => {
        const el = document.createElement('span'); el.className = 'pulse'; el.textContent = i + 1; return el;
      }));
      strip.style.setProperty('--beats', beats);
    }
    let beat = -1;
    for (const b of list) if (b.t <= p + EPS) beat = b.beat;
    [...strip.children].forEach((el, i) => el.classList.toggle('current', !finished && p >= range.start - EPS && i === beat));
  }

  // ───────── Listen ─────────
  // Sound a group of attacks like a pianist: sustain pedal held to the barline,
  // melody (top note) a little louder, bass a little fuller, slight variation.
  function playChord(att, mi, delay = 0) {
    if (!att.length) return;
    const pedal = root.dataset.pedal !== 'off';
    const barEnd = song.measures[mi].end;
    const top = Math.max(...att.map(e => e.n));
    for (const e of att) {
      const beats = pedal ? Math.max(e.d, barEnd - e.t) : e.d;
      let v = .58 + Math.random() * .08;
      if (e.n === top && att.length > 1 || e.n >= 67) v += .14;
      if (e.n < 48) v += .06;
      piano.tone(e.n, beats * quarterMs() / 1000, Math.min(1, v), delay, {pedal, key: e.d * quarterMs() / 1000}); // [sound] pedal → resonance; key length for the harpsichord
    }
  }

  // ───────── Sessions (practice:session) ─────────
  function beginSession(kind) {
    if (session?.kind === kind) return;
    endSession();
    session = {kind, start: performance.now()};
  }
  function endSession() {
    if (!session) return;
    const durationMs = Math.round(performance.now() - session.start);
    const kind = session.kind;
    session = null;
    if (durationMs >= 3000 && current)
      emit('practice:session', {songId: current.id, title: current.title || song?.title || '', kind, durationMs, at: Date.now()});
  }

  const promptIdle = () => (intent === 'listen' ? 'Press <b class="glyph">▶</b> to hear the passage, then choose <b>Practise</b>'
    : mode === 'timed' ? 'Press <b class="glyph">▶</b> · a bar of count-in, then play in time'
    : 'Press <b class="glyph">▶</b> · the music waits for each note');

  function stopAll() {
    stopExternal();
    if (scrub) { scrub = null; clearTimeout(wheelTimer); root.classList.remove('scrubbing'); }
    stopClock(); clearTimeout(autoTimer); autoTimer = null;
    playing = false; piano.silence(); piano.stopClicks();
    if (practicing) { practicing = false; follow = null; grader = null; }
    refreshFreeClick();
    endSession();
    setButtons();
    if (perf) endPerformance({completed: false}); // a performance run doesn't stop: stopping ends it
  }

  // ───────── Transport (Listen and Play along) ─────────
  // A clock maps performance.now() to score time; a lookahead scheduler
  // (every TICK_MS, LOOKAHEAD_MS ahead) puts notes and metronome clicks on the
  // audio clock, so timing does not depend on timer jitter.
  function clockPos(now = performance.now()) { return clock.pos0 + (now - clock.perf0) / clock.qms; }
  function startClock(kind, from, {count = false} = {}) {
    stopClock();
    const first = song.measures[range.first];
    const ci = count ? countIn(first) : null;
    const startAt = ci ? ci.from : from;
    clock = {kind, pos0: startAt, perf0: performance.now() + 40, qms: quarterMs(), timer: 0};
    clock.groups = soundGroups(kind);
    clock.next = clock.groups.findIndex(g => g.t >= from - EPS);
    if (clock.next < 0) clock.next = clock.groups.length;
    clock.beats = [...(ci ? ci.beats.map(b => ({...b, count: true})) : []), ...beatsOf(song.measures.slice(range.first, range.last + 1)).filter(b => b.t >= from - EPS)];
    clock.nextBeat = 0;
    clock.shown = -1;
    tick();
    clock.timer = setInterval(tick, TICK_MS);
  }
  function stopClock() {
    if (!clock) return;
    clearInterval(clock.timer);
    clock = null;
  }
  // What the app sounds: everything when listening; the other hand in play-along.
  function soundGroups(kind) {
    if (kind === 'listen') return points.map(t => ({t, events: range.events.filter(e => Math.abs(e.t - t) < EPS)}));
    return handGroups(range, hands).filter(g => g.auto.length).map(g => ({t: g.t, events: g.auto}));
  }
  function tick() {
    if (!clock) return;
    const now = performance.now(), p = clockPos(now);
    const horizon = p + LOOKAHEAD_MS / clock.qms;
    const delay = t => Math.max(0, (t - p) * clock.qms / 1000);
    while (clock.next < clock.groups.length && clock.groups[clock.next].t < horizon && clock.groups[clock.next].t < range.end - EPS) {
      const g = clock.groups[clock.next++];
      playChord(g.events, measureIndexAt(g.t), delay(g.t));
    }
    while (clock.nextBeat < clock.beats.length && clock.beats[clock.nextBeat].t < horizon) {
      const b = clock.beats[clock.nextBeat++];
      if (b.count || metronome) piano.click(delay(b.t), b.accent);
    }
    // Visual position: the latest note onset passed.
    if (p < range.start - EPS && clock.kind === 'timed') {
      const counted = clock.beats.filter(b => b.count && b.t <= p + EPS);
      setPrompt(counted.length ? `Count in · <b>${counted.at(-1).beat + 1}</b>` : 'Get ready…');
      renderBeats(p);
    } else {
      let i = clock.shown;
      while (i + 1 < points.length && points[i + 1] <= p + EPS) i++;
      if (i !== clock.shown && i >= 0) {
        if (clock.shown < 0 && clock.kind === 'timed') timedPrompt();
        clock.shown = i; pos = points[i]; draw();
      } else renderBeats(p);
    }
    if (clock.kind === 'timed' && grader) {
      const missed = grader.sweep(clockPos(now - latencyMs), clock.qms);
      if (missed.length) { for (const note of missed) gradeNote(note, 'miss'); renderSheet(); timedPrompt(); }
    }
    if (p >= range.end - EPS) clockEnded(clock.perf0 + (range.end - clock.pos0) * clock.qms);
  }
  // The pass reached the end of the section at `endPerf`.
  function clockEnded(endPerf) {
    const kind = clock.kind;
    if (kind === 'timed' && finishTimedPass()) return; // a chain moved on to a longer passage
    if (!clock) return; // finishing stopped it
    if (loop) {
      // Seamless loop: the next pass starts exactly where this one ended.
      matched.clear(); grades.clear();
      if (kind === 'timed') newGrader();
      Object.assign(clock, {pos0: range.start, perf0: endPerf, qms: quarterMs(), groups: soundGroups(kind), next: 0, nextBeat: 0, shown: -1,
        beats: beatsOf(song.measures.slice(range.first, range.last + 1))});
      passStartedAt = endPerf;
      return;
    }
    stopClock();
    if (kind === 'listen') {
      playing = false; finished = true; pos = range.end; endSession(); setButtons(); draw();
      setStatus('Finished');
      const next = range.last >= song.measures.length - 1 && current ? setlistPosition(current.id)?.next : null;
      setPrompt(next ? `Finished · <button type="button" class="link-btn prompt-link" data-setlist-next>Next in setlist → <i>${escapeHtml(next.title)}</i></button>`
        : 'Now choose <b>Practise</b> and play it yourself');
    } else {
      practicing = false; grader = null; finished = true; pos = range.end; endSession(); setButtons(); draw();
      setStatus('Finished'); showResults(lastResult);
      if (perf) endPerformance({completed: true});
    }
  }

  function pauseListen() {
    const p = livePos();
    stopAll(); pos = points.filter(x => x <= p + EPS).at(-1) ?? range.start; draw();
    setStatus('Paused'); setPrompt('Paused · press <b class="glyph">▶</b> to continue');
  }
  // The single play/pause: starts or stops whatever Listen | Practise has chosen.
  q('#um-play').onclick = () => {
    if (!song) return;
    if (playing) return pauseListen();
    if (practicing && perf) { stopAll(); draw(); return; }
    if (practicing) { stopAll(); draw(); setStatus('Stopped'); setPrompt('Stopped · press <b class="glyph">▶</b> to start the passage again'); return; }
    if (intent === 'practice') startPractice(); else startListen();
  };
  // `persist: false` (entry hints, the performance run) changes it for now without saving it.
  function setIntent(v, {start = false, persist = true} = {}) {
    if (v !== 'listen' && v !== 'practice') return;
    const busy = playing || practicing, changed = v !== intent;
    intent = v; if (persist) save({intent});
    if (changed && busy) { stopAll(); start = true; }
    setButtons();
    if (start && song) { if (v === 'practice') startPractice(); else startListen(); }
    else if (changed && song) setPrompt(promptIdle());
  }
  q('#um-listen').onclick = () => setIntent('listen');
  q('#um-practice').onclick = () => setIntent('practice');
  function startListen() {
    if (!song || playing) return;
    hideResults();
    const wasPracticing = practicing; stopAll();
    let i = points.findIndex(p => p >= pos - EPS);
    if (finished || i < 0 || wasPracticing) i = 0;
    finished = false; matched.clear(); grades.clear(); playing = true; setButtons();
    beginSession('listen');
    setStatus(`Listening · ${sectionLabel()}${loop ? ' · looping' : ''}`); setPrompt('Listen and watch the notes');
    pos = points[i] ?? range.start; draw();
    startClock('listen', pos);
  }

  // ───────── Results (practice:result) ─────────
  let lastResult = null;
  function emitResult(r) {
    lastResult = r;
    const detail = {
      songId: current?.id ?? null, title: current?.title || song?.title || '', section: [range.first, range.last],
      mode: practiceMode, hands, tempo: tempo(), right: r.right, wrong: r.wrong, accuracy: r.accuracy,
      timing: r.timing ?? null, durationMs: Math.round(performance.now() - passStartedAt), at: Date.now(),
      misses: misses.list(),
    };
    // Optional touch feedback (phase 6): only with a real keyboard's velocities.
    const touch = analyseTouch();
    r.touch = touch;
    if (touch.evenness) { const {points, ...rest} = touch.evenness; detail.evenness = rest; }
    if (touch.dynamics) detail.dynamics = touch.dynamics;
    if (touch.articulation) detail.articulation = touch.articulation;
    if (strategy !== 'off') detail.strategy = strategy;
    if (chain) detail.chain = {dir: chain.dir, section: [...chain.goal]};
    if (r.performance) detail.performance = {score: r.performance.score, accuracy: r.performance.accuracy, timing: r.performance.timing, evenness: r.performance.evenness};
    emit('practice:result', detail);
    r.memory = strategy === 'memory';
    // Best clean tempo for this section (play along only: Wait has no tempo to keep).
    r.tempoFrom = detail.tempo; r.tempoTo = detail.tempo;
    if (practiceMode === 'timed' && !['dotted', 'reversed', 'blocked'].includes(strategy) && current?.id != null) {
      const res = recordBest(read(SONG_STORE(current.id)).best || {}, bestKey(), detail.tempo, r.accuracy, {threshold: CLEAN});
      if (res.improved) { saveSong({best: res.bests}); r.newBest = detail.tempo; }
    }
    // Slow-practice ladder, else the speed trainer: a clean pass raises the tempo toward the target (not in a performance run).
    const next = r.performance ? detail.tempo : strategy === 'ladder' ? ladderNext(detail.tempo, targetTempo(), r.accuracy, {threshold: CLEAN})
      : speedUp ? speedUpTempo(detail.tempo, targetTempo(), r.accuracy) : detail.tempo;
    if (next !== detail.tempo) { setTempoValue(next); r.tempoTo = tempo(); flash(`♩ = ${r.tempoTo}`); }
    // Chaining: a clean pass adds a bar.
    r.chainNext = null;
    if (chain) {
      const step = chainStep(chain, r.accuracy, {threshold: CLEAN});
      if (step.done) { r.chainDone = [...chain.goal]; chain = null; flash('Chain complete.'); }
      else if (step.grew) { chain = step.chain; r.chainNext = [chain.first, chain.last]; }
    }
    misses = new MissLog(50);
    played = []; pedalLog = []; memoryHints = 0;
    passStartedAt = performance.now();
    showTempo(); showStrategy(); refreshTroubleSoon();
    return detail;
  }
  // The chain grew: practise the longer passage straight away.
  function continueChain(r) {
    if (!r.chainNext || !song) return false;
    const [a, b] = r.chainNext;
    setRange(a, b, {keep: true, quiet: true});
    flash(`Now ${a === b ? measureName(song.measures[a]).toLowerCase() : barsText(song.measures, a, b)}.`);
    startPractice();
    return true;
  }
  const bestKey = () => `${range.first}-${range.last}${hands === 'both' ? '' : ':' + hands}`;

  // Evenness (exercises), dynamics, balance and articulation (pieces), pedal.
  // Up to two short observations for the results card.
  function analyseTouch() {
    const out = {evenness: null, dynamics: null, articulation: null, remarks: []};
    const real = played.filter(p => p.id != null && p.source !== 'screen');
    if (!song || real.length < 4) return out;
    const id = String(current?.id ?? ''), measures = song.measures, marks = song.marks ?? {};
    const exercise = id.startsWith('ex:') && !id.startsWith('ex:progression');
    const remarks = [];
    if (exercise) {
      out.evenness = evenness(real);
      remarks.push(evennessRemark(out.evenness, measures));
    } else {
      out.dynamics = dynamicsReport(real, {marks: marks.dynamics ?? [], hairpins: marks.hairpins ?? [], measures, hands});
      remarks.push(...(out.dynamics?.remarks ?? []));
    }
    out.articulation = articulationReport(real, {slurs: marks.slurs ?? [], legato: exercise, measures});
    remarks.push(...(out.articulation?.remarks ?? []));
    if (pedalLog.length || marks.pedals?.length) {
      const ped = pedalReport(pedalLog, marks.pedals ?? []);
      if (out.articulation) out.articulation.pedal = {presses: ped.presses, marks: ped.marks, caught: ped.caught};
      remarks.push(ped.remark);
    }
    out.remarks = [...new Set(remarks.filter(Boolean))].slice(0, 2);
    return out;
  }
  // Link a played note to the score note it answered.
  function linkPlayed(rec, e) {
    if (!rec || !e) return;
    Object.assign(rec, {id: e.id, t: e.t, d: e.d, hand: e.hand, staff: e.staff, stacc: !!e.stacc, measure: measureIndexAt(e.t), qms: quarterMs()});
  }
  const measureLabelAt = t => song.measures[measureIndexAt(t)].label;

  // ───────── Practice: Wait for me ─────────
  function practicePrompt() {
    if (!practicing || practiceMode !== 'wait' || !follow?.active) return;
    const g = follow.current;
    if (!g.notes.length) { setPrompt('Listen…'); return; }
    const remaining = g.notes.filter(n => !follow.collected.has(n));
    const ev = n => g.events.find(e => e.n === n) || {n};
    const hand = n => ev(n).hand;
    // Memory check: no names, unless three slips in a row ask for a hint.
    if (strategy === 'memory' && memoryHints < 3) setPrompt(follow.collected.size ? 'From memory · <b>and the rest of the chord</b>' : 'From memory · <b>keep going</b>');
    else setPrompt(`Play ${remaining.map(n => `<b class="${handClass(hand(n))}">${spelled(song, ev(n))}</b>`).join(' + ')}`);
    setStatus(`${measureName(song.measures[measureIndexAt(g.t)])} · ${follow.index + 1} / ${follow.groups.length}${hands !== 'both' ? ` · ${hands} hand` : ''}`);
  }
  function startPractice() {
    if (!song) return;
    hideResults(); stopAll();
    finished = false; matched.clear(); grades.clear(); rightCount = 0; wrongCount = 0;
    misses = new MissLog(50); played = []; pedalLog = []; memoryHints = 0;
    const groups = handGroups(range, hands);
    if (!groups.some(g => g.notes.length)) {
      setPrompt(hands === 'both' ? 'This section has no notes' : `No ${hands}-hand notes in this section`); draw(); return;
    }
    practiceMode = mode;
    if (mode === 'timed') return startTimed();
    follow = new FollowNotes(groups);
    autoPlayed = new Set();
    practicing = true; passStartedAt = performance.now(); beginSession('practice');
    pos = follow.current.t; setButtons(); draw(); practicePrompt();
    refreshFreeClick();
    runAuto(true);
  }
  // Play the other hand's notes of group i (once).
  function playAuto(i, delay = 0) {
    const g = follow?.groups[i];
    if (!g || autoPlayed.has(i) || !g.auto.length) return;
    autoPlayed.add(i);
    for (const e of g.auto) piano.tone(e.n, e.d * quarterMs() / 1000, .55, delay);
  }
  // Groups with nothing to play for the user's hand go by at tempo.
  function runAuto(immediate = false, from = pos) {
    clearTimeout(autoTimer); autoTimer = null;
    if (!practicing || practiceMode !== 'wait' || !follow?.active || follow.current.notes.length) return;
    const step = () => {
      autoTimer = null;
      if (!practicing || !follow?.active) return;
      const i = follow.index, t = follow.current.t;
      playAuto(i);
      if (follow.skip() === 'finished') return finishWait();
      pos = follow.current.t; draw(); practicePrompt();
      if (!follow.current.notes.length) autoTimer = setTimeout(step, Math.max(0, (follow.current.t - t) * quarterMs()));
    };
    const wait = immediate ? 0 : Math.max(0, (follow.current.t - from) * quarterMs());
    autoTimer = setTimeout(step, wait);
  }
  function practiceAttack(n, rec) {
    if (!practicing || practiceMode !== 'wait' || !follow?.active) return;
    // Played ahead while the app is still playing the other hand: catch up.
    if (!follow.current.notes.length) {
      const k = follow.groups.findIndex((g, i) => i >= follow.index && g.notes.length);
      if (k >= 0 && follow.groups[k].notes.includes(n)) {
        clearTimeout(autoTimer); autoTimer = null;
        while (follow.index < k) { playAuto(follow.index); follow.skip(); }
        pos = follow.current.t;
      }
    }
    const group = follow.current, index = follow.index;
    if (group.notes.includes(n)) for (const e of group.events.filter(e => e.n === n)) matched.add(e.id);
    if (group.notes.includes(n) && !follow.collected.has(n)) linkPlayed(rec, group.events.find(e => e.n === n));
    const result = follow.attack(n);
    barTally.add(measureIndexAt(group.t), result !== 'wrong');
    if (result === 'wrong') {
      wrongCount++; flashKey(n, 'wrong'); flash('Not quite.', 'bad');
      if (strategy === 'memory') { memoryHints++; practicePrompt(); }
      misses.add(group.t, measureLabelAt(group.t), {expected: group.notes.filter(x => !follow.collected.has(x)).map(x => spelled(song, group.events.find(e => e.n === x) || {n: x})), played: [name(n)]});
      return;
    }
    rightCount++; flashKey(n, 'hit');
    if (result === 'advanced' || result === 'finished') memoryHints = 0;
    playAuto(index); // the other hand comes in with the user's first note of the chord
    if (result === 'finished') return finishWait();
    if (result === 'advanced') {
      if (Math.random() < .3) flash(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
      const from = group.t;
      pos = follow.current.t;
      draw(); practicePrompt(); runAuto(false, from);
      return;
    }
    draw(); practicePrompt();
  }
  function finishWait() {
    const total = rightCount + wrongCount;
    const r = {right: rightCount, wrong: wrongCount, accuracy: total ? Math.round(100 * rightCount / total) : 100, timing: null};
    emitResult(r);
    if (continueChain(r)) return;
    if (loop) {
      flash(r.tempoTo !== r.tempoFrom ? `Once more · ♩ = ${r.tempoTo}` : 'Once more.');
      follow.reset(); autoPlayed = new Set(); matched.clear(); rightCount = 0; wrongCount = 0;
      pos = follow.current.t; draw(); practicePrompt(); runAuto(true);
      return;
    }
    practicing = false; follow = null; finished = true; pos = range.end;
    refreshFreeClick(); endSession(); setButtons(); draw();
    setPrompt('Passage complete'); setStatus('Finished'); showResults(r);
  }

  // Metronome while waiting: a steady pulse at the tempo, in the current bar's meter.
  function refreshFreeClick() {
    const want = metronome && metroInWait && practicing && practiceMode === 'wait';
    if (!want) { clearInterval(freeClick?.timer); freeClick = null; return; }
    if (freeClick) return;
    freeClick = {next: performance.now() + 60, beat: 0};
    freeClick.timer = setInterval(() => {
      const now = performance.now(), qms = quarterMs();
      while (freeClick.next < now + LOOKAHEAD_MS) {
        const m = song.measures[measureIndexAt(pos)], info = beatInfo(m.meter);
        piano.click(Math.max(0, (freeClick.next - now) / 1000), freeClick.beat % info.beats === 0);
        freeClick.beat = (freeClick.beat + 1) % info.beats;
        freeClick.next += info.len * qms;
      }
    }, TICK_MS);
  }

  // ───────── Practice: Play along (timed) ─────────
  let eventById = new Map();
  function newGrader() {
    const want = handFilter(hands);
    eventById = new Map(range.events.map(e => [e.id, e]));
    grader = new TimedGrader(range.events.filter(e => !e.carried && want(e)).map(e => ({id: e.id, n: e.n, t: e.t})));
  }
  function startTimed() {
    newGrader();
    practicing = true; passStartedAt = performance.now(); beginSession('practice');
    pos = points[0] ?? range.start; setButtons(); draw();
    setStatus(`Play along · ${sectionLabel()} · ♩ = ${tempo()}`);
    startClock('timed', range.start, {count: true});
  }
  function gradeNote(note, grade) {
    grades.set(note.id, grade);
    if (grade !== 'miss') matched.add(note.id);
    barTally.add(measureIndexAt(note.t), grade !== 'miss');
    highway.popup(note.n, GRADE_TEXT[grade], grade);
    if (grade === 'miss') misses.add(note.t, measureLabelAt(note.t), {expected: [spelled(song, note)]});
  }
  function timedAttack(n, time, rec) {
    if (!clock || clock.kind !== 'timed' || !grader) return;
    const p = clockPos(time - latencyMs); // calibrated input latency (Settings)
    if (p < range.start - TIMING.window / clock.qms) return; // still counting in
    const r = grader.attack(n, p, clock.qms);
    if (r.result === 'wrong') {
      flashKey(n, 'wrong');
      // Attach the stray note to the nearest note the user should have played.
      const near = range.events.filter(e => !e.carried && wantHand(e)).reduce((b, e) => (!b || Math.abs(e.t - p) < Math.abs(b.t - p) ? e : b), null);
      const t = near && Math.abs(near.t - p) * clock.qms < 1000 ? near.t : p;
      misses.add(t, measureLabelAt(Math.max(range.start, t)), {played: [name(n)]});
      barTally.add(measureIndexAt(Math.max(range.start, t)), false);
    } else { flashKey(n, 'hit'); gradeNote(r.note, r.result); linkPlayed(rec, eventById.get(r.note.id)); }
    renderSheet(); timedPrompt();
  }
  function timedPrompt() {
    if (!grader) return;
    const c = grader.counts;
    setPrompt(`<b class="ok">${c.perfect}</b> on time · ${c.early} early · ${c.late} late · <b class="miss">${c.miss}</b> missed`);
  }
  function finishTimedPass() {
    grader.finish().forEach(note => gradeNote(note, 'miss'));
    const s = grader.summary;
    const r = {...s, counts: {...grader.counts}};
    if (perf) r.performance = performanceScore({counts: r.counts, evenness: evenness(played.filter(p => p.id != null))});
    emitResult(r);
    if (r.chainNext) { stopAll(); setTimeout(() => continueChain(r), 300); return true; }
    if (!loop) return false;
    flash(r.tempoTo !== r.tempoFrom ? `Once more · ♩ = ${r.tempoTo}` : `${r.accuracy}% · once more.`);
    return false;
  }

  // The results card reads like a programme note: one large figure, a fine table.
  const VERDICTS = [[98, 'Clean.'], [90, 'Well played.'], [75, 'Nearly there.'], [50, 'Taking shape.'], [0, 'Slowly, then.']];
  function showResults(r = lastResult) {
    if (!r) return;
    const perfR = r.performance;
    const acc = perfR ? perfR.score : r.accuracy;
    const handsText = {both: 'both hands', right: 'right hand', left: 'left hand'}[hands];
    const sl = current ? setlistPosition(current.id) : null;
    const kicker = perfR ? `Performance · the whole piece · ♩ = ${r.tempoFrom}` : `${sectionLabel()} · ${practiceMode === 'timed' ? 'Play along' : 'Wait'} · ${handsText}`;
    q('#um-complete-kicker').textContent = (sl ? `${sl.name} · ${sl.index + 1} of ${sl.total} · ` : '') + kicker;
    q('#um-acc').textContent = acc;
    q('#um-complete .note-figure-cap').textContent = perfR ? 'performance' : 'accuracy';
    q('#complete-title').textContent = perfR ? perfR.verdict : VERDICTS.find(([min]) => acc >= min)[1];
    let speed = r.tempoTo !== r.tempoFrom ? ` Tempo raised to ♩ = ${r.tempoTo}.` : ` At ♩ = ${r.tempoFrom}.`;
    if (r.newBest) speed += perfR ? ' Your best clean tempo for the whole piece.' : ' Your best clean tempo here.';
    if (r.memory) speed += ` From memory: ${r.wrong ? `${r.wrong} slip${r.wrong === 1 ? '' : 's'}` : 'no slips'}.`;
    if (r.chainDone) speed += ` Chained all of ${barsText(song.measures, ...r.chainDone)}.`;
    const timing = q('#um-complete-timing'), perfTable = q('#um-perf');
    perfTable.hidden = !perfR;
    if (perfR) {
      q('#um-complete-text').textContent = `${r.right} notes played, ${r.missed} missed, ${r.extra} stray.${r.newBest ? ' Your best clean tempo for the whole piece.' : ''}`;
      const rows = [['acc', 'Accuracy', perfR.accuracy], ['time', 'Timing', perfR.timing], ['even', 'Evenness', perfR.evenness]];
      perfTable.innerHTML = '<caption class="sr-only">Performance</caption>' + rows.map(([k, label, v]) => v == null
        ? `<tr class="p-${k}"><th scope="row">${label}</th><td class="t-bar"></td><td class="t-num" title="Needs more notes">–</td></tr>`
        : `<tr class="p-${k}"><th scope="row">${label}</th><td class="t-bar"><i style="width:${v}%"></i></td><td class="t-num">${v}</td></tr>`).join('');
      timing.hidden = true;
    } else if (r.counts) {
      q('#um-complete-text').textContent = `${r.right} notes played, ${r.missed} missed, ${r.extra} stray.${speed}`;
      const c = r.counts, total = Math.max(1, c.perfect + c.early + c.late + c.miss);
      timing.innerHTML = '<caption class="sr-only">Timing</caption>' + [['perfect', 'On time', c.perfect], ['early', 'Early', c.early], ['late', 'Late', c.late], ['miss', 'Missed', c.miss]]
        .map(([k, label, v]) => `<tr class="t-${k}"><th scope="row">${label}</th><td class="t-bar"><i style="width:${(100 * v / total).toFixed(1)}%"></i></td><td class="t-num">${v}</td></tr>`).join('');
      timing.hidden = false;
    } else {
      q('#um-complete-text').textContent = `${r.right} notes found, ${r.wrong} wrong.${speed}`;
      timing.hidden = true;
    }
    showTouch(r.touch);
    const last = range.last >= song.measures.length - 1;
    // No dead buttons: at the end of the piece there is no next section to offer.
    q('#um-complete-next').hidden = last || !!perfR;
    // Playing a setlist: the next piece is the one primary action.
    const next = sl?.next || null, nextBtn = q('#um-complete-setlist'), again = q('#um-again');
    nextBtn.hidden = !next;
    if (next) { nextBtn.setAttribute('aria-label', `Next in setlist: ${next.title}`); nextBtn.title = next.title; }
    // Sight-reading: a fresh piece at the same level is the one primary action.
    const another = q('#um-complete-another');
    another.hidden = !!next || !sightReadingLevel();
    again.className = next || !another.hidden ? 'quiet-btn' : 'primary-btn';
    again.textContent = perfR ? 'Perform again' : 'Again';
    if (sl && !next && (last || perfR)) q('#um-complete-text').textContent += ` The end of “${sl.name}”.`;
    if (q('#um-complete').hidden) resultsModal.open();
    q('#um-complete').hidden = false;
    (next ? nextBtn : !another.hidden ? another : again).focus({preventScroll: true});
  }
  // Evenness graph (fine lines: timing in ink, loudness in brass) and up to two remarks.
  function showTouch(touch) {
    const fig = q('#um-touch'), list = q('#um-remarks');
    const ev = touch?.evenness;
    fig.hidden = !ev;
    if (ev) {
      q('#um-even-score').textContent = ev.score;
      const W = 300, H = 64, mid = H / 2, n = ev.points.length;
      const x = i => (n > 1 ? i / (n - 1) : .5) * (W - 8) + 4;
      const line = (key, range) => ev.points.map((p, i) => `${x(i).toFixed(1)},${(mid - Math.max(-1, Math.min(1, p[key] / range)) * (mid - 6)).toFixed(1)}`).join(' ');
      q('#um-even-graph').innerHTML = `<line class="g-zero" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>` +
        `<polyline class="g-vel" points="${line('dv', 30)}"/><polyline class="g-time" points="${line('dt', 60)}"/>` +
        ev.points.map((p, i) => `<circle class="g-dot" cx="${x(i).toFixed(1)}" cy="${(mid - Math.max(-1, Math.min(1, p.dt / 60)) * (mid - 6)).toFixed(1)}" r="1.6"/>`).join('');
      q('#um-even-detail').textContent = `· ±${Math.round(ev.timingSdMs)} ms · ±${Math.round(ev.velocitySd)} velocity`;
    }
    const remarks = touch?.remarks ?? [];
    list.hidden = !remarks.length;
    list.replaceChildren(...remarks.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
  }
  function hideResults() { if (!q('#um-complete').hidden) { q('#um-complete').hidden = true; resultsModal.closed(); } }
  // Modal cards (results, settings): focus moves in, Tab stays inside, Escape closes, and focus
  // returns to whatever opened them.
  function modalFocus(modal, close) {
    let opener = null;
    const focusables = () => [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && !el.hidden && el.getClientRects().length);
    modal.addEventListener('keydown', e => {
      if (modal.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        // Escape during latency calibration cancels just the calibration, not Settings.
        if (calib || !q('#lat-panel')?.hidden) { cancelCalibration(); return; }
        close(); return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); list.at(-1).focus(); }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
    });
    return {
      open() { const a = document.activeElement; opener = a && !modal.contains(a) && a !== document.body ? a : null; },
      focusFirst() { focusables()[0]?.focus({preventScroll: true}); },
      closed() {
        if (modal.contains(document.activeElement) || document.activeElement === document.body) {
          const back = opener?.isConnected && opener.getClientRects().length ? opener : q('#um-play');
          back?.focus({preventScroll: true});
        }
        opener = null;
      },
    };
  }
  const resultsModal = modalFocus(q('#um-complete'), () => hideResults());
  q('#um-again').onclick = () => (lastResult?.performance ? startPerformance() : startPractice());
  // Setlists (src/collections/): the next piece, from the results card or the end of a listen.
  function goSetlistNext() {
    const next = current ? setlistPosition(current.id)?.next : null;
    if (!next) return;
    hideResults();
    location.hash = playHref(next.id);
  }
  q('#um-complete-setlist').onclick = goSetlistNext;
  // "sr:<level>:<seed>" (src/sightread/index.js): another piece is the same level with a new seed.
  const sightReadingLevel = () => /^sr:([a-z0-9-]+):\d+$/.exec(current?.id || '')?.[1] || null;
  q('#um-complete-another').onclick = () => {
    const level = sightReadingLevel();
    if (!level) return;
    hideResults();
    location.hash = playHref(`sr:${level}:${1 + Math.floor(Math.random() * (2 ** 31 - 2))}`);
  };
  q('#um-practice-status').addEventListener('click', e => { if (e.target.closest?.('[data-setlist-next]')) goSetlistNext(); });
  q('#um-complete-close').onclick = hideResults;
  q('#um-complete-next').onclick = () => {
    hideResults(); if (!song) return;
    const len = range.last - range.first;
    if (range.last < song.measures.length - 1) setRange(range.last + 1, range.last + 1 + len);
  };

  // A key press from MIDI or the on-screen keyboard.
  // Every attack is announced as `piano:note`, whether or not the player is on screen.
  // While practising, every press is kept (velocity, press and release times) for touch feedback.
  function userAttack(n, {source = 'screen', velocity = 96, time = performance.now()} = {}) {
    if (calib) { if (source === 'screen') tone(n); calibTap(time); return; }
    emit('piano:note', {note: n, velocity, source, time});
    recording.noteOn(n, velocity, time, source);
    if (source === 'screen') tone(n);
    q('#um-midi-last').textContent = `Last note: ${name(n)} (MIDI ${n})`;
    let rec = null;
    if (practicing && played.length < 2000) { rec = {n, source, velocity, at: time, off: null, id: null}; played.push(rec); }
    if (practicing && practiceMode === 'timed') timedAttack(n, time, rec);
    else practiceAttack(n, rec);
  }
  function userRelease(n, time = performance.now()) {
    recording.noteOff(n, time);
    for (let i = played.length - 1; i >= 0; i--) if (played[i].n === n && played[i].off == null) { played[i].off = time; break; }
  }
  // Sustain pedal (CC 64): shown on the keybed's felt strip, logged against the score.
  function setPedal(down) {
    if (down === pedalDown) return;
    pedalDown = down;
    root.classList.toggle('pedal-down', down);
    if (practicing && pedalLog.length < 500) pedalLog.push({pos: livePos() ?? pos, down});
  }

  // ───────── Navigation ─────────
  function seek(t) {
    const wasPlaying = playing;
    if (practicing) stopAll();
    stopClock(); piano.silence();
    let i = points.findIndex(p => p >= t - EPS); if (i < 0) i = points.length - 1;
    finished = false; pos = points[i] ?? range.start;
    if (wasPlaying) { draw(); startClock('listen', pos); } else draw(true);
    setStatus(measureName(song.measures[measureIndexAt(pos)]));
  }
  const stepBy = d => {
    if (!song) return;
    const i = points.findIndex(p => Math.abs(p - pos) < EPS);
    const target = points[Math.max(0, Math.min(points.length - 1, (i < 0 ? points.findIndex(p => p > pos) - (d > 0 ? 1 : 0) : i) + d))];
    stopAll(); finished = false; pos = target; draw(true);
  };
  q('#um-next').onclick = () => stepBy(1);
  q('#um-prev').onclick = () => stepBy(-1);
  q('#um-stop').onclick = () => {
    if (!song) return;
    if (practicing && perf) { stopAll(); draw(); return; } // a performance run isn't restarted mid-way
    if (practicing) return startPractice(); // practising: begin the passage again
    stopAll(); finished = false; matched.clear(); grades.clear(); pos = points[0] ?? range.start; highway.jump(); draw();
    setStatus(sectionLabel()); setPrompt(promptIdle());
  };
  q('#um-prev-measure').onclick = () => { if (song) seek(song.measures[Math.max(range.first, measureIndexAt(pos) - 1)].start); };
  q('#um-next-measure').onclick = () => { if (song) seek(song.measures[Math.min(range.last, measureIndexAt(pos) + 1)].start); };
  function showTempo() {
    const bpm = tempo();
    q('#um-bpm').textContent = bpm;
    q('#tempo-pop-value').textContent = bpm;
    q('#tempo-term').textContent = tempoTerm(bpm);
    q('#tempo-btn').setAttribute('aria-label', `Tempo: ${bpm} beats per minute${metronome ? ', metronome on' : ''}`);
    const target = q('#um-target');
    target.hidden = !(speedUp || strategy === 'ladder') || !song;
    if (song) target.textContent = `→ ${targetTempo()}`;
    // Slow-practice ladder rungs, the current one marked.
    const ladder = q('#tempo-ladder');
    ladder.hidden = strategy !== 'ladder' || !song;
    if (!ladder.hidden) ladder.innerHTML = 'Ladder ' + ladderRungs(targetTempo()).map(r => `<b class="${r === bpm ? 'on' : r < bpm ? 'past' : ''}">${r}</b>`).join(' · ');
    // Best clean tempo for this section, with a suggested next step.
    const bestEl = q('#tempo-best');
    const best = song && range && current?.id != null ? (read(SONG_STORE(current.id)).best || {})[bestKey()] : null;
    bestEl.hidden = !best;
    if (best) {
      const next = nextTempoStep(best, targetTempo());
      q('#tempo-best-text').innerHTML = `Best clean <span class="tempo-note">♩</span> = ${best}`;
      const tryBtn = q('#tempo-try');
      tryBtn.hidden = !(next > best) || next === bpm;
      tryBtn.textContent = `try ${next}`;
      tryBtn.dataset.tempo = next;
    }
  }
  q('#tempo-try').onclick = () => setTempoValue(+q('#tempo-try').dataset.tempo);
  // Keep the music where it is when the tempo changes mid-flow.
  function setTempoValue(v) {
    const p = clock ? clockPos() : null;
    q('#um-tempo').value = clampTempo(v);
    if (clock) { clock.pos0 = p; clock.perf0 = performance.now(); clock.qms = quarterMs(); }
    showTempo(); saveSong({tempo: tempo()});
  }
  q('#um-tempo').oninput = () => setTempoValue(tempo());
  q('#tempo-down').onclick = () => setTempoValue(tempo() - 2);
  q('#tempo-up').onclick = () => setTempoValue(tempo() + 2);
  // Click a measure on the progress bar to jump there.
  q('#progress').addEventListener('click', e => {
    if (!song) return;
    const box = q('#progress').getBoundingClientRect();
    seek(range.start + (e.clientX - box.left) / box.width * (range.end - range.start));
  });
  // Click a note in the sheet music to jump to it.
  q('#um-sheet').addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    const el = e.target.closest('.note'); if (!el || !song) return;
    const seg = song.segments.find(s => s.id === el.id);
    const ev = seg && song.events.find(x => x.id === seg.root);
    if (ev) seek(Math.max(range.start, ev.t));
  });

  // ───────── Section bar (typed measure numbers, right above the music) ─────────
  const secFirst = q('#sec-first'), secLast = q('#sec-last');
  // A typed measure number → measure index. Repeated measures share a number,
  // so "from" takes its first appearance and "to" its last.
  function measureFromText(text, which) {
    const t = String(text).trim().toLowerCase().replace(/^m(easure)?\s*/, '');
    if (!t) return null;
    if ((t === 'p' || t === 'pickup' || t === '0') && song.measures[0]?.pickup) return 0;
    const hits = song.measures.map((m, i) => (String(m.label).toLowerCase() === t ? i : -1)).filter(i => i >= 0);
    if (!hits.length) return null;
    return which === 'first' ? hits[0] : hits.at(-1);
  }
  function showSectionInputs() {
    if (!song || !range) return;
    const shown = i => (song.measures[i].pickup ? '0' : song.measures[i].label);
    secFirst.value = shown(range.first);
    secLast.value = shown(range.last);
    q('#sec-of').textContent = `of ${song.measures.at(-1).label}`;
  }
  function rejectInput(input) {
    showSectionInputs();
    input.classList.remove('invalid'); void input.offsetWidth; input.classList.add('invalid');
    setTimeout(() => input.classList.remove('invalid'), 600);
  }
  function applySectionInputs(changed) {
    if (!song) return;
    let a = measureFromText(secFirst.value, 'first');
    let b = measureFromText(secLast.value, 'last');
    if (a == null) return rejectInput(secFirst);
    if (b == null) return rejectInput(secLast);
    if (a > b) { if (changed === secFirst) b = a; else a = b; }
    if (a === range.first && b === range.last) return showSectionInputs();
    setRange(a, b);
  }
  for (const input of [secFirst, secLast]) {
    input.addEventListener('change', () => applySectionInputs(input));
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applySectionInputs(input); input.blur(); }
      else if (e.key === 'Escape') { showSectionInputs(); input.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!song) return;
        const step = e.key === 'ArrowUp' ? 1 : -1;
        const i = Math.max(0, Math.min(song.measures.length - 1, (input === secFirst ? range.first : range.last) + step));
        input.value = song.measures[i].pickup ? '0' : song.measures[i].label;
        applySectionInputs(input);
      }
    });
  }
  q('#section-bar').addEventListener('submit', e => e.preventDefault());
  q('#sec-loop').onchange = () => setLoop(q('#sec-loop').checked);
  root.querySelectorAll('[data-preset]').forEach(btn => btn.onclick = () => {
    closePopovers();
    if (!song) return;
    const here = measureIndexAt(pos), n = song.measures.length, len = range.last - range.first;
    const [a, b] = {
      whole: [0, n - 1], here: [here, here], four: [here, here + 3],
      next: [range.last + 1, range.last + 1 + len], prev: [range.first - 1 - len, range.first - 1],
    }[btn.dataset.preset];
    if (a >= n || b < 0) return;
    setRange(Math.max(0, a), Math.min(n - 1, b));
  });

  // ───────── Practise smarter (Bars ▾): weak bars, phrases, chaining ─────────
  const rangeText = (a, b) => (a === b ? measureName(song.measures[a]) : `${shortName(song.measures[a])}–${shortName(song.measures[b])}`);
  function showSmartMenu() {
    if (!song || !range) return;
    const weak = weakPassage(trouble, song.measures.length);
    const weakBtn = q('#smart-weak');
    weakBtn.disabled = !weak;
    weakBtn.title = weak ? '' : 'Play a few passes first: your weakest bars appear here';
    q('#smart-weak-meta').textContent = weak ? rangeText(weak.first, weak.last) : 'after a few passes';
    const here = phraseAt(phrases, measureIndexAt(pos)), next = nextPhrase(phrases, range.last);
    q('#smart-phrase-meta').textContent = here ? rangeText(here.first, here.last) : '';
    q('#smart-next').disabled = !next;
    q('#smart-next-meta').textContent = next ? rangeText(next.first, next.last) : 'the end';
  }
  function startChaining(dir) {
    // A single bar chains over its phrase; otherwise over the chosen bars.
    let [a, b] = [range.first, range.last];
    if (a === b) { const ph = phraseAt(phrases, a); if (ph) [a, b] = [ph.first, ph.last]; }
    if (a === b) { flash('Choose two bars or more to chain', 'bad'); return; }
    const c = startChain(a, b, dir);
    setRange(c.first, c.last, {keep: true, quiet: true});
    chain = c;
    setLoop(true);
    setIntent('practice');
    showStrategy();
    setStatus(`Chaining ${barsText(song.measures, a, b)}`);
    setPrompt(`Press <b class="glyph">▶</b> · ${dir === 'forward' ? 'from the first bar' : 'from the last bar'}, one more bar after each clean pass`);
  }
  root.querySelectorAll('[data-smart]').forEach(btn => btn.onclick = () => {
    closePopovers();
    if (!song || !range) return;
    const act = btn.dataset.smart;
    if (act === 'weak') {
      const w = weakPassage(trouble, song.measures.length);
      if (!w) return;
      setRange(w.first, w.last); setLoop(true); setIntent('practice');
      flash(`Looping the weak bars · ${rangeText(w.first, w.last)}`);
    } else if (act === 'phrase' || act === 'next-phrase') {
      const ph = act === 'phrase' ? phraseAt(phrases, measureIndexAt(pos)) : nextPhrase(phrases, range.last);
      if (ph) setRange(ph.first, ph.last);
    } else if (act === 'chain-forward') startChaining('forward');
    else if (act === 'chain-backward') startChaining('backward');
  });

  // ───────── Performance run (Bars ▾ → Performance run) ─────────
  // The whole piece once, in play-along time, without stopping: pausing (or anything else that
  // stops the music) ends the run. Both hands, no loop, no strategy; the metronome stays as the
  // student set it (off unless they chose it). A take is recorded when the recorder isn't already
  // running (src/record/), and the results card scores accuracy, timing and evenness
  // (src/analysis/performance.mjs). Afterwards the section, hands, loop, mode and Listen |
  // Practise come back as they were.
  let perf = null;
  function startPerformance() {
    closePopovers();
    if (!song || !range) return;
    hideResults();
    const prev = perf ? {...perf} : {hands, loop, mode, intent, range: [range.first, range.last]};
    perf = null;
    stopAll();
    if (strategy !== 'off') setStrategy('off');
    chain = null;
    setLoop(false);
    setHands('both', {persist: false});
    setMode('timed', {persist: false});
    setIntent('practice', {persist: false});
    setRange(0, song.measures.length - 1, {quiet: true});
    startPractice();
    if (!practicing) { perf = {...prev, rec: false}; endPerformance({completed: false, quiet: true}); return; }
    perf = {...prev, rec: false};
    root.classList.add('performing');
    showStrategy();
    if (!root.classList.contains('recording')) { recording.toggle(); perf.rec = root.classList.contains('recording'); }
    setStatus(`Performance run · the whole piece · ♩ = ${tempo()}`);
    flash('Performance run');
  }
  function endPerformance({completed = false, quiet = false} = {}) {
    if (!perf) return;
    const p = perf;
    perf = null;
    root.classList.remove('performing');
    showStrategy();
    const where = song && range && !completed ? measureName(song.measures[measureIndexAt(pos)]) : '';
    if (p.rec && root.classList.contains('recording')) recording.toggle(); // saves the take
    setHands(p.hands, {persist: false});
    setMode(p.mode, {persist: false});
    setIntent(p.intent, {persist: false});
    setLoop(p.loop);
    if (song && p.range) setRange(p.range[0], p.range[1], {quiet: true});
    if (!completed && !quiet) {
      setStatus('Performance run stopped');
      setPrompt(`Performance run stopped${where ? ' at ' + escapeHtml(where.toLowerCase()) : ''} · start another from <b>Bars</b>`);
    }
  }
  q('#perform-run').onclick = startPerformance;

  // ───────── Favourites and collections (⋯ menu) ─────────
  // Generated pieces (exercises, sight-reading) aren't kept in collections.
  const collectable = () => !!current && !/^(ex|sr):/.test(String(current.id));
  function showFavourite() {
    const group = q('#collect-group');
    group.hidden = !collectable();
    const on = collectable() && isFavourite(collections(), current.id);
    const btn = q('#fav-btn');
    btn.setAttribute('aria-pressed', String(on));
    btn.firstElementChild.textContent = on ? 'In favourites' : 'Favourite';
    btn.classList.toggle('is-on', on);
  }
  q('#fav-btn').onclick = () => {
    if (!collectable()) return;
    const on = !isFavourite(collections(), current.id);
    updateCollections(d => setFavourite(d, current.id, on));
    flash(on ? 'Added to favourites.' : 'Removed from favourites.');
  };
  q('#collect-btn').onclick = () => {
    if (!collectable()) return;
    const entry = current, anchor = q('#more-btn');
    closePopovers();
    import('./collections/picker.js').then(m => m.openCollectionPicker({anchor, pieceId: entry.id, title: entry.title}))
      .catch(e => console.warn('Collections unavailable:', e));
  };
  window.addEventListener(COLLECTIONS_EVENT, showFavourite);

  // ───────── Strategies (⋯ → Strategy) ─────────
  function setStrategy(v) {
    v = v in STRATEGIES ? v : 'off';
    const changed = v !== strategy;
    strategy = v;
    q('#menu-strategy').value = v;
    root.dataset.strategy = v;
    root.classList.toggle('memory', v === 'memory');
    if (!changed) return;
    if (v === 'ladder' && song) setTempoValue(ladderRungs(targetTempo())[0]);
    // Rebuild the passage: rhythm variations and blocked chords alter its timing.
    if (song && range) setRange(range.first, range.last, {keep: true, quiet: playing || practicing});
    showStrategy(); showTempo();
    if (v !== 'off') flash(STRATEGIES[v]);
  }
  q('#menu-strategy').onchange = () => setStrategy(q('#menu-strategy').value);
  // A quiet tag on the stage names the strategy or chain in force; tap to end it.
  function showStrategy() {
    const tag = q('#um-strategy');
    const parts = [];
    if (perf) parts.push('Performance run');
    if (strategy !== 'off') parts.push(STRATEGIES[strategy]);
    if (chain && song) parts.push(`Chaining ${chain.dir === 'backward' ? '←' : '→'} ${rangeText(chain.first, chain.last)} of ${rangeText(...chain.goal)}`);
    tag.hidden = !parts.length;
    tag.textContent = parts.join(' · ');
    tag.setAttribute('aria-label', parts.join(', ') + '. Turn off');
  }
  q('#um-strategy').onclick = () => {
    if (perf) { stopAll(); draw(); showStrategy(); return; } // ends the performance run
    if (chain) { const [a, b] = chain.goal; chain = null; setRange(a, b); }
    if (strategy !== 'off') setStrategy('off');
    showStrategy();
  };

  // Keyboard shortcuts.
  window.addEventListener('keydown', e => {
    if (calib && !e.repeat && e.key !== 'Escape' && !e.ctrlKey && !e.metaKey && !['Shift', 'Alt', 'Control', 'Meta', 'Tab'].includes(e.key)) {
      e.preventDefault(); calibTap(performance.now()); return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (keyForControl(e)) return; // typing, or Space/arrows on a focused toggle (hands, mode, loop)
    if (!root.isConnected || !root.getClientRects().length) return; // player not on screen
    // Pages view: arrows and PageUp/PageDown (Bluetooth page turners) turn the page.
    const paged = root.dataset.view === 'pages' && song && !e.shiftKey;
    if (paged && ['PageDown', 'ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); turnPage(1); return; }
    if (paged && ['PageUp', 'ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); turnPage(-1); return; }
    if (e.code === 'Space') { e.preventDefault(); q('#um-play').click(); }
    else if (e.key === 'p' || e.key === 'P') { setIntent('practice'); startPractice(); }
    else if (e.key === 'l' || e.key === 'L') { q('#sec-loop').click(); }
    else if (e.key === 'm' || e.key === 'M') setMuted(!piano.muted);
    else if (e.key === 'r' || e.key === 'R') recording.toggle();
    else if (e.key === 'n' || e.key === 'N') setNames(!root.classList.contains('show-names'));
    else if (e.key === 'k' || e.key === 'K') setMetronome(!metronome);
    else if (e.key === 'h' || e.key === 'H') setHands(HANDS[(HANDS.indexOf(hands) + 1) % HANDS.length]);
    else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.2);
    else if (e.key === '-' || e.key === '_') setZoom(zoom / 1.2);
    else if (e.key === 'ArrowRight') e.shiftKey ? q('#um-next-measure').click() : stepBy(1);
    else if (e.key === 'ArrowLeft') e.shiftKey ? q('#um-prev-measure').click() : stepBy(-1);
    else if (e.key === 'Escape') { if (!closePopovers()) { hideResults(); closeSettings(); } }
  });

  // ───────── MIDI ─────────
  // Local Web MIDI inputs, plus notes relayed from a Mac over the dev server
  // (iPad Safari has no Web MIDI; see src/midi-relay.js).
  let midiAccess = null;
  let relay = {bridge: false, devices: [], state: '', label: ''}, relayLatency = null;
  const midiHeld = new Map();
  const localInputs = () => midiAccess ? [...midiAccess.inputs.values()].filter(p => p.state === 'connected') : [];
  function renderMidi() {
    const notes = [...new Set([...midiHeld.values()].flatMap(s => [...s]))];
    root.querySelectorAll('.pkey').forEach(b => b.classList.toggle('midi-down', notes.includes(+b.dataset.note)));
    q('#um-midi-notes').textContent = notes.length ? 'You: ' + notes.sort((a, b) => a - b).map(name).join(' + ')
      : midiAccess || relay.bridge ? 'Piano ready' : 'Tap the keys or connect a piano';
  }
  function setMidiChip(text, state) {
    q('#um-midi span:last-child').textContent = text;
    q('#midi-chip').dataset.state = state;
    root.dataset.midi = state;
    q('#um-midi-status').textContent = text;
  }
  function refreshChip() {
    const inputs = localInputs();
    const relayName = relay.devices.length > 1 ? `${relay.devices.length} inputs` : relay.devices[0] || 'piano';
    const fine = Number.isFinite(relayLatency) ? ` · ${Math.round(relayLatency)} ms` : '';
    if (inputs.length) setMidiChip((inputs.length === 1 ? (inputs[0].name || 'Piano') : `${inputs.length} inputs`) + (relay.bridge ? ' + Mac' : ''), 'on');
    else if (relay.bridge && (!relay.state || relay.state === 'connected')) setMidiChip('Mac · ' + relayName + fine, 'on');
    // The Mac relay's own trouble states (src/midi-relay.js) with its ready-made label.
    else if (['reconnecting', 'stale', 'no-piano', 'waiting'].includes(relay.state) && relay.label) setMidiChip(relay.label, relay.state === 'reconnecting' ? 'busy' : 'warn');
    else if (midiAccess) setMidiChip('No piano found', 'warn');
    else setMidiChip('Connect piano', '');
  }
  // One MIDI message [status, note, velocity] from any source. `source`
  // separates held keys per input so one device can't release another's.
  function midiMessage(source, [status, n, velocity], time = performance.now()) {
    const command = status & 240;
    if (command !== 144 && command !== 128 && command !== 176) return;
    const key = source + ':' + (status & 15);
    if (!midiHeld.has(key)) midiHeld.set(key, new Set());
    const held = midiHeld.get(key);
    if (command === 144 && velocity > 0) {
      const already = held.has(n); held.add(n);
      if (!already) userAttack(n, {source: source.startsWith('local:') ? 'midi' : 'relay', velocity, time});
    } else if (command === 128 || command === 144) { if (held.delete(n)) userRelease(n, time); }
    else if (n === 64) { setPedal(velocity >= 64); recording.pedal(velocity, time); }
    else if (n === 120 || n === 123) held.clear();
    renderMidi();
  }
  const clearHeld = (prefix = '') => { for (const k of [...midiHeld.keys()]) if (k.startsWith(prefix)) midiHeld.delete(k); };
  onRelayMidi(bytes => midiMessage('relay', bytes));
  onRelayStatus(status => {
    relay = {bridge: !!status?.bridge, devices: Array.isArray(status?.devices) ? status.devices : [], state: status?.state || '', label: status?.label || ''};
    clearHeld('relay:'); refreshChip(); renderMidi();
  });
  // Label-only updates (a new latency figure) arrive as a window event; held keys stay.
  window.addEventListener('relay:status', e => {
    const d = e.detail || {};
    relayLatency = Number.isFinite(d.latencyMs) ? d.latencyMs : null;
    if (d.state) { relay.state = d.state; relay.label = d.label || relay.label; }
    refreshChip();
  });
  function wireMidi() {
    if (practicing) { stopAll(); setPrompt('MIDI devices changed · press <b class="glyph">▶</b> to begin again'); }
    const select = q('#um-midi-device');
    const selected = select.value;
    const inputs = localInputs();
    select.innerHTML = '<option value="all">All inputs</option>';
    inputs.forEach(p => select.append(new Option(p.name || 'MIDI input', p.id)));
    select.value = inputs.some(p => p.id === selected) ? selected : 'all';
    clearHeld('local:'); renderMidi(); refreshChip();
    inputs.forEach(input => {
      input.onmidimessage = event => {
        if (select.value !== 'all' && select.value !== input.id) return;
        midiMessage('local:' + input.id, event.data, event.timeStamp || performance.now());
      };
    });
  }
  q('#um-midi-clear').onclick = () => { midiHeld.clear(); renderMidi(); };
  q('#um-midi-device').onchange = () => { midiHeld.clear(); renderMidi(); };
  window.addEventListener('blur', () => { midiHeld.clear(); renderMidi(); });
  const connectMidi = async () => {
    const noWebMidi = !window.isSecureContext || !navigator.requestMIDIAccess;
    if (noWebMidi && relay.bridge) { refreshChip(); return; }
    if (noWebMidi && relayAvailable) { setMidiChip('Use the Mac bridge (see README)', 'warn'); return; }
    if (!window.isSecureContext) { setMidiChip('MIDI needs HTTPS', 'warn'); return; }
    if (!navigator.requestMIDIAccess) { setMidiChip('Use Chrome or Edge for MIDI', 'warn'); return; }
    try {
      setMidiChip('Connecting…', 'busy');
      midiAccess = await navigator.requestMIDIAccess({sysex: false});
      midiAccess.onstatechange = wireMidi; wireMidi();
    } catch { setMidiChip('MIDI blocked', 'warn'); }
  };
  q('#um-midi').onclick = connectMidi;
  // Allowed once, the piano reconnects by itself on the next visit (no prompt is shown when the
  // permission is already granted), so Today → note reading works without opening a piece first.
  navigator.permissions?.query({name: 'midi'}).then(p => { if (p.state === 'granted' && !midiAccess) connectMidi(); }, () => {});

  // Current musical position, moving smoothly between notes while playing.
  function livePos() {
    if (!song || !range) return null;
    if (scrub) return scrub.t;
    if (external) return Math.max(range.start, Math.min(range.end, external.pos()));
    if (clock) return Math.min(range.end, clockPos());
    return pos;
  }

  // ───────── Take playback (src/record/) ─────────
  // A recorded take drives the position: `posFn()` → score time, from the take's timing
  // aligned to the score. The highway, the sheet and the keys follow it like Listen.
  let external = null;
  function playExternal(posFn, onStop) {
    stopAll(); hideResults();
    finished = false; matched.clear(); grades.clear();
    external = {pos: posFn, onStop, shown: -1};
    const step = () => {
      if (!external) return;
      const p = external.pos();
      let i = -1;
      while (i + 1 < points.length && points[i + 1] <= p + EPS) i++;
      if (i !== external.shown) { external.shown = i; pos = points[Math.max(0, i)] ?? pos; draw(); }
    };
    external.timer = setInterval(step, 30);
    step();
    root.classList.add('playing-take');
  }
  function stopExternal() {
    if (!external) return;
    const e = external;
    external = null;
    clearInterval(e.timer);
    root.classList.remove('playing-take');
    midiHeld.delete('take:0'); renderMidi();
    e.onStop?.();
  }
  const recording = attachRecording({
    root, piano,
    song: () => song, range: () => range, current: () => current, state: () => getState(),
    tempo, busy: () => (playing ? 'listen' : practicing ? 'practice' : null),
    setRange: (a, b) => setRange(a, b, {quiet: true}),
    setLoop: v => setLoop(v),
    stop: () => { stopAll(); draw(); },
    playExternal, stopExternal,
    keys: notes => { if (notes.length) midiHeld.set('take:0', new Set(notes)); else midiHeld.delete('take:0'); renderMidi(); },
    flash, setStatus, setPrompt, measureName: i => measureName(song.measures[i]),
  });

  // ───────── Highway ─────────
  const highway = createHighway({
    canvas: q('#um-highway'),
    keys: q('#um-keys'),
    getEvents: () => range?.events ?? [],
    getMeasures: () => song && range ? song.measures.slice(range.first, range.last + 1) : [],
    position: () => (finished && song ? range.end + 1 : livePos()),
    handColors: () => !root.classList.contains('no-hands'),
    hideNotes: () => strategy === 'memory',
    barHeat: m => { const st = trouble.get(m.index); return st ? heatLevel(st.accuracy) : null; },
    noteLabel: e => (root.classList.contains('show-names') ? song?.noteNames?.get(e.id)?.name ?? NAMES[e.n % 12] : null),
    noteState(e) {
      if (grades.has(e.id)) return grades.get(e.id);
      if (!wantHand(e)) return 'auto'; // the hand the app plays: greyed
      if (practicing && practiceMode === 'wait' && follow?.active && e.t === follow.current.t) return follow.collected.has(e.n) ? 'matched' : 'expected';
      if (matched.has(e.id)) return 'matched';
      return '';
    },
  });

  // ───────── Scrubbing ─────────
  // Drag or wheel over the sheet (horizontal) or the highway (vertical) to
  // move the music under the playhead; on release snap to the nearest note.
  let scrub = null, suppressClick = false, wheelTimer = null;
  const clampT = t => Math.max(range.start, Math.min(range.end, t));
  function scrubBegin() {
    if (scrub) return true;
    if (!song || !range) return false;
    if (playing) {
      const p = livePos();
      stopAll(); pos = points.filter(x => x <= p + EPS).at(-1) ?? range.start;
      setStatus('Paused'); setPrompt('Paused · press <b class="glyph">▶</b> to continue');
    } else if (practicing && practiceMode === 'timed') {
      stopAll(); setStatus('Stopped'); setPrompt('Stopped · press <b class="glyph">▶</b> to start again');
    }
    hideResults();
    const from = finished ? range.end : livePos();
    finished = false;
    scrub = {t: clampT(from ?? range.start)};
    root.classList.add('scrubbing');
    return true;
  }
  function scrubTo(t) {
    if (!scrub) return;
    scrub.t = clampT(t);
    highway.jump(); // follow the gesture exactly, no easing
  }
  function scrubEnd() {
    if (!scrub) return;
    const t = scrub.t;
    scrub = null;
    root.classList.remove('scrubbing');
    if (practicing && follow?.active) {
      // Continue practising from the first chord at or after this point.
      clearTimeout(autoTimer);
      let i = follow.groups.findIndex(g => g.t >= t - EPS);
      if (i < 0) i = follow.groups.length - 1;
      follow.index = i; follow.collected.clear();
      for (const e of follow.groups.slice(i).flatMap(g => g.events)) matched.delete(e.id);
      for (let k = i; k < follow.groups.length; k++) autoPlayed.delete(k);
      pos = follow.current.t;
      draw(); practicePrompt(); runAuto(true);
      return;
    }
    if (!points.length) { pos = t; draw(); return; }
    pos = points.reduce((best, p) => Math.abs(p - t) < Math.abs(best - t) ? p : best, points[0]);
    draw(true); // like stepping: sound the chord once
    setStatus(measureName(song.measures[measureIndexAt(pos)]));
  }

  // Map a gesture delta to time for each view.
  const sheetTime = (t, dx) => tAt(xAt(t) + dx);
  // Falling notes follow the finger: dragging down pulls upcoming notes onto the keys (forward in time).
  const highwayTime = (t, dy) => t + dy / highway.pixelsPerQuarter();

  // ───────── Drag to select a section (and loop it) ─────────
  // Sheet: drag across the measure-number strip at the top, long-press then
  // drag (touch), or shift-drag. Falling notes: the same on the bar-number
  // strip at the left edge.
  const inRuler = e => !!e.target?.closest?.('.sel-ruler');
  function measureAtPoint(axis, e) {
    if (axis === 'x') {
      let best = 0, bestDist = Infinity;
      song.measures.forEach((m, i) => {
        const r = measureEls.get(m.id)?.getBoundingClientRect();
        if (!r || !r.width) return;
        const d = e.clientX < r.left ? r.left - e.clientX : e.clientX >= r.right ? e.clientX - r.right + 1 : 0;
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    }
    const box = highwayBox().getBoundingClientRect();
    const t = (livePos() ?? 0) + (box.bottom - e.clientY) / highway.pixelsPerQuarter();
    const i = song.measures.findIndex(m => m.start <= t && t < m.end);
    return i < 0 ? (t < song.measures[0].start ? 0 : song.measures.length - 1) : i;
  }
  const highwayBox = () => q('#um-highway').closest('.highway') || q('#um-highway');
  function showSelection(axis, a, b) {
    const host = axis === 'x' ? sheetHost : highwayBox();
    let band = host.querySelector(':scope > .sel-band');
    if (!band) { band = document.createElement('div'); band.className = 'sel-band'; host.append(band); }
    const hb = host.getBoundingClientRect();
    if (axis === 'x') {
      const ra = measureEls.get(song.measures[a].id)?.getBoundingClientRect();
      const rb = measureEls.get(song.measures[b].id)?.getBoundingClientRect();
      if (!ra || !rb) return;
      Object.assign(band.style, {left: ra.left - hb.left + 'px', width: rb.right - ra.left + 'px', top: '0', height: '100%'});
    } else {
      const pps = highway.pixelsPerQuarter(), now = livePos() ?? 0;
      const yOf = t => hb.height - (t - now) * pps;
      const top = yOf(song.measures[b].end), bottom = yOf(song.measures[a].start);
      Object.assign(band.style, {left: '0', width: '100%', top: top + 'px', height: bottom - top + 'px'});
    }
    const label = a === b ? measureName(song.measures[a]) : `${measureName(song.measures[a])} – ${song.measures[b].label}`;
    band.dataset.label = label + ' · release to loop';
    band.hidden = false;
  }
  function hideSelection() {
    for (const band of root.querySelectorAll('.sel-band')) band.hidden = true;
  }
  function commitSelection(a, b) {
    hideSelection();
    const [first, last] = a <= b ? [a, b] : [b, a];
    setRange(first, last);
    setLoop(true);
    flash(first === last ? `Looping ${measureName(song.measures[first])}` : `Looping ${song.measures[first].label}–${song.measures[last].label}`);
  }

  function scrubbable(el, axis) {
    let drag = null, pinch = null;
    const touches = new Map();
    const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    if (axis === 'x') {
      // Two-finger pinch on the sheet zooms it (iPad).
      const forget = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
      el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'touch') return;
        touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
        if (touches.size === 2) {
          if (drag) { clearTimeout(drag.hold); if (drag.active && !drag.select && !drag.pan) scrubEnd(); hideSelection(); el.classList.remove('selecting'); drag = null; }
          pinch = {dist: spread(), zoom};
        }
      }, true);
      el.addEventListener('pointermove', e => {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
        if (pinch && touches.size === 2) { e.preventDefault(); setZoom(pinch.zoom * spread() / pinch.dist); }
      }, true);
      for (const type of ['pointerup', 'pointercancel']) el.addEventListener(type, forget, true);
      el.addEventListener('gesturestart', e => e.preventDefault());
    }
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!song || !range || pinch) return;
      drag = {id: e.pointerId, x: e.clientX, y: e.clientY, active: false, t0: 0, select: null};
      const startSelect = ev => {
        if (!drag) return;
        stopAll();
        const at = measureAtPoint(axis, ev);
        drag.select = {from: at, to: at};
        drag.active = true;
        try { el.setPointerCapture(drag.id); } catch {}
        el.classList.add('selecting');
        showSelection(axis, at, at);
      };
      if (e.shiftKey || inRuler(e)) { e.preventDefault(); startSelect(e); return; }
      // Touch: hold still for a moment, then drag to select.
      clearTimeout(drag.hold);
      drag.hold = setTimeout(() => { if (drag && !drag.active) startSelect({clientX: drag.x, clientY: drag.y}); }, 450);
    });
    el.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id || pinch) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.pan) { e.preventDefault(); sheetHost.scrollTop = drag.pan.top - dy; return; }
      if (drag.select) {
        e.preventDefault();
        drag.select.to = measureAtPoint(axis, e);
        const {from, to} = drag.select;
        showSelection(axis, Math.min(from, to), Math.max(from, to));
        return;
      }
      if (!drag.active) {
        if (Math.hypot(dx, dy) < 6) return; // still a click (or a long-press in progress)
        clearTimeout(drag.hold);
        if (axis === 'x' && Math.abs(dy) > Math.abs(dx) && sheetHost.classList.contains('tall')) {
          drag.pan = {top: sheetHost.scrollTop}; drag.active = true;
          try { el.setPointerCapture(e.pointerId); } catch {}
          return;
        }
        if (!scrubBegin()) { drag = null; return; }
        drag.active = true; drag.t0 = scrub.t;
        try { el.setPointerCapture(e.pointerId); } catch {}
      }
      e.preventDefault();
      // Sheet: drag left = forward. Highway: drag down = back in time.
      scrubTo(axis === 'x' ? sheetTime(drag.t0, -dx) : highwayTime(drag.t0, dy));
    });
    const finish = e => {
      if (!drag || e.pointerId !== drag.id) return;
      clearTimeout(drag.hold);
      el.classList.remove('selecting');
      if (drag.select) {
        suppressClick = true;
        if (e.type === 'pointerup') commitSelection(drag.select.from, drag.select.to);
        else hideSelection();
      } else if (drag.pan) suppressClick = e.type === 'pointerup';
      else if (drag.active) { suppressClick = e.type === 'pointerup'; scrubEnd(); }
      drag = null;
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', finish);
    el.addEventListener('wheel', e => {
      if (!song || !range) return;
      if (e.ctrlKey) { // trackpad pinch (and ctrl+wheel) zooms the sheet
        if (axis === 'x') { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * .01)); }
        return;
      }
      // A zoomed-in sheet taller than the card scrolls vertically.
      if (axis === 'x' && sheetHost.classList.contains('tall') && Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey && !scrub) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
      if (!scrubBegin()) return;
      scrubTo(axis === 'x' ? sheetTime(scrub.t, delta) : highwayTime(scrub.t, delta));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(scrubEnd, 150);
    }, {passive: false});
  }
  scrubbable(q('#um-sheet'), 'x');
  scrubbable(q('#um-highway').closest('.highway') || q('#um-highway'), 'y');

  // ───────── App chrome ─────────
  window.addEventListener('pagehide', stopAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });

  q('#fullscreen-btn').onclick = () => {
    closePopovers();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const showFullscreen = () => { q('#fullscreen-btn span').textContent = document.fullscreenElement ? 'Leave full screen' : 'Full screen'; };
  document.addEventListener('fullscreenchange', showFullscreen);

  // "← Back" (#player-back) belongs to the shell: it fills the button and handles the click.

  // ───────── Popovers (tempo, ⋯, bar presets) ─────────
  // One open at a time; outside click or Escape closes; anchored to their button.
  const POPS = [['#tempo-btn', '#tempo-pop'], ['#more-btn', '#more-menu'], ['#section-btn', '#bars-pop']].map(([b, p]) => [q(b), q(p)]);
  function closePopovers() {
    let closed = false;
    for (const [btn, pop] of POPS) if (!pop.hidden) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); closed = true; }
    return closed;
  }
  for (const [btn, pop] of POPS) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = pop.hidden;
      closePopovers();
      if (!open) return;
      if (pop.id === 'bars-pop') showSmartMenu();
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      // Keep it on screen on narrow layouts.
      pop.style.removeProperty('--pop-shift');
      const r = pop.getBoundingClientRect(), pad = 8;
      const shift = r.left < pad ? pad - r.left : r.right > innerWidth - pad ? innerWidth - pad - r.right : 0;
      if (shift) pop.style.setProperty('--pop-shift', shift + 'px');
    });
  }
  document.addEventListener('pointerdown', e => {
    if (POPS.some(([btn, pop]) => !pop.hidden && (pop.contains(e.target) || btn.contains(e.target)))) return;
    closePopovers();
  }, true);

  // ───────── Theme (shared with the shell: localStorage + data-theme on <html>) ─────────
  function showTheme() {
    const attr = document.documentElement.dataset.theme;
    const t = attr === 'light' || attr === 'dark' ? attr : 'auto';
    const input = q(`input[name="menu-theme"][value="${t}"]`); if (input) input.checked = true;
    highway.refreshColors();
  }
  const setTheme = t => { setAppTheme(t); showTheme(); };
  root.querySelectorAll('input[name="menu-theme"]').forEach(i => i.onchange = () => setTheme(i.value));
  new MutationObserver(showTheme).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  window.addEventListener('storage', e => { if (e.key === THEME_KEY) setTheme(getTheme()); });
  window.addEventListener(THEME_EVENT, showTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => highway.refreshColors());

  // ───────── Sound ─────────
  // [sound] Settings rows + ⋯ microphone toggle (src/audio/sound-ui.js); mic notes enter like any key press.
  mountSoundSettings(root, piano, {onMicNote: (n, velocity, time) => userAttack(n, {source: 'mic', velocity, time}), onMicRelease: (n, time) => userRelease(n, time)});
  function setMuted(v) {
    piano.setMuted(v); save({muted: !!v});
    root.classList.toggle('muted', !!v);
    q('#mute-btn').checked = !v;
  }
  q('#mute-btn').onchange = () => setMuted(!q('#mute-btn').checked);

  // ───────── Settings ─────────
  const settingsModal = q('#settings');
  function applySettings(st) {
    const view = viewHinted || (VIEWS.includes(st.view) ? st.view : 'sheet'); // score first (DESIGN.md)
    root.dataset.view = view;
    root.dataset.labels = ['none', 'c', 'all'].includes(st.labels) ? st.labels : 'c';
    root.classList.toggle('no-hands', st.hands === false);
    settingsModal.querySelector(`input[name="view"][value="${view}"]`).checked = true;
    q(`input[name="menu-view"][value="${view}"]`).checked = true;
    q('#um-page').hidden = view !== 'pages';
    // The strategy tag sits in the score card's head, or over the falling notes.
    const tag = q('#um-strategy');
    if (view === 'falling') q('#built-in-panel .view').append(tag); else q('#um-page').before(tag);
    holdPagesAwake(view === 'pages');
    page = -1; manualPage = null;
    settingsModal.querySelector(`input[name="labels"][value="${root.dataset.labels}"]`).checked = true;
    q('#set-hands').checked = st.hands !== false;
    root.classList.toggle('show-names', !!st.names);
    q('#set-names').checked = !!st.names;
    q('#names-btn').checked = !!st.names;
    root.dataset.playhead = st.playhead === 'left' ? 'left' : 'center';
    settingsModal.querySelector(`input[name="playhead"][value="${root.dataset.playhead}"]`).checked = true;
    root.dataset.pedal = st.pedal === false ? 'off' : 'on';
    q('#set-pedal').checked = st.pedal !== false;
    highway.layout();
    requestAnimationFrame(layoutSheet);
  }
  function setLoop(v) {
    loop = v; save({loop}); root.classList.toggle('looping', loop);
    q('#sec-loop').checked = loop; q('#set-loop').checked = loop;
  }
  const closeSettings = () => { if (settingsModal.hidden) return; settingsModal.hidden = true; cancelCalibration(); settingsFocus.closed(); };
  const settingsFocus = modalFocus(settingsModal, closeSettings);
  q('#settings-btn').onclick = () => {
    const opener = q('#more-btn');
    closePopovers(); opener.focus({preventScroll: true});
    settingsFocus.open(); settingsModal.hidden = false; settingsFocus.focusFirst();
  };
  q('#settings-close').onclick = closeSettings;
  settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
  settingsModal.querySelectorAll('input[name="view"],input[name="labels"],input[name="playhead"]').forEach(input => input.onchange = () => {
    if (input.name === 'view') viewHinted = false; // the student's own choice beats a piece's hint
    save({[input.name]: input.value}); applySettings(load()); if (input.name === 'view') draw();
  });
  q('#set-hands').onchange = () => { save({hands: q('#set-hands').checked}); applySettings(load()); };
  q('#set-loop').onchange = () => setLoop(q('#set-loop').checked);
  const setNames = v => { save({names: !!v}); applySettings(load()); };
  q('#set-names').onchange = () => setNames(q('#set-names').checked);
  q('#names-btn').onchange = () => setNames(q('#names-btn').checked);
  root.querySelectorAll('input[name="menu-view"]').forEach(input => input.onchange = () => { viewHinted = false; save({view: input.value}); applySettings(load()); draw(); });
  q('#set-pedal').onchange = () => { save({pedal: q('#set-pedal').checked}); applySettings(load()); };

  // ───────── Latency calibration (Settings) ─────────
  // Eight clicks at 100 BPM; the user taps along on the piano, the on-screen
  // pad or any computer key. The median offset (after two run-in clicks) is
  // the input + audio latency, taken off every play-along note.
  let calib = null;
  const CALIB_CLICKS = 8, CALIB_MS = 600;
  function showLatency() {
    q('#lat-value').textContent = `${latencyMs} ms`;
  }
  function setLatency(ms) { latencyMs = clampLatency(ms); save({latencyMs}); showLatency(); }
  function startCalibration() {
    stopAll();
    piano.load();
    const panel = q('#lat-panel');
    panel.hidden = false;
    const dots = q('#lat-dots');
    dots.replaceChildren(...Array.from({length: CALIB_CLICKS}, () => document.createElement('i')));
    const t0 = performance.now() + 700;
    calib = {clicks: Array.from({length: CALIB_CLICKS}, (_, i) => t0 + i * CALIB_MS), taps: [], timers: []};
    calib.clicks.forEach((t, i) => {
      piano.click(Math.max(0, (t - performance.now()) / 1000), i % 4 === 0);
      calib.timers.push(setTimeout(() => dots.children[i]?.classList.add('on'), t - performance.now()));
    });
    q('#lat-text').textContent = 'Listen for two clicks, then tap with each one…';
    calib.timers.push(setTimeout(finishCalibration, calib.clicks.at(-1) - performance.now() + CALIB_MS));
  }
  function calibTap(time) {
    if (!calib) return;
    calib.taps.push(time);
    const pad = q('#lat-pad');
    pad.classList.remove('tap'); void pad.offsetWidth; pad.classList.add('tap');
  }
  function finishCalibration() {
    if (!calib) return;
    const res = measureLatency(calib.clicks, calib.taps);
    calib.timers.forEach(clearTimeout);
    calib = null;
    if (!res) { q('#lat-text').textContent = 'Not enough taps to measure. Try again.'; return; }
    setLatency(res.ms);
    q('#lat-text').textContent = res.spread > 40 ? `About ${res.ms} ms, but the taps were uneven (±${res.spread} ms). Try again for a steadier figure.`
      : `Measured ${res.ms} ms (±${res.spread} ms). Play along now allows for it.`;
  }
  function cancelCalibration() { if (calib) { calib.timers.forEach(clearTimeout); calib = null; piano.stopClicks(); } q('#lat-panel').hidden = true; }
  // Settings → Diagnostics (src/diagnostics/): a sheet that stands in for Settings while open.
  mountDiagnostics(root, {piano, midiAccess: () => midiAccess, latencyMs: () => latencyMs,
    closeSettings: () => { settingsModal.hidden = true; cancelCalibration(); },
    openSettings: () => { settingsModal.hidden = false; }});
  q('#lat-calibrate').onclick = startCalibration;
  q('#lat-again').onclick = startCalibration;
  q('#lat-reset').onclick = () => { setLatency(0); q('#lat-text').textContent = 'Latency set to 0 ms.'; };
  q('#lat-done').onclick = cancelCalibration;
  q('#lat-pad').addEventListener('pointerdown', e => { e.preventDefault(); calibTap(e.timeStamp || performance.now()); });

  // ───────── Practice options ─────────
  function setHands(h, {persist = true} = {}) {
    if (!HANDS.includes(h)) return;
    const changed = h !== hands;
    hands = h;
    root.classList.toggle('hands-right', h === 'right');
    root.classList.toggle('hands-left', h === 'left');
    const input = q(`input[name="sec-hands"][value="${h}"]`); if (input) input.checked = true;
    if (persist) saveSong({hands: h});
    if (!changed || !song || !range) return;
    if (practicing) startPractice();
    else { draw(); if (!playing) setPrompt(promptIdle()); }
  }
  function setMode(m, {persist = true} = {}) {
    if (m !== 'wait' && m !== 'timed') return;
    const changed = m !== mode;
    mode = m; if (persist) save({mode: m});
    const input = q(`input[name="sec-mode"][value="${m}"]`); if (input) input.checked = true;
    if (changed && practicing) stopAll();
    if (changed && song && !playing) { setStatus(sectionLabel()); setPrompt(promptIdle()); }
    setButtons();
  }
  function setMetronome(v) {
    metronome = !!v; save({metronome});
    q('#metro-btn').checked = metronome;
    q('#menu-metro').checked = metronome;
    q('#set-metro').checked = metronome;
    root.classList.toggle('metro-on', metronome);
    showTempo();
    if (!metronome) piano.stopClicks();
    refreshFreeClick();
  }
  function setSpeedUp(v) {
    speedUp = !!v; save({speedUp});
    q('#sec-speed').checked = speedUp;
    showTempo();
  }
  function setZoom(z) {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +z || 1));
    if (Math.abs(z - 1) < .04) z = 1;
    zoom = Math.round(z * 100) / 100; save({zoom});
    root.style.setProperty('--sheet-zoom', zoom);
    q('#zoom-level').textContent = Math.round(zoom * 100) + '%';
    requestAnimationFrame(layoutSheet);
  }
  root.querySelectorAll('input[name="sec-hands"]').forEach(i => i.onchange = () => setHands(i.value));
  root.querySelectorAll('input[name="sec-mode"]').forEach(i => i.onchange = () => setMode(i.value));
  q('#sec-speed').onchange = () => setSpeedUp(q('#sec-speed').checked);
  q('#metro-btn').onchange = () => setMetronome(q('#metro-btn').checked);
  q('#menu-metro').onchange = () => setMetronome(q('#menu-metro').checked);
  q('#set-metro').onchange = () => setMetronome(q('#set-metro').checked);
  q('#set-metro-wait').onchange = () => { metroInWait = q('#set-metro-wait').checked; save({metroInWait}); refreshFreeClick(); };
  q('#set-metro-vol').oninput = () => { const v = +q('#set-metro-vol').value / 100; piano.setClickVolume(v); save({metroVolume: v}); };
  q('#zoom-in').onclick = () => setZoom(zoom * 1.2);
  q('#zoom-out').onclick = () => setZoom(zoom / 1.2);

  // ───────── Songs ─────────
  let current = null, loadToken = 0;
  const saveSong = v => { if (current?.id != null) write(SONG_STORE(current.id), v); };
  const clampTempo = v => Math.max(+q('#um-tempo').min || 20, Math.min(+q('#um-tempo').max || 160, Math.round(v)));

  // Default section: the catalog's, else the first 4 measures (plus a
  // pickup), or the whole piece when it is short.
  function defaultSection(entry) {
    const n = song.measures.length;
    const valid = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a <= b && b < n;
    const saved = read(SONG_STORE(entry.id));
    if (valid(saved.first, saved.last)) return [saved.first, saved.last];
    const [a, b] = Array.isArray(entry.section) ? entry.section.map(Number) : [];
    if (valid(a, b)) return [a, b];
    if (n <= 8) return [0, n - 1];
    return [0, Math.min(n - 1, song.measures[0].pickup ? 4 : 3)];
  }
  // Speed trainer goal: the catalog's tempo, else the score's.
  const targetTempo = () => clampTempo(+current?.tempo > 0 ? +current.tempo : song?.tempo > 0 ? song.tempo : 100);
  function defaultTempo(entry) {
    for (const v of [read(SONG_STORE(entry.id)).tempo, entry.tempo, song.tempo]) if (+v > 0) return clampTempo(+v);
    return 60;
  }

  function showLoading(entry) {
    unmountSheet();
    song = null; range = null; points = []; pos = 0; finished = false; matched.clear(); grades.clear();
    keyboardRange = '';
    q('#lesson-title').textContent = entry.title || 'Untitled';
    q('#lesson-title').title = entry.title || '';
    q('#lesson-composer').textContent = entry.composer || '';
    q('#lesson-subtitle').textContent = 'Loading…';
    q('#sec-first').value = q('#sec-last').value = ''; q('#sec-of').textContent = '';
    q('#um-progress').style.width = '0%';
    q('#um-count').replaceChildren();
    q('#um-measure').textContent = ''; q('#um-detail').textContent = '';
    root.querySelectorAll('.pkey').forEach(b => b.classList.remove('held', 'attack'));
    chain = null; phrases = []; barTally = new BarTally(); trouble = new Map(); showStrategy();
    setStatus(''); setPrompt('Opening the score…');
    root.classList.add('loading');
    root.classList.remove('load-error');
  }

  function showSong(entry, s) {
    song = s;
    const notes = song.events.map(e => e.n);
    defaultLow = whiteBelow(Math.max(21, Math.min(48, Math.min(...notes) - 1)));
    defaultHigh = whiteAbove(Math.min(108, Math.max(72, Math.max(...notes) + 1)));
    q('#um-tempo').value = defaultTempo(entry);
    if (strategy === 'ladder') q('#um-tempo').value = ladderRungs(targetTempo())[0];
    showTempo();
    phrases = detectPhrases({measures: song.measures, events: song.events, slurs: song.marks?.slurs ?? []});
    const savedHands = read(SONG_STORE(entry.id)).hands;
    setHands(HANDS.includes(savedHands) ? savedHands : 'both', {persist: false});
    root.classList.remove('loading');
    buildKeyboard();
    mountSheet();
    const [first, last] = defaultSection(entry);
    setRange(first, last);
    refreshTrouble();
    holdPagesAwake(root.dataset.view === 'pages');
    recording.loaded(entry);
    if (harmonyOn) ensureHarmony();
    const sl = setlistPosition(entry.id);
    if (sl) setStatus(`${sl.name} · ${sl.index + 1} of ${sl.total}`);
  }

  function showError(entry, err) {
    root.classList.remove('loading');
    root.classList.add('load-error');
    q('#lesson-subtitle').textContent = 'Could not load';
    setStatus('');
    setPrompt(`Could not load <b>${escapeHtml(entry.title || 'this song')}</b>: ${escapeHtml(err?.message || err || 'unknown error')}`);
  }

  // An entry may ask for a practice mode and Listen | Practise choice (sight-reading pieces: Play
  // along, Practise). The hint holds for that piece only and is never saved; the next piece without
  // hints gets the student's own saved choice back. Choosing differently while on the piece saves
  // that choice as usual.
  // A `view: 'sheet'` hint (sight-reading) turns falling notes into the score for that piece only;
  // `view: 'falling'` (a MIDI import whose timing was too loose for a clean score) does the reverse.
  let viewHinted = false;
  function applyEntryHints(entry) {
    const st = load();
    const m = entry?.mode === 'timed' || entry?.mode === 'wait' ? entry.mode : st.mode === 'timed' ? 'timed' : 'wait';
    const i = entry?.intent === 'practice' || entry?.intent === 'listen' ? entry.intent : st.intent === 'practice' ? 'practice' : 'listen';
    setMode(m, {persist: false});
    setIntent(i, {persist: false});
    const want = entry?.view === 'sheet' && (!VIEWS.includes(st.view) || st.view === 'falling') ? 'sheet'
      : entry?.view === 'falling' && st.view !== 'falling' ? 'falling' : false;
    if (want !== viewHinted) { viewHinted = want; applySettings(st); }
  }

  // Swap to another song. Only the most recent call wins.
  async function loadEntry(entry, songPromise) {
    const token = ++loadToken;
    recording.leaving();
    stopAll(); hideResults();
    // A practice strategy belongs to the passage it was chosen for: a new piece starts plain
    // (a memory check carried over would open an unseen piece with its score hidden).
    if (current?.id !== entry?.id) setStrategy('off');
    current = entry;
    piano.load();
    showFavourite();
    applyEntryHints(entry);
    piano.setSong(entry); // [sound] Auto instrument (harpsichord for Baroque)
    showLoading(entry);
    let s;
    try { s = await songPromise; } catch (err) {
      if (token === loadToken) showError(entry, err);
      return null;
    }
    if (token !== loadToken) return null;
    try { showSong(entry, s); } catch (err) {
      song = null; range = null; unmountSheet();
      showError(entry, err);
      return null;
    }
    return s;
  }

  // ───────── Boot ─────────
  const saved = load();
  const urlView = new URLSearchParams(location.search).get('view');
  if (urlView) saved.view = urlView;
  setLoop(!!saved.loop);
  setMuted(!!saved.muted);
  intent = saved.intent === 'practice' ? 'practice' : 'listen';
  setMode(saved.mode === 'timed' ? 'timed' : 'wait');
  metroInWait = !!saved.metroInWait; q('#set-metro-wait').checked = metroInWait;
  const metroVolume = saved.metroVolume != null && Number.isFinite(+saved.metroVolume) ? +saved.metroVolume : .6;
  piano.setClickVolume(metroVolume); q('#set-metro-vol').value = Math.round(metroVolume * 100);
  setMetronome(!!saved.metronome);
  setSpeedUp(!!saved.speedUp);
  setZoom(+saved.zoom || 1);
  setHarmony(!!saved.harmony, {persist: false});
  loadCollections().then(showFavourite).catch(() => {});
  latencyMs = clampLatency(saved.latencyMs); showLatency();
  // The piano samples load with the first piece opened (loadEntry), not while Today renders.
  applySettings(saved);
  showTheme(); showFullscreen();
  setButtons();
  buildKeyboard();
  highway.start();
  requestAnimationFrame(scrollSheet);

  function stopPublic() {
    holdPagesAwake(false); // leaving the player; reacquired when a song opens in Pages view
    recording.leaving();
    const busy = playing || practicing;
    stopAll(); hideResults();
    if (busy && song) { setStatus(sectionLabel()); setPrompt(promptIdle()); }
  }

  // ───────── Teacher hooks (window.pianoPlayer) ─────────
  // Setters run through the same code paths as the UI and return getState().
  function getState() {
    return {
      songId: current?.id ?? null, title: current?.title || song?.title || '', composer: current?.composer || song?.composer || '',
      section: range ? [range.first, range.last] : null, sectionLabel: song && range ? sectionLabel() : '',
      measureCount: song?.measures.length ?? 0, tempo: tempo(), targetTempo: song ? targetTempo() : null,
      mode, hands, view: root.dataset.view, playing, practicing, loop,
      strategy, chain: chain ? {dir: chain.dir, section: [chain.first, chain.last], goal: [...chain.goal]} : null, latencyMs,
    };
  }
  const int = v => (v !== null && v !== '' && Number.isFinite(+v) ? Math.round(+v) : NaN);
  window.pianoPlayer = {
    getState,
    setSection(first, last = first) {
      if (!song) return getState();
      const n = song.measures.length;
      let a = int(first), b = int(last);
      if (Number.isNaN(a)) return getState();
      if (Number.isNaN(b)) b = a;
      a = Math.max(0, Math.min(n - 1, a)); b = Math.max(0, Math.min(n - 1, b));
      if (a > b) [a, b] = [b, a];
      setRange(a, b);
      return getState();
    },
    setTempo(bpm) { if (Number.isFinite(+bpm) && +bpm > 0) setTempoValue(+bpm); return getState(); },
    setHands(h) { setHands(String(h).toLowerCase()); return getState(); },
    setMode(m) { m = String(m).toLowerCase(); setMode(m === 'play-along' || m === 'playalong' || m === 'timed' ? 'timed' : m); return getState(); },
    setLoop(v) { setLoop(!!v); return getState(); },
    setStrategy(v) { setStrategy(String(v).toLowerCase()); return getState(); },
    listen() { if (song && !playing) { if (practicing) stopAll(); intent = 'listen'; save({intent}); startListen(); } return getState(); },
    practice() { if (song) { intent = 'practice'; save({intent}); startPractice(); } return getState(); },
    stop() { stopPublic(); return getState(); },
  };

  return {
    load: loadEntry,
    stop: stopPublic,
    get current() { return current; },
  };
}
