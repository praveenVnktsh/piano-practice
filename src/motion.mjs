// Smooth following for the playhead: a critically damped spring ("smooth damp"). It glides to a
// moving target without overshoot and takes about the same time on a 60 Hz Mac and a 120 Hz iPad,
// unlike a fixed per-frame fraction. Pure.
//
//   const f = follower(0.22);        // seconds to (nearly) arrive
//   x = f.step(target, dtSeconds);   // each animation frame
//   f.jump(target)                   // snap (playing in real time, scrubbing, reduced motion)
export function smoothDamp(current, target, velocity, smoothTime, dt) {
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  let v = (velocity - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  // Never overshoot the target.
  if ((target - current > 0) === (out > target)) { out = target; v = 0; }
  return [out, v];
}

export function follower(smoothTime = .22, {epsilon = .01} = {}) {
  let value = null, velocity = 0;
  return {
    get value() { return value; },
    jump(target) { value = target; velocity = 0; return value; },
    step(target, dt) {
      if (value == null || !Number.isFinite(dt) || dt <= 0) return this.jump(target);
      [value, velocity] = smoothDamp(value, target, velocity, smoothTime, Math.min(dt, .1));
      if (Math.abs(target - value) < epsilon) this.jump(target);
      return value;
    },
  };
}

// A smooth, monotone curve through (time, x) points (Fritsch–Carlson cubic Hermite): it passes
// through every point exactly, never runs backwards, and has no sudden changes of speed between
// them, so a playhead moving at a steady tempo glides instead of lurching from note to note.
//   const m = monotoneMap([[t0, x0], [t1, x1], ...]);  // t and x strictly increasing
//   m.at(t) → x     m.inv(x) → t
export function monotoneMap(points) {
  const n = points.length;
  const T = points.map(p => p[0]), X = points.map(p => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((X[i + 1] - X[i]) / (T[i + 1] - T[i]));
  if (n > 1) { m[0] = d[0]; m[n - 1] = d[n - 2]; }
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  const seg = (arr, v) => { // last i with arr[i] <= v
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= v) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const hermite = (i, t) => {
    const h = T[i + 1] - T[i], s = (t - T[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * X[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * X[i + 1] + (s3 - s2) * h * m[i + 1];
  };
  return {
    at(t) {
      if (!n) return 0;
      if (n === 1 || t <= T[0]) return X[0];
      if (t >= T[n - 1]) return X[n - 1];
      return hermite(seg(T, t), t);
    },
    inv(x) {
      if (!n) return 0;
      if (n === 1 || x <= X[0]) return T[0];
      if (x >= X[n - 1]) return T[n - 1];
      const i = seg(X, x);
      let lo = T[i], hi = T[i + 1];
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (hermite(i, mid) < x) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    },
  };
}
