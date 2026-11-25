// Standard MIDI File reader, in plain JS with no dependencies. Pure; tests in tests/midi-parse.test.js.
//
//   parseMidi(bytes: Uint8Array | ArrayBuffer) → {
//     format: 0 | 1 | 2, division (ticks per quarter note), trackCount,
//     tracks: [{name, noteCount}],
//     notes: [{track, channel, n, vel, tick, end}],     // sorted by tick, then pitch
//     tempos: [{tick, usPerQuarter, bpm}],             // sorted; empty → 120 bpm
//     timeSigs: [{tick, num, den}],                    // den is the real denominator (4, 8, …)
//     keySigs: [{tick, fifths, minor}],
//     pedal: [{tick, track, channel, value}],          // sustain (CC64) changes, 0–127
//     programs: [{tick, track, channel, program}],
//     title, copyright, endTick,
//   }
//
// Handles format 0 and 1 (format 2 is read like 1), running status, note-on with velocity 0 as a
// note-off, overlapping notes of the same pitch (first on, first off), notes left hanging at the
// end of a track, SysEx and unknown chunks (skipped). SMPTE time division is turned into ticks per
// quarter at 120 bpm. Throws an Error with a plain-words message for files that aren't MIDI.

const ascii = (b, at, len) => String.fromCharCode(...b.subarray(at, at + len));

class Reader {
  constructor(bytes, start, end) { this.b = bytes; this.p = start; this.end = end; }
  get done() { return this.p >= this.end; }
  u8() {
    if (this.p >= this.end) throw Error('This MIDI file is cut short (a track ends mid-event).');
    return this.b[this.p++];
  }
  vlq() {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.u8();
      n = n * 128 + (c & 0x7f);
      if (!(c & 0x80)) return n;
    }
    throw Error('This MIDI file has a malformed length or time value.');
  }
  bytes(len) {
    if (this.p + len > this.end) throw Error('This MIDI file is cut short (a track ends mid-event).');
    const out = this.b.subarray(this.p, this.p + len);
    this.p += len;
    return out;
  }
}

const textOf = data => {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(data).trim(); }
  catch { return String.fromCharCode(...data).trim(); } // Latin-1 fallback
};

export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 14 || ascii(b, 0, 4) !== 'MThd') throw Error('This is not a MIDI file (no MThd header).');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const headLen = v.getUint32(4);
  if (headLen < 6) throw Error('This MIDI file has a broken header.');
  const format = v.getUint16(8);
  const trackCount = v.getUint16(10);
  const rawDivision = v.getUint16(12);
  if (format > 2) throw Error(`This MIDI file uses an unknown format (${format}).`);
  let division;
  if (rawDivision & 0x8000) {
    // SMPTE: frames per second × ticks per frame = ticks per second; assume 120 bpm (2 quarters/s).
    const fps = 256 - (rawDivision >> 8), tpf = rawDivision & 0xff;
    division = Math.max(1, Math.round((fps === 29 ? 29.97 : fps) * tpf / 2));
  } else division = rawDivision;
  if (!division) throw Error('This MIDI file has no time division.');

  const out = {
    format, division, trackCount, tracks: [], notes: [], tempos: [], timeSigs: [], keySigs: [],
    pedal: [], programs: [], title: '', copyright: '', endTick: 0,
  };

  let p = 8 + headLen;
  let trackIndex = 0;
  while (p + 8 <= b.length && trackIndex < trackCount) {
    const id = ascii(b, p, 4);
    const len = v.getUint32(p + 4);
    const start = p + 8, end = Math.min(b.length, start + len);
    p = start + len;
    if (id !== 'MTrk') continue; // unknown chunk: skip
    readTrack(new Reader(b, start, end), trackIndex++, out);
  }
  if (!trackIndex) throw Error('This MIDI file has no tracks.');

  const byTick = (a, c) => a.tick - c.tick;
  out.notes.sort((a, c) => a.tick - c.tick || a.n - c.n || a.track - c.track);
  out.tempos.sort(byTick);
  out.timeSigs.sort(byTick);
  out.keySigs.sort(byTick);
  out.pedal.sort(byTick);
  out.programs.sort(byTick);
  return out;
}

function readTrack(r, track, out) {
  const info = {name: '', noteCount: 0};
  out.tracks.push(info);
  const open = new Map(); // channel*128 + n → [note, …] (oldest first)
  let tick = 0, status = 0;

  const noteOff = (channel, n) => {
    const list = open.get(channel * 128 + n);
    const note = list?.shift();
    if (note) note.end = tick;
  };

  while (!r.done) {
    tick += r.vlq();
    let byte = r.u8();
    if (byte === 0xff) { // meta event (cancels running status)
      status = 0;
      const type = r.u8();
      const data = r.bytes(r.vlq());
      if (type === 0x2f) break; // end of track
      meta(type, data, tick, track, info, out);
      continue;
    }
    if (byte === 0xf0 || byte === 0xf7) { // SysEx: skip
      status = 0;
      r.bytes(r.vlq());
      continue;
    }
    let first;
    if (byte & 0x80) { status = byte; first = r.u8(); }
    else {
      if (!status) throw Error('This MIDI file has a data byte where an event should start.');
      first = byte; // running status: this byte is the first data byte
    }
    const kind = status & 0xf0, channel = status & 0x0f;
    if (kind === 0xc0 || kind === 0xd0) { // one data byte
      if (kind === 0xc0) out.programs.push({tick, track, channel, program: first & 0x7f});
      continue;
    }
    const second = r.u8();
    if (kind === 0x90 && second > 0) {
      const note = {track, channel, n: first & 0x7f, vel: second & 0x7f, tick, end: -1};
      const key = channel * 128 + note.n;
      if (!open.has(key)) open.set(key, []);
      open.get(key).push(note);
      out.notes.push(note);
      info.noteCount++;
    } else if (kind === 0x80 || kind === 0x90) noteOff(channel, first & 0x7f);
    else if (kind === 0xb0 && first === 64) out.pedal.push({tick, track, channel, value: second & 0x7f});
    // 0xa0 aftertouch, other 0xb0 controllers, 0xe0 pitch bend: read and ignored.
  }
  // Notes still sounding at the end of the track end there.
  for (const list of open.values()) for (const note of list) note.end = tick;
  out.endTick = Math.max(out.endTick, tick);
}

function meta(type, data, tick, track, info, out) {
  if (type === 0x51 && data.length >= 3) {
    const us = (data[0] << 16) | (data[1] << 8) | data[2];
    if (us > 0) out.tempos.push({tick, usPerQuarter: us, bpm: 60e6 / us});
  } else if (type === 0x58 && data.length >= 2) {
    const den = 2 ** data[1];
    if (data[0] > 0 && den <= 64) out.timeSigs.push({tick, num: data[0], den});
  } else if (type === 0x59 && data.length >= 2) {
    const sf = data[0] > 127 ? data[0] - 256 : data[0];
    if (sf >= -7 && sf <= 7) out.keySigs.push({tick, fifths: sf, minor: data[1] === 1});
  } else if (type === 0x03) {
    if (!info.name) info.name = textOf(data);
  } else if (type === 0x02) {
    if (!out.copyright) out.copyright = textOf(data);
  }
  if (type === 0x03 && track === 0 && !out.title) out.title = textOf(data);
}
