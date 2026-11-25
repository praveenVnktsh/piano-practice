// In-app help: a "?" overlay typeset like a programme booklet (what each place does, how
// practising works, keyboard shortcuts, the iPad bridge, where data lives, backup).
// Opened with Shift+/ (?) anywhere, the "?" in the navigation rail's footer, the player's
// ⋯ → Help (#help-btn) and Progress → Settings. The content is loaded on first use.
import {el, keyForControl} from '../app/dom.js';

let open = null;   // the open overlay's {close}
let loading = null;

/** Wires the triggers. Call once, before views mount (the key guard must run first). */
export function installHelp({shell = document.querySelector('.shell')} = {}) {
  // Keys typed in an open modal dialog (help, introduction, import) never reach the shortcuts
  // of the page behind it: the player, the drills and the recordings listen on window.
  window.addEventListener('keydown', e => {
    const d = e.target?.closest?.('dialog[open]');
    if (d && d.matches(':modal')) e.stopImmediatePropagation();
  }, true);

  window.addEventListener('keydown', e => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (keyForControl(e)) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    openHelp();
  });

  // A quiet "?" in the rail's footer, above the theme switch.
  const foot = shell?.querySelector('.nav-foot');
  if (foot && !foot.querySelector('.nav-help')) {
    foot.prepend(el('button', {type: 'button', class: 'nav-help', 'aria-label': 'Help and keyboard shortcuts', title: 'Help (?)',
      'aria-haspopup': 'dialog', onclick: () => openHelp()},
    el('span', {class: 'nav-help-mark', 'aria-hidden': 'true', text: '?'}), el('span', {class: 'nav-help-label', text: 'Help'})));
  }

  // The player's ⋯ menu: one row (#help-btn in index.html). Close the menu, then return focus to ⋯.
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('#help-btn');
    if (!btn) return;
    const menu = document.getElementById('more-menu'), more = document.getElementById('more-btn');
    if (menu) menu.hidden = true;
    more?.setAttribute('aria-expanded', 'false');
    openHelp(null, {returnTo: more});
  });
}

/** Opens the help overlay, optionally at a section ('places' | 'practising' | 'shortcuts' | 'ipad' | 'data'). */
export function openHelp(section = null, {returnTo = document.activeElement} = {}) {
  if (open) { open.goTo(section); return Promise.resolve(); }
  loading ||= import('./overlay.js');
  return loading.then(m => {
    if (open) return open.goTo(section);
    open = m.showHelp({section, returnTo, onClose: () => { open = null; }});
  });
}
