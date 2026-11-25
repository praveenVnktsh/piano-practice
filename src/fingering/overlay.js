// Suggested fingering drawn on the rendered score (Settings → Fingering numbers). Small italic
// numerals in --ink-soft: above the staff's notes for the right hand, below for the left, a chord's
// numbers stacked with the top note's finger on top. Printed fingering is never touched: bars that
// have any are left alone (./suggest.mjs). Positions come from each notehead's box, as the note
// names inside the noteheads do (src/player.js labelNoteheads), so they need the score laid out.
//
//   fingeringFor(song, {beginner}) → Map(noteId → finger), memoised per song
//   drawSuggestedFingering(svg, noteEls, song, fingers) → number of numerals drawn

import {suggestForSong} from './suggest.mjs';

const cache = new WeakMap();
export function fingeringFor(song, {beginner = false} = {}) {
  if (!song) return new Map();
  const key = beginner ? 'b' : 'a';
  let byKey = cache.get(song);
  if (!byKey) cache.set(song, byKey = {});
  return byKey[key] ??= suggestForSong(song, {printed: song.printedFingering, beginner});
}

const NS = 'http://www.w3.org/2000/svg';
const box = el => { try { const b = el.getBBox(); return b.width || b.height ? b : null; } catch { return null; } };

// The five staff lines' extent (the staff's own <path> children).
function staffLines(staff) {
  const lines = staff ? [...staff.children].filter(c => c.localName === 'path').map(box).filter(Boolean) : [];
  if (!lines.length) return null;
  return {top: Math.min(...lines.map(b => b.y)), bottom: Math.max(...lines.map(b => b.y + b.height))};
}

export function drawSuggestedFingering(svg, noteEls, song, fingers) {
  if (!svg || !fingers?.size) return 0;
  svg.querySelectorAll('g.sfing').forEach(g => g.remove());
  const segs = new Map(song.segments.map(s => [s.id, s]));
  // Notes struck together on one staff share a stack.
  const groups = new Map();
  for (const [id, finger] of fingers) {
    const el = noteEls.get(id), seg = segs.get(id);
    const head = el?.querySelector('.notehead');
    const b = head && box(head);
    if (!b || !seg) continue;
    const staff = el.closest('.staff');
    const key = `${staff?.id ?? seg.staff}:${seg.t}`;
    if (!groups.has(key)) groups.set(key, {staff, hand: seg.hand, notes: []});
    groups.get(key).notes.push({el, b, n: seg.n, finger});
  }
  let drawn = 0;
  for (const {staff, hand, notes} of groups.values()) {
    const measure = staff?.closest('.measure');
    if (!measure) continue;
    const h = Math.max(...notes.map(p => p.b.height));
    const size = h * 1.35, line = size * .95, pad = h * .45;
    const x = notes.reduce((s, p) => s + p.b.x + p.b.width / 2, 0) / notes.length;
    const lines = staffLines(staff);
    // The notes' full extent (stems and ledger lines included), and the staff's.
    const ext = notes.map(p => box(p.el.closest('.chord') ?? p.el)).filter(Boolean);
    // Clear of a tempo or direction printed above the same spot (the right hand's numbers).
    // (Measured by their text runs: a music-font glyph's box in a 0px <text> comes back huge.)
    const marks = hand === 'l' ? [] : [...measure.querySelectorAll(':scope > .tempo tspan, :scope > .dir tspan')].map(box)
      .filter(b => b && b.height < h * 6 && b.x <= x + h && b.x + b.width >= x - h && (!lines || b.y < lines.top));
    const top = Math.min(lines?.top ?? Infinity, ...ext.map(b => b.y), ...marks.map(b => b.y));
    const bottom = Math.max(lines?.bottom ?? -Infinity, ...ext.map(b => b.y + b.height));
    const order = [...notes].sort((a, b) => b.n - a.n); // top note first
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'sfing ' + (hand === 'l' ? 'h-l' : 'h-r'));
    const title = document.createElementNS(NS, 'title');
    title.textContent = 'Suggested fingering';
    g.append(title);
    order.forEach((p, i) => {
      const t = document.createElementNS(NS, 'text');
      // Right hand: the stack sits above, its last line just clear of the music; left hand: below.
      const y = hand === 'l' ? bottom + pad + size * .8 + i * line : top - pad - (order.length - 1 - i) * line;
      t.setAttribute('x', x.toFixed(1));
      t.setAttribute('y', y.toFixed(1));
      t.setAttribute('font-size', size.toFixed(1));
      t.textContent = String(p.finger);
      g.append(t);
      drawn++;
    });
    measure.append(g);
  }
  return drawn;
}
