// First lessons (#/exercises/lessons and #/exercises/lessons/<lesson>), under Exercises.
//   mountLessons(container) → {destroy()}                      the list of lessons
//   mountLesson(container, {lesson}) → {destroy(), title}      a few cards, then things to play
// Keys are checked from window `piano:note` (MIDI, the Mac relay, the microphone) and from the
// lesson's own on-screen keys. Completion is kept in localStorage (piano-practice.lessons), and
// each finished lesson dispatches `trainer:result` with level 'lesson:<id>'.
import '../theory/engrave.css';
import '../theory/theory.css';
import './lessons.css';
import {createPiano} from '../piano.js';
import {LESSONS, lessonById, lessonTasks, step, startTask, targets, score, tuneExample, noteName, LEVEL_PREFIX, PASS} from './lessons.js';
import {art, handsSvg} from './art.js';
import {engrave} from '../theory/engrave.js';
import {playExample} from '../theory/play.js';
import {createKeys} from '../theory/keys.js';
import {newSeed} from '../theory/music.js';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
/** *italic* and **bold** in lesson text (escaped first). */
const markup = text => esc(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<em>$1</em>');

export const STORE_KEY = 'piano-practice.lessons';
const LO = 48, HI = 84;
const ADVANCE_MS = 1100;

export function loadLessons() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return {lessons: {}, ...s}; } catch { return {lessons: {}}; } }
function saveResult(id, accuracy) {
  const s = loadLessons();
  const prev = s.lessons[id] || {};
  s.lessons[id] = {best: Math.max(prev.best ?? 0, accuracy), done: !!prev.done || accuracy >= PASS, at: Date.now(), attempts: (prev.attempts || 0) + 1};
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
  return s.lessons[id];
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

// ───────── the list ─────────

export function mountLessons(container) {
  const state = loadLessons();
  const root = el('div', {class: 'th ls'},
    el('p', {class: 'th-lead', text: 'Four short lessons for your first days at the piano. Read a few cards, then play: every answer is checked on the keys.'}),
    el('ol', {class: 'th-list', role: 'list'}, LESSONS.map((l, i) => {
      const s = state.lessons[l.id];
      return el('li', {}, el('a', {class: 'th-item' + (s?.done ? ' is-done' : ''), href: `#/exercises/lessons/${l.id}`},
        el('span', {class: 'th-item-n', text: String(i + 1)}),
        el('span', {class: 'th-item-text'},
          el('span', {class: 'th-item-title', text: l.title}),
          el('span', {class: 'th-item-blurb', text: l.blurb})),
        el('span', {class: 'th-item-status', text: s?.done ? `Done · ${Math.round(s.best)}%` : s ? `${Math.round(s.best)}% · try again` : 'A few minutes'})));
    })),
    el('p', {class: 'ls-coda'}, 'Then your first pieces are waiting in ', el('a', {href: '#/pieces', text: 'Pieces'}), ', beginning with ', el('a', {href: '#/play/hot-cross-buns', text: 'Hot Cross Buns'}), '.'));
  container.append(root);
  return {destroy() { root.remove(); }};
}

// ───────── one lesson ─────────

export function mountLesson(container, {lesson: id} = {}) {
  const lesson = lessonById(id);
  if (!lesson) {
    const box = el('div', {class: 'view-card'}, el('h2', {text: 'No such lesson'}), el('p', {text: 'It may have been renamed.'}), el('a', {class: 'view-card-link', href: '#/exercises/lessons', text: 'All lessons'}));
    container.append(box);
    return {destroy() { box.remove(); }};
  }
  const piano = createPiano(() => {});
  try { piano.load(); } catch {}
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
  const stopSound = () => { clearTimers(); try { piano.silence(); } catch {} };
  let stepIdx = 0;          // cards, then the tasks
  let run = null, keys = null;
  const root = el('div', {class: 'th th-lesson ls'});
  container.append(root);

  function figure(example) {
    if (!example) return null;
    const {svg} = engrave(example);
    const staff = el('div', {class: 'th-ex-staff is-playable', html: svg});
    staff.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    const hear = () => {
      stopSound();
      playExample(piano, example, {onEvent: (i, at, len) => {
        later(() => staff.querySelector(`.eg-ev[data-i="${i}"]`)?.classList.add('is-playing'), at);
        later(() => staff.querySelector(`.eg-ev[data-i="${i}"]`)?.classList.remove('is-playing'), at + Math.max(120, len * .9));
      }});
    };
    staff.addEventListener('click', hear);
    return el('figure', {class: 'th-ex' + (example.staff === 'grand' ? ' is-grand' : '')}, staff,
      el('figcaption', {}, el('button', {type: 'button', class: 'th-hear', onclick: hear}, el('span', {class: 'th-hear-icon', 'aria-hidden': 'true', text: '▸'}), 'Hear it')));
  }
  const artBox = id => { const svg = art(id); return svg ? el('div', {class: 'ls-art', html: svg}) : null; };

  const dots = () => el('ol', {class: 'th-steps', 'aria-label': 'Lesson progress'}, [...lesson.cards.map((c, i) => el('li', {class: i === stepIdx ? 'is-now' : i < stepIdx ? 'is-past' : '', title: c.title})),
    el('li', {class: 'th-steps-quiz' + (stepIdx >= lesson.cards.length ? ' is-now' : ''), title: 'Play', text: '♪'})]);

  function showCard() {
    stopSound();
    keys?.destroy(); keys = null;
    const card = lesson.cards[stepIdx];
    const last = stepIdx === lesson.cards.length - 1;
    const next = el('button', {type: 'button', class: 'btn-primary th-next', onclick: () => { stepIdx++; render(); }}, last ? 'Start playing' : 'Next');
    root.replaceChildren(
      dots(),
      el('section', {class: 'th-card', 'aria-labelledby': 'ls-card-h'},
        el('p', {class: 'th-eyebrow', text: `${stepIdx + 1} of ${lesson.cards.length}`}),
        el('h2', {class: 'th-h', id: 'ls-card-h', text: card.title}),
        el('div', {class: 'th-text'}, card.text.map(t => el('p', {html: markup(t)}))),
        card.art ? artBox(card.art) : null,
        figure(card.example),
        el('div', {class: 'th-nav'},
          stepIdx > 0 ? el('button', {type: 'button', class: 'text-btn th-back', onclick: () => { stepIdx--; render(); }}, 'Back') : el('a', {class: 'text-btn th-back', href: '#/exercises/lessons'}, 'All lessons'),
          next)));
    if (stepIdx > 0) next.focus({preventScroll: true});
  }

  // ───── playing ─────
  function startRun() {
    run = {tasks: lessonTasks(lesson, newSeed()), i: 0, right: 0, wrong: 0, start: performance.now(), times: []};
    showTask();
  }

  function taskArt(task) {
    if (task.kind === 'tune') {
      const {svg} = engrave(tuneExample(task));
      return el('div', {class: 'ls-tune' + (task.staff === 'grand' ? ' is-grand' : ''), html: svg});
    }
    if (task.kind === 'note' && task.finger) return el('div', {class: 'ls-art', html: handsSvg({hands: [task.hand], on: {hand: task.hand, finger: task.finger}})});
    return task.art ? artBox(task.art) : null;
  }

  function showTask() {
    stopSound();
    keys?.destroy();
    const task = run.tasks[run.i];
    run.cur = {task, state: startTask(), shownAt: performance.now(), slipped: false};
    keys = createKeys({lo: LO, hi: HI, piano, onNote: n => play(n)});
    const feedback = el('p', {class: 'th-feedback', 'aria-live': 'polite'});
    const next = el('button', {type: 'button', class: 'btn-primary th-next', hidden: true, onclick: () => advance()}, run.i === run.tasks.length - 1 ? 'See how you did' : 'Next');
    const pic = taskArt(task);
    root.replaceChildren(
      dots(),
      el('section', {class: 'th-card th-question ls-task', 'aria-labelledby': 'ls-task-h'},
        el('p', {class: 'th-eyebrow', text: `${run.i + 1} of ${run.tasks.length}`}),
        el('h2', {class: 'th-h th-prompt', id: 'ls-task-h', text: task.prompt}),
        task.detail ? el('p', {class: 'ls-detail', text: task.detail}) : null,
        pic,
        el('div', {class: 'th-play'},
          el('p', {class: 'th-play-note', text: 'Play it on your piano, or tap the keys below.'}),
          keys.el),
        feedback,
        el('div', {class: 'th-nav th-nav-quiz'}, el('span', {class: 'th-score', text: scoreText()}), next)));
    run.cur.feedback = feedback; run.cur.next = next; run.cur.pic = pic;
    markTune();
  }
  const scoreText = () => `${run.right} right · ${run.wrong} ${run.wrong === 1 ? 'slip' : 'slips'}`;

  /** Tune staff: notes played so far, and the next one. */
  function markTune() {
    const c = run.cur;
    if (c.task.kind !== 'tune' || !c.pic) return;
    c.pic.querySelectorAll('.eg-ev').forEach(g => {
      const i = +g.dataset.i;
      g.classList.toggle('is-done', i < c.state.pos);
      g.classList.toggle('is-next', i === c.state.pos && !c.state.done);
    });
  }

  function play(n) {
    const c = run?.cur;
    if (!c || c.state.done) return;
    const {state, verdict} = step(c.task, c.state, n);
    c.state = state;
    if (verdict === 'ignore') return;
    keys?.clear();
    if (verdict === 'wrong') {
      run.wrong++;
      c.slipped = true;
      keys?.mark(n, 'bad', 800);
      for (const t of targets(c.task, c.state, LO, HI)) keys?.mark(t, 'target');
      c.feedback.dataset.tone = 'bad';
      c.feedback.replaceChildren(el('b', {text: 'Not quite.'}), ' ', `That was ${noteName(n)}. ${c.task.hint || ''}`);
    } else {
      run.right++;
      keys?.mark(n, 'ok', 700);
      if (verdict === 'ok') {
        c.feedback.dataset.tone = '';
        c.feedback.textContent = c.task.kind === 'pc' && c.task.count > 1 ? `${c.state.played.length} of ${c.task.count}.` : '';
        if (c.task.kind === 'tune' && c.slipped) for (const t of targets(c.task, c.state, LO, HI)) keys?.mark(t, 'target');
      }
    }
    root.querySelector('.th-score').textContent = scoreText();
    markTune();
    if (verdict === 'done') {
      run.times.push(performance.now() - c.shownAt);
      c.feedback.dataset.tone = 'ok';
      c.feedback.replaceChildren(el('b', {text: c.slipped ? 'There it is.' : 'Clean.'}));
      c.next.hidden = false;
      later(() => { if (run?.cur === c) advance(); }, ADVANCE_MS);
    }
  }

  function advance() {
    clearTimers();
    if (run.i < run.tasks.length - 1) { run.i++; showTask(); return; }
    finish();
  }

  function finish() {
    stopSound();
    keys?.destroy(); keys = null;
    const s = score(run.right, run.wrong);
    const avgMs = run.times.length ? Math.round(run.times.reduce((a, b) => a + b, 0) / run.times.length) : 0;
    const saved = saveResult(lesson.id, s.accuracy);
    window.dispatchEvent(new CustomEvent('trainer:result', {detail: {
      level: LEVEL_PREFIX + lesson.id, right: s.right, wrong: s.wrong, accuracy: s.accuracy, avgMs,
      durationMs: Math.round(performance.now() - run.start), at: Date.now(), levelName: lesson.title, passed: s.passed,
    }}));
    const nextLesson = LESSONS[LESSONS.indexOf(lesson) + 1];
    const forward = s.passed && nextLesson ? el('a', {class: 'btn-primary', href: `#/exercises/lessons/${nextLesson.id}`}, `Next: ${nextLesson.title}`)
      : s.passed && lesson.next ? el('a', {class: 'btn-primary', href: lesson.next.href}, lesson.next.label)
        : s.passed ? el('a', {class: 'btn-primary', href: '#/exercises/lessons'}, 'All lessons')
          : el('button', {type: 'button', class: 'btn-primary', onclick: () => startRun()}, 'Try again');
    root.replaceChildren(el('section', {class: 'th-card th-results', 'aria-live': 'polite'},
      el('p', {class: 'th-eyebrow', text: lesson.title}),
      el('h2', {class: 'th-h', text: s.passed ? 'Lesson complete' : 'Nearly there'}),
      el('div', {class: 'th-res-big'}, el('b', {text: `${s.accuracy}%`}), el('span', {text: `${s.right} right · ${s.wrong} ${s.wrong === 1 ? 'slip' : 'slips'} · best ${Math.round(saved.best)}%`})),
      el('p', {class: 'th-res-verdict', text: s.passed ? (s.wrong === 0 ? 'Clean. Well played.' : 'Well played.') : `Take it slowly and try for ${PASS}% or more.`}),
      el('div', {class: 'th-nav th-res-actions'},
        el('button', {type: 'button', class: 'text-btn', onclick: () => { if (s.passed) startRun(); else { stepIdx = 0; render(); } }}, s.passed ? 'Play it again' : 'Back to the cards'),
        forward)));
    root.querySelector('.btn-primary')?.focus({preventScroll: true});
  }

  function render() {
    if (stepIdx < lesson.cards.length) showCard();
    else startRun();
    root.closest('.view-scroll')?.scrollTo?.({top: 0});
  }

  // Keys from MIDI, the relay or the microphone (the on-screen keys call play() themselves).
  const onPianoNote = e => {
    const d = e.detail || {};
    if (typeof d.note !== 'number' || d.velocity === 0 || !run?.cur) return;
    if (d.source !== 'screen') keys?.press(d.note);
    play(d.note);
  };
  window.addEventListener('piano:note', onPianoNote);

  render();
  return {
    title: lesson.title,
    destroy() {
      stopSound();
      keys?.destroy();
      run = null;
      window.removeEventListener('piano:note', onPianoNote);
      root.remove();
    },
  };
}
