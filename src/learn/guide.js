// "Learn a piece, guided" inside the player (docs/ROADMAP.md, Phase 12).
//
//   const learn = attachLearn(api)   (src/player.js passes a few internals, see there)
//   learn.loaded(entry, song, phrases) · leaving() · refresh() · listened([first, last])
//
// - The plan (./plan.mjs): one quiet "Next step" button under the stage. It sets the step up
//   through window.pianoPlayer (section, hands, mode, tempo, strategy); once set up, it starts
//   it. A practice:result (or a finished listen) that meets the step ticks it off.
//   Started from Bars ▾ → "Learn this piece, step by step" or from the first-look card.
// - The first-look card (./first-look.mjs): before the first play of a piece, key, time,
//   tempo, hand range and tricky bars, with "Listen first". Dismissed once, never shown again.
//
// Storage: per-song localStorage `piano-practice:song:<id>` gains `learnOn`, `learnDone`
// (step keys) and `firstLookSeen`; the window event `learn:step` (docs/ARCHITECTURE.md) is
// recorded by the progress store (totals.learn) so Today and other devices see the plan.
// Today asks the player to set up the current step with sessionStorage `piano-practice.learn.apply`.
import './learn.css';
import {buildPlan, currentStep, planProgress, resultMeets, listenMeets, isSetUp, listenSpan} from './plan.mjs';
import {firstLook} from './first-look.mjs';
import {getProgress} from '../progress/store.js';

export const APPLY_KEY = 'piano-practice.learn.apply';
const SONG_STORE = id => 'piano-practice:song:' + id;
const read = key => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } };
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify({...read(key), ...v})); } catch {} };
const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, {detail}));
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const NOOP = {loaded() {}, leaving() {}, refresh() {}, listened() {}};

/** Pieces with a plan and a first look: not exercises or generated sight-reading. */
export const learnable = id => !!id && !/^(ex|sr):/.test(String(id));

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

export function attachLearn(api) {
  const {root} = api;
  const q = s => root.querySelector(s);
  const btn = q('#learn-next'), toggle = q('#learn-toggle'), stage = q('#built-in-panel .view');
  if (!btn || !toggle || !stage) return NOOP;
  const player = () => window.pianoPlayer;
  let entry = null, song = null, steps = [], done = new Set(), on = false, card = null, token = 0;

  const id = () => entry?.id;
  const save = v => { if (id() != null) write(SONG_STORE(id()), v); };
  const target = () => player()?.getState?.().targetTempo || 100;
  const nextInfo = () => { const s = currentStep(steps, done); return s ? {key: s.key, label: `${s.label} · ${s.detail}`} : null; };
  const record = (action, key) => emit('learn:step', {
    songId: id(), title: entry?.title || '', action, ...(key ? {key} : {}), total: steps.length, next: nextInfo(), at: Date.now(),
  });

  // ───── the one affordance ─────
  function refresh() {
    const cur = on && song ? currentStep(steps, done) : null;
    toggle.hidden = !song || !learnable(id()) || !steps.length;
    const meta = toggle.querySelector('.preset-meta');
    if (on && steps.length) {
      const p = planProgress(steps, done);
      toggle.firstChild.textContent = 'Leave the step-by-step plan';
      meta.textContent = cur ? `step ${p.index + 1} of ${p.total}` : 'all done';
    } else {
      toggle.firstChild.textContent = 'Learn this piece, step by step';
      meta.textContent = steps.length ? `${steps.length} short steps` : '';
    }
    btn.hidden = !cur;
    if (!cur) return;
    const st = player()?.getState?.();
    const ready = isSetUp(cur, st);
    const p = planProgress(steps, done);
    btn.classList.toggle('is-ready', ready);
    btn.disabled = !!(st?.playing || st?.practicing) && ready;
    // The phrase, not the whole count: "162 steps" would daunt anyone.
    const where = cur.kind === 'whole' ? 'Last step' : cur.phrases > 1 ? `Phrase ${cur.phrase + 1} of ${cur.phrases}` : `Step ${p.index + 1} of ${p.total}`;
    btn.querySelector('.learn-step').textContent = ready ? where : 'Next step';
    btn.querySelector('.learn-what').textContent = cur.label;
    btn.title = `${cur.label} · ${cur.detail}`;
    btn.setAttribute('aria-label', ready ? `Start step ${p.index + 1} of ${p.total}: ${cur.label}, ${cur.detail}` : `Next step: ${cur.label}, ${cur.detail}`);
  }

  function setUp(step) {
    const pp = player();
    if (!pp || !song) return;
    pp.stop();
    pp.setSection(step.section[0], step.section[1]);
    pp.setHands(step.hands);
    pp.setMode(step.mode);
    if (pp.getState().strategy !== step.strategy) pp.setStrategy(step.strategy);
    pp.setTempo(step.tempo);
    if (step.intent === 'listen') api.setLoop(false);
    api.setIntent(step.intent);
    api.setPrompt(`${escapeHtml(step.hint || step.label)} · press <b class="glyph">▶</b>`);
    api.setStatus(step.detail);
    refresh();
  }
  function start(step) {
    const pp = player();
    if (!pp) return;
    if (step.intent === 'listen') pp.listen(); else pp.practice();
  }
  btn.addEventListener('click', () => {
    const cur = on ? currentStep(steps, done) : null;
    if (!cur) return;
    if (isSetUp(cur, player()?.getState?.())) start(cur); else setUp(cur);
  });

  function startPlan({apply = true} = {}) {
    if (!steps.length) return;
    on = true;
    save({learnOn: true});
    record('start');
    hideCard();
    const cur = currentStep(steps, done);
    if (apply && cur) setUp(cur);
    else refresh();
  }
  function stopPlan() {
    on = false;
    save({learnOn: false});
    record('stop');
    api.flash('Plan put aside. Your steps are kept.');
    refresh();
  }
  toggle.addEventListener('click', () => {
    api.closePopovers();
    if (on) stopPlan(); else startPlan();
  });

  function markDone(step) {
    done.add(step.key);
    save({learnDone: [...done]});
    record('done', step.key);
    const next = currentStep(steps, done);
    if (next) {
      api.flash('Step done.');
      api.setPrompt(`Step done · next: <b>${escapeHtml(next.label)}</b> · <i>${escapeHtml(next.detail)}</i>`);
    } else {
      api.flash('Learnt, step by step.');
      api.setPrompt('Every step done: the piece is learnt. Now keep it polished.');
    }
    refresh();
  }

  window.addEventListener('practice:result', e => {
    const d = e.detail;
    if (!entry || d?.songId !== id()) return;
    if (card) hideCard(); // played: no first look needed any more
    const cur = on ? currentStep(steps, done) : null;
    if (cur && resultMeets(cur, d)) markDone(cur);
  });

  // ───── first look ─────
  function hideCard() {
    if (!card) return;
    card.remove(); card = null;
    save({firstLookSeen: true});
  }
  function showCard(info) {
    hideCard();
    const pp = player();
    const rows = [['Key', info.key], ['Time', info.meter], ['Tempo', info.tempo ? `♩ = ${info.tempo}` : 'your own'],
      info.ranges.r ? ['Right hand', info.ranges.r] : null, info.ranges.l ? ['Left hand', info.ranges.l] : null].filter(Boolean);
    const listen = () => {
      hideCard();
      if (!pp || !song) return;
      const [a, b] = listenSpan(song.measures, info.tempo || pp.getState().tempo);
      pp.setSection(a, b);
      if (info.tempo) pp.setTempo(info.tempo);
      pp.setHands('both');
      pp.listen();
    };
    card = h('section', {class: 'first-look', 'aria-labelledby': 'first-look-h'},
      h('button', {type: 'button', class: 'fl-close', 'aria-label': 'Close the first look', title: 'Close', onclick: hideCard}, '×'),
      h('p', {class: 'fl-kicker', text: 'First look'}),
      h('h2', {class: 'fl-title', id: 'first-look-h', text: entry.title || 'This piece'}),
      h('dl', {class: 'fl-facts'}, rows.map(([k, v]) => h('div', {}, h('dt', {text: k}), h('dd', {text: v})))),
      info.tricky.length ? h('div', {class: 'fl-tricky'},
        h('p', {class: 'fl-sub', text: 'Bars to watch'}),
        h('ul', {role: 'list'}, info.tricky.map(t => h('li', {},
          h('button', {type: 'button', class: 'fl-bar', title: `Practise ${t.label.toLowerCase()}`, onclick: () => { hideCard(); pp?.setSection(t.index, t.index); }}, t.label),
          h('span', {class: 'fl-why', text: t.reasons.join(', ')}))))) : null,
      h('div', {class: 'fl-actions'},
        h('button', {type: 'button', class: 'primary-btn', onclick: listen}, 'Listen first'),
        steps.length ? h('button', {type: 'button', class: 'quiet-btn', onclick: () => startPlan()}, 'Learn it step by step') : null));
    card.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); hideCard(); } });
    stage.append(card);
  }

  // ───── songs ─────
  function loaded(e, s, phrases) {
    const mine = ++token;
    hideCardQuiet();
    entry = e; song = s; steps = []; done = new Set(); on = false;
    if (!learnable(e?.id) || !s) { refresh(); return; }
    steps = buildPlan({phrases, measures: s.measures, events: s.events}, {target: target()});
    const local = read(SONG_STORE(e.id));
    done = new Set(Array.isArray(local.learnDone) ? local.learnDone : []);
    on = !!local.learnOn;
    let apply = false;
    try { apply = sessionStorage.getItem(APPLY_KEY) === e.id; if (apply) sessionStorage.removeItem(APPLY_KEY); } catch {}
    refresh();
    // Steps done on another device (the dev server's progress), and whether this piece was ever played.
    getProgress().catch(() => null).then(doc => {
      if (mine !== token) return;
      const plan = doc?.totals?.learn?.[e.id];
      if (plan) {
        for (const k of plan.done || []) done.add(k);
        if (local.learnOn === undefined && plan.active) on = true;
      }
      if (apply) { if (!on) { on = true; save({learnOn: true}); } const cur = currentStep(steps, done); if (cur) setUp(cur); }
      else refresh();
      const played = !!doc?.totals?.songs?.[e.id]?.attempts || (doc?.events || []).some(x => x.type === 'practice:result' && x.songId === e.id);
      if (!local.firstLookSeen && !played && !on && !apply) {
        const tempo = +e.tempo > 0 ? +e.tempo : s.tempo > 0 ? s.tempo : null;
        try { showCard(firstLook(s, {tempo})); } catch (err) { console.warn('First look unavailable:', err); }
      }
    });
  }
  // Leaving a piece isn't dismissing its first look.
  function hideCardQuiet() { if (card) { card.remove(); card = null; } }
  function leaving() { token++; hideCardQuiet(); entry = null; song = null; steps = []; refresh(); }
  // Today's "Next step" for the piece already open in the player (it isn't loaded again).
  window.addEventListener('hashchange', () => {
    if (!song || !learnable(id()) || !steps.length) return;
    try { if (sessionStorage.getItem(APPLY_KEY) !== id()) return; sessionStorage.removeItem(APPLY_KEY); } catch { return; }
    if (!on) { on = true; save({learnOn: true}); record('start'); }
    const cur = currentStep(steps, done);
    if (cur) setUp(cur); else refresh();
  });

  function listened(section) {
    const cur = on ? currentStep(steps, done) : null;
    if (cur && listenMeets(cur, section)) markDone(cur);
  }

  return {loaded, leaving, refresh, listened};
}
