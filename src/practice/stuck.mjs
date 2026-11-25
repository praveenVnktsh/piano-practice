// "Stuck" detection for Wait mode: after a few wrong notes on the same chord, or a wrong note
// followed by a long pause, the player shows a stronger hint (names on the noteheads, the keys
// called out on the keyboard, the notes played once softly). Pure; the clock is passed in.
//
//   const s = new StuckTracker({wrongs: 3, afterMs: 6000});
//   s.wrong(groupIndex, now) → true when this wrong note makes the student stuck
//   s.check(groupIndex, now) → true when the pause since the first wrong note is long enough
//   s.advance()              → the chord was played: start afresh
export const STUCK_WRONGS = 3;
export const STUCK_AFTER_MS = 6000;

export class StuckTracker {
  constructor({wrongs = STUCK_WRONGS, afterMs = STUCK_AFTER_MS} = {}) {
    this.limit = wrongs;
    this.afterMs = afterMs;
    this.advance();
  }
  advance() {
    this.group = -1;
    this.wrongs = 0;
    this.firstWrongAt = 0;
    this.stuck = false;
  }
  #on(group) {
    if (group !== this.group) { this.advance(); this.group = group; }
  }
  /** A wrong note on chord `group`. → true exactly once, when it tips into "stuck". */
  wrong(group, now) {
    this.#on(group);
    if (!this.wrongs) this.firstWrongAt = now;
    this.wrongs++;
    return this.#become(this.wrongs >= this.limit);
  }
  /** Still on chord `group` at `now` (a timer). → true exactly once, when the pause is long enough. */
  check(group, now) {
    if (group !== this.group || !this.wrongs) return false;
    return this.#become(now - this.firstWrongAt >= this.afterMs);
  }
  #become(yes) {
    if (!yes || this.stuck) return false;
    this.stuck = true;
    return true;
  }
}
