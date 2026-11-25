// "Import score" modal: drop zone + file picker, plus optional PDF recognition via the local helper.
// Before a MusicXML file is saved it is prepared (src/musicxml.mjs: the piano part picked or a
// two-part piano joined, pickup bars marked, a title found) and opened once the way the player
// will open it, so a score that can't be played is reported here, in plain words, not later.
// "How to export from MuseScore" (index.html, #import-guide) sums up songs/README.md.
import {recordFromFile, recognizePdf, putImport, importStore, STORE_LABEL, ACCEPTED} from './imports.js';
import {prepareMusicXml, unzipMxl} from '../musicxml.mjs';

export function createImportDialog({dialog, onImported}) {
  const drop = dialog.querySelector('#import-drop');
  const fileInput = dialog.querySelector('#import-file');
  const pdfInput = dialog.querySelector('#import-pdf');
  const status = dialog.querySelector('#import-status');
  const foot = dialog.querySelector('.dlg-foot');
  let busy = false, abort = null, where = 'browser';

  // Say where imports end up, in place of the static "stored only in this browser" line.
  const WHERE_TEXT = {
    mac: STORE_LABEL.mac + ' (public/songs/local/imports), so they also show up on your iPad. ',
    browser: STORE_LABEL.browser + ' — clearing site data removes them. ',
  };
  function showWhere() {
    const first = foot?.firstChild;
    if (first?.nodeType === Node.TEXT_NODE) first.textContent = WHERE_TEXT[where];
    if (foot) foot.dataset.store = where;
  }
  importStore().then(w => { where = w; showWhere(); });

  const say = (text, tone = '') => { status.textContent = text; status.dataset.tone = tone; };
  const setBusy = b => { busy = b; dialog.classList.toggle('busy', b); fileInput.disabled = b; pdfInput.disabled = b; };

  async function importFile(file) {
    if (!file || busy) return;
    if (/\.pdf$/i.test(file.name)) { dialog.querySelector('.dlg-omr').open = true; return recognize(file); }
    setBusy(true); say('Reading ' + file.name + '…');
    try {
      const rec = await recordFromFile(file);
      say('Checking the score…');
      await save(await checkRecord(rec, file));
    } catch (e) { say(e.message, 'error'); }
    finally { setBusy(false); fileInput.value = ''; }
  }

  // Prepares MusicXML (see the top of the file) and opens it once; → the record to save, with any warnings.
  async function checkRecord(rec, file) {
    const warnings = [];
    let out = {...rec};
    let text = rec.data;
    if (rec.mxlBase64) text = await unzipMxl(new Uint8Array(await file.arrayBuffer()));
    if (typeof text === 'string' && !/<mei[\s>]/.test(text.slice(0, 4000))) {
      const prep = prepareMusicXml(text, {fileName: file.name});
      warnings.push(...prep.warnings);
      if (prep.changed) { out.data = prep.xml; delete out.mxlBase64; }
      const fromName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (!out.title || out.title === fromName || out.title === 'Untitled score') out.title = prep.title || out.title;
      if (!out.composer && prep.composer) out.composer = prep.composer;
    }
    let song;
    try {
      const {loadSong} = await import('../song.js');
      song = await loadSong(out.mxlBase64 ? {mxlBase64: out.mxlBase64} : {data: out.data});
    } catch (e) {
      throw Error(`This score couldn’t be opened: ${String(e?.message || e).replace(/\.$/, '')}. If it came from a notation program, export it again as MusicXML (see “How to export from MuseScore” below).`, {cause: e});
    }
    if (!song?.measures?.length) throw Error('This score has no bars to play.');
    out.warning = [rec.warning, ...warnings].filter(Boolean).join(' ') || undefined;
    return out;
  }

  async function save(rec) {
    const {warning, ...record} = rec;
    where = await importStore();
    say(where === 'mac' ? 'Saving on your Mac…' : 'Saving…');
    let stored;
    try { stored = await putImport(record); }
    catch (e) {
      throw Error(where === 'mac'
        ? 'Could not save the score on your Mac: ' + e.message
        : 'This browser could not store the score (storage blocked or full).', {cause: e});
    }
    say('');
    dialog.close();
    onImported(stored, warning, where);
  }

  async function recognize(file) {
    if (!file || busy) return;
    setBusy(true); abort = new AbortController();
    try { await save(await recognizePdf(file, t => say(t), abort.signal)); }
    catch (e) { if (!abort.signal.aborted) say('PDF recognition unavailable: ' + e.message + ' You can still import corrected MusicXML.', 'error'); }
    finally { setBusy(false); abort = null; pdfInput.value = ''; }
  }

  dialog.querySelector('#import-close').addEventListener('click', () => dialog.close());
  fileInput.addEventListener('change', () => importFile(fileInput.files[0]));
  pdfInput.addEventListener('change', () => recognize(pdfInput.files[0]));

  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); });
  for (const type of ['dragleave', 'dragend']) drop.addEventListener(type, () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const files = [...(e.dataTransfer?.files || [])];
    const file = files.find(f => ACCEPTED.test(f.name)) || files[0];
    if (file) importFile(file);
  });
  // Dropping a file elsewhere in the dialog shouldn't navigate the page away.
  dialog.addEventListener('dragover', e => e.preventDefault());
  dialog.addEventListener('drop', e => { e.preventDefault(); if (!drop.contains(e.target)) importFile(e.dataTransfer?.files?.[0]); });

  // Player shortcuts must not fire while typing/tabbing in the dialog.
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); // backdrop
  dialog.addEventListener('close', () => { abort?.abort(); if (!busy) say(''); });

  return {
    open() { say(''); dialog.showModal(); fileInput.focus(); },
    close: () => dialog.close(),
  };
}
