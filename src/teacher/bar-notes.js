// The teacher's bar comments in the player (docs/ROADMAP.md, Phase 14).
//
// A comment pinned to a bar range ("lift the wrist here", `node teacher/cli.js comment …`) shows as
// a quiet brass hairline over those bars with a small tab at its start: above the system on the
// score, and beside the bar numbers on the falling notes. The tab (click, tap, or focus + Enter)
// opens a small note with the text, "Practise these bars" (sets the section), "Ask about these bars"
// and "Dismiss". Opening a note marks it read; dismissing takes it off the score.
// The player's ⋯ menu also gets "Ask the teacher about bars X–Y" (the current section).
//
// Data: GET /__teacher/comments once, then the Teacher panel's live thread (window event
// `teacher:thread`, from its SSE stream). Without the dev server (a static build) nothing shows.
// "Ask" fires the window event `teacher:ask` {songId, title, section, bars, tempo, hands, comments}
// that the panel turns into a prefilled message with the attachment (src/teacher/panel.js).
//
//   const notes = attachBarNotes({root, highway, song, range, entry, label, setSection})
//   notes.layout(sheetTrack | null, measureBoxes)   after the sheet is laid out (or unmounted)
//   notes.loaded()                                  a piece was shown
import {barsLabel, commentsFor, commentsOver} from './comments.mjs';
import {renderMarkdown} from './markdown.js';
import './bar-notes.css';

const API = '/__teacher';
const QUILL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3.5c-7 1.2-11.5 6.5-13.6 14.6L5 20.5"/><path d="M8.2 14.5c4.2.2 7.6-2.3 9.3-6.4M11 10.5h4.6"/></svg>`;
const NOOP = {layout() {}, loaded() {}, destroy() {}};

export function attachBarNotes({root, highway, song, range, entry, label = i => String(i + 1), setSection, api = API}) {
  const q = s => root.querySelector(s);
  const sheetHost = q('#um-sheet'), view = q('#built-in-panel .view'), canvas = q('#um-highway');
  if (!sheetHost || !view) return NOOP;

  let comments = [], available = false, track = null, boxes = [], shown = [], open = null, raf = 0;
  const hidden = new Set(); // dismissed here, before the server's thread catches up
  const songId = () => entry()?.id ?? null;
  const count = () => song()?.measures?.length ?? 0;
  const bars = (a, b) => barsLabel(a, b, i => (song()?.measures?.[i]?.pickup ? 'pickup' : label(i)));

  // ───────── Layers ─────────
  const sheetLayer = document.createElement('div');
  sheetLayer.className = 'bn-layer';
  const rollLayer = document.createElement('div');
  rollLayer.className = 'bn-layer bn-roll';
  view.append(rollLayer);
  const pop = document.createElement('div');
  pop.className = 'bn-pop';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  view.append(pop);

  // ⋯ → "Ask the teacher about bars X–Y" (the current section).
  const menu = q('#more-menu');
  let askRow = null;
  if (menu) {
    const group = document.createElement('div');
    group.className = 'menu-group bn-menu';
    group.hidden = true;
    askRow = document.createElement('button');
    askRow.type = 'button';
    askRow.className = 'menu-row';
    askRow.id = 'ask-teacher-btn';
    askRow.innerHTML = '<span>Ask the teacher about <b class="bn-bars"></b></span>';
    group.append(askRow);
    const last = menu.lastElementChild;
    menu.insertBefore(group, last);
    askRow.addEventListener('click', () => {
      const r = range();
      if (!r) return;
      q('#more-btn')?.click(); // closes the menu the same way the player does
      ask(r.first, r.last);
    });
    q('#more-btn')?.addEventListener('click', refreshMenu, true);
  }
  function refreshMenu() {
    if (!askRow) return;
    const r = range();
    askRow.parentElement.hidden = !available || !song() || !r;
    if (r && song()) askRow.querySelector('.bn-bars').textContent = bars(r.first, r.last);
  }

  // ───────── Data ─────────
  function setComments(list) {
    comments = Array.isArray(list) ? list : [];
    render();
  }
  const onThread = e => {
    if (Array.isArray(e.detail?.comments)) {
      available = true;
      setComments(e.detail.comments);
    }
  };
  window.addEventListener('teacher:thread', onThread);
  let fetched = null;
  function fetchOnce() {
    fetched ||= fetch(`${api}/comments`, {cache: 'no-store'})
      .then(res => (res.ok && (res.headers.get('content-type') || '').includes('json') ? res.json() : null))
      .then(data => {
        if (!Array.isArray(data?.comments)) return;
        available = true;
        if (!comments.length) setComments(data.comments);
      })
      .catch(() => {});
    return fetched;
  }
  const post = (id, what) => fetch(`${api}/comments/${id}/${what}`, {method: 'POST'}).catch(() => {});

  // ───────── Drawing ─────────
  function render() {
    shown = commentsFor(comments, songId(), count(), hidden);
    if (open && !shown.some(c => c.id === open.id)) closePop(false);
    drawSheet();
    drawRoll();
    cancelAnimationFrame(raf);
    if (shown.length) raf = requestAnimationFrame(follow);
  }

  function tab(c, where) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bn-tab' + (c.readAt ? '' : ' unread');
    b.dataset.id = c.id;
    b.dataset.where = where;
    b.innerHTML = QUILL;
    b.setAttribute('aria-label', `Teacher’s note on ${bars(c.first, c.last)}${c.readAt ? '' : ' (new)'}`);
    b.title = `Teacher’s note · ${bars(c.first, c.last)}`;
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', String(open?.id === c.id));
    return b;
  }

  function drawSheet() {
    if (!track || !sheetHost.contains(track)) return sheetLayer.replaceChildren();
    if (sheetLayer.parentElement !== sheetHost) sheetHost.append(sheetLayer);
    sheetLayer.replaceChildren(
      ...shown.flatMap(c => {
        const a = boxes[c.first], b = boxes[c.last];
        if (!a || !b) return [];
        const mark = document.createElement('div');
        mark.className = 'bn-mark';
        mark.style.left = a.x0 + 'px';
        mark.style.width = Math.max(6, b.x1 - a.x0 - 2) + 'px';
        mark.append(tab(c, 'sheet'));
        return [mark];
      }),
    );
    follow(false);
  }

  function drawRoll() {
    rollLayer.replaceChildren(...shown.map(c => {
      const mark = document.createElement('div');
      mark.className = 'bn-mark';
      mark.dataset.id = c.id;
      mark.append(tab(c, 'roll'));
      return mark;
    }));
    follow(false);
  }

  // Keeps the layers on the music: the score's track slides under the playhead; the falling notes
  // move every frame. Runs only while this piece has comments.
  function follow(loop = true) {
    if (loop) raf = requestAnimationFrame(follow);
    if (!root.getClientRects().length) return; // the player isn't on screen
    const v = root.dataset.view;
    sheetLayer.hidden = v === 'falling';
    rollLayer.hidden = v !== 'falling';
    if (v !== 'falling') {
      if (!track) return;
      sheetLayer.style.left = track.offsetLeft + 'px';
      sheetLayer.style.top = track.offsetTop + 'px';
      sheetLayer.style.width = track.offsetWidth + 'px';
      sheetLayer.style.transform = track.style.transform;
      sheetLayer.style.clipPath = track.style.clipPath;
      return;
    }
    const s = song(), r = range();
    if (!s || !r || !canvas || !highway?.yOf) return;
    const vb = view.getBoundingClientRect(), cb = canvas.getBoundingClientRect();
    const h = cb.height;
    for (const mark of rollLayer.children) {
      const c = shown.find(x => x.id === Number(mark.dataset.id));
      const a = c && Math.max(c.first, r.first), b = c && Math.min(c.last, r.last);
      if (!c || a > b) { mark.hidden = true; continue; }
      const top = highway.yOf(s.measures[b].end), bottom = highway.yOf(s.measures[a].start);
      if (bottom < 0 || top > h) { mark.hidden = true; continue; }
      mark.hidden = false;
      const t = Math.max(0, top), btm = Math.min(h, bottom);
      mark.style.left = cb.left - vb.left + 'px';
      mark.style.top = cb.top - vb.top + t + 'px';
      mark.style.height = Math.max(2, btm - t) + 'px';
      mark.classList.toggle('cut', bottom > h); // the start of the range has passed the keys
    }
  }

  // ───────── The note ─────────
  function openPop(c, from) {
    open = {id: c.id, from};
    for (const b of root.querySelectorAll('.bn-tab')) b.setAttribute('aria-expanded', String(Number(b.dataset.id) === c.id));
    pop.setAttribute('aria-label', `Teacher’s note on ${bars(c.first, c.last)}`);
    pop.innerHTML = `
      <div class="bn-head"><span>Your teacher · ${bars(c.first, c.last)}</span>
        <button type="button" class="bn-close" aria-label="Close the note">×</button></div>
      <div class="bn-text">${renderMarkdown(c.text)}</div>
      <div class="bn-actions">
        <button type="button" class="bn-practise">Practise these bars</button>
        ${available ? '<button type="button" class="bn-ask quiet-btn">Ask about these bars</button>' : ''}
        <button type="button" class="bn-dismiss quiet-btn">Dismiss</button>
      </div>`;
    pop.hidden = false;
    place(from);
    pop.querySelector('.bn-practise').focus({preventScroll: true});
    if (!c.readAt) {
      c.readAt = new Date().toISOString();
      for (const x of comments) if (x.id === c.id) x.readAt ||= c.readAt;
      from?.classList.remove('unread');
      post(c.id, 'read');
    }
  }
  function place(from) {
    const vb = view.getBoundingClientRect();
    const fb = from?.isConnected ? from.getBoundingClientRect() : {left: vb.left + 16, bottom: vb.top + 16, top: vb.top + 16};
    const w = pop.offsetWidth, hgt = pop.offsetHeight;
    const left = Math.max(8, Math.min(vb.width - w - 8, fb.left - vb.left - 12));
    let top = fb.bottom - vb.top + 6;
    if (top + hgt > vb.height - 8) top = Math.max(8, fb.top - vb.top - hgt - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function closePop(focus = true) {
    if (!open) return;
    const id = open.id, where = open.from?.dataset.where;
    open = null;
    pop.hidden = true;
    for (const b of root.querySelectorAll('.bn-tab')) b.setAttribute('aria-expanded', 'false');
    if (focus) root.querySelector(`.bn-tab[data-id="${id}"][data-where="${where}"]`)?.focus({preventScroll: true});
  }
  function ask(first, last, about = commentsOver(shown, first, last)) {
    const e = entry(), st = window.pianoPlayer?.getState?.();
    window.dispatchEvent(new CustomEvent('teacher:ask', {detail: {
      songId: e?.id, title: e?.title || song()?.title || '', section: [first, last], bars: bars(first, last),
      tempo: st?.tempo, hands: st?.hands, comments: about,
    }}));
  }

  // A tap on a tab must not start a drag (scrub / select) on the score or the roll underneath.
  const swallow = e => { if (e.target.closest('.bn-tab, .bn-pop')) e.stopPropagation(); };
  for (const el of [sheetHost, view]) el.addEventListener('pointerdown', swallow, true);
  // Wheel scrubs on the roll / sheet are fine; clicks on tabs open the note.
  const onClick = e => {
    const t = e.target.closest('.bn-tab');
    if (!t) return;
    e.stopPropagation();
    const c = shown.find(x => x.id === Number(t.dataset.id));
    if (!c) return;
    if (open?.id === c.id) closePop();
    else openPop(c, t);
  };
  sheetHost.addEventListener('click', onClick, true);
  rollLayer.addEventListener('click', onClick);

  pop.addEventListener('click', e => {
    const c = open && shown.find(x => x.id === open.id);
    if (e.target.closest('.bn-close')) return closePop();
    if (!c) return;
    if (e.target.closest('.bn-practise')) {
      setSection?.(c.first, c.last);
      closePop(false);
    } else if (e.target.closest('.bn-ask')) {
      closePop(false);
      ask(c.first, c.last, [c]);
    } else if (e.target.closest('.bn-dismiss')) {
      hidden.add(c.id);
      post(c.id, 'dismiss');
      closePop(false);
      render();
    }
  });
  // Keys inside the note stay in the note (the player's shortcuts would act on them).
  pop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    e.stopPropagation();
  });
  const outside = e => {
    if (open && !pop.contains(e.target) && !e.target.closest?.('.bn-tab')) closePop(false);
  };
  document.addEventListener('pointerdown', outside, true);

  return {
    layout(sheetTrack, measureBoxes = []) {
      track = sheetTrack;
      boxes = measureBoxes;
      if (open?.from?.dataset.where === 'sheet') closePop(false);
      drawSheet();
    },
    loaded() {
      closePop(false);
      fetchOnce();
      render();
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('teacher:thread', onThread);
      document.removeEventListener('pointerdown', outside, true);
      sheetLayer.remove(); rollLayer.remove(); pop.remove(); askRow?.parentElement.remove();
    },
  };
}
