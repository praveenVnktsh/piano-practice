// App shell: wires the library sidebar, import dialog and router to the player.
import {createPlayer} from '../player.js';
import {loadSong} from '../song.js';
import * as catalog from './catalog.js';
import {listImports, deleteImport, migrateLegacy, migrateToServer, importStore} from './imports.js';
import {startRouter, navigate, playHref} from './router.js';
import {createSidebar} from './sidebar.js';
import {createImportDialog} from './import-dialog.js';
import {CHANGE_EVENT, getProgress, startProgressTracking} from '../progress/store.js';
import {todayMinutes} from '../progress/stats.js';
import {DEFAULT_GOAL_MIN} from '../progress/model.js';

const {loadCatalogs, songSource} = catalog;

// Views shown in the main area instead of the player (docs/ARCHITECTURE.md, "Views and routes").
// import.meta.glob = lazy import() that also works while a module doesn't exist yet (→ "coming soon").
const VIEW_MODULES = import.meta.glob(['../exercises/view.js', '../progress/view.js', '../trainer/view.js']);
const VIEWS = {
  technique: {title: 'Technique', file: '../exercises/view.js', mount: (m, el) => m.mountTechnique(el, {open: id => navigate(playHref(id))})},
  progress: {title: 'Progress', file: '../progress/view.js', mount: (m, el) => m.mountProgress(el)},
  'train-reading': {title: 'Note reading', file: '../trainer/view.js', mount: (m, el) => m.mountReadingTrainer(el)},
};

const LAST_KEY = 'piano-practice.last-song';
const APP_NAME = 'Piano Practice';
const getLast = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
const setLast = id => { try { id ? localStorage.setItem(LAST_KEY, id) : localStorage.removeItem(LAST_KEY); } catch {} };

export async function startApp() {
  const $ = id => document.getElementById(id);
  const root = $('player');
  const player = createPlayer(root);
  startProgressTracking();
  const host = createViewHost(root);

  let entries = {bundled: [], local: [], imports: []};
  let currentId = null;

  const sidebar = createSidebar({
    shell: document.querySelector('.shell'), aside: $('library'), toggle: $('open-library'), scrim: $('library-scrim'),
    onImport: () => importDialog.open(),
    onDelete: removeImport,
  });
  const importDialog = createImportDialog({
    dialog: $('import-dialog'),
    async onImported(rec, warning, where) {
      await refreshImports();
      const done = rec.duplicate ? `“${rec.title}” is already in your library.`
        : `Imported “${rec.title}”${where === 'mac' ? ' — saved on your Mac' : ''}.`;
      sidebar.notice(warning || done, warning ? 'warn' : 'ok');
      if (sidebar.narrow) sidebar.close({persist: false});
      navigate(playHref(rec.id));
    },
  });

  const all = () => [...entries.bundled, ...entries.local, ...entries.imports];
  const find = id => all().find(e => e.id === id);
  const asEntry = rec => ({...rec, kind: 'import'});

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
    sidebar.setData({imports: entries.imports, importsWhere: where});
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
      sidebar.notice((await importStore()) === 'mac' ? `Could not delete from your Mac: ${e.message}` : 'Could not delete — browser storage is unavailable.');
      await refreshImports();
      return;
    }
    if (getLast() === entry.id) setLast(null);
    await refreshImports();
    sidebar.notice(`Deleted “${entry.title}”.`, 'ok');
    if (currentId === entry.id) { player.stop(); currentId = null; navigate('#/', {replace: true}); }
  }

  function open(entry, source) {
    document.title = `${entry.title} · ${APP_NAME}`;
    if (currentId === entry.id) { sidebar.setActive(entry.id); return; }
    currentId = entry.id;
    setLast(entry.id);
    sidebar.setActive(entry.id);
    let songPromise;
    try { songPromise = Promise.resolve(loadSong(source || songSource(entry))); }
    catch (e) { songPromise = Promise.reject(e); }
    songPromise.catch(e => {
      if (currentId === entry.id) sidebar.notice(`Couldn’t open “${entry.title}”: ${e?.message || e}`);
    });
    player.load(entry, songPromise);
  }

  const fallbackEntry = () => find(getLast()) || entries.bundled[0] || entries.local[0] || entries.imports[0];

  // Load catalogs and imports in parallel; migrate the old library first so its scores show up,
  // then move anything kept in this browser to the Mac when the dev server's song store is there.
  const ready = Promise.all([
    loadCatalogs(),
    migrateLegacy().catch(e => { console.warn('Old score library not migrated:', e); return 0; })
      .then(() => migrateToServer().catch(e => { console.warn('Imports not moved to the Mac:', e); return 0; }))
      .then(async moved => {
        await refreshImports();
        if (moved) sidebar.notice(`Moved ${moved} imported song${moved === 1 ? '' : 's'} from this browser to your Mac.`, 'ok');
      }),
  ]).then(([cat]) => {
    entries.bundled = cat.bundled; entries.local = cat.local;
    sidebar.setData({bundled: cat.bundled, local: cat.local});
  });

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

  // ───── routing: one of #player / a view in the main area ─────
  let routeToken = 0;
  startRouter(async route => {
    const token = ++routeToken;
    if (sidebar.narrow && sidebar.isOpen) sidebar.close({persist: false});
    const view = VIEWS[route.name];
    if (view) {
      if (host.showing !== route.name) player.stop();
      sidebar.setActive(null);
      document.title = `${view.title} · ${APP_NAME}`;
      return host.show(route.name, view, () => token === routeToken);
    }
    host.hide();
    await ready;
    if (token !== routeToken) return;
    if (route.name === 'play') {
      const entry = find(route.id);
      if (entry) return open(entry);
      const special = await resolveSpecial(route.id);
      if (token !== routeToken) return;
      if (special) return open(special.entry, special.source);
      sidebar.notice(route.id.startsWith('ex:')
        ? 'That exercise couldn’t be built — pick another one from Technique.'
        : 'That song isn’t in your library — it may have been deleted or renamed. Pick another one below.');
      sidebar.open();
      if (currentId) { history.replaceState(history.state, '', playHref(currentId)); return void (document.title = `${find(currentId)?.title || player.current?.title || 'Song'} · ${APP_NAME}`); }
    } else if (currentId) {
      // "#/" while a song is open: just show the library.
      sidebar.setActive(currentId);
      document.title = `${find(currentId)?.title || player.current?.title || 'Song'} · ${APP_NAME}`;
      sidebar.open({focus: true});
      return;
    } else if (!getLast()) sidebar.open({persist: false}); // first visit: show what's available
    const entry = fallbackEntry();
    if (entry) { history.replaceState(history.state, '', playHref(entry.id)); open(entry); }
    else { document.title = APP_NAME; sidebar.open(); }
  });

  mountTodayIndicator();
}

// ───────── main-area view host ─────────

const LIB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h4v14H4zM10 5h4v14h-4zM16.5 5.5l3.8-1 3.2 13.6-3.8 1z"/></svg>';

/** A sibling of #player inside .shell that shows one lazily-loaded view at a time. */
function createViewHost(player) {
  const libToggle = document.getElementById('open-library');
  const main = document.createElement('main');
  main.id = 'view';
  main.className = 'view-host';
  main.hidden = true;
  main.innerHTML = `<header class="view-bar">
      <button class="icon-btn view-lib-btn" type="button" aria-controls="library">${LIB_ICON}</button>
      <h1 class="view-title"></h1>
    </header>
    <div class="view-body"></div>`;
  player.after(main);
  const body = main.querySelector('.view-body');
  const title = main.querySelector('.view-title');
  const btn = main.querySelector('.view-lib-btn');
  // The sidebar's own toggle lives in the player's top bar; this one just presses it.
  const syncBtn = () => {
    btn.setAttribute('aria-expanded', libToggle?.getAttribute('aria-expanded') || 'false');
    btn.setAttribute('aria-label', libToggle?.getAttribute('aria-label') || 'Show song library');
    btn.title = libToggle?.title || 'Song library';
  };
  btn.addEventListener('click', () => { libToggle?.click(); syncBtn(); });
  if (libToggle) new MutationObserver(syncBtn).observe(libToggle, {attributes: true, attributeFilter: ['aria-expanded']});
  syncBtn();

  let current = null; // {name, handle, node}

  function destroyCurrent() {
    if (!current) return;
    try { current.handle?.destroy?.(); } catch (e) { console.warn('View cleanup failed:', e); }
    current.node.remove();
    current = null;
  }

  function card(kind, heading, text) {
    const node = document.createElement('div');
    node.className = `view-card view-${kind}`;
    const h = document.createElement('h2'); h.textContent = heading;
    const p = document.createElement('p'); p.textContent = text;
    const a = document.createElement('a'); a.href = '#/'; a.className = 'view-card-link'; a.textContent = 'Back to your songs';
    node.append(h, p, a);
    return node;
  }

  return {
    get showing() { return current?.name || null; },
    async show(name, view, stillCurrent) {
      if (!main.hidden && current?.name === name) return;
      destroyCurrent();
      player.hidden = true;
      main.hidden = false;
      title.textContent = view.title;
      main.dataset.view = name;
      const node = document.createElement('div');
      node.className = 'view-root';
      body.replaceChildren(node);
      body.scrollTop = 0;
      current = {name, handle: null, node};
      const mine = current;
      const load = VIEW_MODULES[view.file];
      if (!load) { node.append(card('soon', `${view.title} is coming soon`, 'This part of the app isn’t ready yet.')); return; }
      node.append(card('loading', 'Loading…', ''));
      try {
        const mod = await load();
        if (current !== mine || !stillCurrent()) return;
        node.replaceChildren();
        mine.handle = await view.mount(mod, node);
        if (current !== mine) { try { mine.handle?.destroy?.(); } catch {} }
      } catch (e) {
        console.error(`Could not open ${view.title}:`, e);
        if (current === mine) node.replaceChildren(card('error', `Couldn’t open ${view.title}`, String(e?.message || e)));
      }
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

// ───────── "today" indicator in the sidebar footer ─────────

function mountTodayIndicator() {
  const foot = document.querySelector('#library .lib-foot');
  if (!foot) return;
  const link = document.createElement('a');
  link.className = 'lib-today';
  link.href = '#/progress';
  link.innerHTML = '<span class="lib-today-text"></span><span class="lib-today-bar"><i></i></span>';
  foot.prepend(link);
  const text = link.querySelector('.lib-today-text'), fill = link.querySelector('.lib-today-bar i');
  let busy = false;
  async function update() {
    if (busy) return;
    busy = true;
    try {
      const doc = await getProgress();
      const goal = doc.settings?.dailyGoalMin || DEFAULT_GOAL_MIN;
      const mins = todayMinutes(doc);
      const shown = mins > 0 && mins < 1 ? '<1' : String(Math.round(mins));
      text.textContent = `Today: ${shown} / ${goal} min`;
      fill.style.width = `${Math.min(100, (100 * mins) / goal)}%`;
      link.classList.toggle('done', mins >= goal);
      link.title = mins >= goal ? 'Daily goal reached — see your progress' : 'See your progress';
    } catch {
      text.textContent = 'Your progress';
    } finally { busy = false; }
  }
  update();
  window.addEventListener(CHANGE_EVENT, update);
  window.addEventListener('focus', update);
  setInterval(() => { if (document.visibilityState === 'visible') update(); }, 5 * 60e3);
}
