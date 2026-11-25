// Theory lessons (#/exercises/theory and #/exercises/theory/<lesson>).
//   mountTheory(container) → {destroy()}                     the list of lessons
//   mountTheoryLesson(container, {lesson}) → {destroy(), title}  cards, then questions
// Completion is kept in localStorage (piano-practice.theory); each finished set of questions
// dispatches `trainer:result` with level 'theory:<lesson id>'.
import './engrave.css';
import './theory.css';
import {createPiano} from '../piano.js';
import {LESSONS, lessonById, lessonQuestions, playedMatches, CIRCLE, keySignatureText, tonicTriad} from './lessons.js';
import {engrave} from './engrave.js';
import {playExample, playNotes} from './play.js';
import {createKeys} from './keys.js';
import {newSeed, midiName} from './music.js';
import {midi, pitchName, parseKey} from '../exercises/theory.js';

const STORE_KEY = 'piano-practice.theory';
const PASS = 80;
export function loadTheory() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return {lessons: {}, ...s}; } catch { return {lessons: {}}; } }
function saveResult(id, accuracy) {
  const s = loadTheory();
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
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
/** *italic* and **bold** in lesson text (escaped first). */
export const markup = text => esc(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<em>$1</em>');

// ───────── the list ─────────

export function mountTheory(container) {
  const state = loadTheory();
  const root = el('div', {class: 'th'},
    el('p', {class: 'th-lead', text: 'Six short lessons. Read a few cards, listen to the examples, then answer a handful of questions.'}),
    el('ol', {class: 'th-list', role: 'list'}, LESSONS.map((l, i) => {
      const s = state.lessons[l.id];
      return el('li', {}, el('a', {class: 'th-item' + (s?.done ? ' is-done' : ''), href: `#/exercises/theory/${l.id}`},
        el('span', {class: 'th-item-n', text: String(i + 1)}),
        el('span', {class: 'th-item-text'},
          el('span', {class: 'th-item-title', text: l.title}),
          el('span', {class: 'th-item-blurb', text: l.blurb})),
        el('span', {class: 'th-item-status', text: s?.done ? `Done · ${Math.round(s.best)}%` : s ? `${Math.round(s.best)}% · try again` : `${l.cards.length} cards`})));
    })));
  container.append(root);
  return {destroy() { root.remove(); }};
}

// ───────── one lesson ─────────

export function mountTheoryLesson(container, {lesson: id} = {}) {
  const lesson = lessonById(id);
  if (!lesson) {
    const box = el('div', {class: 'view-card'}, el('h2', {text: 'No such lesson'}), el('p', {text: 'It may have been renamed.'}), el('a', {class: 'view-card-link', href: '#/exercises/theory', text: 'All lessons'}));
    container.append(box);
    return {destroy() { box.remove(); }};
  }
  const piano = createPiano(() => {});
  try { piano.load(); } catch {}
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const stopSound = () => { timers.forEach(clearTimeout); timers.clear(); try { piano.silence(); } catch {} for (const g of root.querySelectorAll('.is-playing')) g.classList.remove('is-playing'); };
  let step = 0;                 // 0 … cards.length - 1: cards; cards.length: questions
  let quiz = null, keys = null, circle = null;
  const root = el('div', {class: 'th th-lesson'});
  container.append(root);

  // An engraved example; tap "Hear it" to play it, the notes light up as they sound.
  function figure(example, {label = 'Hear it'} = {}) {
    if (!example) return null;
    const {svg} = engrave(example);
    const staff = el('div', {class: 'th-ex-staff', html: svg});
    staff.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    const fig = el('figure', {class: 'th-ex' + (example.staff === 'line' ? ' is-line' : example.staff === 'grand' ? ' is-grand' : '')}, staff);
    if (example.play) {
      const btn = el('button', {type: 'button', class: 'th-hear', onclick: () => hear()}, el('span', {class: 'th-hear-icon', 'aria-hidden': 'true', text: '▸'}), label);
      const hear = () => {
        stopSound();
        playExample(piano, example, {onEvent: (i, at, len) => {
          later(() => staff.querySelector(`.eg-ev[data-i="${i}"]`)?.classList.add('is-playing'), at);
          later(() => staff.querySelector(`.eg-ev[data-i="${i}"]`)?.classList.remove('is-playing'), at + Math.max(120, len * .9));
        }});
      };
      staff.addEventListener('click', hear);
      staff.classList.add('is-playable');
      fig.append(el('figcaption', {}, btn));
      fig.hear = hear;
    }
    return fig;
  }

  const dots = () => el('ol', {class: 'th-steps', 'aria-label': 'Lesson progress'}, [...lesson.cards.map((c, i) => el('li', {class: i === step ? 'is-now' : i < step ? 'is-past' : '', title: c.title})),
    el('li', {class: 'th-steps-quiz' + (step === lesson.cards.length ? ' is-now' : ''), title: 'Questions', text: '?'})]);

  function showCard() {
    stopSound();
    circle?.destroy(); circle = null;
    const card = lesson.cards[step];
    const last = step === lesson.cards.length - 1;
    const next = el('button', {type: 'button', class: 'btn-primary th-next', onclick: () => { step++; render(); }}, last ? 'Start the questions' : 'Next');
    if (card.widget === 'circle-of-fifths') circle = createCircle(piano);
    root.replaceChildren(
      dots(),
      el('section', {class: 'th-card', 'aria-labelledby': 'th-card-h'},
        el('p', {class: 'th-eyebrow', text: `${step + 1} of ${lesson.cards.length}`}),
        el('h2', {class: 'th-h', id: 'th-card-h', text: card.title}),
        el('div', {class: 'th-text'}, card.text.map(t => el('p', {html: markup(t)}))),
        figure(card.example),
        circle?.el,
        el('div', {class: 'th-nav'},
          step > 0 ? el('button', {type: 'button', class: 'text-btn th-back', onclick: () => { step--; render(); }}, 'Back') : el('a', {class: 'text-btn th-back', href: '#/exercises/theory'}, 'All lessons'),
          next)));
    if (step > 0) next.focus({preventScroll: true});
  }

  // ───── questions ─────
  function startQuiz() {
    quiz = {qs: lessonQuestions(lesson, newSeed()), i: 0, right: 0, wrong: 0, times: [], start: performance.now()};
    showQuestion();
  }
  function showQuestion() {
    stopSound();
    keys?.destroy(); keys = null;
    const qn = quiz.qs[quiz.i];
    quiz.current = {q: qn, answered: false, shownAt: performance.now(), played: []};
    const feedback = el('p', {class: 'th-feedback', 'aria-live': 'polite'});
    const next = el('button', {type: 'button', class: 'btn-primary th-next', hidden: true, onclick: () => advance()}, quiz.i === quiz.qs.length - 1 ? 'See how you did' : 'Next question');
    let answerArea;
    if (qn.choices) {
      answerArea = el('div', {class: 'th-choices' + (qn.choices.length > 3 ? ' is-four' : '')}, qn.choices.map((c, k) =>
        el('button', {type: 'button', class: 'th-choice', 'data-id': c.id, onclick: () => answerChoice(c.id)}, el('span', {class: 'th-choice-k', text: String(k + 1)}), el('span', {text: c.label}))));
    } else {
      keys = createKeys({lo: 48, hi: 83, piano, onNote: n => answerNote(n)});
      answerArea = el('div', {class: 'th-play'},
        el('p', {class: 'th-play-note', text: qn.play.count > 1 ? 'Play the notes on your piano, or tap them below — any octave, any order.' : 'Play it on your piano, or tap it below — any octave.'}),
        keys.el);
    }
    const fig = figure(qn.example, {label: 'Hear it'});
    root.replaceChildren(
      dots(),
      el('section', {class: 'th-card th-question', 'aria-labelledby': 'th-q-h'},
        el('p', {class: 'th-eyebrow', text: `Question ${quiz.i + 1} of ${quiz.qs.length}`}),
        el('h2', {class: 'th-h th-prompt', id: 'th-q-h', text: qn.prompt}),
        fig, answerArea, feedback,
        el('div', {class: 'th-nav th-nav-quiz'}, el('span', {class: 'th-score', text: `${quiz.right} right · ${quiz.wrong} missed`}), next)));
    quiz.current.feedback = feedback; quiz.current.next = next;
  }
  function judge(ok, text) {
    const c = quiz.current;
    if (c.answered) return;
    c.answered = true;
    if (ok) { quiz.right++; quiz.times.push(performance.now() - c.shownAt); } else quiz.wrong++;
    c.feedback.dataset.tone = ok ? 'ok' : 'bad';
    c.feedback.replaceChildren(el('b', {text: ok ? 'Right.' : 'Not quite.'}), ' ', c.q.explain || text || '');
    root.querySelector('.th-score').textContent = `${quiz.right} right · ${quiz.wrong} missed`;
    c.next.hidden = false;
    c.next.focus({preventScroll: true});
  }
  function answerChoice(id) {
    const c = quiz.current;
    if (c.answered) return;
    for (const b of root.querySelectorAll('.th-choice')) {
      b.disabled = true;
      if (b.dataset.id === c.q.answer) b.classList.add('is-right');
      else if (b.dataset.id === id) b.classList.add('is-wrong');
    }
    judge(id === c.q.answer);
  }
  function answerNote(n) {
    const c = quiz.current;
    if (!c || c.answered || !c.q.play) return;
    const pc = ((n % 12) + 12) % 12;
    if (!c.q.play.pcs.includes(pc)) {
      keys?.mark(n, 'bad', 900);
      judge(false, `You played ${midiName(n).replace(/-?\d+$/, '')}.`);
      for (const p of c.q.play.pcs) for (let m = 48; m <= 83; m++) if (m % 12 === p) keys?.mark(m, 'target');
      return;
    }
    keys?.mark(n, 'ok', 700);
    if (!c.played.some(m => m % 12 === pc)) c.played.push(n);
    if (c.played.length >= c.q.play.count) judge(playedMatches(c.q.play, c.played));
  }
  function advance() {
    if (quiz.i < quiz.qs.length - 1) { quiz.i++; showQuestion(); return; }
    finish();
  }
  function finish() {
    stopSound();
    keys?.destroy(); keys = null;
    const n = quiz.right + quiz.wrong;
    const accuracy = n ? Math.round(100 * quiz.right / n) : 0;
    const avgMs = quiz.times.length ? Math.round(quiz.times.reduce((a, b) => a + b, 0) / quiz.times.length) : null;
    const saved = saveResult(lesson.id, accuracy);
    window.dispatchEvent(new CustomEvent('trainer:result', {detail: {
      level: 'theory:' + lesson.id, right: quiz.right, wrong: quiz.wrong, accuracy, avgMs,
      durationMs: Math.round(performance.now() - quiz.start), at: Date.now(), levelName: lesson.title, passed: accuracy >= PASS,
    }}));
    const nextLesson = LESSONS[LESSONS.indexOf(lesson) + 1];
    const passed = accuracy >= PASS;
    root.replaceChildren(el('section', {class: 'th-card th-results', 'aria-live': 'polite'},
      el('p', {class: 'th-eyebrow', text: lesson.title}),
      el('h2', {class: 'th-h', text: passed ? 'Lesson complete' : 'Nearly there'}),
      el('div', {class: 'th-res-big'}, el('b', {text: `${quiz.right} / ${n}`}), el('span', {text: `${accuracy}% · best ${Math.round(saved.best)}%`})),
      el('p', {class: 'th-res-verdict', text: passed ? (accuracy === 100 ? 'Every one. Well done.' : 'Well understood.') : `Read the cards again, then try for ${PASS}% or more.`}),
      el('div', {class: 'th-nav th-res-actions'},
        el('button', {type: 'button', class: 'text-btn', onclick: () => { if (passed) startQuiz(); else { step = 0; render(); } }}, passed ? 'Try new questions' : 'Back to the cards'),
        passed && nextLesson ? el('a', {class: 'btn-primary', href: `#/exercises/theory/${nextLesson.id}`}, `Next: ${nextLesson.title}`)
          : passed ? el('a', {class: 'btn-primary', href: '#/exercises/theory'}, 'All lessons')
            : el('button', {type: 'button', class: 'btn-primary', onclick: () => startQuiz()}, 'Try again'))));
    root.querySelector('.btn-primary')?.focus({preventScroll: true});
  }

  function render() {
    if (step < lesson.cards.length) showCard();
    else startQuiz();
    root.closest('.view-scroll')?.scrollTo?.({top: 0});
  }

  // MIDI / relay keys answer keyboard questions; 1–4 pick a choice.
  const onPianoNote = e => {
    const d = e.detail || {};
    if (typeof d.note !== 'number' || d.velocity === 0 || !quiz?.current?.q?.play) return;
    if (d.source !== 'screen') keys?.press(d.note);
    answerNote(d.note);
  };
  window.addEventListener('piano:note', onPianoNote);
  const onKey = e => {
    if (!root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input,select,textarea,[contenteditable]')) return;
    const c = quiz?.current;
    if (step < lesson.cards.length || !c || c.answered || !c.q.choices) return;
    const k = +e.key;
    if (k >= 1 && k <= c.q.choices.length) { e.preventDefault(); answerChoice(c.q.choices[k - 1].id); }
  };
  window.addEventListener('keydown', onKey);

  render();
  return {
    title: lesson.title,
    destroy() {
      stopSound();
      keys?.destroy(); circle?.destroy();
      window.removeEventListener('piano:note', onPianoNote);
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}

// ───────── circle of fifths explorer ─────────

function createCircle(piano) {
  let sel = 0;
  const wrap = el('div', {class: 'th-circle'});
  const svgBox = el('div', {class: 'th-circle-svg'});
  const info = el('div', {class: 'th-circle-info', 'aria-live': 'polite'});
  wrap.append(svgBox, info);
  const C = 120, RO = 98, RI = 64;
  function draw() {
    const items = CIRCLE.map((k, i) => {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const xo = C + RO * Math.cos(a), yo = C + RO * Math.sin(a), xi = C + RI * Math.cos(a), yi = C + RI * Math.sin(a);
      const on = i === sel ? ' is-on' : '';
      return `<g class="th-ck${on}" data-i="${i}" role="button" tabindex="0" aria-label="${esc(pitchName(parseKey(k.major)))} major">
        <circle cx="${xo.toFixed(1)}" cy="${yo.toFixed(1)}" r="17" class="th-ck-bg"/>
        <text x="${xo.toFixed(1)}" y="${(yo + 6).toFixed(1)}" text-anchor="middle" class="th-ck-major">${esc(pitchName(parseKey(k.major)))}</text>
        <text x="${xi.toFixed(1)}" y="${(yi + 4.5).toFixed(1)}" text-anchor="middle" class="th-ck-minor">${esc(pitchName(parseKey(k.minor)))}m</text></g>`;
    }).join('');
    svgBox.innerHTML = `<svg viewBox="0 0 240 240" class="th-circle-ring"><circle cx="${C}" cy="${C}" r="${RO + 21}" class="th-ring"/><circle cx="${C}" cy="${C}" r="${(RO + RI) / 2 + 4}" class="th-ring"/><circle cx="${C}" cy="${C}" r="${RI - 16}" class="th-ring"/><text x="${C}" y="${C - 4}" text-anchor="middle" class="th-ck-mid">majors outside</text><text x="${C}" y="${C + 12}" text-anchor="middle" class="th-ck-mid">minors inside</text>${items}</svg>`;
    const k = CIRCLE[sel];
    const {svg} = engrave({staff: 'grand', key: k.fifths, barlines: false, final: false, measures: [[{dur: 4, rest: true, cls: 'eg-hide'}]]});
    info.innerHTML = '';
    info.append(
      el('p', {class: 'th-circle-name', text: `${pitchName(parseKey(k.major))} major`}),
      el('p', {class: 'th-circle-sig', text: keySignatureText(k.fifths)}),
      el('div', {class: 'th-circle-staff', html: svg}),
      el('p', {class: 'th-circle-rel', text: `Relative minor: ${pitchName(parseKey(k.minor))} minor`}),
      el('button', {type: 'button', class: 'th-hear', onclick: () => sound()}, el('span', {class: 'th-hear-icon', 'aria-hidden': 'true', text: '▸'}), 'Hear the chord'));
  }
  function sound() {
    const tones = tonicTriad(CIRCLE[sel].major).map(midi);
    try { piano.silence(); } catch {}
    playNotes(piano, tones, {gapMs: 140, lenMs: 1400});
  }
  function pick(i) { sel = (i + 12) % 12; draw(); sound(); svgBox.querySelector(`[data-i="${sel}"]`)?.focus({preventScroll: true}); }
  svgBox.addEventListener('click', e => { const g = e.target.closest('.th-ck'); if (g) pick(+g.dataset.i); });
  svgBox.addEventListener('keydown', e => {
    const g = e.target.closest('.th-ck');
    if (!g) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(+g.dataset.i); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); pick(sel + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); pick(sel - 1); }
  });
  draw();
  return {el: wrap, destroy() { wrap.remove(); }};
}
