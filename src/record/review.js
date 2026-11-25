// The review overlay inside the player: the piece's takes (history: play, rename, delete,
// export as MIDI) and, for the chosen take, a calm "programme note" report — wrong / missed /
// extra notes per bar, a fine-line tempo curve with the timing deviation per beat, evenness,
// dynamics against the marks, musicality (phrasing, tempo feel, voicing) and "listen and
// compare" (one bar of the score on the sampler, then the same bar of the take) — printable,
// and sendable to the teacher.
//
//   openReview({host, songId, song, entry, ctl, takeId?}) → {close()}
import {el} from '../app/dom.js';
import * as store from './store.js';
import {buildReport, barLines, REPORT_VERSION} from './report.mjs';
import {takeToMidi, midiFileName} from './midi-file.mjs';
import {duration} from './text.mjs';
import {velocityName, heatLevel, barsText} from '../practice-core.mjs';
import {sendTake} from './send.js';
import {onMac} from '../app/mac.js';
import {musicalityMarkup} from '../analysis/musicality-view.js';
import {prepareCompare} from './compare.mjs';

const fmtDate = at => new Date(at).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
const fmtTime = at => new Date(at).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
const NS = 'http://www.w3.org/2000/svg';

export function openReview({host, songId, song, entry, ctl, takeId = null}) {
  if (!host) return {close() {}};
  let takes = [], selected = null, current = null, closed = false, confirmDelete = false, renaming = false, message = '';
  const prevFocus = document.activeElement;
  const sheet = el('div', {class: 'rec-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rec-title'});
  // Above everything (the player is its own stacking context; the Teacher button floats over it).
  if (host.parentElement !== document.body) document.body.append(host);
  host.replaceChildren(sheet);
  host.hidden = false;
  document.documentElement.classList.add('rec-open');

  let compare = null, compareBar = null, compareTimer = 0;
  const silence = () => { clearTimeout(compareTimer); try { ctl.api?.piano?.silence?.(); } catch {} };
  const close = () => {
    if (closed) return;
    closed = true;
    if (compare) silence();
    host.hidden = true; host.replaceChildren();
    document.documentElement.classList.remove('rec-open');
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener(store.CHANGE, onChange);
    try { prevFocus?.focus?.({preventScroll: true}); } catch {}
  };
  // Escape closes; other keys stay with the overlay (Space must not start the player behind it).
  const onKey = e => {
    if (e.key === 'Escape' && !renaming) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') { e.stopPropagation(); return; }
    // Keep Tab inside the sheet (it is modal).
    const items = [...sheet.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  window.addEventListener('keydown', onKey, true);
  host.onclick = e => { if (e.target === host) close(); };
  const onChange = () => refresh();
  window.addEventListener(store.CHANGE, onChange);

  async function refresh() {
    try { takes = await store.listTakes(songId); } catch { takes = []; }
    if (closed) return;
    if (!selected || !takes.some(t => t.id === selected)) selected = takeId && takes.some(t => t.id === takeId) ? takeId : takes[0]?.id ?? null;
    await loadSelected();
  }
  async function loadSelected() {
    current = null; compare = null; compareBar = null;
    if (selected) {
      try { current = await store.getTake(selected); } catch { current = null; }
      if (current && (!current.report || current.report.v !== REPORT_VERSION)) {
        try {
          current.report = buildReport({song, take: current});
          store.updateTake(current.id, {report: current.report}).catch(() => {});
        } catch (e) { console.warn('Could not compare the take:', e); }
      }
    }
    if (!closed) render();
  }

  function render() {
    sheet.replaceChildren(
      el('header', {class: 'rec-head'},
        el('div', {},
          el('p', {class: 'rec-kicker', text: 'Recordings'}),
          el('h2', {class: 'rec-piece', id: 'rec-title'}, entry.title || songId, entry.composer ? el('em', {text: ' · ' + entry.composer}) : null)),
        el('button', {class: 'close-btn rec-close', type: 'button', 'aria-label': 'Close recordings', onclick: close,
          html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'})),
      takes.length ? el('div', {class: 'rec-body'}, takesList(), current ? note(current) : el('p', {class: 'rec-empty', text: 'Choose a take.'}))
        : empty(),
    );
    sheet.querySelector('.rec-close')?.focus({preventScroll: true});
  }

  function empty() {
    return el('div', {class: 'rec-empty-state'},
      el('p', {class: 'rec-empty-title', text: 'No takes yet'}),
      el('p', {class: 'rec-empty', text: 'Press ● Rec beside the play button (or R) and play the passage through. Stop, and the take is kept here with a comparison against the score.'}),
      el('button', {class: 'primary-btn', type: 'button', text: 'Record now', onclick: () => { close(); ctl.start(); }}));
  }

  function takesList() {
    return el('nav', {class: 'rec-takes', 'aria-label': 'Takes'},
      el('h3', {class: 'rec-label', text: `Takes · ${takes.length}`}),
      el('ol', {role: 'list'}, takes.map(t => el('li', {},
        el('button', {type: 'button', class: 'rec-take', 'aria-current': t.id === selected ? 'true' : null,
          onclick: () => { selected = t.id; confirmDelete = false; renaming = false; message = ''; loadSelected(); }},
          el('span', {class: 'rec-take-name', text: t.name || 'Take'}),
          el('span', {class: 'rec-take-meta', text: `${fmtDate(t.at)} · ${duration(t.durationMs)}${t.sentAt ? ' · sent' : ''}`}),
          el('span', {class: 'rec-take-acc', text: t.summary ? `${t.summary.accuracy}%` : '–'}))))));
  }

  function note(t) {
    const r = t.report;
    const sectionText = r ? (r.section[0] === 0 && r.section[1] === song.measures.length - 1 ? 'The whole piece' : barsText(song.measures, ...r.section).replace(/^b/, 'B')) : '';
    const kicker = [sectionText, `${fmtDate(t.at)}, ${fmtTime(t.at)}`, duration(t.durationMs), r?.timing.meanBpm ? `♩ ≈ ${r.timing.meanBpm}` : null, t.hands !== 'both' ? `${t.hands} hand` : null].filter(Boolean).join(' · ');
    const title = renaming
      ? el('form', {class: 'rec-rename', onsubmit: e => { e.preventDefault(); rename(e.target.name.value); }},
        el('input', {class: 'rec-input', name: 'name', value: t.name, maxlength: 80, 'aria-label': 'Take name'}),
        el('button', {class: 'quiet-btn', type: 'submit', text: 'Save'}),
        el('button', {class: 'quiet-btn', type: 'button', text: 'Cancel', onclick: () => { renaming = false; render(); }}))
      : el('h3', {class: 'rec-take-title', text: t.name || 'Take'});
    const art = el('article', {class: 'rec-note', 'aria-label': 'Report'},
      el('p', {class: 'note-kicker', text: kicker}),
      title,
      r ? figure(r) : el('p', {class: 'rec-empty', text: 'This take couldn’t be compared with the score.'}),
      r ? stats(r, t) : null,
      r?.timing.curve.length ? tempoCurve(r, t) : null,
      r?.musicality ? musicFigure(r) : null,
      r ? listenCompare(t) : null,
      r ? barStrip(r) : null,
      r ? barList(r) : null,
      r ? dynamicsTable(r) : null,
      r?.remarks.length ? el('ul', {class: 'note-remarks rec-remarks'}, r.remarks.map(x => el('li', {text: x}))) : null,
      actions(t),
      message ? el('p', {class: 'rec-message', role: 'status', text: message}) : null,
    );
    if (renaming) queueMicrotask(() => art.querySelector('.rec-input')?.select());
    return art;
  }

  function figure(r) {
    return el('div', {class: 'rec-figure'},
      el('div', {class: 'note-figure'}, el('span', {class: 'rec-acc', text: String(r.summary.accuracy)}), el('span', {class: 'note-pct', text: '%'})),
      el('p', {class: 'note-figure-cap', text: 'of the notes'}),
      el('p', {class: 'rec-verdict', text: r.verdict}));
  }

  function stats(r, t) {
    const s = r.summary, tm = r.timing;
    const row = (label, value, detail = '') => el('tr', {}, el('th', {scope: 'row', text: label}), el('td', {class: 'rec-num', text: value}), el('td', {class: 'rec-detail', text: detail}));
    return el('table', {class: 'rec-stats'}, el('caption', {class: 'sr-only', text: 'Summary'}),
      row('Notes', `${s.right} / ${s.expected}`, s.missed || s.extra ? `${s.missed - s.wrong} missed · ${s.wrong} wrong · ${s.extra} extra` : 'none missed'),
      tm.meanBpm ? row('Tempo', `♩ ≈ ${tm.meanBpm}`, t.tempo ? `set at ${t.tempo}` : '') : null,
      tm.score != null ? row('Timing', String(tm.score), `±${Math.round(tm.sdMs)} ms from a steady pulse`) : null,
      r.evenness ? row('Evenness', String(r.evenness.score), r.evenness.velocitySd != null ? `±${Math.round(r.evenness.velocitySd)} velocity` : 'timing only') : null,
      r.pedal ? row('Pedal', r.pedal.marks ? `${r.pedal.caught} / ${r.pedal.marks}` : '—', r.pedal.marks ? `marked changes caught · ${r.pedal.presses} presses` : `${r.pedal.presses} presses · none marked`) : null);
  }

  // Tempo by beat as a fine ink line, the set tempo as a brass dash, and each beat's timing
  // deviation (early above the rule, late below) as dots in a band underneath.
  function tempoCurve(r, t) {
    const W = 600, H = 150, top = 10, curveH = 82, bandY = 112, bandH = 22, padL = 34, padR = 8;
    const [first, last] = r.section;
    const t0 = song.measures[first].start, t1 = song.measures[last].end;
    const x = tt => padL + (W - padL - padR) * (tt - t0) / Math.max(1e-6, t1 - t0);
    const bpms = r.timing.curve.map(c => c[1]).filter(v => v != null);
    const ref = t.tempo || r.timing.meanBpm;
    const lo = Math.floor(Math.min(...bpms, ref) * .92), hi = Math.ceil(Math.max(...bpms, ref) * 1.08);
    const y = v => top + curveH * (1 - (v - lo) / Math.max(1, hi - lo));
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'rec-curve');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Tempo by beat, from ♩ ${Math.min(...bpms)} to ${Math.max(...bpms)}; set tempo ${ref}.`);
    let s = '';
    // Bar lines with sparse labels.
    const step = Math.max(1, Math.ceil((last - first + 1) / 12));
    for (let i = first; i <= last; i++) {
      const xx = x(song.measures[i].start).toFixed(1);
      s += `<line class="c-bar" x1="${xx}" x2="${xx}" y1="${top}" y2="${bandY + bandH}"/>`;
      if ((i - first) % step === 0) s += `<text class="c-label" x="${(+xx + 3).toFixed(1)}" y="${H - 2}">${song.measures[i].pickup ? 'P' : song.measures[i].label}</text>`;
    }
    s += `<text class="c-axis" x="${padL - 4}" y="${y(hi) + 4}" text-anchor="end">${hi}</text><text class="c-axis" x="${padL - 4}" y="${y(lo)}" text-anchor="end">${lo}</text>`;
    s += `<line class="c-ref" x1="${padL}" x2="${W - padR}" y1="${y(ref).toFixed(1)}" y2="${y(ref).toFixed(1)}"/>`;
    // The curve, broken where a beat has no estimate.
    let path = '', pen = false;
    for (const [tt, bpm] of r.timing.curve) {
      if (bpm == null) { pen = false; continue; }
      path += `${pen ? 'L' : 'M'}${x(tt).toFixed(1)},${y(bpm).toFixed(1)}`;
      pen = true;
    }
    s += `<path class="c-line" d="${path}"/>`;
    const mid = bandY + bandH / 2;
    s += `<line class="c-zero" x1="${padL}" x2="${W - padR}" y1="${mid}" y2="${mid}"/>`;
    for (const [tt, , dev] of r.timing.curve) {
      if (dev == null) continue;
      const yy = mid + Math.max(-1, Math.min(1, dev / 120)) * (bandH / 2);
      s += `<circle class="c-dot${Math.abs(dev) > 60 ? ' far' : ''}" cx="${x(tt).toFixed(1)}" cy="${yy.toFixed(1)}" r="1.7"><title>${dev > 0 ? '+' : ''}${dev} ms</title></circle>`;
    }
    svg.innerHTML = s;
    return el('figure', {class: 'rec-fig'},
      el('div', {class: 'rec-fig-head'}, el('span', {class: 'rec-label', text: 'Tempo, beat by beat'}), el('span', {class: 'rec-fig-note', text: r.timing.drift ? `♩ ${r.timing.drift.from} → ${r.timing.drift.to}` : `♩ ≈ ${r.timing.meanBpm}`})),
      svg,
      el('figcaption', {class: 'touch-cap'}, el('i', {class: 'k-time'}), 'tempo', el('i', {class: 'k-ref'}), `set ♩ = ${ref}`, el('i', {class: 'k-dot'}), 'early ↑ late ↓ per beat'));
  }

  function musicFigure(r) {
    const html = musicalityMarkup(r.musicality);
    return html ? el('figure', {class: 'touch music rec-music', 'aria-label': 'Musicality', html}) : null;
  }

  // Listen and compare: A = the bar as written (the sampler, at your tempo there), B = the same
  // bar of the take; "A then B" plays both with a breath between.
  function listenCompare(t) {
    const piano = ctl.api?.piano;
    if (!piano?.tone || !t.notes?.length) return null;
    if (!compare) { try { compare = prepareCompare(song, t); } catch { return null; } }
    if (!compare.bars.length) return null;
    compareBar ??= compare.bars[0].i;
    const status = el('span', {class: 'rec-compare-status', role: 'status'});
    const playClip = (notes, offset = 0) => { for (const x of notes) piano.tone(x.n, x.dur, x.velocity, offset + x.delay); };
    const play = which => {
      const c = compare.clip(compareBar);
      if (!c) return;
      silence();
      const label = compare.bars.find(b => b.i === compareBar)?.label;
      const where = label === 'Pickup' ? 'the pickup' : `bar ${label}`;
      if (which === 'a') { playClip(c.reference); status.textContent = `The score, ${where}`; }
      else if (which === 'b') { playClip(c.take); status.textContent = `Your take, ${where}`; }
      else {
        playClip(c.reference); playClip(c.take, c.seconds.reference + .6);
        status.textContent = `The score, then your take, ${where}`;
      }
      const total = which === 'a' ? c.seconds.reference : which === 'b' ? c.seconds.take : c.seconds.reference + .6 + c.seconds.take;
      clearTimeout(compareTimer);
      compareTimer = setTimeout(() => { status.textContent = ''; }, (total + .4) * 1000);
    };
    const select = el('select', {class: 'rec-input rec-compare-bar', 'aria-label': 'Bar to compare',
      onchange: e => { compareBar = Number(e.target.value); silence(); status.textContent = ''; }},
    compare.bars.map(b => el('option', {value: b.i, selected: b.i === compareBar || null, text: b.label === 'Pickup' ? 'Pickup' : `Bar ${b.label}`})));
    return el('section', {class: 'rec-section rec-compare'},
      el('h4', {class: 'rec-label', text: 'Listen and compare'}),
      el('div', {class: 'rec-compare-row'},
        select,
        el('div', {class: 'rec-compare-ab', role: 'group', 'aria-label': 'Play'},
          el('button', {class: 'quiet-btn', type: 'button', text: 'A · the score', onclick: () => play('a')}),
          el('button', {class: 'quiet-btn', type: 'button', text: 'B · your take', onclick: () => play('b')}),
          el('button', {class: 'quiet-btn', type: 'button', text: 'A then B', onclick: () => play('ab')})),
        status));
  }

  function barStrip(r) {
    return el('div', {class: 'rec-bars', role: 'group', 'aria-label': 'Accuracy by bar (tap a bar to practise it)'},
      r.bars.map(b => el('button', {type: 'button', class: `rec-bar heat-${b.notes ? heatLevel(b.accuracy) : 'none'}`,
        title: `${b.label === 'Pickup' ? 'Pickup' : 'Bar ' + b.label} · ${b.accuracy}%${b.bpm ? ` · ♩ ≈ ${b.bpm}` : ''} · practise it`,
        'aria-label': `${b.label === 'Pickup' ? 'Pickup' : 'Bar ' + b.label}, ${b.accuracy}%`,
        onclick: () => { close(); ctl.practiseBars(b.i, b.i); }},
      el('span', {text: b.label === 'Pickup' ? 'P' : b.label}))));
  }

  function barList(r) {
    const lines = barLines(r, {limit: 24});
    if (!lines.length) return el('p', {class: 'rec-clean', text: 'No slips, bar by bar.'});
    return el('section', {class: 'rec-section'},
      el('h4', {class: 'rec-label', text: 'Bar by bar'}),
      el('ol', {class: 'rec-lines', role: 'list'}, lines.map(l => el('li', {},
        el('span', {class: 'rec-line-bar', text: l.label}),
        el('span', {class: 'rec-line-text', text: l.text}),
        el('button', {type: 'button', class: 'link-btn rec-line-go', text: 'Practise', onclick: () => { close(); ctl.practiseBars(l.i, l.i); }})))));
  }

  function dynamicsTable(r) {
    const d = r.dynamics;
    if (!d || (!d.marks?.length && !d.hairpins?.length)) return null;
    return el('section', {class: 'rec-section'},
      el('h4', {class: 'rec-label', text: 'Dynamics against the marks'}),
      el('table', {class: 'rec-dyn'},
        el('thead', {}, el('tr', {}, el('th', {text: 'Marked'}), el('th', {text: 'Where'}), el('th', {text: 'Played'}))),
        el('tbody', {},
          (d.marks || []).map(m => el('tr', {class: velocityName(m.played) === String(m.mark).toLowerCase() ? 'ok' : ''},
            el('td', {class: 'rec-dyn-mark', text: m.mark}), el('td', {text: m.bars}), el('td', {text: `${velocityName(m.played)} (${Math.round(m.played)})`}))),
          (d.hairpins || []).map(h => el('tr', {},
            el('td', {class: 'rec-dyn-mark', text: h.form === 'dim' ? 'dim.' : 'cresc.'}), el('td', {text: h.bars}),
            el('td', {text: `${h.change > 0 ? '+' : ''}${Math.round(h.change)} velocity`}))))));
  }

  function actions(t) {
    const busy = ctl.recording;
    return el('div', {class: 'rec-actions'},
      el('button', {class: 'primary-btn', type: 'button', text: 'Play take', disabled: busy || null, onclick: () => { close(); ctl.play(t); }}),
      el('button', {class: 'quiet-btn', type: 'button', text: 'Export MIDI', onclick: () => exportMidi(t)}),
      el('button', {class: 'quiet-btn', type: 'button', text: 'Rename', onclick: () => { renaming = true; render(); }}),
      onMac() ? el('button', {class: 'quiet-btn', type: 'button', text: t.sentAt ? 'Send again' : 'Send to teacher', onclick: () => send(t)}) : null,
      el('button', {class: 'quiet-btn', type: 'button', text: 'Print', onclick: printReport}),
      confirmDelete
        ? el('span', {class: 'rec-confirm'},
          el('button', {class: 'quiet-btn rec-danger', type: 'button', text: 'Delete for good', onclick: () => remove(t)}),
          el('button', {class: 'quiet-btn', type: 'button', text: 'Keep', onclick: () => { confirmDelete = false; render(); }}))
        : el('button', {class: 'quiet-btn', type: 'button', text: 'Delete', onclick: () => { confirmDelete = true; render(); }}));
  }

  async function rename(name) {
    renaming = false;
    try { await store.updateTake(current.id, {name}); current.name = name.trim().slice(0, 80); } catch (e) { message = `Couldn’t rename: ${e.message}`; }
    render();
  }
  async function remove(t) {
    confirmDelete = false;
    try { await store.deleteTake(t.id); selected = null; message = ''; } catch (e) { message = `Couldn’t delete: ${e.message}`; render(); }
  }
  function exportMidi(t) {
    const blob = new Blob([takeToMidi(t)], {type: 'audio/midi'});
    const a = el('a', {href: URL.createObjectURL(blob), download: midiFileName(t)});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    message = `Saved ${midiFileName(t)}.`;
    render();
  }
  async function send(t) {
    message = 'Sending…'; render();
    try {
      await sendTake(t);
      message = 'Sent. Your teacher’s reply will appear in the Teacher panel.';
    } catch (e) { message = e.message; }
    if (!closed) render();
  }
  function printReport() {
    document.documentElement.classList.add('rec-print');
    const done = () => { document.documentElement.classList.remove('rec-print'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } finally { setTimeout(done, 1000); }
  }

  sheet.replaceChildren(el('p', {class: 'rec-empty', text: 'Opening your takes…'}));
  refresh();
  return {close};
}
