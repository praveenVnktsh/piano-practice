// The MIDI bridge, reusable: reads the piano with Web MIDI and forwards every note through the
// dev server to the other devices (midi-relay/plugin.js, src/midi-relay.js). bridge.html runs one
// (src/bridge.js), and so does the app itself on the Mac (src/relay/app-relay.js → Today's
// "Piano & iPad" card), so the student needn't keep a second tab open.
//
//   const bridge = createBridge({announceIdle})
//   bridge.start()          heartbeat every 3 s, latency table, pagehide → bridge: false
//   bridge.autoConnect()    connects without a click when MIDI permission was granted before
//   bridge.connect({quiet}) asks for Web MIDI (the button); later calls refresh the inputs
//   bridge.subscribe(fn)    fn(state) now and on every change → unsubscribe   (state: bridge-state.js)
//   bridge.getState(), bridge.stop()
//
// One relaying source: before relaying, a bridge listens for other bridges' heartbeats and stands
// by while one is relaying (arbitrate() in bridge-state.js); it takes over when that one stops.
//   announceIdle  'always'    heartbeat even without a keyboard (bridge.html: the iPad then says
//                             "no keyboard connected on the Mac" instead of "waiting")
//                 'connected' only once MIDI access was granted (the app: an app tab that never
//                             touched MIDI stays silent)
//
// Inputs are listened to with addEventListener, never `onmidimessage`, so the player in the same
// tab keeps its own handler on the same keyboard. Tests inject `relay`, `nav`, `win`, `clock`.
import * as realRelay from '../midi-relay.js';
import {HEARTBEAT_MS, arbitrate, initialState, pageList, reduceBridge} from './bridge-state.js';

export const MIDI_GRANTED_EVENT = 'piano:midi-granted';

const defaultRelay = () => ({
  available: realRelay.relayAvailable,
  id: realRelay.pageId,
  sendMidi: realRelay.sendRelayMidi,
  sendStatus: realRelay.sendRelayStatus,
  onServerStatus: realRelay.onRelayServerStatus,
  onServerConnection: realRelay.onServerConnection,
  startLatencyProbe: realRelay.startLatencyProbe,
});

const defaultClock = () => ({
  now: () => globalThis.performance.now(),
  every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
});

export function createBridge({relay = defaultRelay(), nav = globalThis.navigator, win = globalThis.window,
  clock = defaultClock(), announceIdle = 'connected'} = {}) {
  let state = initialState(relay.available);
  let access = null, inputs = [], other = null, announced = false, probing = false, started = false;
  const listeners = new Set();
  const pages = new Map();
  const undo = [];
  const unwire = [];

  const emit = () => { for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } };
  const dispatch = event => { const next = reduceBridge(state, event); if (next !== state) { state = next; emit(); } };
  const names = () => inputs.map(i => i.name || 'MIDI input');

  function updateRole() {
    const role = arbitrate({id: relay.id, hasInputs: inputs.length > 0, role: state.role, other, now: clock.now()});
    if (role !== state.role || (role === 'standby' && state.other?.source !== other?.source)) {
      dispatch({type: 'role', role, other: role === 'standby' && other ? {source: other.source, devices: other.devices} : null});
    }
  }

  function heartbeat() {
    if (!relay.available) return;
    updateRole();
    const relaying = state.role === 'relaying';
    const idle = state.role === 'idle' && (announceIdle === 'always' || (announceIdle === 'connected' && access));
    if (!relaying && !idle) {
      // Standing by (or never connected): say nothing, so the relaying bridge's status stands.
      announced = false;
      return;
    }
    const latency = {};
    for (const p of pageList(pages, clock.now())) if (Number.isFinite(p.ms)) latency[p.id] = p.ms;
    relay.sendStatus({bridge: relaying, devices: relaying ? names() : [], latency});
    announced = true;
    if (!probing) startProbe();
  }

  function startProbe() {
    probing = true;
    undo.push(relay.startLatencyProbe(({page, label, rttMs}) => {
      const p = pages.get(page) || {label, samples: [], seen: 0};
      p.label = label; p.seen = clock.now();
      p.samples.push(rttMs);
      if (p.samples.length > 10) p.samples.shift();
      pages.set(page, p);
      renderPages();
    }));
  }

  function renderPages() {
    const list = pageList(pages, clock.now());
    const same = list.length === state.pages.length && list.every((p, i) => p.id === state.pages[i].id && p.ms === state.pages[i].ms && p.label === state.pages[i].label);
    if (!same) dispatch({type: 'pages', pages: list});
  }

  function onMessage(e) {
    const data = e?.data;
    if (!data || data.length < 1) return;
    const [status, n, v] = data;
    const cmd = status & 0xf0;
    if (cmd !== 0x90 && cmd !== 0x80 && cmd !== 0xb0) return; // notes and pedal/controllers only
    if (state.role !== 'relaying') return;
    relay.sendMidi(Array.from(data).slice(0, 3));
    if (cmd === 0x90 && v > 0) dispatch({type: 'note', note: n});
  }

  function wire() {
    while (unwire.length) unwire.pop()();
    inputs = access ? [...access.inputs.values()].filter(i => i.state === 'connected') : [];
    for (const input of inputs) {
      if (typeof input.addEventListener !== 'function') continue;
      input.addEventListener('midimessage', onMessage);
      unwire.push(() => input.removeEventListener('midimessage', onMessage));
    }
    dispatch({type: 'midi', midi: inputs.length ? 'on' : 'none', devices: names()});
    heartbeat();
  }

  async function connect({quiet = false} = {}) {
    if (!nav?.requestMIDIAccess) { dispatch({type: 'midi', midi: 'unsupported'}); return state; }
    if (access) { wire(); return state; } // Refresh
    try {
      access = await nav.requestMIDIAccess({sysex: false});
      access.addEventListener?.('statechange', wire);
      if (!access.addEventListener) access.onstatechange = wire;
      wire();
      // Same origin, same permission: the player in this tab may connect too.
      try { win?.dispatchEvent?.(new CustomEvent(MIDI_GRANTED_EVENT)); } catch {}
    } catch {
      if (!quiet) dispatch({type: 'midi', midi: 'blocked'});
    }
    return state;
  }

  function autoConnect() {
    const q = nav?.permissions?.query?.({name: 'midi'});
    if (!q?.then) return Promise.resolve(false);
    return q.then(p => { if (p.state === 'granted') { connect({quiet: true}); return true; } return false; }, () => false);
  }

  function onServerStatus(data) {
    if (!data?.source || data.source === relay.id) return;
    if (data.bridge && data.reason !== 'bridge-closed') other = {source: data.source, bridge: true, devices: data.devices || [], seenAt: clock.now()};
    else if (!other || other.source === data.source) other = null;
    const was = state.role;
    updateRole();
    // Took over from a bridge that stopped: announce at once rather than on the next beat.
    if (was !== 'relaying' && state.role === 'relaying') heartbeat();
  }

  const onPageHide = () => { if (announced) relay.sendStatus({bridge: false, devices: []}); };

  function start() {
    if (started) return api;
    started = true;
    if (relay.available) {
      undo.push(relay.onServerStatus(onServerStatus));
      undo.push(relay.onServerConnection(s => { dispatch({type: 'server', up: s === 'connect'}); if (s === 'connect') heartbeat(); }));
      undo.push(clock.every(heartbeat, HEARTBEAT_MS));
      undo.push(clock.every(renderPages, 2000));
      win?.addEventListener?.('pagehide', onPageHide);
      undo.push(() => win?.removeEventListener?.('pagehide', onPageHide));
      heartbeat();
    }
    return api;
  }

  function stop() {
    onPageHide();
    while (unwire.length) unwire.pop()();
    while (undo.length) { try { undo.pop()?.(); } catch {} }
    started = false; probing = false; announced = false;
  }

  const api = {
    start, stop, connect, autoConnect,
    refresh: () => connect(),
    getState: () => state,
    subscribe(fn) { listeners.add(fn); try { fn(state); } catch (e) { console.error(e); } return () => listeners.delete(fn); },
  };
  return api;
}
