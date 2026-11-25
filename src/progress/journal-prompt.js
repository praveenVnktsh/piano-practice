// "How did it go?" — a one-line practice-journal note offered after a sitting of 3+ minutes
// of practice, when the student leaves the player (or 20 s after they stop, if they stay).
// Never nagging: at most once per sitting, it fades away by itself, "Not now" waits for the
// next sitting, and after two "Not now"s in a day it stays quiet until tomorrow.
import './journal.css';
import {addJournalEntry} from './store.js';
import {dayKey, MAX_JOURNAL_TEXT, MOODS} from './model.js';

export const PROMPT_AFTER_MS = 3 * 60e3;
const STATE_KEY = 'piano-practice.journal.prompt';
const IDLE_MS = 20e3;
const AUTO_HIDE_MS = 60e3;
const MOOD_TEXT = {good: 'Went well', okay: 'So-so', hard: 'Hard going'};

const readState = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; } };
const writeState = s => { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {} };

/** Should a sitting of `ms` practice be offered a note, given the stored state? (pure) */
export function shouldPrompt(ms, state = {}, now = Date.now()) {
  if (ms < PROMPT_AFTER_MS) return false;
  const today = dayKey(now);
  return !(state.day === today && (state.dismissed || 0) >= 2);
}

let started = false;

export function startJournalPrompt() {
  if (started) return;
  started = true;
  let sitting = {ms: 0, songId: null, title: ''}, idle = null, node = null, hideTimer = null;
  const inPlayer = () => location.hash.startsWith('#/play/');

  window.addEventListener('practice:session', e => {
    const d = e.detail || {};
    if (!(d.durationMs > 0)) return;
    sitting.ms += d.durationMs;
    if (d.songId && !String(d.songId).startsWith('ex:')) { sitting.songId = d.songId; sitting.title = d.title || ''; }
    else if (!sitting.songId) { sitting.songId = d.songId || null; sitting.title = d.title || ''; }
    clearTimeout(idle);
    idle = setTimeout(maybeOffer, inPlayer() ? IDLE_MS : 400);
  });
  // Starting to play again cancels the idle offer.
  window.addEventListener('piano:note', () => { if (inPlayer()) clearTimeout(idle); });
  window.addEventListener('hashchange', () => { if (!inPlayer()) { clearTimeout(idle); idle = setTimeout(maybeOffer, 500); } });

  function maybeOffer() {
    if (node || !shouldPrompt(sitting.ms, readState())) return;
    offer({...sitting});
    sitting = {ms: 0, songId: null, title: ''};
  }

  function close(dismissed) {
    clearTimeout(hideTimer);
    if (!node) return;
    if (dismissed) {
      const s = readState(), today = dayKey(Date.now());
      writeState({day: today, dismissed: (s.day === today ? s.dismissed || 0 : 0) + 1});
    }
    const n = node;
    node = null;
    n.classList.add('is-leaving');
    setTimeout(() => n.remove(), 220);
  }

  function offer(s) {
    let mood = null;
    const minutes = Math.round(s.ms / 60e3);
    node = document.createElement('form');
    node.className = 'jp';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', 'Practice journal');
    node.innerHTML = `
      <p class="jp-h">How did it go?</p>
      <p class="jp-sub"></p>
      <div class="jp-moods" role="group" aria-label="How it went">${MOODS.map(m => `<button type="button" class="jp-mood" data-mood="${m}" aria-pressed="false">${MOOD_TEXT[m]}</button>`).join('')}</div>
      <div class="jp-row">
        <input class="jp-input" name="text" maxlength="${MAX_JOURNAL_TEXT}" autocomplete="off" placeholder="One line for your journal: what went well, what to fix" aria-label="Journal note">
        <button type="submit" class="text-btn jp-save">Save</button>
      </div>
      <button type="button" class="jp-close" aria-label="Not now">Not now</button>`;
    node.querySelector('.jp-sub').textContent = `${minutes} minute${minutes === 1 ? '' : 's'}${s.title ? ` · ${s.title}` : ''}`;
    const input = node.querySelector('.jp-input');
    node.querySelectorAll('.jp-mood').forEach(b => b.addEventListener('click', () => {
      mood = mood === b.dataset.mood ? null : b.dataset.mood;
      node.querySelectorAll('.jp-mood').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mood === mood)));
      hold();
    }));
    const hold = () => clearTimeout(hideTimer);
    input.addEventListener('focus', hold);
    input.addEventListener('input', hold);
    node.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } });
    node.querySelector('.jp-close').addEventListener('click', () => close(true));
    node.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text && !mood) { input.focus(); return; }
      addJournalEntry({text, mood, songId: s.songId || undefined, title: s.title || undefined, minutes});
      writeState({});
      node.classList.add('is-saved');
      node.innerHTML = '<p class="jp-h">Noted in your journal.</p>';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => close(false), 1600);
    });
    document.body.append(node);
    hideTimer = setTimeout(() => close(false), AUTO_HIDE_MS);
  }
}
