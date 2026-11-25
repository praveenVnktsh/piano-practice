// Progress tracking in the browser.
//
// Listens on window for practice:result / practice:session / trainer:result, tags each
// event with an id (dedupe key) and the local time-zone offset, mirrors it into a
// localStorage document (the source of truth in a production build, which has no server)
// and uploads it to the dev server's progress store (progress-store/plugin.js).
// The localStorage document doubles as the backlog: whatever it holds that the server
// doesn't is sent in batches (retry with backoff, keepalive fetch on pagehide), including
// events recorded while the server was down. The server ignores ids it already has.
import {EVENT_TYPES, appendEvents, appendJournal, emptyDoc, normalizeDoc, sanitizeEvent, sanitizeGoals, sanitizeJournalEntry, sanitizeSettings} from './model.js';
import {setMasteryDoc} from './mastery.js';

const BASE = (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');
const API = BASE + '__progress';
const LOCAL_KEY = 'piano-practice.progress.local';
const LOCAL_MAX_EVENTS = 3000;
const BATCH = 200;
const KEEPALIVE_BYTES = 60000;
export const CHANGE_EVENT = 'progress:change'; // window event fired after progress changes

const lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

const newId = () => {
  try { return crypto.randomUUID().replace(/-/g, ''); }
  catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }
};

let started = false;
let server = null;          // null = unknown, true = dev-server store, false = none (production)
let probing = null;
let flushTimer = null, flushing = false, backoff = 0;
let serverDoc = null;       // last GET of the server document
let knownIds = null;        // ids the server has (from the last GET plus everything acked since)
let knownJournal = null;    // journal-entry ids the server has

const loadLocal = () => normalizeDoc(lsGet(LOCAL_KEY, null));
const changed = () => window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
const unsentJournal = () => (knownJournal ? loadLocal().journal.filter(e => !knownJournal.has(e.id)) : []);

/** The player's bar count for a result, when the player that sent it is still on that song. */
function measureCountFor(detail) {
  try {
    const s = window.pianoPlayer?.getState?.();
    return s && s.songId === detail?.songId && Number.isInteger(s.measureCount) ? s.measureCount : undefined;
  } catch { return undefined; }
}
const unsent = () => (knownIds ? loadLocal().events.filter(e => e.id && !knownIds.has(e.id)) : []);

/** Records one event (also usable directly). → the stored event or null if invalid. */
export function record(type, detail) {
  const at = detail?.at ?? Date.now();
  const extra = type === 'practice:result' && detail?.measureCount == null ? {measureCount: measureCountFor(detail)} : {};
  const ev = sanitizeEvent({...detail, ...extra, type, id: newId(), at, tz: new Date(at).getTimezoneOffset()});
  if (!ev) return null;
  const local = loadLocal();
  appendEvents(local, [ev], {maxEvents: LOCAL_MAX_EVENTS});
  setMasteryDoc(mergedDoc(local));
  if (!lsSet(LOCAL_KEY, local)) { // storage full: keep the totals, drop most raw events
    local.events.splice(0, Math.floor(local.events.length * 0.75));
    lsSet(LOCAL_KEY, local);
  }
  if (server !== false) scheduleFlush(1500);
  changed();
  return ev;
}

async function fetchServerDoc() {
  const res = await fetch(API, {cache: 'no-store'});
  const json = res.ok && (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null;
  if (json?.store !== 'disk') return null;
  serverDoc = normalizeDoc(json);
  knownIds = new Set([...(knownIds || []), ...serverDoc.events.map(e => e.id).filter(Boolean)]);
  knownJournal = new Set([...(knownJournal || []), ...serverDoc.journal.map(e => e.id)]);
  setMasteryDoc(mergedDoc());
  return serverDoc;
}

async function probe() {
  if (server !== null) return server;
  return (probing ||= (async () => {
    try { server = !!(await fetchServerDoc()); }
    catch { server = null; } // network error: unknown, try again later
    probing = null;
    return server;
  })());
}

function scheduleFlush(ms) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms);
}

function retryDelay() {
  backoff = Math.min(6, backoff + 1);
  return 1000 * 2 ** backoff; // 2 s … 64 s
}

/**
 * Sends every event this browser has that the dev server doesn't (new ones, and anything
 * recorded while it was unavailable). → number sent.
 */
export async function flush() {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    if (!(await probe())) {
      if (server === null) scheduleFlush(retryDelay()); // unreachable: retry; false = no store, local only
      return 0;
    }
    for (let todo = unsent(); todo.length; todo = unsent()) {
      const batch = todo.slice(0, BATCH);
      const res = await fetch(API + '/events', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(batch)});
      // 400 = the batch is unusable; mark it done rather than retrying forever.
      if (!res.ok && res.status !== 400) throw Error('HTTP ' + res.status);
      for (const e of batch) knownIds.add(e.id);
      sent += batch.length;
    }
    const notes = unsentJournal();
    if (notes.length) {
      const res = await fetch(API + '/journal', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(notes.slice(0, 200))});
      if (!res.ok && res.status !== 400) throw Error('HTTP ' + res.status);
      for (const e of notes.slice(0, 200)) knownJournal.add(e.id);
      sent += notes.length;
    }
    backoff = 0;
    if (sent) changed();
  } catch (e) {
    console.warn('Progress not saved to the dev server yet, will retry:', e?.message || e);
    scheduleFlush(retryDelay());
  } finally { flushing = false; }
  return sent;
}

function flushOnExit() {
  if (server !== true) return;
  let batch = unsent().slice(0, BATCH);
  if (!batch.length) return;
  // No ack on unload: if this doesn't arrive, the next visit sends it again (the server dedupes by id).
  let body = JSON.stringify(batch);
  while (body.length > KEEPALIVE_BYTES && batch.length > 1) { batch = batch.slice(0, Math.ceil(batch.length / 2)); body = JSON.stringify(batch); }
  try { fetch(API + '/events', {method: 'POST', headers: {'content-type': 'application/json'}, body, keepalive: true}).catch(() => {}); }
  catch { try { navigator.sendBeacon?.(API + '/events', new Blob([body], {type: 'application/json'})); } catch {} }
}

/** Starts listening for practice events (idempotent). Call once at app start. */
export function startProgressTracking() {
  if (started) return;
  started = true;
  for (const type of EVENT_TYPES) window.addEventListener(type, e => record(type, e.detail));
  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
    else scheduleFlush(500);
  });
  window.addEventListener('online', () => scheduleFlush(200));
  scheduleFlush(300); // sync anything recorded while the server was unavailable
  setMasteryDoc(loadLocal());
  getProgress().catch(() => {}); // fills the mastery cache (barStats) with the server's history
  // "How did it go?" after a practice sitting of 3+ minutes (never nagging; see journal-prompt.js).
  if (typeof document !== 'undefined' && document.body) import('./journal-prompt.js').then(m => m.startJournalPrompt()).catch(() => {});
}

/**
 * The whole progress document (shape: src/progress/model.js). From the dev server when it
 * runs (merged with anything not uploaded yet), otherwise from this browser's localStorage.
 */
export async function getProgress() {
  if (await probe()) {
    try { await fetchServerDoc(); } catch {}
  }
  const doc = mergedDoc();
  setMasteryDoc(doc);
  return doc;
}

/** The server document plus anything this browser hasn't uploaded yet (or the local one alone). */
function mergedDoc(local = loadLocal()) {
  if (!server || !serverDoc) return local;
  const doc = structuredClone(serverDoc);
  const todo = knownIds ? local.events.filter(e => e.id && !knownIds.has(e.id)) : [];
  if (todo.length) appendEvents(doc, todo, {maxEvents: Infinity});
  const notes = knownJournal ? local.journal.filter(e => !knownJournal.has(e.id)) : [];
  if (notes.length) appendJournal(doc, notes);
  return doc;
}

/**
 * Adds a practice-journal note ({text, mood?, songId?, title?, minutes?}) → the stored entry or null.
 * Saved in this browser at once and uploaded to the dev server (retried like events).
 */
export function addJournalEntry(fields) {
  const at = Date.now();
  const entry = sanitizeJournalEntry({...fields, id: newId(), at, tz: new Date(at).getTimezoneOffset()});
  if (!entry) return null;
  const local = loadLocal();
  appendJournal(local, [entry]);
  lsSet(LOCAL_KEY, local);
  if (server !== false) scheduleFlush(300);
  changed();
  return entry;
}

/** Replaces the dated goals → the clean list. */
export async function saveGoals(goals) {
  const clean = sanitizeGoals(goals);
  const local = loadLocal();
  local.goals = clean;
  lsSet(LOCAL_KEY, local);
  if (await probe()) {
    try {
      const res = await fetch(API + '/goals', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({goals: clean})});
      if (res.ok) { const json = await res.json(); if (serverDoc) serverDoc.goals = json.goals; }
    } catch (e) { console.warn('Goals not saved to the dev server:', e?.message || e); }
  }
  changed();
  return clean;
}

/** Where progress is kept: 'disk' (dev server, your Mac) or 'browser'. */
export async function progressWhere() {
  return (await probe()) ? 'disk' : 'browser';
}

/** Saves settings ({dailyGoalMin}, {pathStart}) → the clean settings. */
export async function saveSettings(next) {
  const local = loadLocal();
  local.settings = sanitizeSettings(next, (server && serverDoc?.settings) || local.settings);
  lsSet(LOCAL_KEY, local);
  if (await probe()) {
    try {
      const res = await fetch(API + '/settings', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(next)});
      if (res.ok) { const json = await res.json(); if (serverDoc) serverDoc.settings = json.settings; }
    } catch (e) { console.warn('Goal not saved to the dev server:', e?.message || e); }
  }
  changed();
  return local.settings;
}

export {emptyDoc};
