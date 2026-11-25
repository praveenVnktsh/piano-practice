// Pieces (#/pieces): the repertoire, laid out like a concert programme. Bundled works are
// grouped by composer; "Your songs" and "Imported" follow. Repertoire status (learning /
// secure / polished / maintained, src/progress/mastery.js) is set in small caps beside each
// work, and quiet chips filter by it.
// mountPieces(container, {library, head}) → {destroy()}.
import './pieces.css';
import {el, icon, fold, DIFFICULTY, ago} from './dom.js';
import {playHref} from './router.js';
import {CHANGE_EVENT, getProgress} from '../progress/store.js';
import {songStats} from '../progress/stats.js';
import {pieceMastery, STATUS_LABEL, STATUSES} from '../progress/mastery.js';

const FILTER_KEY = 'piano-practice.pieces.filter';

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
  let stats = new Map(), mastery = new Map(), doc = null, confirming = null, destroyed = false;
  let filter = (() => { try { return localStorage.getItem(FILTER_KEY) || 'all'; } catch { return 'all'; } })();
  if (filter !== 'all' && !STATUSES.includes(filter)) filter = 'all';
  const root = el('div', {class: 'pc'});
  const search = el('input', {type: 'search', class: 'pc-search-input', placeholder: 'Search by title or composer', 'aria-label': 'Search pieces', autocomplete: 'off', spellcheck: 'false'});
  const searchBox = el('label', {class: 'pc-search'}, icon('search'), search);
  const list = el('div', {class: 'pc-list'});
  const chips = el('div', {class: 'pc-chips', role: 'radiogroup', 'aria-label': 'Show pieces by status'});
  root.append(searchBox, chips, list);
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
    const m = mastery.get(entry.id);
    const status = m?.status ? STATUS_LABEL[m.status] : st?.minutes > 0 ? 'Listened' : null;
    const due = m?.review?.isDue ? 'review due' : null;
    const tempo = m?.bestCleanTempo && m.target && m.status !== 'polished' && m.status !== 'maintained' ? `♩ = ${m.bestCleanTempo} of ${m.target}` : null;
    const quiet = st ? [st.lastAt ? `last practised ${ago(st.lastAt)}` : null, tempo || (st.best != null ? `best ${Math.round(st.best)}%` : null), due].filter(Boolean).join(' · ') : '';
    const diff = DIFFICULTY[entry.difficulty];
    const li = el('li', {class: 'pc-work', 'data-id': entry.id},
      el('a', {class: 'pc-link', href: playHref(entry.id), title: entry.sourceUrl || null},
        el('span', {class: 'pc-line'},
          el('span', {class: 'pc-title'}, el('span', {class: 'pc-title-text', text: entry.title || 'Untitled'}),
            showComposer && entry.composer ? el('span', {class: 'pc-by', text: entry.composer}) : null),
          el('span', {class: 'pc-leader', 'aria-hidden': 'true'}),
          diff ? el('span', {class: 'pc-diff', text: diff}) : null),
        status || quiet ? el('span', {class: 'pc-status' + (status ? ' is-' + status.toLowerCase() : '')},
          status ? el('span', {class: 'pc-status-word', text: status}) : null,
          status && quiet ? ' · ' : null, quiet) : null,
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
    renderChips();
    const byStatus = e => filter === 'all' || mastery.get(e.id)?.status === filter;
    const match = e => byStatus(e) && terms.every(t => fold([e.title, e.composer, e.difficulty, e.source, e.license].join(' ')).includes(t));
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
      else if (filter !== 'all' && !f.bundled.length && !f.local.length && !f.imports.length) nodes.push(el('p', {class: 'pc-empty', text: `No ${STATUS_LABEL[filter].toLowerCase()} pieces yet.`}));
      const narrowed = q || filter !== 'all';
      if (local.length && (!narrowed || f.local.length)) {
        nodes.push(el('section', {class: 'pc-section'},
          el('h2', {class: 'pc-section-h', text: 'Your songs'}),
          el('ol', {class: 'pc-works', role: 'list'}, f.local.map(e => work(e, {showComposer: true})))));
      }
      if (!narrowed || f.imports.length) {
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
    if (!q && filter === 'all') {
      nodes.push(el('p', {class: 'pc-more'},
        el('a', {href: '#/pieces/mutopia', class: 'text-btn'}, 'Browse the Mutopia library →'),
        el('span', {class: 'pc-more-note'}, ' Hundreds of free classical scores, converted as you open them (unverified).')));
    }
    const focusedId = list.contains(document.activeElement) ? document.activeElement.closest('.pc-work')?.dataset.id : null;
    list.replaceChildren(...nodes);
    if (focusedId && !confirming) focusRow(focusedId, '.pc-link');
  }

  // Quiet status chips — only once something has a status; counts in old-style figures.
  function renderChips() {
    const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
    for (const m of mastery.values()) if (m.status in counts) counts[m.status]++;
    const any = Object.values(counts).some(Boolean);
    chips.hidden = !any && filter === 'all';
    if (chips.hidden) { chips.replaceChildren(); return; }
    const chip = (id, label, n) => el('button', {type: 'button', role: 'radio', class: 'pc-chip', 'aria-checked': String(filter === id),
      onclick: () => { filter = filter === id && id !== 'all' ? 'all' : id; try { localStorage.setItem(FILTER_KEY, filter); } catch {} render(); }},
    label, n != null ? el('span', {class: 'pc-chip-n', text: String(n)}) : null);
    chips.replaceChildren(chip('all', 'All'), ...STATUSES.filter(s => counts[s] || filter === s).map(s => chip(s, STATUS_LABEL[s], counts[s])));
  }

  function computeMastery() {
    if (!doc) return;
    const {bundled, local, imports} = library.entries;
    const targets = Object.fromEntries([...bundled, ...local, ...imports].filter(e => e.tempo).map(e => [e.id, e.tempo]));
    mastery = new Map([...stats.keys()].map(id => [id, pieceMastery(doc, id, {target: targets[id]})]));
  }

  async function loadStats() {
    try {
      doc = await getProgress();
      if (destroyed) return;
      stats = new Map(songStats(doc).map(s => [s.id, s]));
      computeMastery();
      render();
    } catch {}
  }

  const unsubscribe = library.subscribe(() => { computeMastery(); render(); });
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
