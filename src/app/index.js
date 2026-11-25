// App shell: the four places (Today · Pieces · Exercises · Progress), the navigation rail /
// tab bar, the import dialog and the router, wired to the player (docs/DESIGN.md,
// "Information architecture").
import {createPlayer} from '../player.js';
import {loadSong} from '../song.js';
import * as catalog from './catalog.js';
import {listImports, deleteImport, migrateLegacy, migrateToServer, importStore} from './imports.js';
import {startRouter, navigate, playHref} from './router.js';
import {createNav, createToast, rememberExercise} from './sidebar.js';
import {createImportDialog} from './import-dialog.js';
import {mountPieces} from './pieces.js';
import {initTheme} from './theme.js';
import {el, icon} from './dom.js';
import {startProgressTracking} from '../progress/store.js';
import {isExerciseId} from '../exercises/index.js';
import {installHelp} from '../help/index.js';
import {startOnboarding} from '../onboarding/index.js';

const {loadCatalogs, songSource} = catalog;

// Views shown in the main area instead of the player (docs/ARCHITECTURE.md, "Views and routes").
// import.meta.glob = lazy import() that also works while a module doesn't exist yet (→ "coming soon").
const VIEW_MODULES = import.meta.glob(['../today/view.js', '../exercises/view.js', '../progress/view.js', '../trainer/view.js', '../mutopia/view.js',
  '../sightread/view.js', '../rhythm/view.js', '../theory/view.js', '../ear/view.js']);

const LAST_KEY = 'piano-practice.last-song';
const RETURN_KEY = 'piano-practice.return-to';
const APP_NAME = 'Piano Practice';
const getLast = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
const setLast = id => { try { id ? localStorage.setItem(LAST_KEY, id) : localStorage.removeItem(LAST_KEY); } catch {} };
const ssGet = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };

export async function startApp() {
  initTheme();
  const $ = id => document.getElementById(id);
  const shell = document.querySelector('.shell');
  const root = $('player');
  // The old library drawer is gone: the navigation rail takes its place.
  $('library')?.remove();
  $('library-scrim')?.remove();

  const player = createPlayer(root);
  startProgressTracking();
  const toast = createToast(shell);
  const nav = createNav(shell);
  installHelp({shell}); // "?" help overlay (before any view mounts: its key guard runs first)
  const back = createBackButton(root);
  // Sight-reading: "Another one" after a generated piece is played through (loaded when first needed).
  let srWatch = null;
  window.addEventListener('practice:result', e => {
    if (srWatch || !String(e.detail?.songId || '').startsWith('sr:')) return;
    srWatch = import('../sightread/another.js').then(m => m.watchSightReading({shell, navigate, first: e.detail}));
  });

  // ───── the library: catalogs + imports ─────
  const entries = {bundled: [], local: [], imports: [], importsWhere: 'browser', loaded: false};
  const listeners = new Set();
  const changed = () => listeners.forEach(fn => { try { fn(entries); } catch (e) { console.warn(e); } });
  const all = () => [...entries.bundled, ...entries.local, ...entries.imports];
  const find = id => all().find(e => e.id === id);
  const asEntry = rec => ({...rec, kind: 'import'});
  let currentId = null;

  const importDialog = createImportDialog({
    dialog: $('import-dialog'),
    async onImported(rec, warning, where) {
      await refreshImports();
      const done = rec.duplicate ? `“${rec.title}” is already in your library.`
        : `Imported “${rec.title}”${where === 'mac' ? ' — saved on your Mac' : ''}.`;
      toast(warning || done, warning ? 'warn' : 'ok');
      navigate(playHref(rec.id));
    },
  });

  // Imports can live on the Mac and be shared with the iPad, so this also runs when the window regains focus.
  // Fetches run one after another, so a refresh asked for mid-fetch still sees the latest list.
  let queue = Promise.resolve(), lastRefresh = 0;
  function refreshImports() {
    const run = queue.then(fetchImports);
    queue = run.catch(() => {});
    return run;
  }
  async function fetchImports() {
    const where = await importStore();
    try { entries.imports = (await listImports()).map(asEntry); }
    catch (e) {
      console.warn('Imported songs unavailable:', e);
      // A failed re-fetch from the Mac keeps the list we have rather than emptying it.
      if (where !== 'mac') entries.imports = [];
    }
    lastRefresh = Date.now();
    entries.importsWhere = where;
    changed();
  }
  const refetchOnReturn = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 2000) return;
    importStore().then(where => { if (where === 'mac') refreshImports(); });
  };
  window.addEventListener('focus', refetchOnReturn);
  document.addEventListener('visibilitychange', refetchOnReturn);

  async function removeImport(entry) {
    try { await deleteImport(entry.id); }
    catch (e) {
      toast((await importStore()) === 'mac' ? `Could not delete from your Mac: ${e.message}` : 'Could not delete — browser storage is unavailable.');
      await refreshImports();
      return false;
    }
    if (getLast() === entry.id) setLast(null);
    if (currentId === entry.id) { player.stop(); currentId = null; }
    await refreshImports();
    toast(`Removed “${entry.title}”.`, 'ok');
    return true;
  }

  // Load catalogs and imports in parallel; migrate the old library first so its scores show up,
  // then move anything kept in this browser to the Mac when the dev server's song store is there.
  const ready = Promise.all([
    loadCatalogs(),
    migrateLegacy().catch(e => { console.warn('Old score library not migrated:', e); return 0; })
      .then(() => migrateToServer().catch(e => { console.warn('Imports not moved to the Mac:', e); return 0; }))
      .then(async moved => {
        await refreshImports();
        if (moved) toast(`Moved ${moved} imported song${moved === 1 ? '' : 's'} from this browser to your Mac.`, 'ok');
      }),
  ]).then(([cat]) => {
    entries.bundled = cat.bundled; entries.local = cat.local; entries.loaded = true;
    changed();
  });
  startOnboarding(); // the introduction, on first launch only

  const library = {
    ready: ready.then(() => entries),
    get entries() { return entries; },
    find,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    importScore: () => importDialog.open(),
    removeImport,
    toast,
  };

  function open(entry, source) {
    document.title = `${entry.title} · ${APP_NAME}`;
    if (currentId === entry.id) return;
    currentId = entry.id;
    setLast(entry.id);
    if (isExerciseId(entry.id)) rememberExercise(entry.id);
    let songPromise;
    try { songPromise = Promise.resolve(loadSong(source || songSource(entry))); }
    catch (e) { songPromise = Promise.reject(e); }
    songPromise.catch(e => {
      if (currentId === entry.id) toast(`Couldn’t open “${entry.title}”: ${e?.message || e}`);
    });
    // The player applies the entry's own hints (sight-reading: `mode`, `intent`) for that piece only.
    Promise.resolve(player.load(entry, songPromise)).catch(() => {});
  }

  // Ids that aren't in a catalog ("ex:…" exercises are generated on demand): catalog.resolveEntry.
  async function resolveSpecial(id) {
    if (typeof catalog.resolveEntry !== 'function') return null;
    try {
      const r = await catalog.resolveEntry(id);
      return r?.entry ? {entry: {id, ...r.entry}, source: r.source} : null;
    } catch (e) {
      console.warn('Could not build exercise', id, e);
      return null;
    }
  }

  // ───── the views ─────
  const go = id => navigate(playHref(id));
  const VIEWS = {
    today: {title: 'Today', place: 'today', bare: true, file: '../today/view.js', mount: (m, node) => m.mountToday(node, {library, open: go})},
    pieces: {title: 'Pieces', place: 'pieces', eyebrow: 'Repertoire', mount: (m, node, head) => mountPieces(node, {library, head})},
    exercises: {title: 'Exercises', place: 'exercises', eyebrow: 'Technique · Reading · Ear', file: '../exercises/view.js', mount: (m, node) => m.mountExercises(node, {open: go})},
    progress: {title: 'Progress', place: 'progress', eyebrow: 'Your practice diary', file: '../progress/view.js', mount: (m, node) => m.mountProgress(node)},
    technique: {title: 'Technique', place: 'exercises', parent: ['#/exercises', 'Exercises'], file: '../exercises/view.js', mount: (m, node) => m.mountTechnique(node, {open: go})},
    mutopia: {title: 'Browse Mutopia', place: 'pieces', parent: ['#/pieces', 'Pieces'], file: '../mutopia/view.js', mount: (m, node) => m.mountMutopia(node, {open: go})},
    'train-reading': {title: 'Note reading', place: 'exercises', parent: ['#/exercises', 'Exercises'], fill: true, file: '../trainer/view.js', mount: (m, node) => m.mountReadingTrainer(node)},
    'sight-reading': {title: 'Sight-reading', place: 'exercises', parent: ['#/exercises', 'Exercises'], file: '../sightread/view.js', mount: (m, node) => m.mountSightReading(node, {open: go})},
    rhythm: {title: 'Rhythm', place: 'exercises', parent: ['#/exercises', 'Exercises'], file: '../rhythm/view.js', mount: (m, node) => m.mountRhythmTrainer(node)},
    theory: {title: 'Theory', place: 'exercises', parent: ['#/exercises', 'Exercises'], file: '../theory/view.js', mount: (m, node) => m.mountTheory(node)},
    'theory-lesson': {title: 'Theory', place: 'exercises', parent: ['#/exercises/theory', 'Theory'], file: '../theory/view.js', mount: (m, node, head, route) => m.mountTheoryLesson(node, {lesson: route.arg})},
    ear: {title: 'Ear training', place: 'exercises', parent: ['#/exercises', 'Exercises'], file: '../ear/view.js', mount: (m, node) => m.mountEarTrainer(node)},
  };
  const host = createViewHost(root);

  // ───── routing: one of #player / a view in the main area ─────
  let routeToken = 0, prevHash = null;
  startRouter(async route => {
    const token = ++routeToken;
    const cameFrom = prevHash;
    prevHash = location.hash || '#/';
    const view = VIEWS[route.name];
    if (view) {
      const key = route.arg ? `${route.name}/${route.arg}` : route.name;
      if (host.showing !== key) player.stop();
      shell.dataset.route = 'place';
      document.documentElement.dataset.route = 'place';
      document.documentElement.dataset.view = route.name;
      nav.setActive(view.place);
      ssSet(RETURN_KEY, JSON.stringify({href: location.hash || '#/', label: view.title}));
      document.title = route.name === 'today' ? APP_NAME : `${view.title} · ${APP_NAME}`;
      return host.show(key, view, () => token === routeToken, route);
    }
    // The player, full width, with "← back" to where you came from.
    shell.dataset.route = 'play';
    document.documentElement.dataset.route = 'play';
    document.documentElement.dataset.view = 'play';
    nav.setActive(null);
    let ret = null;
    try { ret = JSON.parse(ssGet(RETURN_KEY) || 'null'); } catch {}
    const fallback = isExerciseId(route.id) ? {href: '#/exercises', label: 'Exercises'}
      : route.id.startsWith('sr:') ? {href: '#/exercises/sight-reading', label: 'Sight-reading'} : {href: '#/pieces', label: 'Pieces'};
    back.set(ret?.href ? ret : fallback, !!ret && cameFrom === ret.href);
    host.hide();
    await ready;
    if (token !== routeToken) return;
    const entry = find(route.id);
    if (entry) return open(entry);
    const special = await resolveSpecial(route.id);
    if (token !== routeToken) return;
    if (special) return open(special.entry, special.source);
    const kind = route.id.startsWith('ex:') ? 'ex' : route.id.startsWith('sr:') ? 'sr' : 'piece';
    toast({ex: 'That exercise couldn’t be built — pick another one from Technique.', sr: 'That sight-reading piece couldn’t be built — try another one.'}[kind]
      || 'That piece isn’t in your library — it may have been deleted or renamed.');
    navigate({ex: '#/technique', sr: '#/exercises/sight-reading'}[kind] || '#/pieces', {replace: true});
  });
}

// ───────── "← back" in the player's top bar ─────────

/**
 * The player keeps a button at the start of its top bar (#open-library, or #player-back);
 * the shell turns it into "← <place>" leading back to where the piece was opened from.
 */
function createBackButton(root) {
  let btn = root.querySelector('#player-back, #open-library');
  let target = {href: '#/pieces', label: 'Pieces'}, useHistory = false;
  if (btn) {
    btn.removeAttribute('aria-controls');
    btn.removeAttribute('aria-expanded');
    btn.classList.add('back-btn');
    btn.replaceChildren(icon('back', 'ln-icon back-icon'), el('span', {class: 'back-label'}));
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (useHistory && history.length > 1) history.back();
      else navigate(target.href);
    });
  }
  return {
    set(t, viaHistory) {
      target = t; useHistory = viaHistory;
      if (!btn) return;
      btn.querySelector('.back-label').textContent = t.label;
      btn.setAttribute('aria-label', `Back to ${t.label}`);
      btn.title = `Back to ${t.label}`;
    },
  };
}

// ───────── main-area view host ─────────

/** A sibling of #player inside .shell that shows one lazily-loaded view at a time. */
function createViewHost(player) {
  const main = el('main', {id: 'view', class: 'view-host', hidden: true, tabindex: '-1'});
  const backLink = el('a', {class: 'page-back'}, icon('back', 'ln-icon'), el('span'));
  const eyebrow = el('p', {class: 'page-eyebrow'});
  const title = el('h1', {class: 'page-title'});
  const aside = el('div', {class: 'page-aside'});
  const head = el('header', {class: 'page-head'}, el('div', {class: 'page-head-text'}, backLink, eyebrow, title), aside);
  const body = el('div', {class: 'view-body'});
  main.append(el('div', {class: 'view-scroll'}, head, body));
  const scroller = main.firstChild;
  player.after(main);

  let current = null; // {name, handle, node}

  function destroyCurrent() {
    if (!current) return;
    try { current.handle?.destroy?.(); } catch (e) { console.warn('View cleanup failed:', e); }
    current.node.remove();
    current = null;
  }

  function card(kind, heading, text) {
    return el('div', {class: `view-card view-${kind}`},
      el('h2', {text: heading}),
      el('p', {text}),
      el('a', {href: '#/', class: 'view-card-link', text: 'Back to Today'}));
  }

  return {
    get showing() { return current?.name || null; },
    async show(name, view, stillCurrent, route = {}) {
      if (!main.hidden && current?.name === name) return;
      destroyCurrent();
      player.hidden = true;
      main.hidden = false;
      main.dataset.view = name;
      main.classList.toggle('is-fill', !!view.fill);
      head.hidden = !!view.bare;
      title.textContent = view.title;
      eyebrow.textContent = view.eyebrow || '';
      eyebrow.hidden = !view.eyebrow || !!view.parent;
      backLink.hidden = !view.parent;
      if (view.parent) { backLink.href = view.parent[0]; backLink.lastChild.textContent = view.parent[1]; }
      aside.replaceChildren();
      const node = el('div', {class: 'view-root'});
      body.replaceChildren(node);
      scroller.scrollTop = 0;
      current = {name, handle: null, node};
      const mine = current;
      const load = view.file ? VIEW_MODULES[view.file] : () => Promise.resolve(null);
      if (!load) { node.append(card('soon', `${view.title} is coming soon`, 'This part of the app isn’t ready yet.')); return; }
      const slow = setTimeout(() => { if (current === mine && !node.childNodes.length) node.append(card('loading', 'Loading…', '')); }, 150);
      try {
        const mod = await load();
        if (current !== mine || !stillCurrent()) return;
        node.replaceChildren();
        mine.handle = await view.mount(mod, node, aside, route);
        if (current !== mine) { try { mine.handle?.destroy?.(); } catch {} }
        // A view may name itself more precisely (a theory lesson's title).
        else if (mine.handle?.title) { title.textContent = mine.handle.title; document.title = `${mine.handle.title} · ${APP_NAME}`; }
      } catch (e) {
        console.error(`Could not open ${view.title}:`, e);
        if (current === mine) node.replaceChildren(card('error', `Couldn’t open ${view.title}`, String(e?.message || e)));
      } finally { clearTimeout(slow); }
    },
    hide() {
      if (main.hidden && !current) return;
      destroyCurrent();
      main.hidden = true;
      delete main.dataset.view;
      if (player.hidden) {
        player.hidden = false;
        // The player measures its canvases; let it re-layout now that it's visible again.
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      }
    },
  };
}
