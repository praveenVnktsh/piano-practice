// Progress → "Recordings": a compact card with the latest takes (each opens its report in the
// player), mock-exam results sheets, and the "Mock exam…" button.
//   mountRecordingsSection(host) → {destroy()}
import './record.css';
import {el} from '../app/dom.js';
import * as store from './store.js';
import {duration} from './text.mjs';

const fmtDate = at => new Date(at).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});

export function mountRecordingsSection(host) {
  let destroyed = false, token = 0;
  async function refresh() {
    const my = ++token;
    let takes = [], exams = [], where = 'browser';
    try { [takes, exams, where] = await Promise.all([store.listTakes(), store.listExams(), store.where()]); } catch {}
    if (destroyed || my !== token) return;
    render(takes, exams, where);
  }
  function render(takes, exams, where) {
    const list = takes.slice(0, 6);
    host.replaceChildren(el('section', {class: 'pg-card rec-card', id: 'recordings', 'aria-labelledby': 'rec-card-h'},
      el('div', {class: 'pg-card-head'},
        el('h3', {id: 'rec-card-h', text: 'Recordings'}),
        el('button', {class: 'text-btn rec-exam-btn', type: 'button', text: 'Mock exam…', onclick: async () => (await import('./exam-ui.js')).openExamSetup()})),
      list.length ? el('ol', {class: 'rec-card-list', role: 'list'}, list.map(t => el('li', {},
        el('a', {class: 'rec-card-row', href: `#/play/${encodeURIComponent(t.songId)}?review=${t.id}`, title: `Review “${t.name}” of ${t.title || t.songId}`},
          el('span', {class: 'rec-card-main'},
            el('span', {class: 'rec-card-title', text: t.title || t.songId}),
            el('span', {class: 'pg-muted', text: `${t.name || 'Take'} · ${fmtDate(t.at)} · ${duration(t.durationMs)}${t.exam ? ' · exam' : ''}${t.sentAt ? ' · sent' : ''}`})),
          el('strong', {class: 'rec-card-acc', text: t.summary ? `${t.summary.accuracy}%` : '–'})))))
        : el('p', {class: 'pg-empty', text: 'Record a take in the player with ● Rec beside play; it is kept here with a comparison against the score.'}),
      takes.length > list.length ? el('p', {class: 'pg-muted', text: `${takes.length - list.length} more in each piece’s ⋯ → Recordings.`}) : null,
      exams.length ? el('div', {class: 'rec-card-exams'},
        el('p', {class: 'rec-label', text: 'Mock exams'}),
        el('ul', {role: 'list'}, exams.slice(0, 3).map(x => el('li', {},
          el('button', {type: 'button', class: 'rec-card-row', onclick: async () => (await import('./exam-ui.js')).openExamSheet(x)},
            el('span', {class: 'rec-card-main'}, el('span', {class: 'rec-card-title', text: `${x.name || 'Mock exam'} · ${x.band}`}), el('span', {class: 'pg-muted', text: `${fmtDate(x.at)} · ${x.items.length} items`})),
            el('strong', {class: 'rec-card-acc', text: `${x.total}/${x.max}`})))))) : null,
      el('p', {class: 'pg-fine', text: where === 'disk' ? 'Kept on your Mac (.data/recordings).' : 'Kept in this browser.'})));
  }
  const onChange = () => refresh();
  window.addEventListener(store.CHANGE, onChange);
  host.replaceChildren(el('section', {class: 'pg-card rec-card'}, el('h3', {text: 'Recordings'})));
  refresh();
  return {
    refresh,
    destroy() { destroyed = true; window.removeEventListener(store.CHANGE, onChange); },
  };
}
