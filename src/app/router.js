// Hash routes (docs/ARCHITECTURE.md, "Views and routes"):
//   #/, #/today        Today: the home              (src/today/view.js)
//   #/pieces           the repertoire               (src/app/pieces.js)
//   #/exercises        exercises hub                (src/exercises/view.js)
//   #/progress         progress dashboard           (src/progress/view.js)
//   #/technique        technique builder, under Exercises
//   #/train/reading    note-reading trainer, under Exercises
//   #/play/<id>        the player; exercise ids start with "ex:"
// Unknown paths fall back to Today.

export const VIEW_ROUTES = {
  '/today': 'today',
  '/pieces': 'pieces',
  '/exercises': 'exercises',
  '/progress': 'progress',
  '/technique': 'technique',
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
  return {name: VIEW_ROUTES[path.replace(/\/+$/, '')] || 'today'};
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
