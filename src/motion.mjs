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
