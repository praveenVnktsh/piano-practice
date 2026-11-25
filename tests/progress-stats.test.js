import {describe, expect, test} from 'vitest';

import {appendEvents, emptyDoc, normalizeDoc, sanitizeEvent} from '../src/progress/model.js';
import {addDays, dayKey, exerciseStats, keyStats, lastDays, minutesByDay, parseExerciseId, readingSummary, readingTrend, songStats, streaks, todayMinutes} from '../src/progress/stats.js';

const MIN = 60000;
const docWith = events => {
  const doc = emptyDoc();
  appendEvents(doc, events.map(e => sanitizeEvent(e, Infinity)).filter(Boolean));
  return doc;
};
const sess = (at, minutes, over = {}) => ({type: 'practice:session', songId: 's', title: 'S', kind: 'practice', durationMs: minutes * MIN, at, tz: 0, ...over});
const utc = (y, m, d, h = 12, mi = 0) => Date.UTC(y, m - 1, d, h, mi);

describe('days and time zones', () => {
  test('dayKey uses the given offset', () => {
    const at = utc(2026, 11, 24, 23, 30);
    expect(dayKey(at, 0)).toBe('2026-11-24');
    expect(dayKey(at, -60)).toBe('2026-11-25');   // UTC+1: already tomorrow
    expect(dayKey(utc(2026, 11, 24, 3), 300)).toBe('2026-11-23'); // UTC-5: still yesterday
  });
  test('addDays crosses months, years and DST changes', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
  test('sessions count on the local day they happened', () => {
    // 23:50 in New York (UTC-5) is 04:50 UTC the next day.
    const doc = docWith([sess(utc(2026, 11, 25, 4, 50), 10, {tz: 300})]);
    expect(minutesByDay(doc)).toEqual({'2026-11-24': 10});
  });
});

describe('streaks', () => {
  const now = utc(2026, 11, 24, 12);
  const tz = new Date(now).getTimezoneOffset();
  const on = (daysAgo, minutes) => sess(now - daysAgo * 864e5, minutes, {tz});

  test('empty data', () => {
    expect(streaks(emptyDoc(), {now})).toEqual({current: 0, longest: 0, todayDone: false});
    expect(todayMinutes(emptyDoc(), now)).toBe(0);
    expect(songStats(emptyDoc())).toEqual([]);
    expect(readingTrend(emptyDoc())).toEqual([]);
    expect(readingSummary(emptyDoc())).toEqual({drills: 0, accuracy: null, avgMs: null});
    expect(lastDays(emptyDoc(), 14, now)).toHaveLength(14);
  });

  test('counts days with at least 5 minutes, keeping the streak alive until today is done', () => {
    const doc = docWith([on(1, 6), on(2, 5), on(3, 20), on(5, 30), on(6, 30), on(7, 30), on(8, 30)]);
    expect(streaks(doc, {now})).toEqual({current: 3, longest: 4, todayDone: false});
    const withToday = docWith([on(0, 2), on(0, 3), on(1, 6), on(2, 5)]); // two sessions add up
    expect(streaks(withToday, {now})).toEqual({current: 3, longest: 3, todayDone: true});
  });

  test('short days break the streak', () => {
    const doc = docWith([on(1, 10), on(2, 4.9), on(3, 10)]);
    expect(streaks(doc, {now}).current).toBe(1);
  });

  test('a streak spanning midnight in another time zone', () => {
    // Played 23:00–23:30 local (UTC+9) on consecutive days: UTC timestamps are 14:00 the same day.
    const day = (d) => sess(utc(2026, 11, d, 14), 30, {tz: -540});
    const doc = docWith([day(21), day(22), day(23)]);
    expect(Object.keys(minutesByDay(doc))).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
    // Same moments but recorded as 00:30 the next day in UTC+10:30.
    const shifted = docWith([sess(utc(2026, 11, 21, 14), 30, {tz: -630}), sess(utc(2026, 11, 22, 14), 30, {tz: -540})]);
    expect(Object.keys(minutesByDay(shifted))).toEqual(['2026-11-22']);
    expect(streaks(shifted, {now: utc(2026, 11, 22, 14)}).longest).toBe(1);
  });
});

describe('songs, exercises and note reading', () => {
  const res = (songId, accuracy, at, over = {}) => ({type: 'practice:result', songId, title: songId.toUpperCase(), accuracy, right: 9, wrong: 1, at, tz: 0, ...over});

  test('per-song best/latest/attempts, exercises split out', () => {
    const doc = docWith([res('a', 80, utc(2026, 11, 20)), res('a', 95, utc(2026, 11, 21)), res('a', 70, utc(2026, 11, 22)), res('b', 50, utc(2026, 11, 23)),
      res('ex:scale:Fs:major:both:2:up-down', 88, utc(2026, 11, 23)), res('ex:arpeggio:Gb:major:right:2', 92, utc(2026, 11, 22))]);
    expect(songStats(doc).map(s => [s.id, s.attempts, s.best, s.latest])).toEqual([['b', 1, 50, 50], ['a', 3, 95, 70]]);
    expect(exerciseStats(doc)).toHaveLength(2);
    const keys = keyStats(doc, {now: utc(2026, 11, 24)});
    expect(Object.keys(keys)).toEqual(['major:6']); // F♯ and G♭ are the same key
    expect(keys['major:6']).toMatchObject({attempts: 2, best: 92, recent: true});
    expect(keyStats(doc, {now: utc(2027, 1, 30)})['major:6'].recent).toBe(false);
  });

  test('parseExerciseId', () => {
    expect(parseExerciseId('ex:progression:Bb:major:I-IV-V-I')).toMatchObject({kind: 'progression', pc: 10, label: 'B♭', quality: 'major'});
    expect(parseExerciseId('ex:scale:A:minor:both')).toMatchObject({pc: 9, label: 'Am'});
    expect(parseExerciseId('ex:scale:H:major')).toBeNull();
    expect(parseExerciseId('fur-elise')).toBeNull();
  });

  test('note-reading trend per day', () => {
    const d = (day, right, wrong, avgMs) => ({type: 'trainer:result', level: 1, right, wrong, accuracy: 0, avgMs, durationMs: 60000, at: utc(2026, 11, day), tz: 0});
    const doc = docWith([d(20, 8, 2, 2000), d(20, 10, 0, 1000), d(22, 9, 1, 1500)]);
    const trend = readingTrend(doc);
    expect(trend.map(t => t.day)).toEqual(['2026-11-20', '2026-11-22']);
    expect(trend[0].accuracy).toBe(90);
    expect(Math.round(trend[0].avgMs)).toBe(1500); // weighted by notes (10 notes each)
    expect(readingSummary(doc).drills).toBe(3);
    expect(minutesByDay(doc)['2026-11-20']).toBe(2); // drills count as practice time
  });
});

describe('document', () => {
  test('pruning keeps totals; normalizeDoc rebuilds missing totals and ignores junk', () => {
    const doc = emptyDoc();
    const evs = [1, 2, 3, 4].map(i => sanitizeEvent(sess(utc(2026, 11, i), 10, {id: 'id-' + i + 'abcd'}), Infinity));
    expect(appendEvents(doc, evs, {maxEvents: 2})).toEqual({added: 4, pruned: 2});
    expect(doc.events).toHaveLength(2);
    expect(Object.keys(minutesByDay(doc))).toHaveLength(4);
    const rebuilt = normalizeDoc({events: evs, settings: {dailyGoalMin: 'x'}});
    expect(Object.keys(rebuilt.totals.days)).toHaveLength(4);
    expect(rebuilt.settings.dailyGoalMin).toBe(15);
    expect(normalizeDoc('garbage')).toEqual(emptyDoc());
  });
});
