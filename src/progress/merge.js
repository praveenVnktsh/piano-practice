// Merging one progress document into another (a backup from the public site into the Mac's store,
// or the Mac's into a browser): practice is added, never replaced, and nothing is counted twice.
//
//   eventIdentity(ev)            → what makes two events the same practice, without the id
//   withId(ev)                   → ev with an id (a stable one derived from its identity if it had none)
//   missingFrom(base, incoming)  → {events, journal, goals}  the incoming entries `base` lacks (pure; tested)
//   mergeDocs(base, incoming, {maxEvents}) → {doc, added: {events, journal, goals}}   (base untouched)
//
// An event is already there when its id is, or when an event with the same identity is (a copy that
// lost or never had its id). Journal entries and goals always carry ids. Settings are left alone:
// they belong to the device. Only raw events travel; totals for pruned old events stay where they were.
import {MAX_GOALS, appendEvents, appendJournal, normalizeDoc, sanitizeEvent, sanitizeGoals, sanitizeJournalEntry} from './model.js';

export function eventIdentity(ev) {
  return [ev.type, ev.at, ev.songId ?? '', ev.level ?? '', ev.action ?? '', ev.key ?? '', ev.accuracy ?? '', ev.durationMs ?? ''].join('|');
}

/** FNV-1a (two lanes) → 16 hex digits: a stable id for an event that has none. */
function hashId(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return 'm' + a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export const withId = ev => (ev.id ? ev : {...ev, id: hashId(eventIdentity(ev))});

export function missingFrom(baseRaw, incomingRaw) {
  const base = normalizeDoc(baseRaw), incoming = normalizeDoc(incomingRaw);
  const ids = new Set(base.events.map(e => e.id).filter(Boolean));
  const same = new Set(base.events.map(eventIdentity));
  const events = [];
  for (const raw of incoming.events) {
    const ev = sanitizeEvent(raw, Infinity);
    if (!ev) continue;
    const key = eventIdentity(ev), full = withId(ev);
    if (ids.has(full.id) || same.has(key)) continue;
    ids.add(full.id); same.add(key);
    events.push(full);
  }
  const journalIds = new Set(base.journal.map(e => e.id));
  const journal = incoming.journal.map(e => sanitizeJournalEntry(e, Infinity)).filter(e => e && !journalIds.has(e.id) && journalIds.add(e.id));
  const goalIds = new Set(base.goals.map(g => g.id));
  const goals = incoming.goals.filter(g => !goalIds.has(g.id) && goalIds.add(g.id));
  return {events, journal, goals};
}

export function mergeDocs(baseRaw, incomingRaw, {maxEvents, now = Date.now()} = {}) {
  const doc = normalizeDoc(structuredClone(baseRaw));
  const todo = missingFrom(doc, incomingRaw);
  const {added} = appendEvents(doc, todo.events, {...(maxEvents ? {maxEvents} : {}), now});
  const journal = appendJournal(doc, todo.journal, {now});
  const goals = sanitizeGoals([...doc.goals, ...todo.goals], Infinity).slice(0, MAX_GOALS);
  const goalsAdded = goals.length - doc.goals.length;
  doc.goals = goals;
  if (goalsAdded) doc.updatedAt = now;
  return {doc, added: {events: added, journal, goals: goalsAdded}};
}
