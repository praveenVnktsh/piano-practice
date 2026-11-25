// Hash routes (docs/ARCHITECTURE.md, "Views and routes"):
//   #/, #/today        Today: the home              (src/today/view.js)
//   #/pieces           the repertoire               (src/app/pieces.js)
//   #/exercises        exercises hub                (src/exercises/view.js)
//   #/progress         progress dashboard           (src/progress/view.js)
//   #/technique        technique builder, under Exercises
//   #/train/reading    note-reading trainer, under Exercises
//   #/exercises/sight-reading   sight-reading (src/sightread/view.js), under Exercises
//   #/exercises/rhythm          rhythm trainer (src/rhythm/view.js)
//   #/exercises/theory[/<id>]   theory lessons (src/theory/view.js), one lesson by id
//   #/exercises/ear             ear training (src/ear/view.js)
//   #/exercises/lessons[/<id>]  first lessons for beginners (src/lessons/view.js), one lesson by id
//   #/play/<id>        the player; exercise ids start with "ex:", sight-reading pieces with "sr:"
// Unknown paths fall back to Today. Routes with an argument come back as {name, arg}.

export const VIEW_ROUTES = {
  '/today': 'today',
  '/pieces': 'pieces',
  '/exercises': 'exercises',
  '/progress': 'progress',
  '/technique': 'technique',
  '/train/reading': 'train-reading',
  '/pieces/mutopia': 'mutopia',
  '/exercises/sight-reading': 'sight-reading',
  '/exercises/rhythm': 'rhythm',
  '/exercises/theory': 'theory',
  '/exercises/ear': 'ear',
  '/exercises/lessons': 'lessons',
};
// Views that take one path segment after their route: '/exercises/theory/intervals' → {name: 'theory-lesson', arg: 'intervals'}.
const ARG_ROUTES = [[/^\/exercises\/theory\/([a-z0-9-]+)$/, 'theory-lesson'], [/^\/exercises\/lessons\/([a-z0-9-]+)$/, 'lesson']];

export function parseRoute(hash = location.hash) {
  const path = (hash.replace(/^#/, '') || '/').split('?')[0];
  const m = path.match(/^\/play\/(.+)$/);
  if (m) {
    let id = m[1];
    try { id = decodeURIComponent(id); } catch {}
    return {name: 'play', id};
  }
  const clean = path.replace(/\/+$/, '');
  for (const [re, name] of ARG_ROUTES) { const a = clean.match(re); if (a) return {name, arg: a[1]}; }
  return {name: VIEW_ROUTES[clean] || 'today'};
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
