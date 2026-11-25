// The Teacher panel: a floating button and a slide-over conversation. Messages go to the dev
// server (POST /__teacher/messages, saved in .teacher/ on the Mac) with the practice context
// attached; replies, written by the teacher with `node teacher/cli.js reply`, arrive live over
// SSE (GET /__teacher/stream). Reply actions are buttons the student taps to apply.
import {describeAction} from '../../teacher/actions.js';
import {collectContext, recentResults, sharingLine, trackResults} from './context.js';
import {escapeHtml, renderMarkdown} from './markdown.js';
import {runAction} from './run.js';

const API = '/__teacher';
const SEEN_KEY = 'piano-practice.teacher.seen';
const SHARE_KEY = 'piano-practice.teacher.share';
const PLAN_KEY = 'piano-practice.teacher.plan.';
const THINKING_STALE_MS = 20 * 60 * 1000;
export const SUGGESTIONS = [
  'How should I practise this section?',
  'Plan my 20 minutes today',
  'Why do I keep missing bar 12?',
  'Teach me the C major scale',
];

const get = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const put = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

// A quill: the teacher writes letters in the margin.
const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3.5c-7 1.2-11.5 6.5-13.6 14.6L5 20.5"/><path d="M8.2 14.5c4.2.2 7.6-2.3 9.3-6.4M11 10.5h4.6"/></svg>`;
const time = at => {
  const d = new Date(at);
  return Number.isNaN(+d) ? '' : d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
};

/** Builds a thread in reading order: each message followed by its replies. */
export function orderThread({messages = [], replies = []}) {
  const items = [];
  for (const m of messages) {
    items.push({kind: 'message', ...m});
    for (const r of replies.filter(r => r.replyTo === m.id)) items.push({kind: 'reply', ...r});
  }
  return items;
}

export function createPanel(root = document.body, {api = API, EventSourceImpl = globalThis.EventSource} = {}) {
  let thread = {messages: [], replies: [], status: {thinking: null}};
  let open = false,
    source = null,
    lastResult = null,
    titles = new Map(),
    library = null;
  const pending = []; // messages sent but not yet seen in the thread
  const notes = new Map(); // `${replyId}:${index}` → {ok, text} after a tap

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'tch-fab';
  fab.setAttribute('aria-label', 'Open the teacher');
  fab.innerHTML = `${ICON}<span>Teacher</span><b class="tch-badge" hidden></b>`;

  const panel = document.createElement('aside');
  panel.className = 'tch-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Teacher');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="tch-head">
      <div><h2>Teacher</h2><p>Letters in the margin</p></div>
      <button type="button" class="tch-close" aria-label="Close the teacher">×</button>
    </header>
    <div class="tch-thread"></div>
    <p class="tch-live" role="status" aria-live="polite"></p>
    <div class="tch-thinking" hidden><span></span><span></span><span></span> Teacher is thinking…</div>
    <div class="tch-quick"></div>
    <form class="tch-compose">
      <label class="tch-share"><input type="checkbox"> <span>Sharing: <em></em></span></label>
      <div class="tch-row">
        <textarea rows="2" placeholder="Ask your teacher…" aria-label="Message to your teacher" maxlength="4000"></textarea>
        <button type="submit" class="tch-send">Send</button>
      </div>
      <p class="tch-error" role="alert" hidden></p>
    </form>`;
  root.append(fab, panel);

  const $ = s => panel.querySelector(s);
  const list = $('.tch-thread'),
    thinking = $('.tch-thinking'),
    quick = $('.tch-quick'),
    form = $('.tch-compose');
  const input = $('textarea'),
    share = $('.tch-share input'),
    shareText = $('.tch-share em'),
    errorBox = $('.tch-error'),
    live = $('.tch-live');
  share.checked = get(SHARE_KEY, 'on') === 'on';

  // ───────── Data ─────────
  const knownSong = id => !library || id.startsWith('import:') || id.startsWith('ex:') || titles.has(id);
  import('../app/catalog.js')
    .then(c => c.loadCatalogs())
    .then(cat => {
      library = [...cat.bundled, ...cat.local];
      for (const e of library) titles.set(e.id, e.title);
      render();
    })
    .catch(() => {});

  let lastReplyId = null; // announce new letters to screen readers (the thread itself is re-rendered)
  function setThread(next) {
    const newest = Math.max(0, ...next.replies.map(r => r.id));
    if (lastReplyId != null && newest > lastReplyId) live.textContent = 'Your teacher replied.';
    lastReplyId = newest;
    thread = next;
    for (let i = pending.length - 1; i >= 0; i--)
      if (thread.messages.some(m => m.id === pending[i].id)) pending.splice(i, 1);
    const maxReply = Math.max(0, ...thread.replies.map(r => r.id));
    if (Number(get(SEEN_KEY, 0)) > maxReply) put(SEEN_KEY, String(maxReply)); // the thread was cleared
    if (open && document.visibilityState === 'visible') put(SEEN_KEY, String(maxReply));
    render();
  }

  function connect() {
    if (!EventSourceImpl) return;
    source = new EventSourceImpl(`${api}/stream`);
    source.addEventListener('thread', e => {
      try {
        setThread(JSON.parse(e.data));
      } catch {}
    });
  }

  async function send(text) {
    text = text.trim();
    if (!text) return;
    errorBox.hidden = true;
    const local = {kind: 'message', id: `local-${Date.now()}`, at: new Date().toISOString(), text, sending: true};
    pending.push(local);
    render(true);
    try {
      const context = share.checked ? await collectContext() : null;
      const res = await fetch(`${api}/messages`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({text, context}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      local.id = body.id;
      local.sending = false;
      if (!thread.messages.some(m => m.id === body.id)) thread = {...thread, messages: [...thread.messages, body]};
      setThread(thread);
    } catch (e) {
      pending.splice(pending.indexOf(local), 1);
      input.value ||= text;
      // Network failures read as browser jargon ("Failed to fetch"); say what it means instead.
      const offline = e instanceof TypeError || /fetch|network|load failed/i.test(e.message || '');
      errorBox.textContent = offline
        ? 'Couldn’t reach your Mac. Is the app still running there (npm run dev:ipad)? Your message is kept below.'
        : `Couldn’t send: ${e.message}`;
      errorBox.hidden = false;
      render();
    }
  }

  // ───────── Rendering ─────────
  const planTicks = key => {
    try {
      return new Set(JSON.parse(get(PLAN_KEY + key, '[]')));
    } catch {
      return new Set();
    }
  };

  function actionButton(action, key) {
    const note = notes.get(key);
    const label = describeAction(action, id => titles.get(id));
    return (
      `<button type="button" class="tch-action" data-key="${escapeHtml(key)}">${escapeHtml(label)}</button>` +
      (note ? `<span class="tch-note ${note.ok ? 'ok' : 'bad'}">${escapeHtml(note.text)}</span>` : '')
    );
  }

  function planCard(plan, replyId, index) {
    const ticks = planTicks(`${replyId}.${index}`);
    const total = plan.items.reduce((a, i) => a + (i.minutes || 0), 0);
    const rows = plan.items.map(
      (item, i) => `
      <li class="${ticks.has(i) ? 'done' : ''}">
        <label><input type="checkbox" data-plan="${replyId}.${index}" data-item="${i}" ${ticks.has(i) ? 'checked' : ''}>
          <span>${escapeHtml(item.label)}</span>${item.minutes ? `<small>${item.minutes} min</small>` : ''}</label>
        ${item.action ? `<div class="tch-plan-act">${actionButton(item.action, `${replyId}:${index}:${i}`)}</div>` : ''}
      </li>`,
    );
    return (
      `<div class="tch-plan"><div class="tch-plan-head"><strong>${escapeHtml(plan.label || 'Practice plan')}</strong>` +
      `${total ? `<small>${total} min</small>` : ''}<small class="tch-count">${ticks.size}/${plan.items.length}</small></div><ol>${rows.join('')}</ol></div>`
    );
  }

  function itemHtml(item) {
    if (item.kind === 'message') {
      return (
        `<div class="tch-msg mine"><div class="tch-bubble">${escapeHtml(item.text).replace(/\n/g, '<br>')}</div>` +
        `<small>${item.sending ? 'Sending…' : time(item.at)}</small></div>`
      );
    }
    const actions = item.actions || [];
    const buttons = actions.map((a, i) => (a.type === 'plan' ? '' : actionButton(a, `${item.id}:${i}`))).join('');
    const plans = actions.map((a, i) => (a.type === 'plan' ? planCard(a, item.id, i) : '')).join('');
    return (
      `<div class="tch-msg teacher"><div class="tch-letter">${renderMarkdown(item.text)}</div>` +
      `${plans}${buttons ? `<div class="tch-actions">${buttons}</div>` : ''}<small>${time(item.at)}</small></div>`
    );
  }

  function isThinking() {
    const id = thread.status?.thinking;
    if (!Number.isInteger(id) || thread.replies.some(r => r.replyTo === id)) return false;
    return !thread.status.at || Date.now() - new Date(thread.status.at) < THINKING_STALE_MS;
  }

  function render(scrollDown = false) {
    const seen = Number(get(SEEN_KEY, 0));
    const unread = thread.replies.filter(r => r.id > seen).length;
    const badge = fab.querySelector('.tch-badge');
    badge.hidden = open || !unread;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    fab.classList.toggle('has-unread', !open && unread > 0);
    if (!open) return;

    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const items = [...orderThread(thread), ...pending.filter(p => !thread.messages.some(m => m.id === p.id))];
    list.innerHTML = items.length
      ? items.map(itemHtml).join('')
      : `<div class="tch-empty"><p>Ask about the piece you’re practising, a tricky bar, technique or theory. Your teacher sees what you share below and replies here.</p>
         <div class="tch-suggest">${SUGGESTIONS.map(s => `<button type="button" class="tch-chip" data-say="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div></div>`;
    thinking.hidden = !isThinking();

    quick.innerHTML = lastResult
      ? `<button type="button" class="tch-chip tch-feedback" data-feedback>Feedback on my last attempt${typeof lastResult.accuracy === 'number' ? ` (${Math.round(lastResult.accuracy)}%)` : ''}</button>`
      : '';
    updateSharing();
    if (scrollDown || nearBottom) list.scrollTop = list.scrollHeight;
  }

  function updateSharing() {
    shareText.textContent = share.checked ? sharingLine() : 'nothing (only your message is sent)';
  }

  // ───────── Events ─────────
  function show(to) {
    const hadFocus = panel.contains(document.activeElement);
    open = to;
    panel.hidden = !open;
    if (!open && hadFocus) fab.focus(); // Escape / × hands focus back to the Teacher button
    fab.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('tch-open', open);
    if (open) {
      put(SEEN_KEY, String(Math.max(0, ...thread.replies.map(r => r.id))));
      render(true);
      if (matchMedia('(pointer: fine)').matches) input.focus();
    } else render();
  }

  fab.addEventListener('click', () => show(!open));
  $('.tch-close').addEventListener('click', () => show(false));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    send(text);
  });
  share.addEventListener('change', () => {
    put(SHARE_KEY, share.checked ? 'on' : 'off');
    updateSharing();
  });

  // Typing in the panel must not reach the player's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) panel.addEventListener(type, e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') show(false);
  });

  panel.addEventListener('click', async e => {
    const say = e.target.closest('[data-say]');
    if (say) return send(say.dataset.say);
    if (e.target.closest('[data-feedback]')) {
      const r = lastResult;
      lastResult = null;
      const bars = Array.isArray(r.section) ? ` (bars ${r.section[0] + 1}–${r.section[1] + 1})` : '';
      return send(
        `Feedback on my last attempt: ${r.title || r.songId}${bars}, ${Math.round(r.accuracy ?? 0)}% at ${r.tempo} BPM. What should I work on?`,
      );
    }
    const btn = e.target.closest('.tch-action');
    if (btn) {
      const [replyId, index, item] = btn.dataset.key.split(':').map(Number);
      const reply = thread.replies.find(r => r.id === replyId);
      let action = reply?.actions?.[index];
      if (action && Number.isInteger(item)) action = action.items?.[item]?.action;
      if (!action) return;
      try {
        notes.set(btn.dataset.key, {ok: true, text: '✓ ' + (await runAction(action, {knownSong}))});
      } catch (err) {
        notes.set(btn.dataset.key, {ok: false, text: err.message});
      }
      render();
    }
  });
  panel.addEventListener('change', e => {
    const box = e.target.closest('[data-plan]');
    if (!box) return;
    const ticks = planTicks(box.dataset.plan);
    box.checked ? ticks.add(Number(box.dataset.item)) : ticks.delete(Number(box.dataset.item));
    put(PLAN_KEY + box.dataset.plan, JSON.stringify([...ticks]));
    render();
  });

  const stopTracking = trackResults(detail => {
    lastResult = detail;
    render();
  });
  const refresh = () => open && updateSharing();
  window.addEventListener('hashchange', refresh);
  const tick = setInterval(refresh, 2000);
  const onVisible = () => document.visibilityState === 'visible' && open && setThread(thread);
  document.addEventListener('visibilitychange', onVisible);

  // Start: the teacher needs the dev server; in a static build the button stays hidden.
  fab.hidden = true;
  const ready = fetch(api, {cache: 'no-store'})
    .then(res =>
      res.ok && (res.headers.get('content-type') || '').includes('json')
        ? res.json()
        : Promise.reject(Error('no teacher')),
    )
    .then(data => {
      fab.hidden = false;
      setThread(data);
      connect();
      return true;
    })
    .catch(() => false);

  return {
    ready,
    open: () => show(true),
    close: () => show(false),
    get lastResult() {
      return lastResult ?? recentResults()[0] ?? null;
    },
    destroy() {
      source?.close();
      stopTracking();
      clearInterval(tick);
      window.removeEventListener('hashchange', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      document.documentElement.classList.remove('tch-open');
      fab.remove();
      panel.remove();
    },
  };
}
