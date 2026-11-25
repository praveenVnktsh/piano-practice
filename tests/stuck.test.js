import {describe, expect, it} from 'vitest';
import {StuckTracker} from '../src/practice/stuck.mjs';

describe('StuckTracker', () => {
  it('is stuck on the third wrong note of the same chord, once', () => {
    const s = new StuckTracker();
    expect(s.wrong(4, 0)).toBe(false);
    expect(s.wrong(4, 500)).toBe(false);
    expect(s.wrong(4, 900)).toBe(true);
    expect(s.wrong(4, 1200)).toBe(false); // already showing the hint
    expect(s.stuck).toBe(true);
  });
  it('is stuck after a long pause following a wrong note', () => {
    const s = new StuckTracker({afterMs: 6000});
    s.wrong(2, 1000);
    expect(s.check(2, 6000)).toBe(false);
    expect(s.check(2, 7000)).toBe(true);
    expect(s.check(2, 9000)).toBe(false);
  });
  it('never on a pause without a wrong note', () => {
    const s = new StuckTracker();
    expect(s.check(0, 60000)).toBe(false);
  });
  it('starts afresh on the next chord', () => {
    const s = new StuckTracker();
    s.wrong(1, 0); s.wrong(1, 10);
    expect(s.wrong(2, 20)).toBe(false); // a new chord: count from one
    expect(s.check(1, 99999)).toBe(false); // the old chord no longer matters
    s.advance();
    expect(s.stuck).toBe(false);
    expect(s.wrongs).toBe(0);
  });
});
