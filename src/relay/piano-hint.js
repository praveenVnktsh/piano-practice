// One quiet line on an iPad / iPhone that can't hear the piano: no Web MIDI in Safari and no Mac
// relay carrying a keyboard. Shown where the piano status lives (the player's ⋯ menu, Settings →
// This device); "Got it" hides it for good on this device.
//
//   mountPianoHint(container) → {el, destroy()}
import {relayState} from '../midi-relay.js';
import {HINT_DISMISS_KEY, NO_PIANO_HINT, isAppleTouch, needsPianoHint} from './bridge-state.js';

const dismissed = () => { try { return localStorage.getItem(HINT_DISMISS_KEY) === '1'; } catch { return false; } };
const webMidi = () => !!globalThis.isSecureContext && typeof navigator.requestMIDIAccess === 'function';
const DISMISSED_EVENT = 'piano-hint:dismissed';

export function mountPianoHint(container) {
  const el = document.createElement('p');
  el.className = 'piano-hint';
  el.hidden = true;
  el.innerHTML = '<span class="piano-hint-text"></span> <button type="button" class="link-btn piano-hint-ok">Got it</button>';
  el.querySelector('.piano-hint-text').textContent = NO_PIANO_HINT;
  el.querySelector('.piano-hint-ok').onclick = () => {
    try { localStorage.setItem(HINT_DISMISS_KEY, '1'); } catch {}
    window.dispatchEvent(new CustomEvent(DISMISSED_EVENT));
  };
  container.append(el);
  function update() {
    el.hidden = !needsPianoHint({webMidi: webMidi(), relayState: relayState().state, dismissed: dismissed(), apple: isAppleTouch()});
  }
  window.addEventListener('relay:status', update);
  window.addEventListener(DISMISSED_EVENT, update);
  update();
  return {el, destroy() { window.removeEventListener('relay:status', update); window.removeEventListener(DISMISSED_EVENT, update); el.remove(); }};
}
