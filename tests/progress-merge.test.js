// Merging progress from another device (src/progress/merge.js): a backup from the public site added
// to the Mac's store, or the other way round. Nothing is lost, nothing is counted twice.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';
import {eventIdentity, mergeDocs, missingFrom, withId} from '../src/progress/merge.js';
import {appendEvents, appendJournal, emptyDoc, sanitizeEvent} from '../src/progress/model.js';
import {addEvents, addJournal, readDoc} from '../progress-store/plugin.js';

const NOW = Date.now();
const session = (over = {}) => ({type: 'practice:session', songId: 'fur-elise', title: 'Für Elise', kind: 'practice', durationMs: 600000, at: NOW - 3600e3, tz: 0, ...over});
const drill = (over = {}) => ({type: 'trainer:result', level: 2, right: 18, wrong: 2, accuracy: 90, avgMs: 1400, durationMs: 90000, at: NOW - 2000e3, tz: 0, ...over});
const note = (over = {}) => ({id: 'jjjjjj1', at: NOW - 1000e3, tz: 0, text: 'Bars 5–8 felt better', ...over});
const goal = (over = {}) => ({id: 'gggggg1', songId: 'fur-elise', title: 'Für Elise', bpm: 72, accuracy: 90, by: '2030-03-01', createdAt: NOW - 5000e3, ...over});

function doc({events = [], journal = [], goals = []} = {}) {
  const d = emptyDoc();
  appendEvents(d, events.map(e => sanitizeEvent(e, Infinity)));
  appendJournal(d, journal);
  d.goals = goals;
  return d;
}

describe('merging progress', () => {
  test('adds only what the other side lacks, by id', () => {
    const mac = doc({events: [session({id: 'aaaaaa1'}), drill({id: 'bbbbbb1'})], journal: [note()]});
    const ipad = doc({events: [session({id: 'aaaaaa1'}), drill({id: 'cccccc1', at: NOW - 500e3})], journal: [note(), note({id: 'jjjjjj2', text: 'Scales'})], goals: [goal()]});
    const todo = missingFrom(mac, ipad);
    expect(todo.events.map(e => e.id)).toEqual(['cccccc1']);
    expect(todo.journal.map(e => e.id)).toEqual(['jjjjjj2']);
    expect(todo.goals.map(g => g.id)).toEqual(['gggggg1']);
  });

  test('an event that lost its id is recognised by what it is', () => {
    const mac = doc({events: [session({id: 'aaaaaa1'})]});
    const copy = session(); // same practice, no id
    expect(missingFrom(mac, doc({events: [copy]})).events).toEqual([]);
    // A different sitting is new, and gets a stable id so a second import is a no-op too.
    const other = session({at: NOW - 7200e3});
    const [added] = missingFrom(mac, doc({events: [other]})).events;
    expect(added.id).toMatch(/^m[0-9a-f]{16}$/);
    expect(withId(sanitizeEvent(other, Infinity)).id).toBe(added.id);
    expect(eventIdentity(added)).toBe(eventIdentity(sanitizeEvent(other, Infinity)));
  });

  test('mergeDocs: the merged document has each event once, totals follow, the base is untouched', () => {
    const base = doc({events: [session({id: 'aaaaaa1'})], goals: [goal()]});
    const incoming = doc({events: [session({id: 'aaaaaa1'}), session({id: 'dddddd1', at: NOW - 9000e3}), drill({id: 'eeeeee1'})], journal: [note()], goals: [goal(), goal({id: 'gggggg2', bpm: 80})]});
    const {doc: merged, added} = mergeDocs(base, incoming, {now: NOW});
    expect(added).toEqual({events: 2, journal: 1, goals: 1});
    expect(merged.events.map(e => e.id)).toEqual(['dddddd1', 'aaaaaa1', 'eeeeee1']);
    expect(merged.totals.songs['fur-elise'].ms).toBe(1200000);
    expect(merged.goals.map(g => g.id).sort()).toEqual(['gggggg1', 'gggggg2']);
    expect(base.events).toHaveLength(1);
    // Merging the same file again changes nothing.
    const again = mergeDocs(merged, incoming, {now: NOW});
    expect(again.added).toEqual({events: 0, journal: 0, goals: 0});
    expect(again.doc.events).toHaveLength(3);
  });

  test('settings stay with the device', () => {
    const base = doc();
    base.settings = {dailyGoalMin: 30};
    const incoming = doc();
    incoming.settings = {dailyGoalMin: 5};
    expect(mergeDocs(base, incoming).doc.settings.dailyGoalMin).toBe(30);
  });

  test('junk in the incoming file is dropped, not merged', () => {
    const incoming = {events: [{type: 'nope', at: NOW}, null, session({id: 'ffffff1'})], journal: [{id: 'x'}], goals: [{}]};
    const todo = missingFrom(emptyDoc(), incoming);
    expect(todo.events.map(e => e.id)).toEqual(['ffffff1']);
    expect(todo.journal).toEqual([]);
    expect(todo.goals).toEqual([]);
  });

  test('into the Mac\'s store: what missingFrom sends is added once, even sent twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'progress-merge-'));
    addEvents(dir, [session({id: 'aaaaaa1'})]);
    const fromSite = doc({events: [session({id: 'aaaaaa1'}), drill({id: 'bbbbbb1'}), session({at: NOW - 8000e3})], journal: [note()]});
    for (let i = 0; i < 2; i++) {
      const todo = missingFrom(readDoc(dir), fromSite);
      addEvents(dir, todo.events);
      addJournal(dir, todo.journal);
    }
    const stored = readDoc(dir);
    expect(stored.events).toHaveLength(3);
    expect(new Set(stored.events.map(e => e.id)).size).toBe(3);
    expect(stored.journal).toHaveLength(1);
  });
});
