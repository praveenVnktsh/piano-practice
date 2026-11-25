// Applies a teacher action when the student taps its button (never automatically).
// Validated again here with the same rules as the CLI (teacher/actions.js).
import {actionError} from '../../teacher/actions.js';

const playHref = id => '#/play/' + encodeURIComponent(id);
const go = href => {
  if (location.hash !== href) location.hash = href;
};

function player() {
  const p = window.pianoPlayer;
  if (!p || typeof p.getState !== 'function') throw new Error('The player isn’t ready — open a song first.');
  const state = p.getState();
  if (!state?.songId) throw new Error('Open a song first.');
  if (!location.hash.startsWith('#/play/')) go(playHref(state.songId));
  return p;
}

/** Runs one action → a short description of what changed. Throws an Error the panel shows. */
export async function runAction(action, {knownSong = () => true} = {}) {
  const err = actionError(action);
  if (err) throw new Error(`This suggestion can’t be applied (${err}).`);
  switch (action.type) {
    case 'open_song':
      if (!knownSong(action.id)) throw new Error(`“${action.id}” isn’t in your library.`);
      go(playHref(action.id));
      return 'Opened the song';
    case 'open_exercise':
      go(playHref(action.id));
      return 'Opened the exercise';
    case 'open_note_reading':
      go('#/train/reading');
      return 'Opened note reading';
    case 'set_section': {
      const p = player();
      const n = p.getState().measureCount;
      if (Number.isInteger(n) && action.last >= n)
        throw new Error(`This piece has ${n} bars — that section doesn’t fit.`);
      p.setSection(action.first, action.last);
      return 'Section set';
    }
    case 'set_tempo':
      player().setTempo(action.bpm);
      return 'Tempo set';
    case 'set_hands':
      player().setHands(action.hands);
      return 'Hands set';
    case 'set_mode':
      player().setMode(action.mode);
      return 'Mode set';
    case 'set_loop':
      player().setLoop(action.on);
      return action.on ? 'Loop on' : 'Loop off';
    default:
      throw new Error(`Unknown action ${action.type}`);
  }
}
