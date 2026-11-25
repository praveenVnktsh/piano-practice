// The help overlay itself (loaded on first use by src/help/index.js): a programme booklet.
import {el, icon} from '../app/dom.js';
import './help.css';

const keysOf = sep => (...keys) => el('span', {class: 'hp-keys'}, ...keys.flatMap((key, i) => [i ? el('span', {class: 'hp-or', text: sep}) : null, el('kbd', {text: key})]));
const k = keysOf(' or ');   // either key
const kk = keysOf(' / ');   // one key each, in the order of the words ("previous / next")
const row = (what, keys) => el('li', {class: 'hp-row'}, el('span', {class: 'hp-what', text: what}), el('span', {class: 'hp-dots', 'aria-hidden': 'true'}), keys);
const p = (...c) => el('p', {}, ...c);
const b = t => el('strong', {text: t});
const term = (name, ...text) => [el('dt', {text: name}), el('dd', {}, ...text)];

// Shortcuts, collected from the code: src/player.js (keyboard shortcuts), src/trainer/view.js,
// src/rhythm/view.js, src/theory/view.js, src/ear/view.js, src/app/pieces.js, src/teacher/panel.js.
const SHORTCUTS = [
  ['Anywhere', [
    ['Help (this booklet)', k('?')],
    ['Next / previous control', kk('Tab', 'Shift+Tab')],
    ['Close a menu, card or dialog', k('Esc')],
  ]],
  ['In the player', [
    ['Play / pause', k('Space')],
    ['Practise from here', k('P')],
    ['Loop the section on / off', k('L')],
    ['Hands: both → right → left', k('H')],
    ['Metronome on / off', k('K')],
    ['Sound on / off', k('M')],
    ['Note names on / off', k('N')],
    ['Record a take', k('R')],
    ['Previous / next note', kk('←', '→')],
    ['Previous / next bar', kk('Shift+←', 'Shift+→')],
    ['Zoom in / out', kk('+', '−')],
    ['Turn the page (Pages view, Bluetooth pedals)', k('→', 'Page Down')],
    ['Page back (Pages view)', k('←', 'Page Up')],
    ['Bar boxes: one bar later / earlier', kk('↑', '↓')],
  ]],
  ['In the exercises', [
    ['Note reading: show the note name', k('H')],
    ['Note reading: any octave counts', k('O')],
    ['Note reading, rhythm: next round', k('Enter')],
    ['Rhythm: tap the beat', k('Space')],
    ['Theory and ear: choose an answer', k('1', '2', '3', '4')],
  ]],
  ['Pieces and the teacher', [
    ['Pieces: from the search to the list', k('↓')],
    ['Pieces: clear the search', k('Esc')],
    ['Teacher: send / new line', kk('Enter', 'Shift+Enter')],
  ]],
];

const SECTIONS = [
  {id: 'places', title: 'The four places', body: () => [
    p('There are only four places in the app. Everything else, the player, the teacher and the settings, opens from them and leads back.'),
    el('dl', {class: 'hp-terms'},
      ...term('Today', 'Your home. Each day it lays out a warm-up (the next technique step on your path), the piece you are learning and a short reading drill, with your daily goal, streak and any homework from your teacher. Most days you need nothing else.'),
      ...term('Pieces', 'The repertoire, grouped like a concert programme: bundled public-domain pieces with a grade, your own songs, imported scores (MusicXML, MXL, MEI) and an experimental browser for the Mutopia archive. Each piece shows how far along it is: learning, secure, polished.'),
      ...term('Exercises', 'Technique (scales, arpeggios, five-finger positions, chromatic scales and cadences in every key, with fingering), note reading, sight-reading, rhythm, theory and ear training.'),
      ...term('Progress', 'Your practice diary: minutes, streaks, the bars you have mastered, your path through the grades, goals with dates, the journal, recordings, letters from your teacher and the settings.'),
      ...term('Teacher', 'A companion, not a place. The quiet Teacher button opens letters in the margin: ask about a bar, ask for feedback on your last attempt, and follow the buttons in the reply. It needs the dev server on your Mac.')),
  ]},
  {id: 'practising', title: 'How practising works', body: () => [
    el('dl', {class: 'hp-terms'},
      ...term('Listen or Practise', 'The one choice at the top of the player. ', b('Listen'), ' plays the section on the sampled piano with the score following. ', b('Practise'), ' hands the music to you: play it on your piano or the keys on screen.'),
      ...term('Wait or Play along', 'In ', b('Wait'), ' the music waits for the right notes, as slowly as you need: learn the notes first. In ', b('Play along'), ' it keeps time at the tempo you set and marks each note early, late or on time, with a count-in.'),
      ...term('Hands', 'L · Both · R in the section strip (or H): practise each hand alone, then put them together. While you practise one hand, the app plays the other.'),
      ...term('Bars and loops', 'Type the first and last bar, or tap Bars for presets: this phrase, the next phrase, “Practise my weak bars” (the bars where you make most mistakes), and chaining from the start or the end (one bar, then one more after each clean pass). Loop (L) repeats the section until it is clean.'),
      ...term('Tempo', 'Tap ♩ = 72 to change the speed, turn on the metronome, or let it speed up by 5 % after each clean pass up to the piece’s tempo.'),
      ...term('Strategies', '⋯ → Strategy: the slow-practice ladder, dotted and reversed rhythms, blocked chords, and the memory check (the score hides while you play). One at a time.'),
      ...term('Results', 'After each pass a small card shows your accuracy, what went wrong and where, and with a real piano your evenness, dynamics and legato. “Again” goes straight back.'),
      ...term('Recordings', 'Rec (R) records a take from your piano. Play it back with the score following, compare it with the score bar by bar, print a report, export MIDI, or send it to your teacher. Several pieces in order make a mock exam.')),
    el('p', {}, el('em', {text: 'A good rhythm for a session: '}), 'listen once, practise a few bars hands separately in Wait, then together, then Play along slowly, and only then speed up.'),
  ]},
  {id: 'shortcuts', title: 'Keyboard shortcuts', body: () => SHORTCUTS.map(([h, rows]) => el('section', {class: 'hp-keyset'},
    el('h4', {text: h}), el('ul', {class: 'hp-rows', role: 'list'}, rows.map(([w, keys]) => row(w, keys)))))},
  {id: 'ipad', title: 'The iPad on the music stand', body: () => [
    p('The piano’s USB cable goes to the Mac; the iPad shows the app. iPad Safari has no Web MIDI, so the Mac relays your keyboard over Wi-Fi.'),
    el('ol', {class: 'hp-steps'},
      el('li', {}, 'On the Mac, in the project folder: ', el('code', {text: 'npm run dev:ipad'}), '.'),
      el('li', {}, 'On the Mac, in Chrome: open ', el('code', {text: 'localhost:5173/bridge.html'}), ', press ', b('Connect piano'), ' and allow MIDI. Keep that tab open; it shows the address for the iPad.'),
      el('li', {}, 'On the iPad, in Safari: open that address, for example ', el('code', {text: 'http://192.168.1.20:5173/'}), '.'),
      el('li', {}, 'To keep it on the home screen: Share → Add to Home Screen. It opens full screen, like an app.')),
    p('The bridge reconnects by itself when the Wi-Fi drops or the Mac restarts the server; the player’s ⋯ menu shows the relay’s state and its delay. The screen stays awake while you practise.'),
  ]},
  {id: 'data', title: 'Where your data lives', body: () => [
    el('dl', {class: 'hp-terms'},
      ...term('With the dev server on your Mac', 'Progress and journal in ', el('code', {text: '.data/progress.json'}), ', recordings in ', el('code', {text: '.data/recordings/'}), ', the teacher’s letters in ', el('code', {text: '.teacher/'}), ' and imported scores in ', el('code', {text: 'public/songs/local/'}), '. Every device using the server (the iPad too) shares them.'),
      ...term('In a built copy', 'Without the dev server everything stays in this browser (local storage and IndexedDB). Clearing the site’s data clears it.'),
      ...term('Settings', 'Per-piece sections and tempi, the view, the theme and the sound are kept in this browser.')),
    p(b('Backup. '), 'Progress → Settings → ', el('em', {text: 'Export my data'}), ' downloads one file with your progress, journal, letters, imports, recordings and settings. ', el('em', {text: 'Import backup'}), ' shows what a file holds and asks before replacing anything.'),
    p('No account, no tracking: nothing leaves your Mac and iPad.'),
  ]},
];

/** Shows the overlay → {goTo(section), close()}. */
export function showHelp({section, returnTo, onClose}) {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const dialog = el('dialog', {class: 'hp', 'aria-labelledby': 'hp-title'});
  const scroller = el('div', {class: 'hp-scroll'});
  const closeBtn = el('button', {type: 'button', class: 'hp-close', 'aria-label': 'Close help', onclick: () => close()}, icon('close'));
  const contents = el('nav', {class: 'hp-contents', 'aria-label': 'Contents'},
    el('ol', {}, SECTIONS.map((s, i) => el('li', {},
      el('a', {href: '#hp-' + s.id, onclick: e => { e.preventDefault(); goTo(s.id, true); }},
        el('span', {class: 'hp-num', text: roman[i] + '.'}), el('span', {text: s.title}))))));
  scroller.append(
    el('header', {class: 'hp-head'},
      el('p', {class: 'hp-eyebrow', text: 'Programme notes'}),
      el('h2', {id: 'hp-title', class: 'hp-title', tabindex: '-1', text: 'Help'}),
      el('p', {class: 'hp-lead', text: 'How the practice room works, in five short movements.'})),
    contents,
    ...SECTIONS.map((s, i) => el('section', {class: 'hp-sec', id: 'hp-' + s.id, 'aria-labelledby': `hp-${s.id}-h`},
      el('h3', {id: `hp-${s.id}-h`, tabindex: '-1'}, el('span', {class: 'hp-num', text: roman[i] + '.'}), ' ', s.title),
      ...[].concat(s.body()))),
    el('p', {class: 'hp-fin', text: 'Fine'}));
  dialog.append(el('div', {class: 'hp-card'}, closeBtn, scroller));

  function goTo(id, focus = false) {
    const h = id && dialog.querySelector(`#hp-${id}-h`);
    if (!h) return;
    h.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    if (focus) h.focus({preventScroll: true});
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    onClose?.();
    try { (returnTo?.isConnected ? returnTo : null)?.focus?.({preventScroll: true}); } catch {}
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('close', () => close());
  // A click on the backdrop (outside the card) closes it.
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });

  document.body.append(dialog);
  dialog.showModal();
  if (section) { goTo(section); dialog.querySelector(`#hp-${section}-h`)?.focus({preventScroll: true}); }
  else dialog.querySelector('#hp-title').focus({preventScroll: true});
  return {goTo: id => goTo(id, true), close};
}
