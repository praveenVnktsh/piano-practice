import {describe, expect, test} from 'vitest';
import {appendEvents, emptyDoc, normalizeDoc, sanitizeEvent, skillOf} from '../src/progress/model.js';
import {readingTrend, readingSummary, skillSummary, songStats, minutesByDay} from '../src/progress/stats.js';
import {repertoire} from '../src/progress/mastery.js';

const at = Date.UTC(2026, 10, 20, 12);
const trainer = (level, right, wrong, extra = {}) => sanitizeEvent({type: 'trainer:result', at, tz: 0, level, right, wrong, accuracy: 100 * right / (right + wrong), avgMs: 900, durationMs: 120000, ...extra});

describe('rhythm, theory and ear results in progress', () => {
  test('levels are accepted and recognised', () => {
    for (const level of ['rhythm:quavers', 'theory:key-signatures', 'ear:int-3', 'ear:dict-1']) {
      expect(trainer(level, 8, 2).level).toBe(level);
      expect(skillOf(level)).toBeTruthy();
    }
    expect(skillOf('treble')).toBeNull();
    expect(skillOf('rhythm:')).toBeNull();
    expect(skillOf(3)).toBeNull();
  });

  test('they count as practice time but stay out of the note-reading trend', () => {
    const doc = emptyDoc();
    appendEvents(doc, [trainer('treble', 18, 2), trainer('rhythm:quavers', 9, 1), trainer('rhythm:dotted', 6, 4), trainer('theory:intervals', 8, 0), trainer('ear:int-1', 7, 3)], {now: at});
    expect(readingTrend(doc)).toHaveLength(1);
    expect(readingSummary(doc)).toMatchObject({drills: 1});
    expect(readingTrend(doc)[0].notes).toBe(20);
    expect(Object.values(minutesByDay(doc))[0]).toBeCloseTo(10);
    expect(doc.totals.skills.rhythm).toMatchObject({drills: 2, right: 15, wrong: 5, levels: {quavers: 90, dotted: 60}});
    const s = skillSummary(doc);
    expect(s.rhythm).toMatchObject({drills: 2, lastAccuracy: 60, levels: 2});
    expect(s.rhythm.accuracy).toBeCloseTo(75);
    expect(s.theory).toMatchObject({drills: 1, levels: 1});
    expect(s.ear).toMatchObject({drills: 1, lastAccuracy: 70});
    expect(s.sightReading).toBeNull();
    // Survives a reload, and a rebuild from raw events.
    expect(normalizeDoc(JSON.parse(JSON.stringify(doc))).totals.skills).toEqual(doc.totals.skills);
    const rebuilt = normalizeDoc({events: doc.events});
    expect(rebuilt.totals.skills.rhythm.drills).toBe(2);
    expect(Object.keys(rebuilt.totals.trainer)).toHaveLength(1);
  });

  test('a failed theory attempt is not a lesson passed', () => {
    const doc = emptyDoc();
    appendEvents(doc, [trainer('theory:triads', 5, 5)], {now: at});
    expect(skillSummary(doc).theory.levels).toBe(0);
  });

  test('sight-reading pieces are practice results, not repertoire', () => {
    const doc = emptyDoc();
    const result = (songId, accuracy) => sanitizeEvent({type: 'practice:result', at, tz: 0, songId, title: 'Study', accuracy, mode: 'timed', right: 10, wrong: 1, section: [0, 3], durationMs: 30000});
    appendEvents(doc, [result('sr:grade-1:5', 91), result('sr:grade-1:6', 80), result('fur-elise', 70)], {now: at});
    expect(songStats(doc).map(s => s.id)).toEqual(['fur-elise']);
    expect(repertoire(doc).map(m => m.songId ?? m.id)).not.toContain('sr:grade-1:5');
    expect(skillSummary(doc).sightReading).toMatchObject({pieces: 2, best: 91});
  });
});
