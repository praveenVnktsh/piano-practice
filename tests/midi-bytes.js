// Hand-built Standard MIDI Files for tests: every byte is spelled out here (no MIDI library).

export const vlq = n => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = n => [(n >> 8) & 255, n & 255];
const ascii = s => [...s].map(c => c.charCodeAt(0));

/** tracks: arrays of raw event bytes (delta times included); an end-of-track is appended. */
export function smf({format = 1, division = 480, tracks}) {
  const out = [...ascii('MThd'), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division)];
  for (const t of tracks) {
    const body = [...t, 0x00, 0xff, 0x2f, 0x00];
    out.push(...ascii('MTrk'), ...u32(body.length), ...body);
  }
  return new Uint8Array(out);
}

export const tempo = bpm => { const us = Math.round(60e6 / bpm); return [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255]; };
export const timeSig = (num, den) => [0xff, 0x58, 0x04, num, Math.log2(den), 24, 8];
export const keySig = (fifths, minor = false) => [0xff, 0x59, 0x02, fifths & 255, minor ? 1 : 0];
export const trackName = s => [0xff, 0x03, ...vlq(s.length), ...ascii(s)];

/**
 * Notes [[startTick, midi, durTicks, vel?]] → track event bytes (note-offs as note-on velocity 0,
 * running status throughout, offs before ons at the same tick). `head` is meta events at tick 0.
 */
export function noteTrack(notes, {channel = 0, head = [], pedal = []} = {}) {
  const ev = [];
  for (const [t, n, d, v = 80] of notes) {
    ev.push({t, o: 2, b: [0x90 | channel, n, v]});
    ev.push({t: t + d, o: 0, b: [0x90 | channel, n, 0]});
  }
  for (const [t, v] of pedal) ev.push({t, o: 1, b: [0xb0 | channel, 64, v]});
  ev.sort((a, b) => a.t - b.t || a.o - b.o);
  const out = [];
  for (const m of head) out.push(0, ...m);
  let last = 0, status = 0;
  for (const e of ev) {
    out.push(...vlq(e.t - last));
    last = e.t;
    if (e.b[0] === status) out.push(...e.b.slice(1)); // running status
    else { out.push(...e.b); status = e.b[0]; }
  }
  return out;
}
