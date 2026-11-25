// Theme choice: Auto (follow the system), Paper (light) or Concert hall (dark).
// Sets data-theme on <html> (src/styles/tokens.css) and remembers the choice.
const KEY = 'piano-practice.theme';
export const THEMES = [
  {id: 'auto', label: 'Auto'},
  {id: 'light', label: 'Paper'},
  {id: 'dark', label: 'Concert hall'},
];
export const THEME_EVENT = 'theme:change';

export function getTheme() {
  try { const v = localStorage.getItem(KEY); return THEMES.some(t => t.id === v) ? v : 'auto'; } catch { return 'auto'; }
}

function apply(id) {
  const html = document.documentElement;
  if (id === 'auto') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', id);
  // The browser chrome follows the paper colour.
  requestAnimationFrame(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(html).getPropertyValue('--paper').trim() || meta.content;
  });
}

export function setTheme(id) {
  if (!THEMES.some(t => t.id === id)) id = 'auto';
  try { id === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, id); } catch {}
  apply(id);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, {detail: {theme: id}}));
}

export function initTheme() {
  apply(getTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => apply(getTheme()));
}

export const themeLabel = id => THEMES.find(t => t.id === id)?.label || 'Auto';
