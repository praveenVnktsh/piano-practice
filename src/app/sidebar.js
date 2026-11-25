// Navigation: the four places as a slim rail on wide screens and a tab bar on iPad portrait
// and phones (one <nav>, laid out by src/styles/shell.css). Also the shell's quiet toast.
import {el, icon} from './dom.js';
import {getTheme, setTheme, themeLabel, THEMES, THEME_EVENT} from './theme.js';
import {isExerciseId} from '../exercises/index.js';

export const PLACES = [
  {id: 'today', href: '#/', label: 'Today'},
  {id: 'pieces', href: '#/pieces', label: 'Pieces'},
  {id: 'exercises', href: '#/exercises', label: 'Exercises'},
  {id: 'progress', href: '#/progress', label: 'Progress'},
];

const RECENT_KEY = 'piano-practice.recent-exercises';
const RECENT_MAX = 4;
export const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(isExerciseId) : []; } catch { return []; } };
export function rememberExercise(id) {
  const list = [id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

export function createNav(shell) {
  const links = PLACES.map(p => el('a', {class: 'nav-link', href: p.href, 'data-place': p.id},
    icon(p.id, 'ln-icon nav-icon'), el('span', {class: 'nav-label', text: p.label})));

  const themeBtn = el('button', {type: 'button', class: 'nav-theme'}, icon('theme', 'ln-icon'), el('span', {class: 'nav-theme-label'}));
  const syncTheme = () => {
    const t = getTheme();
    themeBtn.lastChild.textContent = themeLabel(t);
    themeBtn.setAttribute('aria-label', `Theme: ${themeLabel(t)}. Change theme`);
    themeBtn.title = 'Theme: Auto · Paper · Concert hall';
  };
  themeBtn.addEventListener('click', () => {
    const i = THEMES.findIndex(t => t.id === getTheme());
    setTheme(THEMES[(i + 1) % THEMES.length].id);
  });
  window.addEventListener(THEME_EVENT, syncTheme);
  syncTheme();

  const nav = el('nav', {class: 'nav', 'aria-label': 'Main'},
    el('a', {class: 'nav-mark', href: '#/', 'aria-label': 'Piano Practice — Today'},
      el('span', {class: 'nav-mark-a', text: 'Piano'}), el('span', {class: 'nav-mark-b', text: 'Practice'})),
    el('div', {class: 'nav-links'}, ...links),
    el('div', {class: 'nav-foot'}, themeBtn));
  shell.prepend(nav);

  return {
    setActive(place) {
      for (const a of links) {
        if (a.dataset.place === place) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
  };
}

/** A small paper slip at the bottom of the screen. toast(text, 'ok' | 'warn'). */
export function createToast(shell) {
  const box = el('div', {class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true});
  shell.append(box);
  let timer = null;
  return (text, tone = 'warn') => {
    clearTimeout(timer);
    box.hidden = !text;
    box.dataset.tone = tone;
    box.replaceChildren(...(text ? [el('span', {text}), el('button', {type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onclick: () => { box.hidden = true; }}, icon('close'))] : []));
    if (text) timer = setTimeout(() => { box.hidden = true; }, tone === 'ok' ? 5000 : 9000);
  };
}
