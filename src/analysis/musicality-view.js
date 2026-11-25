// The musicality figure on the results card (and in a recording's review): fine-line
// engravings, tokens only. Phrase contours (played in ink, the shaped model as a brass dash),
// the tempo flex (the shaped tempo as an ink line over faint beat dots), and voicing as one
// sentence. The analysis is ./musicality.mjs; this file only draws it.
//
//   musicalityMarkup(m) → HTML string ('' when there is nothing to show)
//   renderMusicality(fig, m)   fills the figure and hides it when empty

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const W = 300, H = 56;
const FLEX_WORD = {steady: 'steady', expressive: 'expressive', unsteady: 'unsteady'};

function shapeSvg(shape) {
  const pts = shape.phrases.flatMap(p => p.points);
  if (pts.length < 2) return '';
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  const vs = pts.flatMap(p => [p.v, p.m]);
  const lo = Math.min(...vs) - 3, hi = Math.max(...vs) + 3;
  const x = t => 4 + (W - 8) * (t1 > t0 ? (t - t0) / (t1 - t0) : .5);
  const y = v => 4 + (H - 8) * (1 - (v - lo) / Math.max(1, hi - lo));
  let s = '';
  shape.phrases.forEach((p, i) => {
    if (i > 0) { const xx = x((shape.phrases[i - 1].points.at(-1).t + p.points[0].t) / 2).toFixed(1); s += `<line class="g-zero" x1="${xx}" x2="${xx}" y1="2" y2="${H - 2}"/>`; }
    const line = key => p.points.map(q => `${x(q.t).toFixed(1)},${y(q[key]).toFixed(1)}`).join(' ');
    s += `<polyline class="g-vel" points="${line('m')}"/><polyline class="g-time" points="${line('v')}"/>`;
  });
  return `<svg class="touch-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${s}</svg>`;
}

function flexSvg(flex) {
  const beats = flex.curve.filter(c => c[1] != null);
  if (beats.length < 2) return '';
  const t0 = flex.curve[0][0], t1 = flex.curve.at(-1)[0];
  const vals = beats.flatMap(c => [c[1], c[2]]).filter(v => v != null);
  const lo = Math.min(...vals, flex.meanBpm) * .97, hi = Math.max(...vals, flex.meanBpm) * 1.03;
  const x = t => 4 + (W - 8) * (t1 > t0 ? (t - t0) / (t1 - t0) : .5);
  const y = v => 4 + (H - 8) * (1 - (v - lo) / Math.max(1, hi - lo));
  let s = `<line class="g-zero" x1="0" x2="${W}" y1="${y(flex.meanBpm).toFixed(1)}" y2="${y(flex.meanBpm).toFixed(1)}"/>`;
  s += beats.map(c => `<circle class="g-beat" cx="${x(c[0]).toFixed(1)}" cy="${y(c[1]).toFixed(1)}" r="1.4"/>`).join('');
  let d = '', pen = false;
  for (const [t, , v] of flex.curve) { if (v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }
  s += `<path class="g-time" d="${d}"/>`;
  return `<svg class="touch-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${s}</svg>`;
}

export function musicalityMarkup(m) {
  if (!m) return '';
  const parts = [];
  if (m.shape) {
    parts.push(`<div class="music-part music-shape">
      <div class="touch-head"><span class="touch-label">Phrasing</span><span class="touch-score">${m.shape.score}</span></div>
      ${shapeSvg(m.shape)}
      <p class="touch-cap"><i class="k-time"></i>played <i class="k-vel"></i>a shaped line</p>
      ${m.shape.hint ? `<p class="music-hint">${esc(m.shape.hint)}</p>` : ''}</div>`);
  }
  if (m.flex) {
    parts.push(`<div class="music-part music-flex">
      <div class="touch-head"><span class="touch-label">Tempo feel</span><span class="music-word">${FLEX_WORD[m.flex.label] ?? ''}</span></div>
      ${flexSvg(m.flex)}
      <p class="touch-cap"><i class="k-time"></i>shaped tempo <i class="k-dot"></i>beat by beat <span>· flex ±${m.flex.flexPct}% · beat to beat ±${m.flex.jitterPct}%</span></p>
      <p class="music-hint">${esc(m.flex.remark)}</p></div>`);
  }
  if (m.voicing) {
    parts.push(`<div class="music-part music-voicing">
      <div class="touch-head"><span class="touch-label">Voicing</span><span class="music-word">${m.voicing.melody === 'through' ? 'melody above' : m.voicing.melody}</span></div>
      <p class="music-hint">${esc(m.voicing.remark)}</p></div>`);
  }
  return parts.join('');
}

export function renderMusicality(fig, m) {
  if (!fig) return;
  const html = musicalityMarkup(m);
  fig.innerHTML = html;
  fig.hidden = !html;
}
