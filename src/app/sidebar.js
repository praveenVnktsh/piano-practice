// Library sidebar: search, song sections, open/close (docked on wide screens, drawer on narrow).
import {playHref} from './router.js';

const STORE_KEY = 'piano-practice.sidebar';
const NARROW = '(max-width: 899.98px)';

const load = () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } };
const save = v => { try { localStorage.setItem(STORE_KEY, v); } catch {} };

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const DIFFICULTY = {beginner: 'Beginner', easy: 'Easy', intermediate: 'Intermediate', advanced: 'Advanced'};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter(c => c != null && c !== false));
  return node;
}
const icon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = `<path d="${d}"/>`; return s; };
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';

function sourceLine(entry, where) {
  if (entry.kind === 'import') {
    const when = entry.added ? new Date(entry.added).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : '';
    return {short: (entry.omr ? 'Recognized from PDF' : 'Imported') + (when ? ' · ' + when : ''), long: (entry.omr ? 'Recognized from a PDF — notes may need checking' : 'Imported') + (where === 'mac' ? '\nSaved on your Mac' : '\nSaved in this browser only')};
  }
  const short = [entry.license, entry.source?.split(/\s[–—-]\s/)[0]].filter(Boolean).join(' · ');
  const long = [entry.license && 'Licence: ' + entry.license, entry.source && 'Source: ' + entry.source, entry.sourceUrl].filter(Boolean).join('\n');
  return {short: short || (entry.kind === 'local' ? 'Your private library' : ''), long};
}

export function createSidebar({shell, aside, toggle, scrim, onImport, onDelete}) {
  const search = aside.querySelector('#library-search');
  const lists = aside.querySelector('#library-lists');
  const notice = aside.querySelector('#library-notice');
  const mq = matchMedia(NARROW);
  let data = {bundled: [], local: [], imports: [], importsWhere: 'browser'}, loaded = false, activeId = null, confirming = null;
  let isOpen = false;

  // ───── open / close ─────
  function apply(open, {persist = true, focus = false} = {}) {
    isOpen = open;
    shell.classList.toggle('lib-open', open);
    shell.classList.toggle('lib-narrow', mq.matches);
    aside.inert = !open;
    scrim.hidden = !(open && mq.matches);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide song library' : 'Show song library');
    toggle.title = open ? 'Hide library' : 'Song library';
    if (persist && !mq.matches) save(open ? 'open' : 'closed');
    if (open && focus) (lists.querySelector('.song-link[aria-current]') || search).focus({preventScroll: true});
    if (!open && focus && aside.contains(document.activeElement)) toggle.focus();
    // Let the player re-measure its canvases after the layout change.
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
  }
  const initial = () => !mq.matches && load() !== 'closed';
  shell.classList.add('lib-no-anim');
  apply(initial(), {persist: false});
  requestAnimationFrame(() => requestAnimationFrame(() => shell.classList.remove('lib-no-anim')));
  mq.addEventListener('change', () => apply(initial(), {persist: false}));

  toggle.addEventListener('click', () => apply(!isOpen, {focus: mq.matches}));
  aside.querySelector('#library-close').addEventListener('click', () => apply(false, {focus: true}));
  scrim.addEventListener('click', () => apply(false));
  aside.querySelector('#import-open').addEventListener('click', () => onImport());

  // Keys inside the sidebar shouldn't trigger player shortcuts (Space = play, arrows = seek…).
  aside.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (search.value && e.target === search) { search.value = ''; render(); }
      else if (confirming) { confirming = null; render(); }
      else if (mq.matches) apply(false, {focus: true});
      e.stopPropagation(); return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.target === search || e.target.closest('.song'))) {
      const links = [...lists.querySelectorAll('.song-link')];
      if (links.length) {
        const i = links.indexOf(e.target.closest('.song')?.querySelector('.song-link'));
        const next = e.target === search ? (e.key === 'ArrowDown' ? 0 : -1) : i + (e.key === 'ArrowDown' ? 1 : -1);
        if (next >= 0 && next < links.length) { links[next].focus(); e.preventDefault(); }
        else if (next < 0 && e.target !== search) { search.focus(); e.preventDefault(); }
      }
    }
    e.stopPropagation();
  });
  // Escape anywhere closes the drawer on narrow screens.
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen && mq.matches && !document.querySelector('dialog[open], .modal:not([hidden])')) apply(false, {focus: true});
  });

  search.addEventListener('input', () => render());

  lists.addEventListener('click', e => {
    const link = e.target.closest('.song-link');
    if (link && mq.matches) apply(false);
  });

  // ───── rendering ─────
  function row(entry) {
    const src = sourceLine(entry, data.importsWhere);
    const active = entry.id === activeId;
    const li = el('li', {class: 'song' + (active ? ' active' : ''), 'data-id': entry.id});
    if (confirming === entry.id) {
      li.classList.add('confirming');
      li.append(el('div', {class: 'song-confirm', role: 'group', 'aria-label': 'Confirm delete'},
        el('span', {text: `Delete “${entry.title}”?`}),
        el('button', {type: 'button', class: 'mini danger', text: 'Delete', onclick: async () => { confirming = null; await onDelete(entry); }}),
        el('button', {type: 'button', class: 'mini', text: 'Cancel', onclick: () => { confirming = null; render(); focusRow(entry.id, '.song-del'); }}),
      ));
      return li;
    }
    const diff = DIFFICULTY[entry.difficulty];
    li.append(el('a', {class: 'song-link', href: playHref(entry.id), 'aria-current': active ? 'page' : null, title: src.long || null},
      el('span', {class: 'song-title', text: entry.title || 'Untitled'}),
      el('span', {class: 'song-meta'},
        entry.composer ? el('span', {class: 'song-composer', text: entry.composer}) : null,
        diff ? el('span', {class: 'pill pill-' + entry.difficulty, text: diff}) : null),
      src.short ? el('span', {class: 'song-src', text: src.short}) : null,
    ));
    if (entry.kind === 'import') {
      li.append(el('button', {type: 'button', class: 'song-del', 'aria-label': `Delete ${entry.title}`, title: 'Delete', onclick: () => { confirming = entry.id; render(); focusRow(entry.id, '.mini'); }}, icon(TRASH)));
    }
    return li;
  }
  const focusRow = (id, sel) => lists.querySelector(`.song[data-id="${CSS.escape(id)}"] ${sel}`)?.focus();

  function section(title, entries, total, empty, id, hint) {
    const s = el('section', {class: 'lib-section', 'aria-labelledby': id});
    s.append(el('h2', {id, title: hint}, title, total ? el('span', {class: 'count', text: entries.length === total ? String(total) : `${entries.length}/${total}`}) : null));
    if (entries.length) s.append(el('ul', {class: 'song-list', role: 'list'}, ...entries.map(row)));
    else if (empty) s.append(el('p', {class: 'lib-empty', text: empty}));
    return s;
  }

  function render() {
    const terms = fold(search.value).split(/\s+/).filter(Boolean);
    const match = e => terms.every(t => fold([e.title, e.composer, e.difficulty, e.source, e.license].join(' ')).includes(t));
    const f = {bundled: data.bundled.filter(match), local: data.local.filter(match), imports: data.imports.filter(match)};
    const nodes = [];
    if (!loaded) nodes.push(el('p', {class: 'lib-empty', text: 'Loading songs…'}));
    else {
      const q = search.value.trim();
      const none = q ? 'No matches.' : null;
      nodes.push(section('Songs', f.bundled, data.bundled.length, none || 'No bundled songs found.', 'lib-h-songs'));
      if (data.local.length) nodes.push(section('Your songs', f.local, data.local.length, none, 'lib-h-local'));
      nodes.push(section('Imported', f.imports, data.imports.length,
        q ? none : data.importsWhere === 'mac'
          ? 'Nothing imported yet. Import a MusicXML or MEI file to practise it here — it’s saved on your Mac, so your iPad sees it too.'
          : 'Nothing imported yet. Import a MusicXML or MEI file to practise it here — it stays in this browser.',
        'lib-h-imports', data.importsWhere === 'mac' ? 'Saved on your Mac (public/songs/local/imports)' : 'Saved in this browser only'));
      if (q && !f.bundled.length && !f.local.length && !f.imports.length) nodes.unshift(el('p', {class: 'lib-noresults', text: `No songs match “${q}”.`}));
    }
    const hadFocus = aside.contains(document.activeElement) && document.activeElement.closest('.song')?.dataset.id;
    lists.replaceChildren(...nodes);
    if (hadFocus && !confirming) focusRow(hadFocus, '.song-link');
  }
  render();

  return {
    setData(next) { data = {...data, ...next}; loaded = true; render(); },
    setActive(id) {
      activeId = id; render();
      lists.querySelector('.song.active')?.scrollIntoView({block: 'nearest'});
    },
    notice(text, tone = 'warn') {
      notice.hidden = !text;
      notice.dataset.tone = tone;
      notice.replaceChildren(...(text ? [el('span', {text}), el('button', {type: 'button', class: 'mini', 'aria-label': 'Dismiss', text: '×', onclick: () => { notice.hidden = true; }})] : []));
    },
    open: opts => apply(true, opts),
    close: opts => apply(false, opts),
    get isOpen() { return isOpen; },
    get narrow() { return mq.matches; },
  };
}
