import {describe, expect, it} from 'vitest';
import {follower, smoothDamp} from '../src/motion.mjs';

const run = (hz, seconds, target = 100) => {
  const f = follower(.22);
  f.jump(0);
  const trace = [];
  for (let i = 0; i < Math.round(seconds * hz); i++) trace.push(f.step(target, 1 / hz));
  return trace;
};

describe('playhead motion', () => {
  it('glides without overshoot and arrives', () => {
    const t = run(60, 2);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
    expect(Math.max(...t)).toBeLessThanOrEqual(100);
    expect(t.at(-1)).toBe(100);
  });
  it('starts gently rather than jumping', () => {
    const [first] = run(60, 1 / 60);
    expect(first).toBeLessThan(10); // the first frame moves under a tenth of the way
  });
  it('takes the same time at 60 Hz and 120 Hz', () => {
    const at = (hz, s) => run(hz, s)[Math.round(s * hz) - 1];
    expect(Math.abs(at(60, .15) - at(120, .15))).toBeLessThan(3);
    expect(Math.abs(at(60, .3) - at(120, .3))).toBeLessThan(2);
  });
  it('is mostly there after about the smooth time', () => {
    expect(run(60, .3).at(-1)).toBeGreaterThan(70);
  });
  it('smoothDamp follows a target moving backwards', () => {
    const [x] = smoothDamp(10, 0, 0, .2, 1 / 60);
    expect(x).toBeLessThan(10);
    expect(x).toBeGreaterThan(0);
  });
});

import {monotoneMap} from '../src/motion.mjs';
describe('monotoneMap (playhead over the score)', () => {
  const pts = [[0, 0], [1, 40], [1.5, 60], [3.5, 100], [4, 180]];
  const m = monotoneMap(pts);
  it('passes through every note exactly', () => {
    for (const [t, x] of pts) expect(m.at(t)).toBeCloseTo(x, 6);
  });
  it('never runs backwards', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 4; t += .001) { const x = m.at(t); expect(x).toBeGreaterThanOrEqual(prev - 1e-9); prev = x; }
  });
  it('changes speed gradually (no jumps at the notes)', () => {
    const v = t => (m.at(t + 1e-4) - m.at(t - 1e-4)) / 2e-4;
    for (const [t] of pts.slice(1, -1)) expect(Math.abs(v(t + 1e-3) - v(t - 1e-3))).toBeLessThan(2);
  });
  it('inv undoes at', () => {
    for (let t = 0; t <= 4; t += .37) expect(m.inv(m.at(t))).toBeCloseTo(t, 4);
  });
  it('clamps outside the range', () => {
    expect(m.at(-1)).toBe(0); expect(m.at(9)).toBe(180);
    expect(m.inv(-5)).toBe(0); expect(m.inv(999)).toBe(4);
  });
});
