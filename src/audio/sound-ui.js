// Sound settings for the player: instrument, room, metronome sound and the
// microphone. Adds its own rows to the player's Settings sheet and ⋯ menu (so
// index.html needs no markup for them) and keeps its own localStorage key.
//
//   const sound = mountSoundSettings(root, piano, {onMicNote(n, velocity, time), onMicRelease(n, time)});
//   sound.settings → {instrument, room, metronome, micSensitivity}
import {createMic} from './mic.js';
import {METRONOME_SOUNDS} from './metronome.js';

export const SOUND_STORE = 'piano-practice:sound';
const DEFAULTS = {instrument: 'auto', room: .35, metronome: 'wood', micSensitivity: .5};

export function readSoundSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SOUND_STORE)) || {}; } catch {}
  return {
    instrument: ['auto', 'piano', 'harpsichord'].includes(s.instrument) ? s.instrument : DEFAULTS.instrument,
    room: Number.isFinite(+s.room) && s.room !== null ? Math.max(0, Math.min(1, +s.room)) : DEFAULTS.room,
    metronome: METRONOME_SOUNDS.includes(s.metronome) ? s.metronome : DEFAULTS.metronome,
    micSensitivity: Number.isFinite(+s.micSensitivity) && s.micSensitivity !== null ? Math.max(0, Math.min(1, +s.micSensitivity)) : DEFAULTS.micSensitivity,
  };
}
function saveSoundSettings(v) {
  try { localStorage.setItem(SOUND_STORE, JSON.stringify({...readSoundSettings(), ...v})); } catch {}
}

function html(s) {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content;
}
const seg = (name, label, options) => `
  <div class="set-row" data-sound>
    <span>${label}</span>
    <span class="fine-seg" role="radiogroup" aria-label="${label}">
      ${options.map(([v, text]) => `<label><input type="radio" name="${name}" value="${v}"><span>${text}</span></label>`).join('')}
    </span>
  </div>`;

export function mountSoundSettings(root, piano, {onMicNote, onMicRelease} = {}) {
  const q = s => root.querySelector(s);
  let settings = readSoundSettings();

  piano.setInstrument(settings.instrument);
  piano.setRoom(settings.room);
  piano.setMetronomeSound(settings.metronome);

  // ── Settings sheet: after "Click volume" (or at the end of the sound group) ──
  const anchor = q('#set-metro-vol')?.closest('.set-row');
  const group = anchor?.parentElement || q('#settings .set-group:last-of-type');
  if (group && !q('[data-sound]')) {
    const frag = html(`
      ${seg('sound-instrument', 'Instrument', [['auto', 'Auto'], ['piano', 'Piano'], ['harpsichord', 'Harpsichord']])}
      <p class="set-note" style="margin:0 0 6px;font-size:13px;line-height:1.4;color:var(--ink-soft)" data-sound id="sound-instrument-note">Auto plays Bach and other Baroque pieces on the harpsichord.</p>
      <label class="set-row range-row" data-sound><span>Room</span><input type="range" id="sound-room" min="0" max="100" aria-label="Room reverberation (dry to wet)"></label>
      ${seg('sound-metro', 'Metronome sound', [['wood', 'Wood'], ['click', 'Click'], ['beep', 'Beep']])}
      <label class="set-row range-row" data-sound><span>Microphone sensitivity</span><input type="range" id="sound-mic-sens" min="0" max="100" aria-label="Microphone sensitivity"></label>
      <p class="set-note" style="margin:0 0 6px;font-size:13px;line-height:1.4;color:var(--ink-soft)" data-sound>The microphone (⋯ → Listen with microphone) follows one note at a time: it works for melodies and single notes, not chords.</p>`);
    if (anchor) anchor.after(frag); else group.append(frag);
  }
  const setRadio = (name, v) => { const i = root.querySelector(`input[name="${name}"][value="${v}"]`); if (i) i.checked = true; };
  setRadio('sound-instrument', settings.instrument);
  setRadio('sound-metro', settings.metronome);
  if (q('#sound-room')) q('#sound-room').value = Math.round(settings.room * 100);
  if (q('#sound-mic-sens')) q('#sound-mic-sens').value = Math.round(settings.micSensitivity * 100);

  root.querySelectorAll('input[name="sound-instrument"]').forEach(i => i.onchange = () => {
    settings.instrument = i.value; piano.setInstrument(i.value); saveSoundSettings({instrument: i.value});
  });
  root.querySelectorAll('input[name="sound-metro"]').forEach(i => i.onchange = () => {
    settings.metronome = i.value; piano.setMetronomeSound(i.value); saveSoundSettings({metronome: i.value});
    piano.click(0, true); // let them hear it
  });
  q('#sound-room')?.addEventListener('input', e => {
    settings.room = +e.target.value / 100; piano.setRoom(settings.room); saveSoundSettings({room: settings.room});
  });
  q('#sound-mic-sens')?.addEventListener('input', e => {
    settings.micSensitivity = +e.target.value / 100; mic.setSensitivity(settings.micSensitivity); saveSoundSettings({micSensitivity: settings.micSensitivity});
  });

  // ── ⋯ menu: microphone toggle under "Connect piano". Off on every load; the
  // permission prompt appears only when it is switched on. ──
  const mic = createMic({
    sensitivity: settings.micSensitivity,
    isBusy: () => piano.recentlyStruck?.() ?? false,
    onNote: (n, v, t) => onMicNote ? onMicNote(n, v, t) : window.dispatchEvent(new CustomEvent('piano:note', {detail: {note: n, velocity: v, source: 'mic', time: t}})),
    onRelease: (n, t) => onMicRelease?.(n, t),
    onState: v => { const box = q('#sound-mic'); if (box) box.checked = v; root.classList.toggle('mic-on', v); },
  });
  const chip = q('#midi-chip');
  if (chip && !q('#sound-mic')) {
    chip.append(html(`<label class="menu-row pop-toggle" data-sound title="Hears one note at a time — melodies and single notes, not chords"><span>Listen with microphone <small>single notes</small></span><input type="checkbox" id="sound-mic"><i></i></label>
      <p class="set-note mic-msg" style="margin:0 0 6px;font-size:13px;color:var(--oxblood)" data-sound id="sound-mic-msg" hidden></p>`));
  }
  const box = q('#sound-mic'), msg = q('#sound-mic-msg');
  if (box) box.onchange = async () => {
    if (msg) msg.hidden = true;
    if (!box.checked) { mic.stop(); return; }
    try { await mic.start(); }
    catch (e) {
      box.checked = false;
      if (msg) { msg.textContent = e?.name === 'NotAllowedError' ? 'Microphone permission was declined.' : 'Microphone unavailable: ' + (e?.message || e); msg.hidden = false; }
    }
  };

  const api = {get settings() { return {...settings}; }, get instrument() { return piano.instrument; }, get loaded() { return piano.loaded; }, get micOn() { return mic.on; }, mic};
  window.pianoSound = api; // diagnostics (tests, the teacher): effective instrument, loaded layers, mic state
  return api;
}
