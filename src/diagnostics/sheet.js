// Settings → Diagnostics: one row in the player's Settings sheet opens a sheet with what the app
// knows about MIDI, the Mac relay, audio, samples and storage, and a "Copy report" button.
//
//   mountDiagnostics(root, {piano, midiAccess: () => access, latencyMs: () => ms, openSettings, closeSettings})
//     → {open(), close(), refresh()}
import {collectInfo} from './collect.js';
import {buildReport, formatReport} from './report.js';
import './diagnostics.css';
import {mountIpadLink} from '../app/ipad-link.js';
import {mountPianoHint} from '../relay/piano-hint.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

export function mountDiagnostics(root, {piano, midiAccess, latencyMs, openSettings = () => {}, closeSettings = () => {}} = {}) {
  const settings = root.querySelector('#settings');
  const anchor = settings?.querySelector('.shortcuts');
  if (!settings || root.querySelector('#diag')) return null;

  const group = document.createElement('section');
  group.className = 'set-group';
  group.innerHTML = `<h3 class="set-heading">This device</h3>
    <div class="set-row"><span>Diagnostics <small>MIDI, audio, memory</small></span><button class="link-btn" id="diag-open" type="button">Open…</button></div>`;
  if (anchor) anchor.before(group); else settings.querySelector('.settings-card')?.append(group);
  // On the Mac: the piano relay and the iPad address. On an iPad without a piano: one quiet hint.
  mountIpadLink(group, {compact: true});
  mountPianoHint(group);

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'diag';
  modal.hidden = true;
  modal.innerHTML = `<div class="modal-card settings-card diag-card" role="dialog" aria-modal="true" aria-labelledby="diag-title">
      <div class="settings-head">
        <h2 id="diag-title">Diagnostics</h2>
        <button class="close-btn" id="diag-close" type="button" aria-label="Back to settings"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="diag-body" id="diag-body" aria-live="polite"></div>
      <textarea class="diag-text" id="diag-text" readonly hidden aria-label="Diagnostics report"></textarea>
      <div class="modal-actions diag-actions">
        <button class="primary-btn" id="diag-copy" type="button">Copy report</button>
        <button class="quiet-btn" id="diag-refresh" type="button">Refresh</button>
        <span class="diag-status" id="diag-status" role="status"></span>
      </div>
    </div>`;
  settings.after(modal);
  const $ = s => modal.querySelector(s);
  let text = '', opener = null, seq = 0;

  function render(sections) {
    $('#diag-body').innerHTML = sections.map(s => `<section class="diag-group"><h3 class="set-heading">${esc(s.title)}</h3>
      <dl class="diag-rows">${s.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`).join('');
  }
  async function refresh() {
    const n = ++seq;
    $('#diag-status').textContent = 'Measuring…';
    // Draw at once without the relay round trip, then again with it.
    const quick = await collectInfo({piano, midiAccess, latencyMs, measureRtt: false});
    if (n !== seq) return;
    render(buildReport(quick));
    const info = await collectInfo({piano, midiAccess, latencyMs});
    if (n !== seq) return;
    const sections = buildReport(info);
    render(sections);
    text = formatReport(sections);
    $('#diag-text').value = text;
    $('#diag-status').textContent = '';
  }
  async function copy() {
    if (!text) await refresh();
    try {
      await navigator.clipboard.writeText(text);
      $('#diag-status').textContent = 'Copied.';
    } catch {
      // No clipboard (plain http on the iPad, or permission): show the text to copy by hand.
      const area = $('#diag-text');
      area.hidden = false;
      area.focus(); area.select();
      $('#diag-status').textContent = 'Select all and copy the text above.';
    }
  }

  const focusables = () => [...modal.querySelectorAll('button, textarea, [href], input')].filter(el => !el.disabled && !el.hidden && el.getClientRects().length);
  function open() {
    opener = document.activeElement;
    closeSettings({keepFocus: true});
    modal.hidden = false;
    $('#diag-text').hidden = true;
    $('#diag-status').textContent = '';
    $('#diag-close').focus({preventScroll: true});
    refresh().catch(e => { $('#diag-status').textContent = 'Could not read everything: ' + (e?.message || e); });
  }
  function close() {
    if (modal.hidden) return;
    seq++;
    modal.hidden = true;
    openSettings();
    const back = root.querySelector('#diag-open');
    (back?.getClientRects().length ? back : opener)?.focus?.({preventScroll: true});
  }
  modal.addEventListener('keydown', e => {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') {
      const list = focusables(), i = list.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); list.at(-1)?.focus(); }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0]?.focus(); }
    }
    e.stopPropagation(); // the player's shortcuts stay quiet while the sheet is open
  });
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  $('#diag-close').onclick = close;
  $('#diag-copy').onclick = () => { copy(); };
  $('#diag-refresh').onclick = () => { refresh().catch(() => {}); };
  root.querySelector('#diag-open').onclick = open;
  return {open, close, refresh, get text() { return text; }};
}
