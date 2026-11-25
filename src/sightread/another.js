// "Another one": after a sight-reading piece is played through (practice:result for an "sr:" id),
// a small note offers a fresh piece at the same level. It lives in the shell, outside #player,
// docked just above the keyboard (so it never covers the keys), hides itself after 12 seconds
// (not while the pointer or focus is on it), and goes away when the route changes.
//   watchSightReading({shell, navigate, first}) → stop()      first: a practice:result detail to show at once
import './sightread.css';
import {parseSightReadingId, sightReadingId} from './index.js';
import {playHref} from '../app/router.js';

export const SHOW_MS = 12000;
const GAP = 12; // px between the note and the keyboard

export function watchSightReading({shell, navigate, first = null}) {
  const box = document.createElement('div');
  box.className = 'sr-another';
  box.setAttribute('role', 'status');
  box.hidden = true;
  shell.append(box);
  let forId = null, timer = 0, held = false;

  // Sit just above the keyboard (the player's keybed); fall back to the stylesheet's position.
  function dock() {
    if (box.hidden) return;
    const keys = document.querySelector('#player:not([hidden]) .keybed') || document.querySelector('#player:not([hidden]) #um-keys');
    const r = keys?.getBoundingClientRect();
    if (r && r.height && r.top > 80) box.style.bottom = `${Math.max(8, Math.round(innerHeight - r.top + GAP))}px`;
    else box.style.removeProperty('bottom');
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (!held) hide(); }, SHOW_MS); };
  const hide = () => { clearTimeout(timer); box.hidden = true; forId = null; };
  // Pointer or keyboard focus on the note keeps it; leaving starts the clock again.
  const hold = on => { held = on; if (!on && !box.hidden) schedule(); };
  box.addEventListener('pointerenter', () => hold(true));
  box.addEventListener('pointerleave', () => hold(box.contains(document.activeElement)));
  box.addEventListener('focusin', () => hold(true));
  box.addEventListener('focusout', e => { if (!box.contains(e.relatedTarget)) hold(false); });

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
    held = false;
    dock();
    requestAnimationFrame(dock); // after the results card and keyboard have settled
    schedule();
  };
  const onRoute = () => { if (forId && !decodeURIComponent(location.hash).includes(forId)) hide(); };
  window.addEventListener('practice:result', onResult);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('resize', dock);
  if (first) onResult({detail: first});
  return () => {
    clearTimeout(timer);
    window.removeEventListener('practice:result', onResult);
    window.removeEventListener('hashchange', onRoute);
    window.removeEventListener('resize', dock);
    box.remove();
  };
}
