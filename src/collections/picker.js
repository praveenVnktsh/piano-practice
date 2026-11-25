// "Add to collection": a small popover anchored to a button (a piece's row in Pieces, or the
// player's ⋯ menu). Each collection is a checkbox (in it / not in it); the last row makes a new
// collection with the piece already in it. Changes apply at once (src/collections/store.js).
//
//   openCollectionPicker({anchor, pieceId, title, onClose}) → {close()}
import './collections.css';
import {addToCollection, cleanName, createCollection, removeFromCollection, setFavourite, isFavourite} from './model.js';
import {collections, loadCollections, updateCollections, CHANGE_EVENT} from './store.js';

let open = null;

export function openCollectionPicker({anchor, pieceId, title = '', onClose = () => {}} = {}) {
  open?.close();
  const pop = document.createElement('div');
  pop.className = 'cl-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Add ${title || 'this piece'} to a collection`);
  const list = document.createElement('div');
  list.className = 'cl-pop-list';
  const form = document.createElement('form');
  form.className = 'cl-pop-new';
  form.innerHTML = '<input type="text" maxlength="80" placeholder="New collection…" aria-label="Name of a new collection" autocomplete="off" spellcheck="false"><button type="submit">Add</button>';
  const input = form.querySelector('input');
  const head = document.createElement('p');
  head.className = 'cl-pop-kicker';
  head.textContent = 'Add to a collection';
  pop.append(head, list, form);
  document.body.append(pop);

  function render() {
    const doc = collections();
    const rows = [];
    const fav = document.createElement('label');
    fav.className = 'cl-pop-row is-fav';
    fav.innerHTML = '<input type="checkbox"><span class="cl-pop-star" aria-hidden="true"></span><span>Favourites</span>';
    const favBox = fav.querySelector('input');
    favBox.checked = isFavourite(doc, pieceId);
    favBox.onchange = () => updateCollections(d => setFavourite(d, pieceId, favBox.checked));
    rows.push(fav);
    for (const c of doc.collections) {
      const row = document.createElement('label');
      row.className = 'cl-pop-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = c.items.includes(pieceId);
      box.onchange = () => updateCollections(d => (box.checked ? addToCollection(d, c.id, pieceId) : removeFromCollection(d, c.id, pieceId)));
      const name = document.createElement('span');
      name.textContent = c.name;
      const n = document.createElement('span');
      n.className = 'cl-pop-n';
      n.textContent = String(c.items.length);
      row.append(box, name, n);
      rows.push(row);
    }
    const focused = list.contains(document.activeElement) ? [...list.querySelectorAll('input')].indexOf(document.activeElement) : -1;
    list.replaceChildren(...rows);
    if (focused >= 0) list.querySelectorAll('input')[focused]?.focus();
  }
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = cleanName(input.value);
    if (!name) { input.focus(); return; }
    updateCollections(d => createCollection(d, name, {items: [pieceId]}).doc);
    input.value = '';
  });

  function place() {
    const r = anchor?.getBoundingClientRect?.();
    if (!r) return;
    const w = pop.offsetWidth, h = pop.offsetHeight, pad = 8;
    let left = Math.min(innerWidth - w - pad, Math.max(pad, r.right - w));
    let top = r.bottom + 6;
    if (top + h > innerHeight - pad && r.top - h - 6 > pad) top = r.top - h - 6;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(pad, Math.min(innerHeight - h - pad, top)) + 'px';
  }

  const onDown = e => { if (!pop.contains(e.target) && !anchor?.contains?.(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); anchor?.focus?.(); } };
  const onChange = () => render();
  function close() {
    if (open !== handle) return;
    open = null;
    pop.remove();
    document.removeEventListener('pointerdown', onDown, true);
    pop.removeEventListener('keydown', onKey);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('resize', place);
    anchor?.setAttribute?.('aria-expanded', 'false');
    onClose();
  }
  const handle = {close};
  open = handle;
  document.addEventListener('pointerdown', onDown, true);
  pop.addEventListener('keydown', onKey);
  pop.addEventListener('keydown', e => e.stopPropagation()); // the player's shortcuts stay quiet while typing here
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('resize', place);
  anchor?.setAttribute?.('aria-expanded', 'true');
  render();
  place();
  (list.querySelector('input') || input).focus({preventScroll: true});
  loadCollections().then(() => { if (open === handle) { render(); place(); } });
  return handle;
}
