// Falling-notes "roll": notes descend toward the keyboard and land on their key
// at the moment they should be played. Times are in quarter notes.
//
// Drawn like an engraving, not a game: flat ink/brass bars on paper (light) or
// ivory/brass on graphite (dark), hairline bar lines, no glows or shadows.
// Every colour comes from the design tokens (src/styles/tokens.css), read off
// the canvas so both themes work; call refreshColors() when the theme changes.

const POPUP_MS = 900;
const LOOKAHEAD = 5; // quarter notes visible above the keys
const TOKENS = ['ink', 'ink-soft', 'ink-faint', 'rule', 'rule-strong', 'brass', 'sage', 'oxblood', 'right-hand', 'left-hand', 'paper-raised', 'font-text', 'font-ui'];

// Options: hideNotes() → true draws only the bar lines (memory check);
// barHeat(measure) → 'good' | 'fair' | 'weak' | null marks the bar at the left edge (trouble spots).
export function createHighway({canvas, keys, getEvents, getMeasures, position, noteState, handColors = () => true, noteLabel = () => null, hideNotes = () => false, barHeat = () => null}) {
  const ctx = canvas.getContext('2d');
  let lanes = new Map(), width = 0, height = 0, dpr = 1, shown = 0, raf = 0;
  let c = {}; // resolved token colours
  const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const popups = []; // timing feedback words rising from the keys

  function refreshColors() {
    const st = getComputedStyle(canvas);
    c = Object.fromEntries(TOKENS.map(t => [t, st.getPropertyValue('--' + t).trim()]));
    c.text = c['font-text'] || 'Georgia, serif';
    c.ui = c['font-ui'] || 'system-ui, sans-serif';
  }

  function layout() {
    const box = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = box.width; height = box.height;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    lanes = new Map();
    for (const key of keys.querySelectorAll('.pkey')) {
      const r = key.getBoundingClientRect();
      lanes.set(+key.dataset.note, {x: r.left - box.left, w: r.width, black: key.classList.contains('black')});
    }
    refreshColors();
  }

  function rect(x, y, w, h, r = 2) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }

  // Fill / outline for each note state. `alpha` softens the fill only.
  function look(state, hand) {
    const handInk = handColors() ? (hand === 'l' ? c['left-hand'] : c['right-hand']) : c.ink;
    switch (state) {
      case 'expected': return {fill: c.brass, alpha: 1, line: null, text: c['paper-raised']};
      case 'matched': return {fill: c.sage, alpha: .22, line: c.sage, text: c.sage};
      case 'auto': return {fill: null, alpha: 0, line: c['ink-faint'], text: c['ink-faint']};
      case 'perfect': return {fill: c.sage, alpha: .9, line: null, text: c['paper-raised']};
      case 'early': case 'late': return {fill: c.brass, alpha: .3, line: c.brass, text: c.brass};
      case 'miss': return {fill: c.oxblood, alpha: .14, line: c.oxblood, text: c.oxblood};
      default: return {fill: handInk, alpha: .9, line: null, text: c['paper-raised']};
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!width || !height) return;
    const target = position();
    if (target == null) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    // Follow exactly while playing; ease toward jumps (stepping, practice), unless motion is reduced.
    shown = Math.abs(target - shown) > 8 || reduceMotion?.matches ? target : shown + (target - shown) * .25;
    const pps = height / LOOKAHEAD;
    const y = t => height - (t - shown) * pps;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Lane guides: a faint hairline at every C, like ledger rules turned on end.
    ctx.globalAlpha = .55;
    ctx.fillStyle = c.rule;
    for (const [n, lane] of lanes) if (!lane.black && n % 12 === 0) ctx.fillRect(Math.round(lane.x), 0, 1, height);
    ctx.globalAlpha = 1;

    // Bar lines (hairline) and beats (fainter), bar numbers in italic.
    ctx.font = `italic 13px ${c.text}`;
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
    const HEAT = {good: c.sage, fair: c.brass, weak: c.oxblood};
    for (const m of getMeasures()) {
      if (m.end < shown || m.start > shown + LOOKAHEAD) continue;
      // Trouble spots: a faint mark down the left edge, the length of the bar.
      const heat = HEAT[barHeat(m)];
      if (heat) {
        const top = Math.max(0, y(m.end) + 2), bottom = Math.min(height, y(m.start) - 2);
        if (bottom > top) { ctx.globalAlpha = .5; ctx.fillStyle = heat; ctx.fillRect(0, top, 3, bottom - top); ctx.globalAlpha = 1; }
      }
      for (let t = m.start; t < m.end - 1e-6; t++) {
        const yy = Math.round(y(t)) + .5, bar = t === m.start;
        if (yy < 0 || yy > height) continue;
        ctx.globalAlpha = bar ? 1 : .45;
        ctx.fillStyle = bar ? c['rule-strong'] : c.rule;
        ctx.fillRect(0, yy - .5, width, 1);
        ctx.globalAlpha = 1;
        if (bar && yy > 22 && yy < height - 24) { ctx.fillStyle = c['ink-soft']; ctx.fillText(m.label, 6, yy - 4); }
      }
    }

    // Notes (white-key lanes first so black-key notes sit on top).
    const visible = hideNotes() ? [] : getEvents().filter(e => e.t < shown + LOOKAHEAD && e.t + e.d > shown - .01 && lanes.has(e.n));
    visible.sort((a, b) => (lanes.get(a.n).black ? 1 : 0) - (lanes.get(b.n).black ? 1 : 0));
    for (const e of visible) {
      const lane = lanes.get(e.n);
      const top = y(e.t + e.d), bottom = Math.min(height, y(e.t));
      const state = noteState(e);
      const s = look(state, e.hand);
      const inset = lane.black ? 1 : Math.max(2, lane.w * .14);
      const x = lane.x + inset, w = lane.w - inset * 2, h = Math.max(5, bottom - top - 2);
      if (s.fill) {
        ctx.globalAlpha = s.alpha; ctx.fillStyle = s.fill;
        rect(x, top, w, h); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (s.line) {
        ctx.strokeStyle = s.line; ctx.lineWidth = 1;
        rect(x + .5, top + .5, w - 1, h - 1); ctx.stroke();
      }
      // The note's onset: a fine rule at its foot, as on a piano roll.
      if (!state || state === 'expected') {
        ctx.globalAlpha = .35; ctx.fillStyle = c['paper-raised'];
        ctx.fillRect(x + 1, top + h - 2, w - 2, 1);
        ctx.globalAlpha = 1;
      }
      const label = noteLabel(e);
      if (label && w >= 12 && h >= 16) {
        ctx.fillStyle = s.text;
        ctx.font = `600 ${Math.min(13, Math.max(9, w * .46))}px ${c.ui}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(label, x + w / 2, top + h - 4);
      }
    }

    // The line where notes meet the keys: one brass hairline.
    ctx.fillStyle = c.brass;
    ctx.fillRect(0, height - 1, width, 1);

    // "Perfect / Early / Late / Miss" as small italic words rising from the key.
    const now = performance.now();
    while (popups.length && now - popups[0].at > POPUP_MS) popups.shift();
    ctx.font = `italic 500 15px ${c.text}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const p of popups) {
      const lane = lanes.get(p.n); if (!lane) continue;
      const k = (now - p.at) / POPUP_MS;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.fillStyle = p.kind === 'perfect' ? c.sage : p.kind === 'miss' ? c.oxblood : c.brass;
      ctx.fillText(p.text, Math.max(30, Math.min(width - 30, lane.x + lane.w / 2)), height - 12 - p.row * 17 - (reduceMotion?.matches ? 0 : k * 28)); // reduced motion: fade, don't rise
    }
    ctx.globalAlpha = 1;
  }

  new ResizeObserver(layout).observe(canvas);
  window.addEventListener('resize', layout);

  return {
    layout: () => requestAnimationFrame(layout),
    refreshColors: () => requestAnimationFrame(refreshColors),
    jump() { shown = position() ?? 0; },
    // Pixels per quarter note (for drag-to-scrub).
    pixelsPerQuarter: () => (height || canvas.clientHeight) / LOOKAHEAD,
    // Where score time t is drawn this frame, in px from the canvas top (overlays: bar comments).
    yOf: t => (height || canvas.clientHeight) - (t - shown) * ((height || canvas.clientHeight) / LOOKAHEAD),
    popup(n, text, kind) {
      // Words from neighbouring keys at nearly the same moment stack instead of overprinting.
      const at = performance.now(), x = lanes.get(n)?.x ?? 0;
      const row = popups.filter(p => at - p.at < 260 && Math.abs((lanes.get(p.n)?.x ?? 0) - x) < 70).length % 3;
      popups.push({n, text, kind, at, row});
      if (popups.length > 24) popups.shift();
    },
    start() { layout(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
  };
}
