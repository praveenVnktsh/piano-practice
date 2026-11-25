// #/pieces/mutopia — Browse Mutopia (experimental).
//
//   mountMutopia(container, {open}) → {destroy()}
//
// Lists the solo piano pieces of the Mutopia Project (public/songs/mutopia-index.json)
// with search and filters. Choosing one downloads its LilyPond source, converts it
// in the browser (src/mutopia/convert.js) and calls open("mutopia:<path>"); the shell
// resolves that id with resolveMutopiaEntry(). Every conversion is labelled unverified.

import './view.css';
import {el, icon} from '../app/dom.js';
import {convertPiece, loadIndex, mutopiaId, pieceInfoUrl} from './convert.js';

const PAGE = 60;
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function mountMutopia(container, {open} = {}) {
  let destroyed = false;
  let pieces = [];
  let shown = PAGE;
  const state = {q: '', composer: '', style: ''};

  const search = el('input', {class: 'mu-search-input', type: 'search', placeholder: 'Search title, composer or opus', 'aria-label': 'Search the Mutopia library', autocomplete: 'off'});
  const composerSel = el('select', {class: 'mu-select', 'aria-label': 'Composer'});
  const styleSel = el('select', {class: 'mu-select', 'aria-label': 'Period'});
  const count = el('p', {class: 'mu-count', 'aria-live': 'polite'});
  const list = el('ol', {class: 'mu-list'});
  const more = el('button', {class: 'mu-more', type: 'button', hidden: true, onclick: () => { shown += PAGE; render(); }}, 'Show more');
  const root = el('div', {class: 'mu'},
    el('p', {class: 'mu-intro'},
      el('span', {class: 'mu-badge'}, 'Experimental'),
      ' Solo piano music from the ',
      el('a', {href: 'https://www.mutopiaproject.org/', target: '_blank', rel: 'noopener'}, 'Mutopia Project'),
      ', free to play and share. Each piece is converted in your browser when you open it. These conversions are ',
      el('strong', {}, 'not checked'),
      ': expect the odd wrong note, missing ornament or bar. The checked pieces are in ',
      el('a', {href: '#/pieces'}, 'Pieces'), '.'),
    el('div', {class: 'mu-tools'},
      el('label', {class: 'mu-search'}, icon('search'), search),
      el('div', {class: 'mu-filters'}, composerSel, styleSel)),
    count, list, more);
  container.append(root);

  const option = (value, text) => el('option', {value}, text);
  const fillSelect = (sel, label, values) => sel.replaceChildren(option('', label), ...values.map(([v, n]) => option(v, `${v} (${n})`)));
  const counted = key => {
    const m = new Map();
    for (const p of pieces) if (p[key]) m.set(p[key], (m.get(p[key]) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  };

  function matches(p) {
    if (state.composer && p.composer !== state.composer) return false;
    if (state.style && p.style !== state.style) return false;
    if (!state.q) return true;
    return fold(state.q).split(/\s+/).filter(Boolean).every(w => p._text.includes(w));
  }

  function row(p) {
    const status = el('span', {class: 'mu-status', 'aria-live': 'polite'});
    const btn = el('button', {class: 'mu-open', type: 'button'}, 'Open', el('span', {class: 'mu-open-note'}, ' · unverified'));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      status.className = 'mu-status';
      status.textContent = 'Downloading and converting…';
      try {
        const c = await convertPiece(p);
        if (destroyed) return;
        status.textContent = `Converted ${c.measures} bars${c.warnings.length ? ` · ${c.warnings.length} warning${c.warnings.length > 1 ? 's' : ''}` : ''}`;
        if (c.warnings.length) status.title = c.warnings.slice(0, 12).join('\n');
        open?.(mutopiaId(p));
      } catch (e) {
        if (destroyed) return;
        status.className = 'mu-status mu-error';
        status.textContent = `Could not convert this piece: ${e?.message || e}`;
      } finally { btn.disabled = false; }
    });
    const meta = [p.opus, p.date, p.style, p.license].filter(Boolean).join(' · ');
    const info = pieceInfoUrl(p);
    return el('li', {class: 'mu-item'},
      el('div', {class: 'mu-main'},
        el('div', {class: 'mu-line'},
          el('span', {class: 'mu-title'}, p.title),
          el('span', {class: 'mu-by'}, p.composer)),
        el('div', {class: 'mu-meta'}, meta, info ? el('a', {class: 'mu-info', href: info, target: '_blank', rel: 'noopener'}, 'Mutopia page') : null),
        status),
      btn);
  }

  function render() {
    const found = pieces.filter(matches);
    count.textContent = `${found.length} of ${pieces.length} pieces`;
    list.replaceChildren(...found.slice(0, shown).map(row));
    more.hidden = found.length <= shown;
  }

  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value.trim(); shown = PAGE; render(); }, 120); });
  composerSel.addEventListener('change', () => { state.composer = composerSel.value; shown = PAGE; render(); });
  styleSel.addEventListener('change', () => { state.style = styleSel.value; shown = PAGE; render(); });

  count.textContent = 'Loading the Mutopia catalogue…';
  loadIndex().then(index => {
    if (destroyed) return;
    pieces = index.pieces.map(p => ({...p, _text: fold([p.title, p.composer, p.opus, p.date, p.style].join(' '))}));
    fillSelect(composerSel, 'All composers', counted('composer'));
    fillSelect(styleSel, 'All periods', counted('style'));
    render();
  }).catch(e => {
    if (!destroyed) count.textContent = e?.message || 'The Mutopia catalogue could not be loaded';
  });

  return {
    destroy() { destroyed = true; clearTimeout(timer); root.remove(); },
  };
}
