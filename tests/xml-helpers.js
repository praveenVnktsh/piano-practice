// Tiny regex helpers for inspecting the MusicXML the converters write.
// (The writers emit one <note> per line, so this stays simple.)

export const measures = xml =>
  [...xml.matchAll(/<measure number="(-?\d+)"([^>]*)>([\s\S]*?)<\/measure>/g)].map(([, number, attrs, body]) => ({
    number: +number,
    implicit: /implicit="yes"/.test(attrs),
    body,
  }));

const tag = (s, t) => s.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];

export const notes = xml =>
  [...xml.matchAll(/<note>([\s\S]*?)<\/note>/g)].map(([, n]) => ({
    pitch: n.includes('<pitch>')
      ? `${tag(n, 'step')}${{'-2': 'bb', '-1': 'b', 1: '#', 2: '##'}[tag(n, 'alter')] ?? ''}${tag(n, 'octave')}`
      : null,
    rest: n.includes('<rest'),
    chord: n.includes('<chord/>'),
    duration: +tag(n, 'duration'),
    type: tag(n, 'type'),
    dots: (n.match(/<dot\/>/g) ?? []).length,
    voice: tag(n, 'voice'),
    staff: tag(n, 'staff'),
    accidental: tag(n, 'accidental') ?? null,
    tieStart: n.includes('<tie type="start"/>'),
    tieStop: n.includes('<tie type="stop"/>'),
    beams: [...n.matchAll(/<beam number="(\d)">([^<]*)<\/beam>/g)].map(([, num, v]) => `${num}:${v}`),
    tuplet: n.includes('<time-modification>'),
  }));
