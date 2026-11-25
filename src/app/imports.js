// Imported songs. Stored on the Mac's disk through the dev server's /__songs
// endpoint (song-store/plugin.js) when it's there, so they survive clearing
// site data and are shared with other devices on the same dev server (iPad);
// otherwise (production build, server unreachable) in this browser's IndexedDB.
//
// Server entry: {id: "import:<id>", title, composer?, added, file, format, omr?, midi?, quality?, view?}
//   → played from {url: file}
// Browser record: {id: "import:<uuid>", title, composer?, added, data | mxlBase64, omr?, midi?, quality?, view?}
// A MIDI file is converted to MusicXML on import (src/midi-file/): `midi: true`, `quality` (0–1, how
// cleanly it quantised) and, when that is poor, `view: 'falling'` (the player opens it in falling notes).

const DB_NAME = 'piano-practice-imports';
const STORE = 'songs';
const LEGACY_DB = 'piano-score-library';
const MIGRATED_KEY = 'piano-practice.imports-migrated';
const API = (import.meta.env?.BASE_URL || '/') + '__songs';

// ───────── Browser store (IndexedDB) ─────────

let dbPromise;
function db() {
  return dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, {keyPath: 'id'});
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function request(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('Storage transaction aborted'));
  }));
}

const byNewest = list => (list || []).sort((a, b) => (b.added || 0) - (a.added || 0));
const browser = {
  list: async () => byNewest(await request('readonly', s => s.getAll())),
  put: rec => request('readwrite', s => s.put(rec)),
  delete: id => request('readwrite', s => s.delete(id)),
};

// ───────── Mac store (dev server) ─────────

async function api(path = '', init = {}) {
  const res = await fetch(API + path, {cache: 'no-store', ...init, signal: init.signal ?? AbortSignal.timeout(init.method ? 60000 : 8000)});
  const type = res.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok || !body) throw Error(body?.error || `The dev server answered ${res.status}`);
  return body;
}

const server = {
  list: async () => (await api()).songs,
  put: rec => api('', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      id: rec.id, title: rec.title, composer: rec.composer, added: rec.added,
      ...(rec.mxlBase64 ? {mxlBase64: rec.mxlBase64} : {data: rec.data}),
      ...(rec.omr ? {omr: true} : {}), ...(rec.partial ? {partial: true} : {}),
      ...(rec.midi ? {midi: true, quality: rec.quality} : {}), ...(rec.view === 'falling' ? {view: 'falling'} : {}),
    }),
  }),
  delete: id => api('/' + encodeURIComponent(id), {method: 'DELETE'}),
};

let storePromise;
/** Where imports are kept: 'mac' (dev server disk) or 'browser' (IndexedDB). Decided once per page load. */
export function importStore() {
  return storePromise ??= (async () => {
    if (!import.meta.env?.DEV) return 'browser';
    try { const body = await api(); return body.store === 'disk' && Array.isArray(body.songs) ? 'mac' : 'browser'; }
    catch (e) { console.warn('Song store on the dev server unavailable; keeping imports in this browser:', e.message); return 'browser'; }
  })();
}
const backend = async () => (await importStore()) === 'mac' ? server : browser;

export const STORE_LABEL = {mac: 'Saved on your Mac', browser: 'Saved in this browser only'};

export async function listImports() { return (await backend()).list(); }
/** Stores an import record; resolves with what was stored (a server entry when saved on the Mac). */
export async function putImport(rec) {
  const b = await backend();
  if (b === browser) { await b.put(rec); return rec; }
  return b.put(rec);
}
export async function deleteImport(id) { await (await backend()).delete(id); }

export const newImportId = () => 'import:' + (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Moves songs kept in this browser up to the Mac, removing each only once the server has it. → count moved. */
export async function migrateToServer() {
  if ((await importStore()) !== 'mac') return 0;
  let local;
  try { local = await browser.list(); } catch { return 0; } // no IndexedDB: nothing to move
  let moved = 0;
  for (const rec of local) {
    if (!rec?.id || !(rec.data || rec.mxlBase64)) continue;
    try {
      await server.put(rec); // the server skips an identical title + content and returns the existing entry
      await browser.delete(rec.id);
      moved++;
    } catch (e) { console.warn(`Could not move “${rec.title}” to the Mac; it stays in this browser:`, e.message); }
  }
  return moved;
}

// ───────── Reading files ─────────

const stripExt = name => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled score';

/** Title / composer from MusicXML or MEI text (best effort). */
export function scoreMeta(text) {
  try {
    const doc = new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml');
    if (doc.querySelector('parsererror')) return {};
    const pick = sel => doc.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '';
    const root = doc.documentElement.localName;
    if (root === 'mei') {
      return {
        title: pick('titleStmt title') || pick('work title'),
        composer: pick('titleStmt composer') || pick('persName[role="composer"]') || pick('work composer'),
      };
    }
    return {
      title: pick('work > work-title') || pick('movement-title') || pick('credit-words'),
      composer: pick('identification > creator[type="composer"]'),
    };
  } catch { return {}; }
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Reads the main score XML out of a compressed .mxl (zip) so we can show its title. */
async function mxlText(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return '';
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (name.startsWith('META-INF') || !/\.(xml|musicxml)$/i.test(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) return dec.decode(raw);
    if (method === 8 && typeof DecompressionStream === 'function') {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
  }
  return '';
}

export const ACCEPTED = /\.(musicxml|xml|mxl|mei|midi?)$/i;
export const MAX_BYTES = 50 * 1024 * 1024;
const MAX_MIDI_BYTES = 4 * 1024 * 1024;

/** Turns a picked/dropped file into an import record (not yet stored). */
export async function recordFromFile(file) {
  if (!ACCEPTED.test(file.name)) throw Error('Choose a MusicXML (.musicxml, .xml, .mxl), MEI (.mei) or MIDI (.mid) file.');
  if (file.size > MAX_BYTES) throw Error('Choose a score smaller than 50 MB.');
  const rec = {id: newImportId(), added: Date.now()};
  if (/\.midi?$/i.test(file.name)) return recordFromMidi(file, rec);
  let meta = {};
  if (/\.mxl$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (v32(bytes) !== 0x04034b50) throw Error('This .mxl file is not a valid compressed MusicXML file.');
    rec.mxlBase64 = toBase64(bytes);
    meta = scoreMeta(await mxlText(bytes).catch(() => ''));
  } else {
    rec.data = await file.text();
    if (!/<(score-partwise|score-timewise|mei)\b/.test(rec.data)) throw Error('This file does not look like MusicXML or MEI.');
    meta = scoreMeta(rec.data);
  }
  rec.title = meta.title || stripExt(file.name);
  if (meta.composer) rec.composer = meta.composer;
  return rec;
}
const v32 = b => b.length >= 4 ? new DataView(b.buffer, b.byteOffset).getUint32(0, true) : 0;

// A .mid becomes MusicXML here (quantised, hands split: src/midi-file/to-musicxml.mjs) and is then
// checked and saved like any other import. Loose timing (a recorded performance) still gets a
// rough score, but the piece is marked to open in falling notes.
async function recordFromMidi(file, rec) {
  if (file.size > MAX_MIDI_BYTES) throw Error('Choose a MIDI file smaller than 4 MB.');
  const {midiToMusicXml} = await import('../midi-file/to-musicxml.mjs');
  let out;
  try { out = midiToMusicXml(new Uint8Array(await file.arrayBuffer()), {fileName: file.name}); }
  catch (e) { throw Error(`This MIDI file couldn’t be read: ${String(e?.message || e).replace(/\.$/, '')}.`, {cause: e}); }
  return {
    ...rec, data: out.xml, title: out.title, midi: true, quality: out.quality,
    ...(out.fallingPreferred ? {view: 'falling'} : {}),
    warning: out.warnings.join(' ') || undefined,
  };
}

// ───────── PDF recognition via the optional local Audiveris helper ─────────

export const OMR_HELPER = 'http://127.0.0.1:8937';

/** Sends a PDF to the local helper and resolves with an import record once recognized. */
export async function recognizePdf(file, onStatus = () => {}, signal) {
  if (file.size > MAX_BYTES) throw Error('Choose a PDF smaller than 50 MB.');
  const headers = {'X-Score-Request': '1'};
  const timeout = () => AbortSignal.any ? AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]) : AbortSignal.timeout(15000);
  onStatus('Connecting to the local recognition helper…');
  let job;
  try {
    const res = await fetch(OMR_HELPER + '/jobs', {method: 'POST', headers: {...headers, 'Content-Type': 'application/pdf'}, body: file, signal: timeout()});
    job = await res.json();
    if (!res.ok) throw Error(job.error || 'The helper rejected the file');
  } catch (e) {
    if (signal?.aborted) throw e;
    throw Error('The local recognition helper is not running at ' + OMR_HELPER + ' (' + e.message + ').');
  }
  onStatus('Recognizing music on this computer. This can take several minutes…');
  for (;;) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 2000);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, {once: true});
    });
    const state = await (await fetch(OMR_HELPER + '/jobs/' + job.id, {headers, signal: timeout()})).json();
    if (state.status === 'failed') throw Error(state.error || 'Recognition failed');
    if (state.status === 'complete') {
      const meta = scoreMeta(state.xml || '');
      return {
        id: newImportId(), added: Date.now(), data: state.xml, omr: true, partial: !!state.partial,
        title: (meta.title || stripExt(file.name)) + ' (recognized)', ...(meta.composer ? {composer: meta.composer} : {}),
        warning: state.warning,
      };
    }
  }
}

// ───────── One-time migration from the old score library (into the browser store;
// migrateToServer then moves it to the Mac when that's available) ─────────

async function legacyExists() {
  if (indexedDB.databases) {
    try { return (await indexedDB.databases()).some(d => d.name === LEGACY_DB); } catch {}
  }
  return true; // unknown: try opening without creating (see below)
}

export async function migrateLegacy() {
  try { if (localStorage.getItem(MIGRATED_KEY)) return 0; } catch {}
  let moved = 0;
  if (await legacyExists()) {
    const legacy = await new Promise(resolve => {
      const r = indexedDB.open(LEGACY_DB);
      // The DB didn't exist: abort so we don't create an empty one.
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
    if (legacy && legacy.objectStoreNames.contains('scores')) {
      const old = await new Promise(resolve => {
        const r = legacy.transaction('scores').objectStore('scores').getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => resolve([]);
      });
      legacy.close();
      const existing = new Set((await browser.list()).map(r => r.legacyId));
      for (const o of old) {
        if (!(o.notation || o.mxl) || existing.has(o.id)) continue;
        const meta = o.notation ? scoreMeta(o.notation) : {};
        const name = String(o.name || '');
        const rec = {
          id: newImportId(), legacyId: o.id, added: o.created || Date.now(),
          title: (/\.\w{2,8}$/.test(name) ? (meta.title || stripExt(name)) : name.trim()) || meta.title || 'Imported score',
          ...(meta.composer ? {composer: meta.composer} : {}),
          ...(o.notation ? {data: o.notation} : {mxlBase64: o.mxl}),
          ...(o.omr ? {omr: true} : {}),
        };
        await browser.put(rec);
        moved++;
      }
    } else legacy?.close();
  }
  try { localStorage.setItem(MIGRATED_KEY, '1'); } catch {}
  return moved;
}
