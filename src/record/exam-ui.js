// Mock exam (docs/ROADMAP.md Phase 9, P2): choose two or three pieces, a scale and (when the
// sight-reading generator exists) a sight-reading slot; perform them in order without stopping
// (each one recorded and compared with its score in the player); then a results sheet with
// marks per item, written like an exam report (./exam.mjs), saved with the recordings.
//
//   openExamSetup()            the setup dialog (from Progress → Recordings)
//   createExamRunner(ctl)      drives the exam inside the player (src/record/player-ui.js)
//   openExamSheet(sheet)       the results sheet (printable)
import './record.css';
import {el} from '../app/dom.js';
import {newId} from './take.mjs';
import {examResults, ITEM_MAX} from './exam.mjs';
import * as store from './store.js';

// 'Johann Sebastian Bach (Notebook for Anna Magdalena Bach)' → 'Bach'; 'Christian Petzold (attr.)' → 'Petzold'.
const surnameOf = composer => String(composer).replace(/\(.*?\)/g, '').trim().split(/\s+/).at(-1);
import {dropHashParam} from './hash.js';

const ACTIVE = 'piano-practice.recordings.exam-active';
const KEYS = [['C', 'C'], ['G', 'G'], ['D', 'D'], ['A', 'A'], ['E', 'E'], ['B', 'B'], ['Fs', 'F♯'], ['F', 'F'], ['Bb', 'B♭'], ['Eb', 'E♭'], ['Ab', 'A♭'], ['Db', 'D♭']];
const KIND_LABEL = {piece: 'Piece', scale: 'Scale', 'sight-reading': 'Sight-reading'};
const playHref = (id, examId) => '#/play/' + encodeURIComponent(id) + (examId ? '?exam=' + examId : '');
// The exercises module's sight-reading generator, when it exists (src/sightread/).
const SIGHT = import.meta.glob('../sightread/index.js');

const readActive = () => { try { const v = JSON.parse(localStorage.getItem(ACTIVE)); return v && v.id && Array.isArray(v.items) ? v : null; } catch { return null; } };
const writeActive = v => { try { if (v) localStorage.setItem(ACTIVE, JSON.stringify(v)); else localStorage.removeItem(ACTIVE); } catch {} };
export const activeExam = readActive;

/** The sight-reading generator (src/sightread/: SR_LEVELS, sightReadingId(level), resolveSightReading), or null. */
export async function sightReading() {
  const load = SIGHT['../sightread/index.js'];
  if (!load) return null;
  try {
    const m = await load();
    if (typeof m.sightReadingId !== 'function' || !Array.isArray(m.SR_LEVELS) || !m.SR_LEVELS.length) return null;
    const probe = m.sightReadingId(m.SR_LEVELS[0].id);
    if (typeof m.resolveSightReading === 'function' && !m.resolveSightReading(probe)) return null;
    return m;
  } catch { return null; }
}

export const scaleId = (key, quality) => `ex:scale:${key}:${quality}:both:2:up-down`;
export const scaleTitle = (key, quality) => `${KEYS.find(k => k[0] === key)?.[1] ?? key} ${quality} scale`;

// ───── setup ─────
export async function openExamSetup() {
  let library = [], recent = [];
  try {
    const cat = await import('../app/catalog.js');
    const c = await cat.loadCatalogs();
    library = [...c.bundled, ...c.local].filter(e => !String(e.id).startsWith('ex:'));
  } catch {}
  try {
    const [{getProgress}, {songStats}] = await Promise.all([import('../progress/store.js'), import('../progress/stats.js')]);
    recent = songStats(await getProgress()).map(s => s.id).filter(id => library.some(e => e.id === id));
  } catch {}
  const sr = await sightReading();
  const defaults = [...new Set([...recent, ...library.map(e => e.id)])].slice(0, 3);
  const prev = document.activeElement;

  const pieceSelect = (i, value) => el('select', {class: 'rec-select', name: 'piece' + i, 'aria-label': `Piece ${i + 1}`},
    i === 2 ? el('option', {value: '', text: '— none —'}) : null,
    library.map(e => { const o = el('option', {value: e.id, text: `${e.title}${e.composer ? ' · ' + surnameOf(e.composer) : ''}`}); if (e.id === value) o.selected = true; return o; }));
  const form = el('form', {class: 'rec-setup', onsubmit: e => { e.preventDefault(); begin(new FormData(form)); }},
    el('p', {class: 'rec-kicker', text: 'Mock exam'}),
    el('h2', {class: 'rec-piece', id: 'rec-setup-title', text: 'Your programme'}),
    el('p', {class: 'rec-setup-note', text: 'Each item is played once, in order, without stopping, and recorded. Then you get a results sheet.'}),
    el('fieldset', {class: 'rec-field'}, el('legend', {class: 'rec-label', text: 'Pieces (two or three)'}),
      [0, 1, 2].map(i => pieceSelect(i, i < 2 ? defaults[i] : defaults[2] ?? ''))),
    el('fieldset', {class: 'rec-field rec-field-row'}, el('legend', {class: 'rec-label', text: 'Scale'}),
      el('select', {class: 'rec-select', name: 'key', 'aria-label': 'Scale key'}, KEYS.map(([v, l]) => el('option', {value: v, text: l}))),
      el('select', {class: 'rec-select', name: 'quality', 'aria-label': 'Major or minor'}, el('option', {value: 'major', text: 'major'}), el('option', {value: 'minor', text: 'minor'})),
      el('span', {class: 'rec-setup-note', text: 'hands together, two octaves'})),
    el('fieldset', {class: 'rec-field'}, el('legend', {class: 'rec-label', text: 'Sight-reading'}),
      sr ? el('div', {class: 'rec-field-row rec-sight'},
        el('label', {class: 'rec-check'}, el('input', {type: 'checkbox', name: 'sight', checked: true}), ' A short piece you haven’t seen, at'),
        el('select', {class: 'rec-select', name: 'srLevel', 'aria-label': 'Sight-reading level'}, sr.SR_LEVELS.map(l => el('option', {value: l.id, text: l.name}))))
        : el('p', {class: 'rec-setup-note', text: 'Not available yet: the sight-reading generator isn’t installed, so this slot is skipped.'})),
    el('p', {class: 'rec-message', role: 'status'}),
    el('div', {class: 'rec-actions'},
      el('button', {class: 'primary-btn', type: 'submit', text: 'Begin the exam'}),
      el('button', {class: 'quiet-btn', type: 'button', text: 'Cancel', onclick: () => close()})));
  const modal = el('div', {class: 'rec-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rec-setup-title'}, el('div', {class: 'rec-modal-card'}, form));
  const onKey = modalKeys(() => modal, () => close());
  function close() { modal.remove(); window.removeEventListener('keydown', onKey, true); try { prev?.focus?.(); } catch {} }
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(modal);
  form.querySelector('select')?.focus();
  if (!library.length) { form.querySelector('.rec-message').textContent = 'The library couldn’t be loaded.'; return {close}; }

  function begin(data) {
    const ids = [data.get('piece0'), data.get('piece1'), data.get('piece2')].filter(Boolean);
    if (new Set(ids).size !== ids.length) { form.querySelector('.rec-message').textContent = 'Choose different pieces.'; return; }
    const titleOf = id => library.find(e => e.id === id)?.title || id;
    const items = ids.map(id => ({kind: 'piece', songId: id, title: titleOf(id)}));
    items.push({kind: 'scale', songId: scaleId(data.get('key'), data.get('quality')), title: scaleTitle(data.get('key'), data.get('quality'))});
    if (sr && data.get('sight')) {
      const level = sr.SR_LEVELS.find(l => l.id === data.get('srLevel')) ?? sr.SR_LEVELS[0];
      items.push({kind: 'sight-reading', songId: sr.sightReadingId(level.id), title: `Sight-reading · ${level.name}`});
    }
    const exam = {id: newId(), at: Date.now(), name: 'Mock exam', items, index: 0, takes: [], reports: []};
    writeActive(exam);
    close();
    location.hash = playHref(items[0].songId, exam.id);
  }
  return {close};
}

// ───── running it in the player ─────
export function createExamRunner(ctl) {
  let watch = 0, finishing = false;
  const api = ctl.api;
  function show(active) {
    const item = active.items[active.index];
    const label = `Mock exam · ${active.index + 1} of ${active.items.length} · ${KIND_LABEL[item.kind]}: ${item.title}`;
    ctl.showStrip([{el: el('i', {class: 'rec-strip-exam', 'aria-hidden': 'true'})}, label,
      {label: 'Begin', primary: true, id: 'rec-exam-begin', onClick: () => begin(active)},
      {label: 'Leave exam', onClick: leave}], {kind: 'exam'});
  }
  function begin(active) {
    const song = api.song();
    if (!song) return;
    api.stop();
    api.setRange(0, song.measures.length - 1);
    if (!ctl.start({mode: 'exam', exam: {id: active.id, index: active.index}})) return;
    api.setStatus('Mock exam · play it through once');
    api.setPrompt('Play from the beginning to the end, without stopping. <b>Finish</b> when you are done.');
    // Finishes by itself after a long silence once most of the notes have been played.
    const expected = song.events.length;
    clearInterval(watch);
    watch = setInterval(() => {
      if (!ctl.recording) { clearInterval(watch); return; }
      if (ctl.notesPlayed >= expected * .6 && ctl.idleMs > 5000) finish();
    }, 500);
  }
  async function finish() {
    if (finishing) return;
    const active = readActive();
    if (!active || !ctl.recording) return;
    finishing = true;
    clearInterval(watch);
    const take = await ctl.stop();
    active.takes[active.index] = take?.id ?? null;
    active.reports[active.index] = take?.report ?? null;
    active.index++;
    finishing = false;
    if (active.index < active.items.length) {
      writeActive(active);
      location.hash = playHref(active.items[active.index].songId, active.id);
      return;
    }
    writeActive(null);
    dropHashParam('exam');
    ctl.hideStrip();
    const sheet = {id: active.id, at: Date.now(), name: active.name,
      ...examResults(active.items.map((it, k) => ({...it, takeId: active.takes[k] ?? null, report: active.reports[k]})))};
    let saved = sheet;
    try { saved = await store.saveExam(sheet); } catch (e) { console.warn('Could not save the exam sheet:', e); }
    openExamSheet(saved);
  }
  function leave() {
    clearInterval(watch);
    if (ctl.recording) ctl.stop({save: false});
    writeActive(null);
    dropHashParam('exam');
    ctl.hideStrip();
    api.flash('Exam left.');
  }
  return {
    finish,
    loaded(entry, examId) {
      const active = readActive();
      if (!examId || !active || active.id !== examId) { if (examId) dropHashParam('exam'); return; }
      const item = active.items[active.index];
      if (!item) { writeActive(null); return; }
      if (item.songId !== entry.id) { location.hash = playHref(item.songId, active.id); return; }
      show(active);
    },
    leaving() { clearInterval(watch); },
  };
}

// ───── the results sheet ─────
const fmtDate = at => new Date(at).toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
export function openExamSheet(sheet) {
  document.querySelector('.rec-modal.rec-exam-modal')?.remove();
  const prev = document.activeElement;
  const card = el('article', {class: 'rec-modal-card rec-exam-sheet', 'aria-labelledby': 'rec-exam-title'},
    el('header', {class: 'rec-head'},
      el('div', {},
        el('p', {class: 'rec-kicker', text: 'Mock examination · results'}),
        el('h2', {class: 'rec-piece', id: 'rec-exam-title', text: sheet.name || 'Mock exam'}),
        el('p', {class: 'rec-setup-note', text: fmtDate(sheet.at)})),
      el('button', {class: 'close-btn', type: 'button', 'aria-label': 'Close results', onclick: () => close(),
        html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'})),
    el('div', {class: 'rec-exam-total'},
      el('div', {class: 'note-figure'}, el('span', {class: 'rec-acc', text: String(sheet.total)}), el('span', {class: 'note-pct', text: `/${sheet.max}`})),
      el('p', {class: 'rec-band', text: sheet.band || ''}),
      el('p', {class: 'rec-setup-note', text: `Pass ${Math.ceil(sheet.max * 2 / 3)} · Merit ${Math.ceil(sheet.max * .8)} · Distinction ${Math.ceil(sheet.max * .9)}`})),
    el('ol', {class: 'rec-exam-items', role: 'list'}, sheet.items.map((it, k) => el('li', {class: 'rec-exam-item'},
      el('div', {class: 'rec-exam-row'},
        el('span', {class: 'rec-exam-n', text: String(k + 1)}),
        el('span', {class: 'rec-exam-what'}, el('span', {class: 'rec-label', text: KIND_LABEL[it.kind] || it.kind}), el('span', {class: 'rec-exam-title', text: it.title})),
        el('span', {class: 'rec-exam-mark'}, el('strong', {text: String(it.mark)}), `/${it.max ?? ITEM_MAX[it.kind]}`),
        el('span', {class: 'rec-exam-band', text: it.band || ''})),
      el('p', {class: 'rec-exam-comment', text: it.comment}),
      it.takeId && it.songId ? el('a', {class: 'link-btn rec-exam-link', href: `#/play/${encodeURIComponent(it.songId)}?review=${it.takeId}`, text: 'Review this take', onclick: () => close()}) : null))),
    sheet.remarks?.length ? el('ul', {class: 'note-remarks rec-remarks'}, sheet.remarks.map(r => el('li', {text: r}))) : null,
    el('div', {class: 'rec-actions'},
      el('button', {class: 'primary-btn', type: 'button', text: 'Done', onclick: () => close()}),
      el('button', {class: 'quiet-btn', type: 'button', text: 'Print', onclick: () => {
        document.documentElement.classList.add('rec-print');
        try { window.print(); } finally { setTimeout(() => document.documentElement.classList.remove('rec-print'), 1000); }
      }})));
  const modal = el('div', {class: 'rec-modal rec-exam-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rec-exam-title'}, card);
  const onKey = modalKeys(() => modal, () => close());
  function close() { modal.remove(); window.removeEventListener('keydown', onKey, true); try { prev?.focus?.(); } catch {} }
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.append(modal);
  card.querySelector('.close-btn')?.focus({preventScroll: true});
  return {close};
}

// Keys while a modal is open: Escape closes, Tab stays inside, and nothing else reaches the
// shortcuts of the page behind it (Space must not start the player).
function modalKeys(getModal, close) {
  return e => {
    const modal = getModal();
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') { e.stopPropagation(); return; }
    const items = [...modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
}
