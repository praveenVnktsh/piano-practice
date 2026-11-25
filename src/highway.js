// Falling-notes "highway": notes drop toward the keyboard and land on their key
// at the moment they should be played. Times are in quarter notes.

const COLORS = {
  l: {fill: '#4da3ff', glow: 'rgba(77,163,255,.55)'},
  r: {fill: '#37e2a0', glow: 'rgba(55,226,160,.55)'},
  expected: {fill: '#ffbe3d', glow: 'rgba(255,190,61,.75)'},
  matched: {fill: 'rgba(255,255,255,.22)', glow: 'transparent'},
  auto: {fill: 'rgba(160,166,200,.32)', glow: 'transparent'},
  perfect: {fill: '#37e2a0', glow: 'rgba(55,226,160,.8)'},
  early: {fill: '#ffbe3d', glow: 'rgba(255,190,61,.7)'},
  late: {fill: '#ff9f43', glow: 'rgba(255,159,67,.7)'},
  miss: {fill: 'rgba(255,93,115,.55)', glow: 'transparent'},
};
const POPUP_MS = 800;
const LOOKAHEAD = 5; // quarter notes visible above the keys

export function createHighway({canvas, keys, getEvents, getMeasures, position, noteState, handColors = () => true, noteLabel = () => null}) {
  const ctx = canvas.getContext('2d');
  let lanes = new Map(), width = 0, height = 0, dpr = 1, shown = 0, raf = 0;
  const popups = []; // timing feedback words floating above the keys

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
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!width || !height) return;
    const target = position();
    if (target == null) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    // Follow exactly while playing; ease toward jumps (stepping, practice).
    shown = Math.abs(target - shown) > 8 ? target : shown + (target - shown) * .25;
    const pps = height / LOOKAHEAD;
    const y = t => height - (t - shown) * pps;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Lane guides on every C and F.
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (const [n, lane] of lanes) if (!lane.black && (n % 12 === 0 || n % 12 === 5)) ctx.fillRect(lane.x, 0, 1, height);

    // Beat and bar lines.
    ctx.font = '800 11px Nunito, system-ui, sans-serif';
    for (const m of getMeasures()) {
      if (m.end < shown || m.start > shown + LOOKAHEAD) continue;
      for (let t = m.start; t < m.end - 1e-6; t++) {
        const yy = y(t), bar = t === m.start;
        ctx.fillStyle = bar ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.05)';
        ctx.fillRect(0, yy, width, bar ? 2 : 1);
        if (bar && yy > 24 && yy < height - 28) { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillText(m.label, 8, yy - 6); }
      }
    }

    // Notes (white-key lanes first so black-key notes sit on top).
    const visible = getEvents().filter(e => e.t < shown + LOOKAHEAD && e.t + e.d > shown - .01 && lanes.has(e.n));
    visible.sort((a, b) => (lanes.get(a.n).black ? 1 : 0) - (lanes.get(b.n).black ? 1 : 0));
    for (const e of visible) {
      const lane = lanes.get(e.n);
      const top = y(e.t + e.d), bottom = Math.min(height, y(e.t));
      const state = noteState(e);
      const sounding = e.t <= shown && shown < e.t + e.d;
      const c = COLORS[state] ?? COLORS[handColors() && e.hand === 'l' ? 'l' : 'r'];
      const inset = lane.black ? 1 : Math.max(2, lane.w * .12);
      const x = lane.x + inset, w = lane.w - inset * 2, h = Math.max(6, bottom - top - 2);
      ctx.save();
      ctx.shadowColor = c.glow; ctx.shadowBlur = sounding || state === 'expected' ? 22 : 8;
      ctx.fillStyle = c.fill;
      roundRect(x, top, w, h, 7); ctx.fill();
      ctx.restore();
      const label = noteLabel(e);
      if (label && w >= 12 && h >= 16) {
        ctx.save();
        ctx.fillStyle = state === 'matched' || state === 'auto' ? 'rgba(255,255,255,.5)' : 'rgba(8,10,24,.82)';
        ctx.font = `900 ${Math.min(14, Math.max(9, w * .5))}px Nunito, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(label, x + w / 2, top + h - 3);
        ctx.restore();
      }
      if (state !== 'matched' && state !== 'auto' && state !== 'miss') {
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        roundRect(x + 2, top + 2, Math.max(2, w * .28), Math.max(2, h - 4), 4); ctx.fill();
      }
    }

    // "Perfect / Early / Late / Miss" rising from the key that was played.
    const now = performance.now();
    while (popups.length && now - popups[0].at > POPUP_MS) popups.shift();
    for (const p of popups) {
      const lane = lanes.get(p.n); if (!lane) continue;
      const k = (now - p.at) / POPUP_MS;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = (COLORS[p.kind] ?? COLORS.perfect).fill;
      ctx.font = '900 13px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(p.text, Math.max(28, Math.min(width - 28, lane.x + lane.w / 2)), height - 26 - k * 40);
      ctx.restore();
    }

    const grad = ctx.createLinearGradient(0, height - 18, 0, height);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,.12)');
    ctx.fillStyle = grad; ctx.fillRect(0, height - 18, width, 18);
  }

  new ResizeObserver(layout).observe(canvas);
  window.addEventListener('resize', layout);

  return {
    layout: () => requestAnimationFrame(layout),
    jump() { shown = position() ?? 0; },
    // Pixels per quarter note (for drag-to-scrub).
    pixelsPerQuarter: () => (height || canvas.clientHeight) / LOOKAHEAD,
    popup(n, text, kind) { popups.push({n, text, kind, at: performance.now()}); if (popups.length > 24) popups.shift(); },
    start() { layout(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
  };
}
