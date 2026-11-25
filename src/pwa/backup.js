// "Export my data" / "Import backup" (Progress → Settings).
//
//   mountBackupControls(container) → {destroy()}   renders the two controls into `container`
//   exportBackup() → the backup object (and downloads it unless {download: false})
//   readBackupFile(file) → {backup, summary}       parses + validates, throws Error(message)
//   restoreBackup(backup) → {server, browser}      writes it back (call only after confirming)
//   mergeBackup(backup) → {events, journal, goals, imports}   adds its practice to this one, nothing twice
//
// A backup is one JSON file: the dev server's part (backup/plugin.js: .data progress + journal + collections,
// .teacher thread and student profile, imported scores) plus this browser's part
// (localStorage settings and per-song state, scores imported while offline in IndexedDB).
// In a production build (no dev server) only the browser part is present.
//
// Two ways in: Restore replaces (a whole-Mac backup), Add merges (a file from the public site or
// another browser: its practice, journal and goals join this progress without duplicates, and its
// imported scores are added). On the public site, Export reads "Take this progress to your Mac".
import './backup.css';
import {onMac} from '../app/mac.js';
import {mergeProgress} from '../progress/store.js';

export const FORMAT = 'piano-practice-backup';
export const VERSION = 1;
const API = (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/') + '__backup';
const KEY_PREFIXES = ['piano-practice', 'trainer:'];
const PROGRESS_LOCAL = 'piano-practice.progress.local';
const COLLECTIONS_LOCAL = 'piano-practice.collections'; // src/collections/store.js
const IDB = {name: 'piano-practice-imports', store: 'songs'};
const MAX_FILE = 80 * 1024 * 1024;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ownKey = k => KEY_PREFIXES.some(p => k.startsWith(p)) && k !== 'piano-practice.sw';

// ───────── browser data ─────────

function readLocalStorage() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (ownKey(k)) out[k] = localStorage.getItem(k);
    }
  } catch {}
  return out;
}

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve([]);
    const open = indexedDB.open(IDB.name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IDB.store, {keyPath: 'id'});
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(IDB.store, mode);
      const r = fn(tx.objectStore(IDB.store));
      tx.oncomplete = () => { db.close(); resolve(r?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

// ───────── export ─────────

async function fetchServerPart() {
  if (!onMac()) return null; // a static site has no /__backup
  try {
    const res = await fetch(API, {cache: 'no-store'});
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return null;
    const json = await res.json();
    return json?.format === FORMAT ? json.server : null;
  } catch { return null; }
}

export async function exportBackup({download = true} = {}) {
  const [server, imports] = await Promise.all([fetchServerPart(), idb('readonly', s => s.getAll()).catch(() => [])]);
  const backup = {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
    app: {userAgent: navigator.userAgent, origin: location.origin},
    server, // null in a production build
    browser: {localStorage: readLocalStorage(), imports: imports || []},
  };
  if (download) {
    const blob = new Blob([JSON.stringify(backup)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `piano-practice-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  return backup;
}

// ───────── import ─────────

/** Validates a parsed backup (browser-side checks; the server re-validates its part). */
export function summarize(backup) {
  if (!isObj(backup) || backup.format !== FORMAT) throw new Error('This file is not a Piano Practice backup.');
  if (!Number.isInteger(backup.version) || backup.version > VERSION) throw new Error('This backup was made by a newer version of the app.');
  const browser = isObj(backup.browser) ? backup.browser : {};
  const ls = isObj(browser.localStorage) ? browser.localStorage : {};
  for (const [k, v] of Object.entries(ls)) {
    if (!ownKey(k) || typeof v !== 'string') throw new Error('The backup contains settings this app does not use.');
  }
  const imports = Array.isArray(browser.imports) ? browser.imports : [];
  if (imports.some(r => !isObj(r) || typeof r.id !== 'string' || !r.id.startsWith('import:') || (typeof r.data !== 'string' && typeof r.mxlBase64 !== 'string'))) {
    throw new Error('An imported score in the backup is damaged.');
  }
  const server = isObj(backup.server) ? backup.server : null;
  let progress = server?.data?.['progress.json'];
  if (!isObj(progress)) { try { progress = JSON.parse(ls[PROGRESS_LOCAL] || 'null'); } catch { progress = null; } }
  const lines = t => (typeof t === 'string' ? t.split('\n').filter(l => l.trim()).length : 0);
  // Favourites and collections: the Mac's .data/collections.json, else this browser's copy.
  let coll = server?.data?.['collections.json'];
  if (!isObj(coll)) { try { coll = JSON.parse(ls[COLLECTIONS_LOCAL] || 'null'); } catch { coll = null; } }
  return {
    exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : null,
    events: Array.isArray(progress?.events) ? progress.events.length : 0,
    journal: Array.isArray(progress?.journal) ? progress.journal.length : 0,
    teacherMessages: lines(server?.teacher?.['messages.jsonl']) + lines(server?.teacher?.['replies.jsonl']),
    teacherProfile: typeof server?.teacher?.['student.md'] === 'string',
    imports: (Array.isArray(server?.imports?.index) ? server.imports.index.length : 0) + imports.length,
    settings: Object.keys(ls).length,
    collections: Array.isArray(coll?.collections) ? coll.collections.length : 0,
    hasServer: !!server,
  };
}

export async function readBackupFile(file) {
  if (!file) throw new Error('No file chosen.');
  if (file.size > MAX_FILE) throw new Error('This file is too large to be a backup.');
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON.'); }
  return {backup, summary: summarize(backup)};
}

export async function restoreBackup(backup) {
  summarize(backup); // throws on anything malformed
  const result = {server: null, browser: {settings: 0, imports: 0}};
  if (isObj(backup.server) && onMac()) {
    let res;
    try {
      res = await fetch(API + '/restore', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({format: backup.format, version: backup.version, exportedAt: backup.exportedAt, server: backup.server})});
    } catch { res = null; }
    const json = res && (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null;
    if (res?.ok) result.server = json;
    else if (res && res.status !== 404) throw new Error(json?.error || 'The Mac could not restore the backup.');
    // 404: no dev server (production build); the browser part below still applies.
  }
  const ls = backup.browser?.localStorage || {};
  // The progress store treats browser events the server lacks as unsent and would upload them
  // again: make this browser's copy match the restored document.
  const restoredProgress = backup.server?.data?.['progress.json'];
  try {
    for (const [k, v] of Object.entries(ls)) { localStorage.setItem(k, v); result.browser.settings++; }
    if (result.server && isObj(restoredProgress)) localStorage.setItem(PROGRESS_LOCAL, JSON.stringify(restoredProgress));
  } catch { throw new Error('This browser’s storage is full; the settings could not be restored.'); }
  const imports = backup.browser?.imports || [];
  if (imports.length) {
    await idb('readwrite', s => { for (const r of imports) s.put(r); });
    result.browser.imports = imports.length;
  }
  window.dispatchEvent(new CustomEvent('progress:change'));
  return result;
}

/** The backup's progress document: the Mac's .data/progress.json, else the browser's copy. */
export function backupProgress(backup) {
  const p = backup?.server?.data?.['progress.json'];
  if (isObj(p)) return p;
  try { return JSON.parse(backup?.browser?.localStorage?.[PROGRESS_LOCAL] || 'null'); } catch { return null; }
}

export async function mergeBackup(backup) {
  summarize(backup); // throws on anything malformed
  const progress = backupProgress(backup);
  const added = isObj(progress) ? await mergeProgress(progress) : {events: 0, journal: 0, goals: 0};
  const imports = backup.browser?.imports || [];
  const have = new Set(imports.length ? await idb('readonly', s => s.getAllKeys()).catch(() => []) : []);
  const fresh = imports.filter(r => !have.has(r.id));
  if (fresh.length) await idb('readwrite', s => { for (const r of fresh) s.put(r); });
  return {...added, imports: fresh.length};
}

// ───────── UI ─────────

const fmtDate = iso => {
  const d = new Date(iso);
  return isNaN(d) ? 'an unknown date' : d.toLocaleString(undefined, {dateStyle: 'long', timeStyle: 'short'});
};
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function mountBackupControls(container) {
  const root = document.createElement('div');
  root.className = 'bk';
  const mac = onMac();
  root.innerHTML = `
    <div class="bk-row">
      <div class="bk-text">
        ${mac ? `<p class="bk-title">Export my data</p>
        <p class="bk-help">One file with your progress, journal, teacher letters, imported scores and settings.</p>`
    : `<p class="bk-title">Take this progress to your Mac</p>
        <p class="bk-help">Downloads one file. On the Mac, choose it under Import backup: your practice is added there, nothing twice.</p>`}
      </div>
      <button type="button" class="bk-btn" data-act="export">${mac ? 'Export' : 'Download'}</button>
    </div>
    <div class="bk-row">
      <div class="bk-text">
        <p class="bk-title">Import backup</p>
        <p class="bk-help">Add a file’s practice to this one, or restore from it. You’ll see what’s in it before anything changes.</p>
      </div>
      <label class="bk-btn bk-file">Choose file…<input type="file" accept="application/json,.json" data-act="file" hidden></label>
    </div>
    <div class="bk-confirm" hidden role="alertdialog" aria-live="polite"></div>
    <p class="bk-msg" role="status" aria-live="polite"></p>`;
  container.append(root);
  const msg = root.querySelector('.bk-msg');
  const confirmBox = root.querySelector('.bk-confirm');
  const input = root.querySelector('input[type=file]');
  const say = (text, tone = '') => { msg.textContent = text; msg.dataset.tone = tone; };
  let pending = null;

  root.querySelector('[data-act=export]').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true; say('Preparing your backup…');
    try {
      const b = await exportBackup();
      say(b.server ? 'Backup downloaded.' : mac ? 'Backup downloaded (this browser’s data only: no Mac connected).' : 'Downloaded. Import it on your Mac to add this practice there.', 'ok');
    } catch { say('Could not make the backup.', 'bad'); }
    btn.disabled = false;
  };

  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    confirmBox.hidden = true; say('');
    try {
      const {backup, summary: s} = await readBackupFile(file);
      pending = backup;
      const parts = [plural(s.events, 'practice record'), plural(s.journal, 'journal entry', 'journal entries'),
        plural(s.teacherMessages, 'teacher message'), plural(s.imports, 'imported score'), ...(s.collections ? [plural(s.collections, 'collection')] : []), plural(s.settings, 'setting')];
      // A whole-Mac backup is restored; a browser's file (the public site) is added to this progress.
      const first = s.hasServer ? 'restore' : 'merge';
      const btn = act => act === 'merge'
        ? `<button type="button" class="bk-btn${first === act ? ' bk-primary' : ''}" data-act="merge">Add to this progress</button>`
        : `<button type="button" class="bk-btn${first === act ? ' bk-primary' : ''}" data-act="restore">Replace everything</button>`;
      confirmBox.innerHTML = `
        <p class="bk-title">The backup from ${fmtDate(s.exportedAt)}</p>
        <p class="bk-help">It contains ${parts.join(', ')}.</p>
        <p class="bk-help"><b>Add</b> keeps everything here and adds the practice, journal entries, goals and imported scores you don’t have yet, nothing twice.
          <b>Replace</b> swaps your current progress, journal${s.teacherMessages || s.teacherProfile ? ', teacher letters' : ''}${s.collections ? ', collections' : ''} and settings for the backup’s${s.hasServer && mac ? '; a copy of the current data is kept on the Mac in .data/backups' : ''}.</p>
        <div class="bk-actions">${btn(first)}${btn(first === 'merge' ? 'restore' : 'merge')}<button type="button" class="bk-btn" data-act="cancel">Cancel</button></div>`;
      confirmBox.hidden = false;
      confirmBox.querySelector(`[data-act=${first}]`).focus();
    } catch (err) {
      pending = null;
      say(err.message, 'bad');
    }
  };

  confirmBox.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') { pending = null; confirmBox.hidden = true; say('Nothing was changed.'); return; }
    if ((act !== 'restore' && act !== 'merge') || !pending) return;
    e.target.disabled = true;
    try {
      if (act === 'merge') {
        const a = await mergeBackup(pending);
        confirmBox.hidden = true;
        const bits = [plural(a.events, 'practice record'), plural(a.journal, 'journal entry', 'journal entries'), ...(a.goals ? [plural(a.goals, 'goal')] : []), ...(a.imports ? [plural(a.imports, 'imported score')] : [])];
        say(a.events || a.journal || a.goals || a.imports ? `Added ${bits.join(', ')}.` : 'Nothing new: all of it was here already.', 'ok');
        pending = null;
        return;
      }
      await restoreBackup(pending);
      confirmBox.hidden = true;
      msg.dataset.tone = 'ok';
      msg.innerHTML = 'Restored. <button type="button" class="bk-link" data-act="reload">Reload the app</button> to see everything.';
      msg.querySelector('[data-act=reload]').onclick = () => location.reload();
    } catch (err) {
      e.target.disabled = false;
      say(err.message, 'bad');
    }
    pending = null;
  };

  return {destroy() { root.remove(); }};
}
