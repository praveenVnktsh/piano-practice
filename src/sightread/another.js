// "Another one": after a sight-reading piece is played through (practice:result for an "sr:" id),
// a small note at the foot of the screen offers a fresh piece at the same level. It lives in the
// shell, outside #player, and goes away when the route changes.
//   watchSightReading({shell, navigate, first}) → stop()      first: a practice:result detail to show at once
import './sightread.css';
import {parseSightReadingId, sightReadingId} from './index.js';
import {playHref} from '../app/router.js';

export function watchSightReading({shell, navigate, first = null}) {
  const box = document.createElement('div');
  box.className = 'sr-another';
  box.setAttribute('role', 'status');
  box.hidden = true;
  shell.append(box);
  let forId = null;

  const hide = () => { box.hidden = true; forId = null; };
  const onResult = e => {
    const d = e.detail || {};
    const p = parseSightReadingId(d.songId);
    if (!p || !location.hash.startsWith('#/play/')) return;
    forId = d.songId;
    const acc = Math.round(d.accuracy ?? 0);
    const verdict = acc >= 95 ? 'Well read.' : acc >= 80 ? 'Nearly clean.' : 'Keep going — a new one, or try this again.';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'sr-another-go';
    next.textContent = 'Another one';
    next.addEventListener('click', () => { hide(); navigate(playHref(sightReadingId(p.level))); });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sr-another-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', hide);
    const text = document.createElement('span');
    text.className = 'sr-another-text';
    text.innerHTML = `<b>${acc}%</b> ${verdict}`;
    box.replaceChildren(text, next, close);
    box.hidden = false;
  };
  const onRoute = () => { if (forId && !decodeURIComponent(location.hash).includes(forId)) hide(); };
  window.addEventListener('practice:result', onResult);
  window.addEventListener('hashchange', onRoute);
  if (first) onResult({detail: first});
  return () => {
    window.removeEventListener('practice:result', onResult);
    window.removeEventListener('hashchange', onRoute);
    box.remove();
  };
}
