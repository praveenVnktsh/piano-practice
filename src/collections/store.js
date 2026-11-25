// Favourites and collections in the browser.
//
// The dev server's store (src/collections/plugin.js, .data/collections.json) is the source of
// truth when it is there, so the Mac and the iPad share one set; a copy is kept in localStorage
// (`piano-practice.collections`), which is all a production build has. A change made while the
// server can't be reached is kept locally, marked pending, and sent when it answers again; when
// both sides changed, the newer document wins (model.newer).
//
//   loadCollections() → Promise<doc>          first call fetches; later calls reuse it
//   collections()     → doc                   what is known now (empty until loaded)
//   updateCollections(fn) → doc               fn(doc) → new doc (model.js operations); saved + synced
//   collectionsWhere() → 'mac' | 'browser'
//   window event 'collections:change'         after every change (detail: doc)
//
// Setlists in play (sessionStorage, this tab only):
//   startSetlist({id, name, items: [{id, title}]}) · activeSetlist() · setlistNext(pieceId) · endSetlist()
import {emptyDoc, newer, normalizeDoc} from './model.js';

const BASE = (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');
const API = BASE + '__collections';
const LOCAL_KEY = 'piano-practice.collections';
const PENDING_KEY = 'piano-practice.collections.pending';
const SETLIST_KEY = 'piano-practice.setlist';
export const CHANGE_EVENT = 'collections:change';
export const SETLIST_EVENT = 'setlist:change';

const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

let doc = (() => { try { return normalizeDoc(JSON.parse(lsGet(LOCAL_KEY) || 'null')); } catch { return emptyDoc(); } })();
let where = 'browser';
let loading = null, saveTimer = 0, saving = null;

const changed = () => { try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {detail: doc})); } catch {} };
const keepLocal = () => lsSet(LOCAL_KEY, JSON.stringify(doc));

async function fetchServer() {
  if (!import.meta.env?.DEV) return null;
  try {
    const res = await fetch(API, {cache: 'no-store', signal: AbortSignal.timeout?.(6000)});
    const json = res.ok && (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null;
    return json?.store === 'disk' ? normalizeDoc(json) : null;
  } catch { return null; }
}

async function putServer(body) {
  const res = await fetch(API, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout?.(8000)});
  const json = await res.json().catch(() => null);
  if (res.status === 409 && json?.doc) return {stale: true, doc: normalizeDoc(json.doc)};
  if (!res.ok || !json?.ok) throw Error(json?.error || `The dev server answered ${res.status}`);
  return {doc: normalizeDoc(json.doc)};
}

/** Loads (once) and reconciles the server's document with the local copy. */
export function loadCollections({refresh = false} = {}) {
  if (loading && !refresh) return loading;
  loading = (async () => {
    const server = await fetchServer();
    if (!server) { where = where === 'mac' ? 'mac' : 'browser'; return doc; }
    where = 'mac';
    const pending = lsGet(PENDING_KEY) === '1';
    if (pending && (doc.updatedAt || 0) > (server.updatedAt || 0)) await sync();
    else if ((server.updatedAt || 0) !== (doc.updatedAt || 0) || !pending) {
      const before = JSON.stringify(doc);
      doc = pending ? newer(doc, server) : server;
      lsSet(PENDING_KEY, null);
      keepLocal();
      if (JSON.stringify(doc) !== before) changed();
    }
    return doc;
  })();
  return loading;
}

export const collections = () => doc;
export const collectionsWhere = () => where;

async function sync() {
  if (!import.meta.env?.DEV) return;
  const body = doc;
  try {
    const out = await putServer(body);
    if (out.stale) { doc = out.doc; keepLocal(); changed(); }
    if (doc === body || out.stale) lsSet(PENDING_KEY, null);
    where = 'mac';
  } catch {
    lsSet(PENDING_KEY, '1'); // sent again next time the server answers (loadCollections)
  }
}

/** Applies one change; keeps it locally at once and sends it to the Mac shortly after. */
export function updateCollections(fn) {
  const next = fn(doc);
  if (!next || next === doc) return doc;
  doc = normalizeDoc(next);
  keepLocal();
  lsSet(PENDING_KEY, '1');
  changed();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saving = (saving || Promise.resolve()).then(sync); }, 250);
  return doc;
}

// Another device may have changed the set: look again when the window comes back.
if (typeof window !== 'undefined') {
  let last = 0;
  const again = () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 4000 || !loading) return;
    last = Date.now();
    loadCollections({refresh: true});
  };
  window.addEventListener('focus', again);
  document.addEventListener('visibilitychange', again);
  // Another tab of this browser changed the local copy.
  window.addEventListener('storage', e => {
    if (e.key !== LOCAL_KEY || !e.newValue) return;
    try { doc = normalizeDoc(JSON.parse(e.newValue)); changed(); } catch {}
  });
}

// ───────── setlists in play ─────────

const ssGet = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} };
const setlistChanged = () => { try { window.dispatchEvent(new CustomEvent(SETLIST_EVENT)); } catch {} };

/** {id, name, items: [{id, title}]} → the first item (or null when empty). */
export function startSetlist({id = null, name = 'Setlist', items = []} = {}) {
  const list = items.filter(it => it && typeof it.id === 'string').map(it => ({id: it.id, title: String(it.title || it.id).slice(0, 200)})).slice(0, 500);
  if (!list.length) return null;
  ssSet(SETLIST_KEY, JSON.stringify({id, name: String(name).slice(0, 80), items: list, at: Date.now()}));
  setlistChanged();
  return list[0];
}

export function activeSetlist() {
  try {
    const s = JSON.parse(ssGet(SETLIST_KEY) || 'null');
    return s && Array.isArray(s.items) && s.items.length ? s : null;
  } catch { return null; }
}

/** Where a piece sits in the active setlist: {name, index, total, next: {id, title} | null} or null. */
export function setlistPosition(pieceId) {
  const s = activeSetlist();
  if (!s) return null;
  const index = s.items.findIndex(it => it.id === pieceId);
  if (index < 0) return null;
  return {name: s.name, id: s.id, index, total: s.items.length, next: s.items[index + 1] || null};
}

export const setlistNext = pieceId => setlistPosition(pieceId)?.next ?? null;

export function endSetlist() { ssSet(SETLIST_KEY, null); setlistChanged(); }
