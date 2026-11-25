// The introduction's dialog (loaded by src/onboarding/index.js): welcome → your piano →
// the four places → your level and daily goal → done (Today).
import {el} from '../app/dom.js';
import {LEVELS} from '../curriculum/data.js';
import './onboarding.css';

const GOALS = [10, 15, 20, 30, 45];
const isIPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Shows the introduction → a promise of how it ended ('done' | 'skip'). markSeen() runs on close. */
export function showOnboarding({markSeen}) {
  const returnTo = document.activeElement;
  let step = 0, closed = false, settle;
  const done = new Promise(r => { settle = r; });
  const choice = {level: 'beginner', goal: 15, touched: false};
  // Start from what the student already chose (re-opened from Progress).
  import('../progress/store.js').then(s => s.getProgress()).then(doc => {
    if (choice.touched || closed) return;
    if (doc?.settings?.pathStart) choice.level = doc.settings.pathStart;
    if (doc?.settings?.dailyGoalMin) choice.goal = doc.settings.dailyGoalMin;
    if (STEPS[step].id === 'level') render(false);
  }).catch(() => {});

  const dialog = el('dialog', {class: 'ob', 'aria-labelledby': 'ob-title', 'aria-describedby': 'ob-lead'});
  const count = el('p', {class: 'ob-count', 'aria-hidden': 'true'});
  const skip = el('button', {type: 'button', class: 'ob-skip', onclick: () => close('skip')}, 'Skip the introduction');
  const body = el('div', {class: 'ob-body'});
  const back = el('button', {type: 'button', class: 'text-btn ob-back', onclick: () => go(step - 1)}, 'Back');
  const dots = el('ol', {class: 'ob-dots', 'aria-hidden': 'true'});
  const next = el('button', {type: 'button', class: 'btn-primary ob-next', onclick: () => advance()});
  dialog.append(el('div', {class: 'ob-card'},
    el('header', {class: 'ob-head'}, count, skip),
    body,
    el('footer', {class: 'ob-foot'}, back, dots, next)));

  const STEPS = [
    {id: 'welcome', next: 'Begin', render: () => [
      el('p', {class: 'ob-kicker', text: 'Welcome'}),
      el('h2', {id: 'ob-title', tabindex: '-1', text: 'The practice room'}),
      el('p', {id: 'ob-lead', class: 'ob-lead', text: 'A quiet place to learn the piano properly: a little technique, the pieces you are learning, a short reading drill, every day.'}),
      el('p', {class: 'ob-text', text: 'This short introduction shows you around. It takes a minute, and you can skip it now or read it again later from Progress → Settings.'}),
    ]},
    {id: 'piano', next: 'Continue', render: () => [
      el('p', {class: 'ob-kicker', text: 'Your piano'}),
      el('h2', {id: 'ob-title', tabindex: '-1', text: 'Connect your piano'}),
      el('p', {id: 'ob-lead', class: 'ob-lead', text: 'The app listens to what you play: it waits for the right notes, times your rhythm and remembers how each bar went.'}),
      el('dl', {class: 'ob-list'},
        el('dt', {text: 'On the Mac'}),
        el('dd', {text: 'Plug the piano in with USB and open the app in Chrome or Edge. Open any piece, then ⋯ → Connect piano, and allow MIDI.'}),
        el('dt', {text: 'On the iPad'}),
        el('dd', {}, 'Safari has no MIDI, so the Mac relays your piano over Wi-Fi: run the dev server for the iPad on the Mac, open the bridge page there, then open the address it shows on the iPad. ',
          el('button', {type: 'button', class: 'text-btn inline', onclick: () => openHelpAt('ipad')}, 'The steps, in full')),
        el('dt', {text: 'No piano nearby?'}),
        el('dd', {text: 'Tap the keys on screen, or in a piece choose ⋯ → Listen with microphone: it follows single notes and melodies (not chords) on any piano.'})),
      isIPad() ? el('p', {class: 'ob-note', text: 'You are on an iPad: start the bridge on your Mac first.'}) : null,
    ]},
    {id: 'places', next: 'Continue', render: () => [
      el('p', {class: 'ob-kicker', text: 'Finding your way'}),
      el('h2', {id: 'ob-title', tabindex: '-1', text: 'Four places, nothing more'}),
      el('p', {id: 'ob-lead', class: 'ob-lead', text: 'Everything lives in four places: down the left on a wide screen, along the bottom on an iPad held upright or a phone.'}),
      el('ol', {class: 'ob-places'},
        place('Today', 'Your home. One clear path each day: a warm-up, your current piece and a short reading drill, plus your daily goal and any homework.'),
        place('Pieces', 'Your repertoire: bundled pieces by level, your own imports, and how far along each one is.'),
        place('Exercises', 'Scales and arpeggios in every key, note reading, sight-reading, rhythm, theory and ear training.'),
        place('Progress', 'Minutes, streaks and bars mastered, your path through the grades, goals, journal and settings.')),
      el('p', {class: 'ob-text'}, el('strong', {text: 'Your teacher'}), ' is a companion, not a place: the quiet Teacher button opens letters in the margin from anywhere (on your Mac’s dev server). Press ', el('kbd', {text: '?'}), ' at any time for help and shortcuts.'),
    ]},
    {id: 'level', next: 'Continue', render: () => [
      el('p', {class: 'ob-kicker', text: 'About you'}),
      el('h2', {id: 'ob-title', tabindex: '-1', text: 'Where shall we begin?'}),
      el('p', {id: 'ob-lead', class: 'ob-lead', text: 'Choose the level that feels comfortable today. Your path in Progress starts there; you can change it whenever you like.'}),
      el('fieldset', {class: 'ob-levels'},
        el('legend', {class: 'ob-legend', text: 'Your level'}),
        ...LEVELS.map(l => el('label', {class: 'ob-level'},
          el('input', {type: 'radio', name: 'ob-level', value: l.id, checked: l.id === choice.level || null,
            onchange: () => { choice.level = l.id; choice.touched = true; }}),
          el('span', {class: 'ob-level-text'}, el('span', {class: 'ob-level-name', text: l.name}), el('span', {class: 'ob-level-blurb', text: l.blurb}))))),
      el('fieldset', {class: 'ob-goals'},
        el('legend', {class: 'ob-legend', text: 'A daily goal'}),
        el('div', {class: 'ob-goal-row'}, ...GOALS.map(m => el('label', {class: 'ob-goal'},
          el('input', {type: 'radio', name: 'ob-goal', value: String(m), checked: m === choice.goal || null,
            onchange: () => { choice.goal = m; choice.touched = true; }}),
          el('span', {}, el('b', {text: String(m)}), ' min'))))),
    ]},
    {id: 'done', next: 'Start practising', render: () => [
      el('p', {class: 'ob-kicker', text: 'Ready'}),
      el('h2', {id: 'ob-title', tabindex: '-1', text: 'Well, then: to the piano.'}),
      el('p', {id: 'ob-lead', class: 'ob-lead', text: 'Today has your first session laid out. Begin with the warm-up, then the piece; the app waits for each note until you are ready to play along in time.'}),
      el('ul', {class: 'ob-tips'},
        el('li', {}, el('strong', {text: 'Listen'}), ' first, then ', el('strong', {text: 'Practise'}), ': small sections, slowly, hands separately when it is hard.'),
        el('li', {}, 'Press ', el('kbd', {text: '?'}), ' for help and shortcuts; Progress → Settings shows this introduction again.')),
    ]},
  ];

  function place(name, text) {
    return el('li', {}, el('span', {class: 'ob-place-name', text: name}), el('span', {class: 'ob-place-text', text}));
  }

  function render(focus = true) {
    const s = STEPS[step];
    count.textContent = `Introduction · ${step + 1} of ${STEPS.length}`;
    dots.replaceChildren(...STEPS.map((_, i) => el('li', {class: i === step ? 'is-on' : i < step ? 'is-past' : ''})));
    back.hidden = step === 0;
    skip.hidden = step === STEPS.length - 1;
    next.textContent = s.next;
    body.dataset.step = s.id;
    const page = el('section', {class: 'ob-page'}, ...s.render().filter(Boolean));
    body.replaceChildren(page);
    if (focus) {
      // A new page: give it to screen readers by focusing its heading (and keep the page turn quiet).
      page.querySelector('h2')?.focus({preventScroll: true});
    }
  }

  async function advance() {
    if (STEPS[step].id === 'level') {
      saveChoice();
    }
    if (step === STEPS.length - 1) return close('done');
    go(step + 1);
  }
  function saveChoice() {
    const {level, goal} = choice;
    import('../progress/store.js').then(s => s.saveSettings({pathStart: level, dailyGoalMin: goal})).catch(e => console.warn('Settings not saved:', e));
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length || i === step) return;
    step = i;
    render();
  }

  function openHelpAt(section) {
    import('../help/index.js').then(m => m.openHelp(section)).catch(() => {});
  }

  function close(how) {
    if (closed) return;
    closed = true;
    markSeen();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (how === 'done') {
      if (location.hash && location.hash !== '#/' && location.hash !== '#/today') location.hash = '#/';
      requestAnimationFrame(() => document.querySelector('#view .td a, #view .td button, #view')?.focus?.({preventScroll: true}));
    } else {
      // The page may have redrawn while the dialog was open: then the same button, newly drawn.
      let back = returnTo;
      if (back && !back.isConnected && back.matches?.('button, a')) back = [...document.querySelectorAll(back.tagName)].find(e => e.className === back.className && e.textContent === back.textContent);
      try { back?.focus?.({preventScroll: true}); } catch {}
    }
    settle(how);
  }

  // Escape = skip (the dialog's cancel). Keys typed inside never reach the shortcuts of the page
  // behind (src/help/index.js guards every open modal dialog).
  dialog.addEventListener('cancel', e => { e.preventDefault(); close('skip'); });
  dialog.addEventListener('close', () => close('skip'));

  document.body.append(dialog);
  render(false);
  dialog.showModal();
  dialog.querySelector('h2')?.focus({preventScroll: true});
  return done;
}
