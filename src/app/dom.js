// Tiny DOM helpers shared by the shell's views.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // only for static markup (icons)
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

// Fine-line icons (24 × 24, stroked). Drawn to sit with the hairline rules.
export const ICONS = {
  today: 'M3 17.5h18M6.5 17.5a5.5 5.5 0 0 1 11 0M12 6.5V4M6.2 9.7 4.6 8.1M17.8 9.7l1.6-1.6M8 20.5h8',
  pieces: 'M6 3.5h8.5L18.5 7.5v13H6zM14.5 3.5v4h4M8.5 11h7.5M8.5 13.5h7.5M8.5 16h7.5',
  exercises: 'M9.5 3.5h5l4 17h-13zM7.4 15.5h9.2M12 15.5l3.6-8.5',
  progress: 'M4 3.5v17h16.5M7.5 15l3.5-4 3 2.5 5-6.5',
  back: 'M14.5 6 8.5 12l6 6',
  theme: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 3.5v17',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  search: 'M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5',
};
export const icon = (name, cls = 'ln-icon') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls);
  s.innerHTML = `<path d="${ICONS[name]}"/>`;
  return s;
};

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export {fold};

export const DIFFICULTY = {beginner: 'Beginner', easy: 'Easy', intermediate: 'Intermediate', advanced: 'Advanced'};

/** "today" / "yesterday" / "3 days ago" / "12 Nov". */
export function ago(at, now = Date.now()) {
  if (!at) return '';
  const day = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const days = Math.round((day(now) - day(at)) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

/** Repertoire status from best accuracy: learning → secure → polished. */
export function pieceStatus(stat) {
  if (!stat || stat.best == null) return stat?.minutes > 0 ? 'Listened' : null;
  if (stat.best >= 95) return 'Polished';
  if (stat.best >= 85) return 'Secure';
  return 'Learning';
}
