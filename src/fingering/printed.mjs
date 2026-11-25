// Printed fingering in a score (MEI from Verovio: MusicXML <fingering> becomes <fing>). Pure, no DOM.
//
//   printedFingering(meiText) → {fingers: Map(noteId → 1..5), bars: Set('<measureId>:<staff>')}
//
// `bars` holds every bar and staff with any printed number, so a suggestion never mixes into an
// editor's fingering; `fingers` anchors the suggestion around it (single-digit marks on a note).

const attr = (attrs, name) => attrs.match(new RegExp(`\\s${name.replace('.', '\\.')}="([^"]*)"`))?.[1];

export function printedFingering(mei) {
  const fingers = new Map(), bars = new Set();
  if (typeof mei !== 'string' || !mei.includes('<fing')) return {fingers, bars};
  for (const m of mei.matchAll(/<measure\b([^>]*)>([\s\S]*?)<\/measure>/g)) {
    const body = m[2];
    if (!body.includes('<fing')) continue;
    const id = attr(m[1], 'xml:id') ?? '';
    // Which staff each note (or chord) is on, for marks without @staff.
    const staffOf = new Map();
    for (const s of body.matchAll(/<staff\b([^>]*)>([\s\S]*?)<\/staff>/g)) {
      const n = attr(s[1], 'n') ?? '1';
      for (const e of s[2].matchAll(/<(?:note|chord)\b[^>]*\sxml:id="([^"]+)"/g)) staffOf.set(e[1], n);
    }
    for (const f of body.matchAll(/<fing\b([^>]*?)(?:\/>|>([\s\S]*?)<\/fing>)/g)) {
      const start = (attr(f[1], 'startid') ?? '').replace(/^#/, '');
      const staves = (attr(f[1], 'staff') ?? staffOf.get(start) ?? '1').split(/\s+/);
      for (const s of staves) bars.add(`${id}:${s}`);
      const text = (f[2] ?? '').replace(/<[^>]*>/g, '').trim();
      if (start && /^[1-5]$/.test(text)) fingers.set(start, +text);
    }
  }
  return {fingers, bars};
}
