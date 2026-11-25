// The MIDI bridge's pure parts (no DOM, no sockets; tested in tests/bridge.test.js).
// src/relay/bridge-core.js runs them; bridge.html and Today's "Piano & iPad" card draw them.
//
//   initialState(server)          → {server, midi, devices, notesSent, lastNote, pages, role, other}
//     server     true while the dev server's socket is up (false: no dev server, or reconnecting)
//     midi       'off' (not asked yet) | 'blocked' | 'unsupported' (no Web MIDI here) | 'none' (no keyboard) | 'on'
//     devices    names of the connected keyboards
//     role       'idle' | 'relaying' | 'standby' (another tab or computer is relaying: we stay quiet)
//     other      {source, devices} of the bridge we stand by for, or null
//     pages      [{id, label, ms, quality: 'good'|'fair'|'poor'}] app pages answering the latency probe
//   reduceBridge(state, event)    → next state; events {type: 'server'|'midi'|'note'|'pages'|'role'|'reset-count', …}
//   arbitrate({id, hasInputs, role, other, now, staleMs}) → role   (one relaying source at a time)
//   latencyQuality(ms), formatMs(ms), median(xs), pageList(map, now)
//   pianoStatus(state)            → {tone, text, action: 'connect'|'refresh'|null}   (the words on screen)
//   pagesSummary(pages)           → one line for compact places ("iPad Safari · 12 ms")
//   preferLocal({localNames, relayDevices}) → true when the relay should be ignored (it is the
//                                   same keyboard this page already reads with Web MIDI)
//   needsPianoHint({webMidi, relayState, dismissed, apple}) and NO_PIANO_HINT (iPad without Web MIDI)
//   isAppleTouch(navigator)       → iPad / iPhone (iPadOS reports itself as a Mac with touch)

export const HEARTBEAT_MS = 3000;
export const PAGE_TIMEOUT_MS = 8000;
/** A bridge whose heartbeat stopped this long ago no longer counts (same as the iPad's "stale"). */
export const OTHER_STALE_MS = HEARTBEAT_MS * 3 + 500;

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);

export const initialState = (server = false) => ({
  server: !!server, midi: 'off', devices: [], notesSent: 0, lastNote: null, pages: [], role: 'idle', other: null,
});

export function reduceBridge(state, event) {
  switch (event?.type) {
    case 'server': return {...state, server: !!event.up};
    case 'midi': {
      const devices = Array.isArray(event.devices) ? event.devices.slice() : [];
      const midi = event.midi || (devices.length ? 'on' : 'none');
      return {...state, midi, devices};
    }
    case 'note': return {...state, notesSent: state.notesSent + 1, lastNote: event.note};
    case 'reset-count': return {...state, notesSent: 0, lastNote: null};
    case 'pages': return {...state, pages: event.pages || []};
    case 'role': return {...state, role: event.role, other: event.role === 'standby' ? (event.other || null) : null};
    default: return state;
  }
}

/**
 * Who relays. Exactly one source should, or every iPad hears each note twice.
 * The first bridge to relay keeps it; another one (bridge.html opened next to the app, a second
 * tab) stands by and takes over when the first stops, closes or goes quiet. If two start at the
 * same moment, both see each other's heartbeat and the one with the lower id keeps relaying.
 *   other: {source, bridge, seenAt} — the last status heard from another bridge, or null
 */
export function arbitrate({id, hasInputs, role, other, now, staleMs = OTHER_STALE_MS}) {
  const otherLive = !!other && other.source && other.source !== id && other.bridge && now - other.seenAt < staleMs;
  if (!otherLive) return hasInputs ? 'relaying' : 'idle';
  if (hasInputs && role === 'relaying' && String(id) < String(other.source)) return 'relaying';
  return 'standby';
}

export const latencyQuality = ms => !Number.isFinite(ms) ? 'poor' : ms < 30 ? 'good' : ms < 80 ? 'fair' : 'poor';
export const formatMs = ms => Number.isFinite(ms) ? `${Math.max(0, Math.round(ms))} ms` : '—';
export const median = xs => { const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** pageId → {label, samples, seen}: drops pages not heard from for PAGE_TIMEOUT_MS (mutates), → list. */
export function pageList(pages, now, timeoutMs = PAGE_TIMEOUT_MS) {
  for (const [id, p] of pages) if (now - p.seen > timeoutMs) pages.delete(id);
  return [...pages].map(([id, p]) => {
    const ms = median(p.samples);
    return {id, label: p.label || 'Page', ms, quality: latencyQuality(ms), samples: p.samples.length};
  });
}

const keyboards = devices => devices.length > 1 ? `${devices.length} keyboards` : devices[0] || 'piano';
const notes = n => `${n} note${n === 1 ? '' : 's'}`;

export function pianoStatus(s) {
  if (!s.server) return {tone: 'warn', text: 'The relay needs the dev server · start the app with npm run dev:ipad', action: null};
  switch (s.midi) {
    case 'unsupported': return {tone: 'warn', text: 'Open the app in Chrome or Edge on this Mac to connect the piano', action: null};
    case 'blocked': return {tone: 'warn', text: 'MIDI access was blocked · allow it in the browser’s site settings', action: 'connect'};
    case 'none': return {tone: 'warn', text: 'No keyboard found · check the USB cable and that the piano is on', action: 'refresh'};
    case 'on':
      if (s.role === 'standby') {
        const who = s.other?.devices?.length ? ` ${keyboards(s.other.devices)}` : '';
        return {tone: 'busy', text: `Another tab is relaying${who} · this one stands by`, action: 'refresh'};
      }
      return {tone: 'on', text: `Relaying ${keyboards(s.devices)} · ${notes(s.notesSent)}`, action: 'refresh'};
    default: return {tone: '', text: 'Piano not connected', action: 'connect'};
  }
}

export function pagesSummary(pages) {
  if (!pages?.length) return 'No iPad connected yet';
  if (pages.length === 1) return `${pages[0].label} · ${formatMs(pages[0].ms)}`;
  const worst = Math.max(...pages.map(p => Number.isFinite(p.ms) ? p.ms : 0));
  return `${pages.length} pages · up to ${formatMs(worst)}`;
}

const norm = s => String(s || '').trim().toLowerCase();

/**
 * The Mac's player reads the piano itself (Web MIDI) and also hears the relay. When the relay is
 * carrying the same keyboard (bridge.html in another tab), every note would arrive twice:
 * prefer the local input and ignore the relay. A relay of a different keyboard (another
 * computer's) still plays. Unknown relay devices count as the same.
 */
export function preferLocal({localNames = [], relayDevices = []} = {}) {
  if (!localNames.length) return false;
  if (!relayDevices.length) return true;
  const local = new Set(localNames.map(norm));
  return relayDevices.some(d => local.has(norm(d)));
}

export const NO_PIANO_HINT = 'No piano? On the Mac run the relay, or open this app in a Web MIDI browser app (e.g. ‘Web MIDI Browser’) to connect the piano straight to the iPad.';
export const HINT_DISMISS_KEY = 'piano-practice.no-piano-hint';

/** iPad/iPhone Safari: no Web MIDI here and no Mac relay carrying a piano → one quiet line. */
export const needsPianoHint = ({webMidi, relayState, dismissed, apple = true}) => apple && !webMidi && !dismissed && relayState !== 'connected';

export function isAppleTouch(nav = globalThis.navigator) {
  const ua = nav?.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1);
}
