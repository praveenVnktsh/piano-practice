// Pieces (#/pieces): the repertoire, laid out like a concert programme. Bundled works are
// grouped by composer; "Your songs" and "Imported" follow. Status comes from progress.
// mountPieces(container, {library, head}) → {destroy()}.
import './pieces.css';
import {el, icon, fold, DIFFICULTY, ago, pieceStatus} from './dom.js';
import {playHref} from './router.js';
import {CHANGE_EVENT, getProgress} from '../progress/store.js';
import {songStats} from '../progress/stats.js';

const DIFF_ORDER = {beginner: 0, easy: 1, intermediate: 2, advanced: 3};
const ANON = /^(traditional|trad\.?|anonymous|anon\.?|folk( song)?|unknown)$/i;

// "Johann Sebastian Bach" → "bach"; "Christian Petzold (attr.)" → "petzold"; traditional last.
const surname = c => {
  const name = String(c || '').replace(/\(.*?\)/g, '').trim();
  if (!name || ANON.test(name)) return '￿';
  return fold(name.split(/\s+/).pop());
};

function fineprint(entry, where) {
  if (entry.kind === 'import') {
    const when = entry.added ? new Date(entry.added).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : '';
    return [(entry.omr ? 'Recognised from a PDF — notes may need checking' : 'Imported') + (when ? ' ' + when : ''), where === 'mac' ? 'saved on your Mac' : 'saved in this browser'].join(' · ');
  }
  const src = entry.source?.split(/\s[–—-]\s/)[0];
  return [entry.license, src].filter(Boolean).join(' · ') || (entry.kind === 'local' ? 'Your private library' : '');
}

export function mountPieces(container, {library, head}) {
  let stats = new Map(), confirming = null, destroyed = false;
  const root = el('div', {class: 'pc'});
  const search = el('input', {type: 'search', class: 'pc-search-input', placeholder: 'Search by title or composer', 'aria-label': 'Search pieces', autocomplete: 'off', spellcheck: 'false'});
  const searchBox = el('label', {class: 'pc-search'}, icon('search'), search);
  const list = el('div', {class: 'pc-list'});
  root.append(searchBox, list);
  container.append(root);

  head?.append(el('button', {type: 'button', class: 'text-btn', 'aria-haspopup': 'dialog', onclick: () => library.importScore()}, 'Import a score'));

  search.addEventListener('input', () => render());
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape' && search.value) { search.value = ''; render(); e.stopPropagation(); }
    if (e.key === 'ArrowDown') { list.querySelector('.pc-link')?.focus(); e.preventDefault(); }
  });
  list.addEventListener('keydown', e => {
    if (e.key === 'Escape' && confirming) { confirming = null; render(); }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...list.querySelectorAll('.pc-link')];
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    const next = links[i + (e.key === 'ArrowDown' ? 1 : -1)];
    (next || (e.key === 'ArrowUp' ? search : null))?.focus();
    e.preventDefault();
  });

  function work(entry, {showComposer = false} = {}) {
    const where = library.entries.importsWhere;
    if (confirming === entry.id) {
      return el('li', {class: 'pc-work confirming', 'data-id': entry.id},
        el('div', {class: 'pc-confirm', role: 'group', 'aria-label': 'Confirm removal'},
          el('span', {}, 'Remove ', el('em', {text: entry.title}), '?'),
          el('button', {type: 'button', class: 'text-btn danger', onclick: async () => { confirming = null; await library.removeImport(entry); render(); }}, 'Remove'),
          el('button', {type: 'button', class: 'text-btn', onclick: () => { confirming = null; render(); focusRow(entry.id, '.pc-del'); }}, 'Keep')));
    }
    const st = stats.get(entry.id);
    const status = pieceStatus(st);
    const quiet = st ? [status, st.lastAt ? `last practised ${ago(st.lastAt)}` : null, st.best != null ? `best ${Math.round(st.best)}%` : null].filter(Boolean).join(' · ') : '';
    const diff = DIFFICULTY[entry.difficulty];
    const li = el('li', {class: 'pc-work', 'data-id': entry.id},
      el('a', {class: 'pc-link', href: playHref(entry.id), title: entry.sourceUrl || null},
        el('span', {class: 'pc-line'},
          el('span', {class: 'pc-title'}, el('span', {class: 'pc-title-text', text: entry.title || 'Untitled'}),
            showComposer && entry.composer ? el('span', {class: 'pc-by', text: entry.composer}) : null),
          el('span', {class: 'pc-leader', 'aria-hidden': 'true'}),
          diff ? el('span', {class: 'pc-diff', text: diff}) : null),
        quiet ? el('span', {class: 'pc-status' + (status ? ' is-' + status.toLowerCase() : ''), text: quiet}) : null,
        el('span', {class: 'pc-fine', text: fineprint(entry, where)})));
    if (entry.kind === 'import') {
      li.append(el('button', {type: 'button', class: 'pc-del', 'aria-label': `Remove ${entry.title}`, onclick: () => { confirming = entry.id; render(); focusRow(entry.id, '.text-btn'); }}, 'Remove'));
    }
    return li;
  }
  const focusRow = (id, sel) => list.querySelector(`.pc-work[data-id="${CSS.escape(id)}"] ${sel}`)?.focus();

  function render() {
    if (destroyed) return;
    const {bundled, local, imports, importsWhere, loaded} = library.entries;
    const q = search.value.trim();
    const terms = fold(q).split(/\s+/).filter(Boolean);
    const match = e => terms.every(t => fold([e.title, e.composer, e.difficulty, e.source, e.license].join(' ')).includes(t));
    const f = {bundled: bundled.filter(match), local: local.filter(match), imports: imports.filter(match)};
    const nodes = [];
    if (!loaded) nodes.push(el('p', {class: 'pc-empty', text: 'Setting out the music…'}));
    else {
      // Composers, alphabetically by surname; works by difficulty, then title.
      const groups = new Map();
      for (const e of f.bundled) {
        const c = e.composer || 'Anonymous';
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(e);
      }
      const composers = [...groups.keys()].sort((a, b) => surname(a).localeCompare(surname(b)) || a.localeCompare(b));
      for (const c of composers) {
        const works = groups.get(c).sort((a, b) => (DIFF_ORDER[a.difficulty] ?? 9) - (DIFF_ORDER[b.difficulty] ?? 9) || String(a.title).localeCompare(String(b.title)));
        nodes.push(el('section', {class: 'pc-composer'},
          el('h2', {class: 'pc-composer-name', text: c}),
          el('ol', {class: 'pc-works', role: 'list'}, works.map(e => work(e)))));
      }
      if (q && !f.bundled.length && !f.local.length && !f.imports.length) nodes.push(el('p', {class: 'pc-empty'}, 'Nothing in the library matches ', el('em', {text: `“${q}”`}), '.'));
      if (local.length && (!q || f.local.length)) {
        nodes.push(el('section', {class: 'pc-section'},
          el('h2', {class: 'pc-section-h', text: 'Your songs'}),
          el('ol', {class: 'pc-works', role: 'list'}, f.local.map(e => work(e, {showComposer: true})))));
      }
      if (!q || f.imports.length) {
        nodes.push(el('section', {class: 'pc-section'},
          el('h2', {class: 'pc-section-h', text: 'Imported'}),
          f.imports.length
            ? el('ol', {class: 'pc-works', role: 'list'}, f.imports.map(e => work(e, {showComposer: true})))
            : el('p', {class: 'pc-empty'},
              'Nothing imported yet. ',
              el('button', {type: 'button', class: 'text-btn inline', onclick: () => library.importScore()}, 'Import a score'),
              importsWhere === 'mac' ? ' (MusicXML or MEI) — it’s kept on your Mac, so your iPad sees it too.' : ' (MusicXML or MEI) — it stays in this browser.')));
      }
    }
    const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('.pc-work')?.dataset.id : null;
    list.replaceChildren(...nodes);
    if (focusedId && !confirming) focusRow(focusedId, '.pc-link');
  }

  async function loadStats() {
    try {
      const doc = await getProgress();
      if (destroyed) return;
      stats = new Map(songStats(doc).map(s => [s.id, s]));
      render();
    } catch {}
  }

  const unsubscribe = library.subscribe(() => render());
  window.addEventListener(CHANGE_EVENT, loadStats);
  render();
  loadStats();

  return {
    destroy() {
      destroyed = true;
      unsubscribe();
      window.removeEventListener(CHANGE_EVENT, loadStats);
      root.remove();
    },
  };
}
