// Recordings in the browser: the dev server's disk store (/__recordings, recordings/plugin.js)
// when it is there, else localStorage (a production build). Takes recorded while the server
// was unreachable are moved to it the next time it answers.
//
//   listTakes(songId?) → [meta, …] newest first     getTake(id) → take | null
//   saveTake(take) → meta    updateTake(id, {name?, report?, sentAt?}) → meta    deleteTake(id)
//   listExams() → [sheet, …]  getExam(id)  saveExam(sheet)  deleteExam(id)
//   where() → 'disk' | 'browser'
// Every change fires a window 'recordings:change' event.
import {takeMeta, validateTake, patchTake, validateExam} from './take.mjs';

const API = (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/') + '__recordings';
const INDEX = 'piano-practice.recordings.index';
const TAKE = id => 'piano-practice.recordings.take.' + id;
const EXAMS = 'piano-practice.recordings.exams';
export const CHANGE = 'recordings:change';

let mode = null, probing = null;
const changed = () => window.dispatchEvent(new CustomEvent(CHANGE));
const lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { throw new Error('This browser’s storage is full: delete a few takes and try again.'); }
}

async function api(path, {method = 'GET', body} = {}) {
  const res = await fetch(API + path, {method, cache: 'no-store', headers: body ? {'content-type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined});
  const json = (res.headers.get('content-type') || '').includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw Object.assign(new Error(json?.error || `${res.status} ${res.statusText}`), {status: res.status});
  return json;
}

/** 'disk' when the dev server keeps recordings, else 'browser'. */
export function where() {
  if (mode) return Promise.resolve(mode);
  return (probing ||= (async () => {
    try {
      const json = await api('');
      mode = json?.store === 'disk' ? 'disk' : 'browser';
    } catch { mode = 'browser'; }
    probing = null;
    if (mode === 'disk') migrate().catch(() => {});
    return mode;
  })());
}

// ───── localStorage ─────
const localIndex = () => { const v = lsGet(INDEX, []); return Array.isArray(v) ? v : []; };
function localSave(take) {
  lsSet(TAKE(take.id), take);
  const list = localIndex().filter(m => m.id !== take.id);
  list.push(takeMeta(take));
  try { lsSet(INDEX, list); } catch (e) { try { localStorage.removeItem(TAKE(take.id)); } catch {} throw e; }
  return takeMeta(take);
}
function localDelete(id) {
  try { localStorage.removeItem(TAKE(id)); } catch {}
  lsSet(INDEX, localIndex().filter(m => m.id !== id));
}
const localTake = id => { const t = lsGet(TAKE(id), null); try { return t ? validateTake(t) : null; } catch { return null; } };

// Takes left in this browser while the server was away go to the Mac.
async function migrate() {
  const list = localIndex();
  if (!list.length) return;
  for (const m of list) {
    const t = localTake(m.id);
    try {
      if (t) await api('/takes/' + t.id, {method: 'PUT', body: t});
      localDelete(m.id);
    } catch {}
  }
  changed();
}

// ───── public ─────
export async function listTakes(songId) {
  if ((await where()) === 'disk') {
    try { return (await api(songId != null ? '?songId=' + encodeURIComponent(songId) : '')).takes || []; } catch { /* fall through to the browser copy */ }
  }
  return localIndex().filter(m => songId == null || m.songId === songId).sort((a, b) => b.at - a.at);
}

export async function getTake(id) {
  if ((await where()) === 'disk') {
    try { return validateTake(await api('/takes/' + encodeURIComponent(id))); } catch (e) { if (e.status === 404 && !localTake(id)) return null; }
  }
  return localTake(id);
}

export async function saveTake(take) {
  const clean = validateTake(take);
  let meta;
  if ((await where()) === 'disk') {
    try { meta = (await api('/takes/' + clean.id, {method: 'PUT', body: clean})).take; } catch (e) { if (e.status && e.status !== 404) throw e; }
  }
  meta ||= localSave(clean);
  changed();
  return meta;
}

export async function updateTake(id, patch) {
  let meta;
  if ((await where()) === 'disk' && !localTake(id)) meta = (await api('/takes/' + encodeURIComponent(id), {method: 'PATCH', body: patch})).take;
  else {
    const t = localTake(id);
    if (!t) throw new Error('That take is gone.');
    meta = localSave(patchTake(t, patch));
  }
  changed();
  return meta;
}

export async function deleteTake(id) {
  if ((await where()) === 'disk' && !localTake(id)) await api('/takes/' + encodeURIComponent(id), {method: 'DELETE'});
  else localDelete(id);
  changed();
}

const localExams = () => { const v = lsGet(EXAMS, []); return Array.isArray(v) ? v : []; };
export async function listExams() {
  const local = localExams();
  if ((await where()) === 'disk') { try { return [...(await api('/exams')).exams, ...local].sort((a, b) => b.at - a.at); } catch {} }
  return local.sort((a, b) => b.at - a.at);
}
export async function getExam(id) {
  const local = localExams().find(e => e.id === id);
  if (local) return local;
  if ((await where()) === 'disk') { try { return await api('/exams/' + encodeURIComponent(id)); } catch {} }
  return null;
}
export async function saveExam(sheet) {
  const clean = validateExam(sheet);
  let done = false;
  if ((await where()) === 'disk') { try { await api('/exams/' + clean.id, {method: 'PUT', body: clean}); done = true; } catch (e) { if (e.status === 400) throw e; } }
  if (!done) lsSet(EXAMS, [...localExams().filter(e => e.id !== clean.id), clean]);
  changed();
  return clean;
}
export async function deleteExam(id) {
  if (localExams().some(e => e.id === id)) lsSet(EXAMS, localExams().filter(e => e.id !== id));
  else if ((await where()) === 'disk') await api('/exams/' + encodeURIComponent(id), {method: 'DELETE'});
  changed();
}
