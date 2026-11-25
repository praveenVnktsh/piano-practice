// Pieces (#/pieces): the repertoire, laid out like a concert programme. Bundled works are
// grouped by composer; "Your songs" and "Imported" follow. Repertoire status (learning /
// secure / polished / maintained, src/progress/mastery.js) is set in small caps beside each work.
//
// A slim typographic filter row (Grade · Period · Composer · Status · ☆) narrows the programme;
// filters combine and are remembered. Collections (src/collections/) are a section of Pieces, not
// a place of their own: favourites (☆ on each row), the student's own collections — ordered, so
// each is also a setlist — and "Play as a setlist" for any filtered view (smart collections by
// grade, period and composer).
// mountPieces(container, {library, head}) → {destroy()}.
import './pieces.css';
import {el, icon, fold, DIFFICULTY, ago} from './dom.js';
import {playHref, navigate} from './router.js';
import {CHANGE_EVENT, getProgress} from '../progress/store.js';
import {songStats} from '../progress/stats.js';
import {pieceMastery, STATUS_LABEL, STATUSES} from '../progress/mastery.js';
import {
  PERIODS, anyFilter, cleanName, composerKey, createCollection, deleteCollection, filterPredicate, isFavourite, moveCollection,
  moveItem, normalizeFilters, periodOf, removeFromCollection, renameCollection, setFavourite,
} from '../collections/model.js';
import {collections, loadCollections, startSetlist, updateCollections, CHANGE_EVENT as COLLECTIONS_EVENT} from '../collections/store.js';
import {openCollectionPicker} from '../collections/picker.js';

const FILTERS_KEY = 'piano-practice.pieces.filters';
const OLD_FILTER_KEY = 'piano-practice.pieces.filter'; // the status chips before the filter row
const OPEN_KEY = 'piano-practice.pieces.open-collection';

const DIFF_ORDER = {beginner: 0, easy: 1, intermediate: 2, advanced: 3};
const ANON = /^(traditional|trad\.?|anonymous|anon\.?|folk( song)?|unknown)$/i;
const GRADE_NAME = g => (g === 0 ? 'Beginner' : `Grade ${g}`);

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

const lsJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} };

function savedFilters() {
  const f = normalizeFilters(lsJson(FILTERS_KEY));
  if (!lsJson(FILTERS_KEY)) {
    let old = null;
    try { old = localStorage.getItem(OLD_FILTER_KEY); } catch {}
    if (old && STATUSES.includes(old)) f.status = old;
  }
  return f;
}

export function mountPieces(container, {library, head}) {
  let stats = new Map(), mastery = new Map(), doc = null, confirming = null, destroyed = false;
  let filters = savedFilters();
  let openId = (() => { try { return localStorage.getItem(OPEN_KEY); } catch { return null; } })();
  let renaming = null, deleting = null, menu = null, creating = false;
  const root = el('div', {class: 'pc'});
  const search = el('input', {type: 'search', class: 'pc-search-input', placeholder: 'Search by title or composer', 'aria-label': 'Search pieces', autocomplete: 'off', spellcheck: 'false'});
  const searchBox = el('label', {class: 'pc-search'}, icon('search'), search);
  const filterRow = el('div', {class: 'pc-filters', role: 'toolbar', 'aria-label': 'Filter pieces'});
  const summary = el('p', {class: 'pc-summary', 'aria-live': 'polite'});
  const list = el('div', {class: 'pc-list'});
  root.append(searchBox, filterRow, summary, list);
  container.append(root);

  head?.append(el('button', {type: 'button', class: 'text-btn', 'aria-haspopup': 'dialog', onclick: () => library.importScore()}, 'Import a score'));

  search.addEventListener('input', () => render());
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape' && search.value) { search.value = ''; render(); e.stopPropagation(); }
    if (e.key === 'ArrowDown') { list.querySelector('.pc-link')?.focus(); e.preventDefault(); }
  });
  list.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (confirming || renaming || deleting)) { confirming = renaming = deleting = null; render(); }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (!e.target.classList?.contains('pc-link')) return;
    const links = [...list.querySelectorAll('.pc-link')];
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    const next = links[i + (e.key === 'ArrowDown' ? 1 : -1)];
    (next || (e.key === 'ArrowUp' ? search : null))?.focus();
    e.preventDefault();
  });

  const allEntries = () => { const {bundled, local, imports} = library.entries; return [...bundled, ...local, ...imports]; };
  const entryById = id => allEntries().find(e => e.id === id);
  const statusOf = id => mastery.get(id)?.status ?? null;
  const favourite = id => isFavourite(collections(), id);

  // ───── one work in the programme ─────
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
    const diff = Number.isInteger(entry.grade) ? GRADE_NAME(entry.grade) : DIFFICULTY[entry.difficulty];
    const fav = favourite(entry.id);
    const title = entry.title || 'Untitled';
    const li = el('li', {class: 'pc-work', 'data-id': entry.id},
      el('a', {class: 'pc-link', href: playHref(entry.id), title: entry.sourceUrl || null},
        el('span', {class: 'pc-line'},
          el('span', {class: 'pc-title'}, el('span', {class: 'pc-title-text', text: title}),
            showComposer && entry.composer ? el('span', {class: 'pc-by', text: entry.composer}) : null),
          el('span', {class: 'pc-leader', 'aria-hidden': 'true'}),
          diff ? el('span', {class: 'pc-diff', text: diff}) : null),
        status || quiet ? el('span', {class: 'pc-status' + (status ? ' is-' + status.toLowerCase() : '')},
          status ? el('span', {class: 'pc-status-word', text: status}) : null,
          status && quiet ? ' · ' : null, quiet) : null,
        el('span', {class: 'pc-fine', text: fineprint(entry, where)})),
      el('span', {class: 'pc-acts'},
        el('button', {type: 'button', class: 'pc-star' + (fav ? ' is-on' : ''), 'aria-pressed': String(fav), 'aria-label': `Favourite: ${title}`, title: fav ? 'Remove from favourites' : 'Add to favourites',
          onclick: () => { updateCollections(d => setFavourite(d, entry.id, !fav)); }}),
        el('button', {type: 'button', class: 'pc-add', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': `Add ${title} to a collection`, title: 'Add to a collection',
          onclick: e => openCollectionPicker({anchor: e.currentTarget, pieceId: entry.id, title})}, '+'),
        entry.kind === 'import' ? el('button', {type: 'button', class: 'pc-del', 'aria-label': `Remove ${title}`, onclick: () => { confirming = entry.id; render(); focusRow(entry.id, '.text-btn'); }}, 'Remove') : null));
    return li;
  }
  const focusRow = (id, sel) => list.querySelector(`.pc-work[data-id="${CSS.escape(id)}"] ${sel}`)?.focus();

  // ───── filter row: Grade · Period · Composer · Status · ☆ ─────
  const setFilters = next => { filters = normalizeFilters(next); lsSet(FILTERS_KEY, filters); menu = null; render(); };
  function options(kind) {
    const entries = allEntries();
    const count = pred => entries.filter(pred).length;
    if (kind === 'grade') {
      const grades = [...new Set(entries.map(e => e.grade).filter(Number.isInteger))].sort((a, b) => a - b);
      return grades.map(g => ({value: g, label: GRADE_NAME(g), n: count(e => e.grade === g)}));
    }
    if (kind === 'period') return PERIODS.map(p => ({value: p, label: p, n: count(e => (e.period || periodOf(e.composer)) === p)})).filter(o => o.n);
    if (kind === 'composer') {
      const names = new Map();
      for (const e of entries) {
        if (!e.composer || ANON.test(composerKey(e.composer))) continue;
        const k = composerKey(e.composer);
        names.set(k, (names.get(k) || 0) + 1);
      }
      return [...names].sort((a, b) => surname(a[0]).localeCompare(surname(b[0]))).map(([k, n]) => ({value: k, label: k, n}));
    }
    if (kind === 'status') {
      const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
      for (const m of mastery.values()) if (m.status in counts) counts[m.status]++;
      return STATUSES.map(s => ({value: s, label: STATUS_LABEL[s], n: counts[s]}));
    }
    return [];
  }
  const FILTER_LABEL = {grade: 'Grade', period: 'Period', composer: 'Composer', status: 'Status'};
  const valueLabel = (kind, v) => (kind === 'grade' ? GRADE_NAME(v) : kind === 'status' ? STATUS_LABEL[v] : v);
  function renderFilters() {
    const parts = [];
    for (const kind of ['grade', 'period', 'composer', 'status']) {
      const v = filters[kind];
      const on = v != null;
      const btn = el('button', {type: 'button', class: 'pc-f' + (on ? ' is-on' : ''), 'data-filter': kind, 'aria-haspopup': 'true', 'aria-expanded': String(menu === kind),
        onclick: () => { menu = menu === kind ? null : kind; renderFilters(); filterRow.querySelector('.pc-fmenu button')?.focus(); }},
      on ? valueLabel(kind, v) : FILTER_LABEL[kind]);
      const wrap = el('span', {class: 'pc-fwrap'}, btn);
      if (menu === kind) {
        const opts = options(kind);
        wrap.append(el('div', {class: 'pc-fmenu', role: 'group', 'aria-label': FILTER_LABEL[kind]},
          el('button', {type: 'button', class: 'pc-fopt' + (!on ? ' is-on' : ''), 'aria-pressed': String(!on), onclick: () => setFilters({...filters, [kind]: null})}, kind === 'status' ? 'Any status' : `Any ${FILTER_LABEL[kind].toLowerCase()}`),
          opts.length ? opts.map(o => el('button', {type: 'button', class: 'pc-fopt' + (v === o.value ? ' is-on' : ''), 'aria-pressed': String(v === o.value), disabled: !o.n && v !== o.value ? true : null,
            onclick: () => setFilters({...filters, [kind]: v === o.value ? null : o.value})}, o.label, el('span', {class: 'pc-fn', text: String(o.n)})))
            : el('p', {class: 'pc-fnone', text: kind === 'status' ? 'Statuses appear once you practise.' : 'Nothing to choose from yet.'})));
      }
      parts.push(wrap, el('span', {class: 'pc-fdot', 'aria-hidden': 'true', text: '·'}));
    }
    parts.push(el('button', {type: 'button', class: 'pc-f pc-ffav' + (filters.fav ? ' is-on' : ''), 'aria-pressed': String(filters.fav), 'aria-label': 'Favourites only', title: 'Favourites only',
      onclick: () => setFilters({...filters, fav: !filters.fav})}, filters.fav ? '★' : '☆'));
    filterRow.replaceChildren(...parts);
  }
  // Close the filter menu on an outside click or Escape.
  const outside = e => { if (menu && !filterRow.contains(e.target)) { menu = null; renderFilters(); } };
  document.addEventListener('pointerdown', outside, true);
  filterRow.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu) { const k = menu; menu = null; renderFilters(); filterRow.querySelector(`[data-filter="${k}"]`)?.focus(); e.stopPropagation(); }
  });

  // ───── playing a list as a setlist ─────
  function playList(name, ids, id = null) {
    const items = ids.map(entryById).filter(Boolean).map(e => ({id: e.id, title: e.title || 'Untitled'}));
    const first = startSetlist({id, name, items});
    if (!first) return;
    navigate(playHref(first.id));
  }

  // ───── the Collections section ─────
  function collectionsSection(narrowed) {
    const cdoc = collections();
    const favs = cdoc.favourites.filter(id => entryById(id));
    const rows = [];
    const countText = n => `${n} piece${n === 1 ? '' : 's'}`;
    if (favs.length) {
      rows.push(el('li', {class: 'pc-coll is-fav', 'data-coll': 'favourites'},
        el('div', {class: 'pc-coll-line'},
          el('button', {type: 'button', class: 'pc-coll-name', 'aria-expanded': String(openId === 'favourites'), onclick: () => toggleOpen('favourites')},
            el('span', {class: 'pc-coll-star', 'aria-hidden': 'true', text: '★'}), 'Favourites'),
          el('span', {class: 'pc-leader', 'aria-hidden': 'true'}),
          el('span', {class: 'pc-coll-n', text: countText(favs.length)}),
          el('button', {type: 'button', class: 'pc-play', 'aria-label': 'Play favourites as a setlist', onclick: () => playList('Favourites', favs)}, 'Play')),
        openId === 'favourites' ? itemList(null, favs) : null));
    }
    cdoc.collections.forEach((c, ci) => {
      const items = c.items.filter(id => entryById(id));
      const isOpen = openId === c.id;
      let line;
      if (renaming === c.id) {
        const input = el('input', {type: 'text', class: 'pc-rename', value: c.name, maxlength: '80', 'aria-label': 'Collection name', autocomplete: 'off', spellcheck: 'false'});
        const commit = () => { const n = cleanName(input.value); renaming = null; if (n && n !== c.name) updateCollections(d => renameCollection(d, c.id, n)); else render(); focusColl(c.id); };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.stopPropagation(); renaming = null; render(); focusColl(c.id); } });
        line = el('form', {class: 'pc-coll-line is-editing', onsubmit: e => { e.preventDefault(); commit(); }},
          input, el('button', {type: 'submit', class: 'text-btn'}, 'Save'), el('button', {type: 'button', class: 'text-btn', onclick: () => { renaming = null; render(); focusColl(c.id); }}, 'Cancel'));
        queueMicrotask(() => { input.focus(); input.select(); });
      } else if (deleting === c.id) {
        line = el('div', {class: 'pc-confirm', role: 'group', 'aria-label': 'Confirm deletion'},
          el('span', {}, 'Delete the collection ', el('em', {text: c.name}), '? The pieces stay in your library.'),
          el('button', {type: 'button', class: 'text-btn danger', onclick: () => { deleting = null; if (openId === c.id) setOpen(null); updateCollections(d => deleteCollection(d, c.id)); }}, 'Delete'),
          el('button', {type: 'button', class: 'text-btn', onclick: () => { deleting = null; render(); focusColl(c.id); }}, 'Keep'));
        queueMicrotask(() => line.querySelector('.text-btn:not(.danger)')?.focus());
      } else {
        line = el('div', {class: 'pc-coll-line'},
          el('button', {type: 'button', class: 'pc-coll-name', 'aria-expanded': String(isOpen), onclick: () => toggleOpen(c.id)}, c.name),
          el('span', {class: 'pc-leader', 'aria-hidden': 'true'}),
          el('span', {class: 'pc-coll-n', text: countText(items.length)}),
          items.length ? el('button', {type: 'button', class: 'pc-play', 'aria-label': `Play ${c.name} as a setlist`, onclick: () => playList(c.name, items, c.id)}, 'Play') : null);
      }
      rows.push(el('li', {class: 'pc-coll' + (isOpen ? ' is-open' : ''), 'data-coll': c.id},
        line,
        isOpen && renaming !== c.id && deleting !== c.id ? el('div', {class: 'pc-coll-body'},
          items.length ? itemList(c, items) : el('p', {class: 'pc-empty small', text: 'Empty for now. Use + beside a piece, or ⋯ in the player, to add it here.'}),
          el('p', {class: 'pc-coll-tools'},
            el('button', {type: 'button', class: 'text-btn', onclick: () => { renaming = c.id; render(); }}, 'Rename'),
            ci > 0 ? el('button', {type: 'button', class: 'text-btn', 'aria-label': `Move ${c.name} up`, onclick: () => updateCollections(d => moveCollection(d, c.id, ci - 1))}, 'Move up') : null,
            ci < cdoc.collections.length - 1 ? el('button', {type: 'button', class: 'text-btn', 'aria-label': `Move ${c.name} down`, onclick: () => updateCollections(d => moveCollection(d, c.id, ci + 1))}, 'Move down') : null,
            el('button', {type: 'button', class: 'text-btn danger', onclick: () => { deleting = c.id; render(); }}, 'Delete'))) : null));
    });
    if (narrowed && !rows.length) return null;
    const newForm = creating ? (() => {
      const input = el('input', {type: 'text', class: 'pc-rename', placeholder: 'Name, e.g. “Grade 2 recital”', maxlength: '80', 'aria-label': 'Name of the new collection', autocomplete: 'off', spellcheck: 'false'});
      const cancel = () => { creating = false; render(); list.querySelector('.pc-new')?.focus(); };
      input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } });
      queueMicrotask(() => input.focus());
      return el('form', {class: 'pc-coll-line is-editing', onsubmit: e => {
        e.preventDefault();
        const name = cleanName(input.value);
        if (!name) { input.focus(); return; }
        creating = false;
        let made = null;
        updateCollections(d => { const r = createCollection(d, name); made = r.collection; return r.doc; });
        if (made) setOpen(made.id);
        render();
      }}, input, el('button', {type: 'submit', class: 'text-btn'}, 'Create'), el('button', {type: 'button', class: 'text-btn', onclick: cancel}, 'Cancel'));
    })() : null;
    const empty = !rows.length;
    return el('section', {class: 'pc-section pc-collections', 'aria-label': 'Collections'},
      el('h2', {class: 'pc-section-h', text: 'Collections'}),
      rows.length ? el('ol', {class: 'pc-colls', role: 'list'}, rows) : null,
      empty && !creating ? el('p', {class: 'pc-empty'}, 'Gather pieces for a recital or a week’s work: ☆ a piece to keep it in Favourites, or ',
        el('button', {type: 'button', class: 'text-btn inline pc-new', onclick: () => { creating = true; render(); }}, 'start a collection'), '.') : null,
      newForm,
      !empty && !creating ? el('p', {class: 'pc-coll-foot'}, el('button', {type: 'button', class: 'text-btn pc-new', onclick: () => { creating = true; render(); }}, 'New collection')) : null);
  }
  const focusColl = id => queueMicrotask(() => list.querySelector(`.pc-coll[data-coll="${CSS.escape(id)}"] .pc-coll-name`)?.focus());
  function setOpen(id) { openId = id; lsSet(OPEN_KEY, id); }
  function toggleOpen(id) { setOpen(openId === id ? null : id); renaming = deleting = null; render(); focusColl(id); }

  // The pieces of one collection, in order: drag the grip (or use ↑ ↓) to reorder.
  function itemList(c, ids) {
    const ol = el('ol', {class: 'pc-citems', role: 'list'});
    ids.forEach((id, i) => {
      const e = entryById(id);
      const title = e?.title || 'Untitled';
      const li = el('li', {class: 'pc-citem', 'data-id': id},
        c ? el('span', {class: 'pc-grip', 'aria-hidden': 'true', title: 'Drag to reorder'}) : null,
        el('span', {class: 'pc-cnum', 'aria-hidden': 'true', text: String(i + 1)}),
        el('a', {class: 'pc-clink', href: playHref(id)}, el('span', {class: 'pc-ctitle', text: title}), e?.composer ? el('span', {class: 'pc-by', text: composerKey(e.composer)}) : null),
        c ? el('span', {class: 'pc-cacts'},
          el('button', {type: 'button', class: 'pc-mv', 'aria-label': `Move ${title} up`, disabled: i === 0 ? true : null, onclick: () => { updateCollections(d => moveItem(d, c.id, i, i - 1)); focusItem(id, 'up'); }}, '↑'),
          el('button', {type: 'button', class: 'pc-mv', 'aria-label': `Move ${title} down`, disabled: i === ids.length - 1 ? true : null, onclick: () => { updateCollections(d => moveItem(d, c.id, i, i + 1)); focusItem(id, 'down'); }}, '↓'),
          el('button', {type: 'button', class: 'pc-mv pc-out', 'aria-label': `Take ${title} out of ${c.name}`, onclick: () => updateCollections(d => removeFromCollection(d, c.id, id))}, '×'))
          : el('span', {class: 'pc-cacts'}, el('button', {type: 'button', class: 'pc-mv pc-out', 'aria-label': `Remove ${title} from favourites`, onclick: () => updateCollections(d => setFavourite(d, id, false))}, '×')));
      if (c) dragToReorder(li, c, ol);
      ol.append(li);
    });
    return ol;
  }
  const focusItem = (id, dir) => queueMicrotask(() => {
    const row = list.querySelector(`.pc-citem[data-id="${CSS.escape(id)}"]`);
    (row?.querySelector(`.pc-mv[aria-label^="Move"][aria-label*="${dir === 'up' ? ' up' : ' down'}"]:not(:disabled)`) || row?.querySelector('.pc-mv:not(:disabled)'))?.focus();
  });
  // Pointer drag on the grip: the row moves within its list; dropping saves the new order. The
  // listeners sit on the window: moving the row in the DOM drops any pointer capture.
  function dragToReorder(li, c, ol) {
    const grip = li.querySelector('.pc-grip');
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      const from = [...ol.children].indexOf(li);
      li.classList.add('is-dragging');
      ol.classList.add('is-sorting');
      const move = ev => {
        if (ev.pointerId !== e.pointerId) return;
        ev.preventDefault();
        const rows = [...ol.children].filter(r => r !== li);
        const before = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
        if (before) { if (li.nextElementSibling !== before) ol.insertBefore(li, before); }
        else if (ol.lastElementChild !== li) ol.append(li);
      };
      const end = ev => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        li.classList.remove('is-dragging');
        ol.classList.remove('is-sorting');
        const to = [...ol.children].indexOf(li);
        if (ev.type === 'pointerup' && to !== from) updateCollections(d => moveItem(d, c.id, from, to));
        else render();
      };
      window.addEventListener('pointermove', move, {passive: false});
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  // ───── the programme ─────
  function render() {
    if (destroyed) return;
    const {bundled, local, imports, importsWhere, loaded} = library.entries;
    const q = search.value.trim();
    const terms = fold(q).split(/\s+/).filter(Boolean);
    renderFilters();
    const filtered = anyFilter(filters);
    const byFilters = filterPredicate(filters, {statusOf, favourite});
    const match = e => byFilters(e) && terms.every(t => fold([e.title, e.composer, e.difficulty, e.source, e.license, e.period || periodOf(e.composer)].join(' ')).includes(t));
    const f = {bundled: bundled.filter(match), local: local.filter(match), imports: imports.filter(match)};
    const shown = [...f.bundled, ...f.local, ...f.imports];
    const narrowed = !!q || filtered;
    // A filtered view is a smart collection: say how many and offer to play it through.
    summary.hidden = !filtered || !loaded;
    if (!summary.hidden) {
      const name = describeFilters(filters);
      summary.replaceChildren(
        el('span', {class: 'pc-summary-n', text: `${shown.length} piece${shown.length === 1 ? '' : 's'}`}),
        shown.length > 1 ? el('button', {type: 'button', class: 'text-btn', onclick: () => playList(name, shown.map(e => e.id))}, 'Play as a setlist →') : null,
        el('button', {type: 'button', class: 'text-btn quiet', onclick: () => setFilters({})}, 'Clear filters'));
    }
    const nodes = [];
    const hasCollections = collections().collections.length || collections().favourites.some(id => entryById(id));
    if (!loaded) nodes.push(el('p', {class: 'pc-empty', text: 'Setting out the music…'}));
    else {
      if (hasCollections && !narrowed) nodes.push(collectionsSection(false));
      // Composers, alphabetically by surname; works by difficulty, then title.
      const groups = new Map();
      for (const e of f.bundled) {
        const c = e.composer || 'Anonymous';
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(e);
      }
      const composers = [...groups.keys()].sort((a, b) => surname(a).localeCompare(surname(b)) || a.localeCompare(b));
      for (const c of composers) {
        const works = groups.get(c).sort((a, b) => (a.grade ?? DIFF_ORDER[a.difficulty] ?? 9) - (b.grade ?? DIFF_ORDER[b.difficulty] ?? 9) || String(a.title).localeCompare(String(b.title)));
        nodes.push(el('section', {class: 'pc-composer'},
          el('h2', {class: 'pc-composer-name', text: c}),
          el('ol', {class: 'pc-works', role: 'list'}, works.map(e => work(e)))));
      }
      if (q && !shown.length) nodes.push(el('p', {class: 'pc-empty'}, 'Nothing in the library matches ', el('em', {text: `“${q}”`}), filtered ? ' with these filters.' : '.'));
      else if (filtered && !shown.length) nodes.push(el('p', {class: 'pc-empty', text: filters.fav && Object.values({...filters, fav: null}).every(v => v == null) ? 'No favourites yet: tap ☆ beside a piece.' : 'No pieces match these filters.'}));
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
      if (!hasCollections && !narrowed) nodes.push(collectionsSection(false));
    }
    if (!narrowed) {
      nodes.push(el('p', {class: 'pc-more'},
        el('a', {href: '#/pieces/mutopia', class: 'text-btn'}, 'Browse the Mutopia library →'),
        el('span', {class: 'pc-more-note'}, ' Hundreds of free classical scores, converted as you open them (unverified).')));
    }
    const active = document.activeElement;
    const focusedId = list.contains(active) && active.classList.contains('pc-link') ? active.closest('.pc-work')?.dataset.id : null;
    const focusedStar = list.contains(active) && active.classList.contains('pc-star') ? active.closest('.pc-work')?.dataset.id : null;
    list.replaceChildren(...nodes.filter(Boolean));
    if (focusedId && !confirming) focusRow(focusedId, '.pc-link');
    if (focusedStar) focusRow(focusedStar, '.pc-star');
  }

  function computeMastery() {
    if (!doc) return;
    const targets = Object.fromEntries(allEntries().filter(e => e.tempo).map(e => [e.id, e.tempo]));
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
  const onCollections = () => render();
  window.addEventListener(CHANGE_EVENT, loadStats);
  window.addEventListener(COLLECTIONS_EVENT, onCollections);
  render();
  loadStats();
  loadCollections().then(() => { if (!destroyed) render(); });

  return {
    destroy() {
      destroyed = true;
      unsubscribe();
      window.removeEventListener(CHANGE_EVENT, loadStats);
      window.removeEventListener(COLLECTIONS_EVENT, onCollections);
      document.removeEventListener('pointerdown', outside, true);
      root.remove();
    },
  };
}

/** "Grade 2 · Romantic · Favourites" — the name a filtered setlist carries. */
function describeFilters(f) {
  return [f.grade != null ? GRADE_NAME(f.grade) : null, f.period, f.composer, f.status ? STATUS_LABEL[f.status] : null, f.fav ? 'Favourites' : null].filter(Boolean).join(' · ') || 'Pieces';
}
