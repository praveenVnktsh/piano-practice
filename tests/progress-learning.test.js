// Progress document additions for Phase 4: journal notes, dated goals, measureCount, path start;
// the dev-server endpoints that store them; and small pure helpers used by Today and the prompt.
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {appendJournal, emptyDoc, isDayKey, normalizeDoc, sanitizeEvent, sanitizeGoal, sanitizeJournalEntry, sanitizeSettings, MAX_GOALS} from '../src/progress/model.js';
import {progressHandler} from '../progress-store/plugin.js';
import {shouldPrompt, PROMPT_AFTER_MS} from '../src/progress/journal-prompt.js';
import {barsText, scoreHasPickup} from '../src/today/view.js';

const NOW = Date.UTC(2026, 10, 24, 12);
const entry = (over = {}) => ({id: 'note000001', at: NOW - 3600e3, tz: -60, text: 'Left hand finally steady in bar 12', mood: 'good', songId: 'fur-elise', title: 'Für Elise', minutes: 14, ...over});
const goal = (over = {}) => ({id: 'goal000001', songId: 'fur-elise', title: 'Für Elise', bpm: 72, accuracy: 90, by: '2027-03-01', createdAt: NOW - 1000, ...over});

describe('journal entries', () => {
  test('clean entries keep their fields; control characters and overlong text are trimmed', () => {
    expect(sanitizeJournalEntry(entry(), NOW)).toEqual(entry());
    const {mood: _mood, ...noMood} = entry();
    expect(sanitizeJournalEntry(entry({text: 'a\u0000b\nc', mood: 'meh', extra: 1}), NOW)).toEqual({...noMood, text: 'a b c'});
    expect(sanitizeJournalEntry(entry({text: 'x'.repeat(500)}), NOW).text).toHaveLength(280);
  });
  test('needs an id, a sane time, and text or a mood', () => {
    expect(sanitizeJournalEntry(entry({id: 'bad id'}), NOW)).toBeNull();
    expect(sanitizeJournalEntry(entry({at: NOW + 3 * 864e5}), NOW)).toBeNull();
    expect(sanitizeJournalEntry(entry({text: '  ', mood: undefined}), NOW)).toBeNull();
    expect(sanitizeJournalEntry(entry({text: '', mood: 'hard'}), NOW)).toMatchObject({text: '', mood: 'hard'});
    expect(sanitizeJournalEntry('text', NOW)).toBeNull();
  });
  test('appendJournal dedupes by id and keeps time order', () => {
    const doc = emptyDoc();
    expect(appendJournal(doc, [entry({id: 'note000002', at: NOW}), entry()], {now: NOW})).toBe(2);
    expect(appendJournal(doc, [entry()], {now: NOW})).toBe(0);
    expect(doc.journal.map(e => e.id)).toEqual(['note000001', 'note000002']);
  });
});

describe('goals, settings and results', () => {
  test('goals need a song, a tempo 20–300 and a real date', () => {
    expect(sanitizeGoal(goal(), NOW)).toEqual(goal());
    expect(sanitizeGoal(goal({bpm: 900}), NOW).bpm).toBe(300);
    expect(sanitizeGoal(goal({by: '2027-02-30'}), NOW)).toBeNull();
    expect(sanitizeGoal(goal({songId: ''}), NOW)).toBeNull();
    expect(sanitizeGoal(goal({accuracy: undefined}), NOW).accuracy).toBe(90);
    expect(isDayKey('2028-02-29')).toBe(true);
  });
  test('normalizeDoc keeps journal and goals and drops junk', () => {
    const doc = normalizeDoc({journal: [entry(), {nope: 1}], goals: [goal(), goal(), goal({id: 'goal000002', by: 'soon'})]});
    expect(doc.journal).toHaveLength(1);
    expect(doc.goals).toHaveLength(1);
    expect(normalizeDoc(null)).toMatchObject({journal: [], goals: []});
  });
  test('pathStart is a level id; null clears it', () => {
    expect(sanitizeSettings({pathStart: 'grade-2'})).toMatchObject({pathStart: 'grade-2'});
    expect(sanitizeSettings({pathStart: '../x'})).not.toHaveProperty('pathStart');
    expect(sanitizeSettings({pathStart: null}, {dailyGoalMin: 15, pathStart: 'grade-2'})).not.toHaveProperty('pathStart');
  });
  test('practice results keep measureCount', () => {
    const ev = sanitizeEvent({type: 'practice:result', songId: 'x', accuracy: 90, measureCount: 64, at: NOW, tz: 0}, NOW);
    expect(ev.measureCount).toBe(64);
    expect(sanitizeEvent({type: 'practice:result', songId: 'x', accuracy: 90, measureCount: 'lots', at: NOW, tz: 0}, NOW)).not.toHaveProperty('measureCount');
  });
});

describe('progress store endpoints', () => {
  let server;
  afterEach(() => server?.close());
  async function serve(dir) {
    const handler = progressHandler(dir);
    server = createServer((req, res) => {
      req.url = req.url.slice('/__progress'.length) || '/';
      handler(req, res, () => { res.statusCode = 404; res.end('next'); });
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${server.address().port}/__progress`;
  }
  const send = (url, method, body) => fetch(url, {method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});

  test('POST /journal adds (one, many, {entries}) and dedupes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'progress-journal-'));
    const base = await serve(dir);
    const now = Date.now();
    let res = await send(base + '/journal', 'POST', entry({at: now - 1000}));
    expect(await res.json()).toMatchObject({ok: true, added: 1, rejected: 0, total: 1});
    res = await send(base + '/journal', 'POST', {entries: [entry({at: now - 1000}), entry({id: 'note000002', at: now}), {id: 'x'}]});
    expect(await res.json()).toMatchObject({added: 1, rejected: 1, total: 2});
    expect((await send(base + '/journal', 'POST', 'just text')).status).toBe(400);
    const doc = await (await fetch(base)).json();
    expect(doc.journal.map(e => e.id)).toEqual(['note000001', 'note000002']);
    expect(JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8')).journal).toHaveLength(2);
  });
  test('PUT /goals replaces the list (validated)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'progress-goals-'));
    const base = await serve(dir);
    let res = await send(base + '/goals', 'PUT', {goals: [goal({createdAt: Date.now()}), goal({id: 'goal000002', bpm: 'fast'})]});
    expect((await res.json()).goals).toHaveLength(1);
    res = await send(base + '/goals', 'PUT', {goals: []});
    expect((await res.json()).goals).toEqual([]);
    expect((await send(base + '/goals', 'PUT', {goals: Array.from({length: MAX_GOALS + 1}, goal)})).status).toBe(400);
    expect((await send(base + '/goals', 'PUT', {nope: 1})).status).toBe(400);
  });
});

describe('Today and journal helpers', () => {
  test('bars wording follows the player, with pickup bars counted from 0', () => {
    expect(barsText(8, 15)).toBe('Bars 9–16');
    expect(barsText(3, 3)).toBe('Bar 4');
    expect(barsText(8, 15, {pickup: true})).toBe('Bars 8–15');
    expect(barsText(0, 4, {pickup: true})).toBe('Pickup – bar 4');
    expect(barsText(0, 0, {pickup: true})).toBe('Pickup');
  });
  test('pickup detection from the first measure of MusicXML or MEI', () => {
    expect(scoreHasPickup('<part><measure number="0" implicit="yes"><note/></measure><measure number="1">')).toBe(true);
    expect(scoreHasPickup('<part><measure number="1"><note/></measure>')).toBe(false);
    expect(scoreHasPickup('<section><measure xml:id="m1" n="0" metcon="false">')).toBe(true);
    expect(scoreHasPickup('')).toBe(false);
  });
  test('the journal prompt waits for 3 minutes and goes quiet after two “Not now”s a day', () => {
    expect(PROMPT_AFTER_MS).toBe(180000);
    expect(shouldPrompt(170000, {}, NOW)).toBe(false);
    expect(shouldPrompt(185000, {}, NOW)).toBe(true);
    const today = new Date(NOW - new Date(NOW).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    expect(shouldPrompt(185000, {day: today, dismissed: 1}, NOW)).toBe(true);
    expect(shouldPrompt(185000, {day: today, dismissed: 2}, NOW)).toBe(false);
    expect(shouldPrompt(185000, {day: '2020-01-01', dismissed: 5}, NOW)).toBe(true);
  });
});
