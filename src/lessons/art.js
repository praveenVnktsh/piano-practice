// Quiet line illustrations for the first lessons (src/lessons/lessons.js `art` ids). Pure SVG
// strings; every colour comes from classes styled with tokens in ./lessons.css.
//
//   art(id) → '<svg …>' | ''      ids: groups, cde, middle-c, posture, hand-shape, hands, c-position,
//                                 middle-c-position, group-2, group-3, hand-r, hand-l
//   keyboardSvg({lo, hi, marks, labels, fingers}) → '<svg …>'
//   handsSvg({hands: ['l', 'r'], on: {hand, finger}}) → '<svg …>'
import {isBlack, POSITIONS, MIDDLE_C, noteName} from './lessons.js';

const f = n => +n.toFixed(1);
const WW = 22, WH = 92, BW = 13, BH = 58; // white / black key sizes

/**
 * A stretch of keyboard. marks: {midi: 'on' | 'soft' | 'group'} washes keys; labels: {midi: text}
 * writes a letter on (or under) a key; fingers: {midi: number} puts a finger number above it.
 */
export function keyboardSvg({lo = 48, hi = 72, marks = {}, labels = {}, fingers = {}} = {}) {
  const whites = [];
  for (let n = lo; n <= hi; n++) if (!isBlack(n)) whites.push(n);
  const top = Object.keys(fingers).length ? 26 : 4;
  const width = whites.length * WW;
  const x = {};
  whites.forEach((n, i) => { x[n] = i * WW; });
  let w = '', b = '', t = '';
  for (const n of whites) {
    w += `<rect x="${f(x[n])}" y="${top}" width="${WW}" height="${WH}" rx="2" class="la-white${marks[n] ? ' is-' + marks[n] : ''}${n === MIDDLE_C ? ' is-middle' : ''}"/>`;
    if (labels[n]) t += `<text x="${f(x[n] + WW / 2)}" y="${top + WH - 9}" text-anchor="middle" class="la-label${marks[n] ? ' is-' + marks[n] : ''}">${labels[n]}</text>`;
    if (fingers[n] != null) t += `<circle cx="${f(x[n] + WW / 2)}" cy="12" r="9" class="la-finger"/><text x="${f(x[n] + WW / 2)}" y="16" text-anchor="middle" class="la-finger-n">${fingers[n]}</text>`;
  }
  for (let n = lo; n <= hi; n++) {
    if (!isBlack(n) || x[n - 1] == null) continue;
    const bx = x[n - 1] + WW - BW / 2;
    b += `<rect x="${f(bx)}" y="${top}" width="${BW}" height="${BH}" rx="1.5" class="la-black${marks[n] ? ' is-' + marks[n] : ''}"/>`;
    if (fingers[n] != null) t += `<circle cx="${f(bx + BW / 2)}" cy="12" r="9" class="la-finger"/><text x="${f(bx + BW / 2)}" y="16" text-anchor="middle" class="la-finger-n">${fingers[n]}</text>`;
  }
  return `<svg viewBox="-1 0 ${width + 2} ${top + WH + 2}" class="la-art la-keys" aria-hidden="true">${w}${b}${t}</svg>`;
}

// One stylised hand seen from above, palm down: five rounded fingers over a palm.
// Right hand: thumb on the left; the left hand is its mirror image.
const FINGERS = [ // [x offset, length] for fingers 1–5 of a right hand
  [0, 30], [24, 50], [44, 56], [64, 50], [83, 38],
];
function handPath(hand, ox, on) {
  const mirror = hand === 'l';
  let s = `<g transform="translate(${ox} 0)${mirror ? ' translate(104 0) scale(-1 1)' : ''}">`;
  s += '<path d="M6 108 C 4 92, 12 78, 22 74 L 98 70 C 104 84, 104 100, 98 118 C 80 130, 30 130, 12 122 Z" class="la-palm"/>';
  FINGERS.forEach(([dx, len], i) => {
    const n = i + 1, isOn = on === n;
    if (n === 1) { // the thumb, angled out
      s += `<rect x="2" y="64" width="17" height="${len + 10}" rx="8.5" transform="rotate(-38 10 100)" class="la-digit${isOn ? ' is-on' : ''}"/>`;
      s += `<g transform="translate(-18 64)${mirror ? ' scale(-1 1)' : ''}"><circle r="9" class="la-num${isOn ? ' is-on' : ''}"/><text y="4" text-anchor="middle" class="la-num-n">${n}</text></g>`;
      return;
    }
    const xx = dx + 6, top = 76 - len;
    s += `<rect x="${xx}" y="${top}" width="16" height="${len + 8}" rx="8" class="la-digit${isOn ? ' is-on' : ''}"/>`;
    s += `<g transform="translate(${xx + 8} ${top - 12})${mirror ? ' scale(-1 1)' : ''}"><circle r="9" class="la-num${isOn ? ' is-on' : ''}"/><text y="4" text-anchor="middle" class="la-num-n">${n}</text></g>`;
  });
  return s + '</g>';
}

/** Both hands (or one) with their finger numbers; `on` highlights one finger. */
export function handsSvg({hands = ['l', 'r'], on = null} = {}) {
  const gap = 175;
  const parts = hands.map((h, i) => handPath(h, 34 + i * gap, on?.hand === h ? on.finger : null)
    + `<text x="${34 + i * gap + 52}" y="150" text-anchor="middle" class="la-caption">${h === 'l' ? 'Left hand' : 'Right hand'}</text>`);
  return `<svg viewBox="0 -6 ${hands.length * gap - 5} 162" class="la-art la-hands" aria-hidden="true">${parts.join('')}</svg>`;
}

const POSTURE = `<svg viewBox="0 0 260 150" class="la-art la-posture" aria-hidden="true">
  <line x1="10" y1="140" x2="250" y2="140" class="la-line soft"/>
  <rect x="178" y="70" width="70" height="10" rx="2" class="la-piano"/>
  <line x1="190" y1="80" x2="190" y2="140" class="la-line soft"/><line x1="240" y1="80" x2="240" y2="140" class="la-line soft"/>
  <rect x="40" y="96" width="70" height="8" rx="2" class="la-bench"/>
  <line x1="48" y1="104" x2="48" y2="140" class="la-line soft"/><line x1="102" y1="104" x2="102" y2="140" class="la-line soft"/>
  <circle cx="92" cy="28" r="12" class="la-figure"/>
  <path d="M90 42 L 86 94" class="la-limb"/>
  <path d="M88 52 L 122 70 L 180 70" class="la-limb"/>
  <path d="M86 94 L 134 96 L 134 138 L 146 138" class="la-limb"/>
  <path d="M120 72 L 180 72" class="la-guide"/>
  <text x="150" y="62" text-anchor="middle" class="la-note-text">forearm level</text>
  <text x="140" y="132" text-anchor="start" class="la-note-text">feet flat</text>
</svg>`;

const HAND_SHAPE = `<svg viewBox="0 0 260 130" class="la-art la-shape" aria-hidden="true">
  <rect x="20" y="96" width="220" height="14" rx="2" class="la-white"/>
  <path d="M40 46 C 70 26, 130 22, 170 34 C 196 42, 206 62, 206 96" class="la-limb"/>
  <path d="M40 54 C 70 36, 128 34, 160 44 C 182 52, 192 70, 194 96" class="la-limb thin"/>
  <circle cx="122" cy="62" r="22" class="la-guide"/>
  <circle cx="200" cy="96" r="4" class="la-tip"/>
  <text x="122" y="66" text-anchor="middle" class="la-note-text">a ball</text>
  <text x="214" y="88" class="la-note-text">fingertip</text>
</svg>`;

/** The illustration for an art id ('' when unknown). */
export function art(id) {
  const range = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
  switch (id) {
    case 'groups': {
      const marks = {};
      for (const n of range(48, 72)) if (isBlack(n)) marks[n] = [1, 3].includes(n % 12) ? 'soft' : 'group';
      return keyboardSvg({lo: 48, hi: 72, marks});
    }
    case 'group-2': case 'group-3': {
      const marks = {};
      for (const n of range(48, 72)) if (isBlack(n) && ([1, 3].includes(n % 12) === (id === 'group-2'))) marks[n] = 'soft';
      return keyboardSvg({lo: 48, hi: 72, marks});
    }
    case 'cde': {
      const labels = {}, marks = {};
      for (const n of range(48, 72)) if ([0, 2, 4].includes(n % 12)) { labels[n] = noteName(n); marks[n] = n % 12 === 0 ? 'on' : 'soft'; }
      return keyboardSvg({lo: 48, hi: 72, marks, labels});
    }
    case 'middle-c': return keyboardSvg({lo: 48, hi: 72, marks: {[MIDDLE_C]: 'on'}, labels: {[MIDDLE_C]: 'C'}});
    case 'posture': return POSTURE;
    case 'hand-shape': return HAND_SHAPE;
    case 'hands': return handsSvg();
    case 'hand-r': return handsSvg({hands: ['r']});
    case 'hand-l': return handsSvg({hands: ['l']});
    case 'c-position': case 'middle-c-position': {
      const pos = POSITIONS[id === 'c-position' ? 'c' : 'middle-c'];
      const fingers = {}, marks = {}, labels = {};
      pos.l.forEach((n, i) => { fingers[n] = i + 1; marks[n] = 'lh'; labels[n] = noteName(n); });
      pos.r.forEach((n, i) => { fingers[n] = n === MIDDLE_C && id === 'middle-c-position' ? '1 1' : i + 1; marks[n] = n === MIDDLE_C ? 'on' : 'rh'; labels[n] = noteName(n); });
      return keyboardSvg({lo: 48, hi: 69, marks, labels, fingers});
    }
  }
  return '';
}
