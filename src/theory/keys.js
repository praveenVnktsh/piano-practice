// A small on-screen piano for the theory and ear exercises: tap a key to play it (and answer).
//   createKeys({lo, hi, piano, onNote}) → {el, mark(midi, 'ok' | 'bad' | 'target'), clear(), press(midi)}
// The parent view also feeds MIDI from window `piano:note` into its own handler; press(n) shows it.
import './keys.css';
import {midiName} from './music.js';

const isBlack = n => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);

export function createKeys({lo = 48, hi = 84, piano = null, onNote = () => {}, sound = true} = {}) {
  const whites = [];
  for (let n = lo; n <= hi; n++) if (!isBlack(n)) whites.push(n);
  const W = whites.length;
  const keys = document.createElement('div');
  keys.className = 'kb-keys';
  keys.style.setProperty('--whites', W);
  let html = '';
  whites.forEach((n, i) => {
    html += `<button type="button" class="kb-key kb-white${n === 60 ? ' kb-middle' : ''}" data-note="${n}" style="left:${(100 * i / W).toFixed(4)}%" aria-label="${midiName(n)}">${n % 12 === 0 ? `<span>${midiName(n)}</span>` : ''}</button>`;
    if (n + 1 <= hi && isBlack(n + 1)) html += `<button type="button" class="kb-key kb-black" data-note="${n + 1}" style="left:${(100 * (i + 1) / W).toFixed(4)}%" aria-label="${midiName(n + 1)}"></button>`;
  });
  keys.innerHTML = html;
  const wrap = document.createElement('div');
  wrap.className = 'kb';
  wrap.append(keys);
  const keyEl = n => keys.querySelector(`[data-note="${n}"]`);
  const timers = new Set();
  const flash = (k, cls, ms) => { k.classList.add(cls); const t = setTimeout(() => { timers.delete(t); k.classList.remove(cls); }, ms); timers.add(t); };

  function play(n) {
    if (sound && piano) try { piano.tone(n, 1.1, .66); } catch {}
    onNote(n);
  }
  keys.addEventListener('pointerdown', e => {
    const k = e.target.closest('.kb-key');
    if (!k) return;
    e.preventDefault();
    flash(k, 'down', 160);
    play(+k.dataset.note);
  });
  keys.addEventListener('click', e => {
    const k = e.target.closest('.kb-key');
    if (k && e.detail === 0) play(+k.dataset.note); // Enter / Space on a focused key
  });
  // Centre middle C when the keys are wider than the screen.
  requestAnimationFrame(() => {
    const c = keyEl(60);
    if (c && wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = c.offsetLeft + c.offsetWidth / 2 - wrap.clientWidth / 2;
  });
  return {
    el: wrap,
    press(n) { const k = keyEl(n); if (k) flash(k, 'down', 180); },
    mark(n, cls, ms = 0) {
      const k = keyEl(n);
      if (!k) return;
      if (ms) flash(k, cls, ms); else k.classList.add(cls);
    },
    clear() { for (const k of keys.querySelectorAll('.ok, .bad, .target')) k.classList.remove('ok', 'bad', 'target'); },
    destroy() { timers.forEach(clearTimeout); wrap.remove(); },
  };
}
