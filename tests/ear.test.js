import {describe, expect, test} from 'vitest';
import {EAR_KINDS, EAR_LEVELS, earLevelById, makeQuestion, makeRound, judgePlayed, QUESTIONS_PER_ROUND, CADENCES} from '../src/ear/levels.js';
import {rng, intervalById, classifyChord} from '../src/theory/music.js';

describe('ear training questions', () => {
  test('levels', () => {
    expect(EAR_KINDS.map(k => k.id)).toEqual(['intervals', 'chords', 'cadences', 'melodies']);
    expect(new Set(EAR_LEVELS.map(l => l.id)).size).toBe(EAR_LEVELS.length);
    for (const l of EAR_LEVELS) expect(earLevelById(l.id).kind).toBe(l.kind);
  });

  for (const level of EAR_LEVELS) {
    test(`${level.id}: questions are sound and answerable`, () => {
      const r = rng(level.id.length * 101);
      for (let i = 0; i < 60; i++) {
        const q = makeQuestion(level, r);
        expect(q.sound.length).toBeGreaterThan(0);
        for (const s of q.sound) for (const m of s.notes) { expect(m).toBeGreaterThanOrEqual(36); expect(m).toBeLessThanOrEqual(96); }
        expect(q.explain).toBeTruthy();
        if (q.choices) expect(q.choices.map(c => c.id)).toContain(q.answer);
        if (level.kind === 'intervals') {
          const [a, b] = q.sound.length === 1 ? q.sound[0].notes : [q.sound[0].notes[0], q.sound[1].notes[0]];
          expect(Math.abs(b - a)).toBe(intervalById(q.answer).semis);
          if (level.dirs.includes('down') && !level.dirs.includes('up')) expect(b).toBeLessThan(a);
          expect(judgePlayed(q, [a, b])).toBe('right');
          expect(judgePlayed(q, [a + 3, b + 3])).toBe('right'); // any starting note
        }
        if (level.kind === 'chords') {
          const c = classifyChord(q.sound[0].notes);
          expect(c?.quality).toBe(q.answer);
          expect(judgePlayed(q, q.sound[0].notes.map(m => m + 5))).toBe('right');
        }
        if (level.kind === 'cadences') {
          expect(q.sound).toHaveLength(3);
          expect(level.types).toContain(q.answer);
          expect(CADENCES[q.answer]).toBeTruthy();
        }
        if (level.kind === 'melodies') {
          const notes = q.target.notes;
          expect(notes.length).toBeGreaterThanOrEqual(level.length[0]);
          expect(notes.length).toBeLessThanOrEqual(level.length[1]);
          expect(q.sound.map(s => s.notes[0])).toEqual(notes);
          const maxStep = Math.max(...Object.keys(level.steps).map(Number));
          for (let k = 1; k < notes.length; k++) expect(Math.abs(notes[k] - notes[k - 1])).toBeLessThanOrEqual(maxStep * 2 + 1);
          expect(judgePlayed(q, notes)).toBe('right');
          expect(judgePlayed(q, notes.map(m => m + 12))).toBe('right');
        }
      }
    });
  }

  test('a round has the right length and no answer three times running', () => {
    for (const level of EAR_LEVELS) {
      const round = makeRound(level, rng(5));
      expect(round).toHaveLength(QUESTIONS_PER_ROUND[level.kind]);
      for (let i = 2; i < round.length; i++) if (round[i].answer) expect(round[i].answer === round[i - 1].answer && round[i].answer === round[i - 2].answer).toBe(false);
    }
  });

  test('judging what was played', () => {
    const iv = {playable: 'interval', target: {semis: 7}};
    expect(judgePlayed(iv, [60])).toBe('pending');
    expect(judgePlayed(iv, [62, 69])).toBe('right');
    expect(judgePlayed(iv, [69, 62])).toBe('right');
    expect(judgePlayed(iv, [60, 66])).toBe('wrong');
    const ch = {playable: 'chord', target: {quality: 'minor'}};
    expect(judgePlayed(ch, [57, 60])).toBe('pending');
    expect(judgePlayed(ch, [60, 64, 69])).toBe('right'); // A minor, first inversion
    expect(judgePlayed(ch, [60, 64, 67])).toBe('wrong');
    const mel = {playable: 'melody', target: {notes: [60, 62, 64]}};
    expect(judgePlayed(mel, [60, 62])).toBe('pending');
    expect(judgePlayed(mel, [60, 63])).toBe('wrong');
    expect(judgePlayed(mel, [72, 74, 76])).toBe('right');
  });
});
