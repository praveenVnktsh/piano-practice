// Hash routes:
//   #/                 library (the player with the last song)
//   #/play/<id>        the player; exercise ids start with "ex:"
//   #/technique        exercise builder        (src/exercises/view.js)
//   #/progress         progress dashboard      (src/progress/view.js)
//   #/train/reading    note-reading trainer    (src/trainer/view.js)
// Unknown paths fall back to the library.

export const VIEW_ROUTES = {
  '/technique': 'technique',
  '/progress': 'progress',
  '/train/reading': 'train-reading',
};

export function parseRoute(hash = location.hash) {
  const path = (hash.replace(/^#/, '') || '/').split('?')[0];
  const m = path.match(/^\/play\/(.+)$/);
  if (m) {
    let id = m[1];
    try { id = decodeURIComponent(id); } catch {}
    return {name: 'play', id};
  }
  const view = VIEW_ROUTES[path.replace(/\/+$/, '')];
  if (view) return {name: view};
  return {name: 'library'};
}

export const playHref = id => '#/play/' + encodeURIComponent(id);

export function navigate(href, {replace = false} = {}) {
  if (location.hash === href) return false;
  if (replace) {
    history.replaceState(history.state, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.hash = href;
  return true;
}

/** Calls handler(route) now and on every hash change. */
export function startRouter(handler) {
  const run = () => handler(parseRoute());
  window.addEventListener('hashchange', run);
  run();
  return () => window.removeEventListener('hashchange', run);
}
