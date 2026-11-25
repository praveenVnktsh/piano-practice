// Standard MIDI File (type 0, one track) from a take, in plain JS. Pure; byte-exact tests in
// tests/record-midi.test.js.
//
//   takeToMidi(take, {bpm, division, name}) → Uint8Array
//
// Times: ticks = round(ms × division / msPerQuarter) at the take's tempo (so the file opens at
// the written ♩ = tempo in a notation program or DAW). Events at the same tick: note-offs, then
// pedal changes, then note-ons. No running status.

const vlq = n => {
  n = Math.max(0, Math.round(n));
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = n => [(n >> 8) & 255, n & 255];
const ascii = s => [...s].map(c => c.charCodeAt(0));

export function midiFile({events, division = 480, tempoUs = 500000, name = ''}) {
  // events: [{tick, order, bytes: [...]}]
  const sorted = events.slice().sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track = [];
  if (name) {
    const text = [...new TextEncoder().encode(name)].slice(0, 127);
    track.push(0, 0xff, 0x03, ...vlq(text.length), ...text);
  }
  track.push(0, 0xff, 0x51, 0x03, (tempoUs >> 16) & 255, (tempoUs >> 8) & 255, tempoUs & 255);
  let last = 0;
  for (const e of sorted) {
    track.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0x00);
  return new Uint8Array([
    ...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(division),
    ...ascii('MTrk'), ...u32(track.length), ...track,
  ]);
}

export function takeToMidi(take, {bpm = take.tempo || 120, division = 480, name = take.name || take.title || '', channel = 0} = {}) {
  const msPerQuarter = 60000 / bpm;
  const tick = ms => Math.round(ms * division / msPerQuarter);
  const ch = channel & 15;
  const events = [];
  for (const [at, n, v, d] of take.notes) {
    events.push({tick: tick(at), order: 2, bytes: [0x90 | ch, n & 127, Math.max(1, Math.min(127, v))]});
    events.push({tick: tick(at + Math.max(d, 1)), order: 0, bytes: [0x80 | ch, n & 127, 0x40]});
  }
  for (const [at, v] of take.pedal || []) events.push({tick: tick(at), order: 1, bytes: [0xb0 | ch, 64, v & 127]});
  return midiFile({events, division, tempoUs: Math.round(60e6 / bpm), name});
}

/** "fur-elise-take-3.mid" style file name. */
export function midiFileName(take) {
  const base = `${take.title || take.songId}${take.name ? ' ' + take.name : ''} ${new Date(take.at).toISOString().slice(0, 10)}`;
  return base.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) + '.mid';
}
