// The control key: one key on the student's MIDI piano (the top C8 unless they choose another)
// that drives the player instead of playing a note, so the hands needn't leave the keyboard.
// Pure: the player feeds it MIDI bytes and its own state.
//
//   isControlPress([status, n, velocity], key) → a note-on of the control key
//   controlAction({offer, repair, practicing, loop}) → 'accept' | 'restart' | 'start'
export const DEFAULT_CONTROL_KEY = 108; // C8, the top key of an 88-key piano

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** "C8", "A0", "F♯4" (MIDI 60 = C4). */
export const keyName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);

/** A saved value → a MIDI note 0–127, else the default. */
export function normaliseControlKey(v) {
  const n = v === null || v === '' || typeof v === 'boolean' ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 127 ? n : DEFAULT_CONTROL_KEY;
}

/** Does the piece itself play this pitch? Then the key stays a note for that piece. */
export const pieceUsesKey = (events, key) => Array.isArray(events) && events.some(e => e?.n === key);

/** A MIDI message [status, note, velocity]: a note-on (velocity > 0) of `key`, on any channel. */
export function isControlPress([status, n, velocity] = [], key) {
  return (status & 0xf0) === 0x90 && velocity > 0 && n === key;
}
/** The matching note-off (or note-on with velocity 0) of `key`. */
export function isControlRelease([status, n, velocity] = [], key) {
  const command = status & 0xf0;
  return n === key && (command === 0x80 || (command === 0x90 && !(velocity > 0)));
}

/**
 * What a press of the control key does, given the player's state:
 *   'accept'  a "Loop this bar slowly?" offer is showing → start the repair loop
 *   'restart' practising, a loop is set, or a repair loop runs → the pass again from the top
 *   'start'   otherwise → start practising (like ▶)
 */
export function controlAction({offer = false, repair = false, practicing = false, loop = false} = {}) {
  if (offer) return 'accept';
  if (practicing || loop || repair) return 'restart';
  return 'start';
}
