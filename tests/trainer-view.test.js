// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mountReadingTrainer} from '../src/trainer/view.js';

const midiOfName = name => {
  const m = /^([A-G])(♯|♭|)(\d)$/.exec(name);
  return 12 * (+m[3] + 1) + {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[m[1]] + (m[2] === '♯' ? 1 : m[2] === '♭' ? -1 : 0);
};
const targets = root => root.querySelector('.tr-notes').dataset.name.split(' and ').map(midiOfName);
const play = note => window.dispatchEvent(new CustomEvent('piano:note', {detail: {note, velocity: 80, source: 'midi', time: 0}}));

describe('reading trainer view', () => {
  let view, results;
  const onResult = e => results.push(e.detail);
  beforeEach(() => {
    vi.useFakeTimers();
    // A plain in-memory Storage (Node's own localStorage global can shadow jsdom's).
    const data = new Map();
    vi.stubGlobal('localStorage', {
      getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, String(v)),
      removeItem: k => data.delete(k), clear: () => data.clear(),
    });
    results = [];
    window.addEventListener('trainer:result', onResult);
  });
  afterEach(() => {
    view?.destroy();
    window.removeEventListener('trainer:result', onResult);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('runs a round from piano:note events and reports the result', () => {
    localStorage.setItem('trainer:reading:settings', JSON.stringify({level: 'treble', length: 10}));
    view = mountReadingTrainer(document.body);
    for (let i = 0; i < 10; i++) {
      const [t] = targets(document.body);
      play(i < 2 ? t + 1 : t);
      vi.advanceTimersByTime(2000);
    }
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({level: 'treble', right: 8, wrong: 2, accuracy: 80});
    expect(typeof results[0].avgMs).toBe('number');
    expect(typeof results[0].durationMs).toBe('number');
    expect(typeof results[0].at).toBe('number');
    expect(document.querySelector('.tr-results').hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem('trainer:reading:stats'))).toBeTruthy();
  });

  it('answers two-note items from on-screen keys, with retry', () => {
    localStorage.setItem('trainer:reading:settings', JSON.stringify({level: 'intervals', length: 10, retry: true, sound: false}));
    view = mountReadingTrainer(document.body);
    const tap = n => document.querySelector(`.tr-key[data-note="${n}"]`).dispatchEvent(new Event('pointerdown', {bubbles: true}));
    for (let i = 0; i < 10; i++) {
      const t = targets(document.body);
      if (i === 0) {
        // A wrong key: not part of the interval (t[0] + 1 *is* the target for a semitone second).
        let wrong = t[0] + 1;
        while (t.includes(wrong)) wrong++;
        tap(wrong);
        vi.advanceTimersByTime(3000);
        expect(targets(document.body)).toEqual(t); // still waiting for the right keys
        expect(document.querySelectorAll('.tr-key.target')).toHaveLength(2);
      }
      tap(t[0]);
      tap(t[1]);
      vi.advanceTimersByTime(1000);
    }
    expect(results).toEqual([expect.objectContaining({level: 'intervals', right: 9, wrong: 1, accuracy: 90})]);
  });

  it('stops listening after destroy', () => {
    view = mountReadingTrainer(document.body);
    view.destroy();
    view = null;
    expect(document.querySelector('.trainer')).toBeNull();
    play(60);
    expect(results).toHaveLength(0);
  });
});
