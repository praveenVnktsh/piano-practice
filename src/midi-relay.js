// Browser side of the MIDI relay (see midi-relay/plugin.js for the wire protocol).
// Works only on the dev server; in a production build everything here is a no-op.
//
// Receiving pages (the iPad):
//   onRelayMidi(bytes => ...)       raw MIDI messages forwarded from the bridge
//   onRelayStatus(status => ...)    whenever the relay's state changes (and once on subscribe if known):
//     {bridge: bool, devices: [names], state, label, latencyMs, at}
//       state  'connected'     the bridge is relaying at least one keyboard (bridge: true)
//              'no-piano'      the bridge page is open but sees no keyboard
//              'waiting'       connected to the Mac, no bridge page open
//              'stale'         the bridge's heartbeat stopped (Mac asleep, tab closed, Wi-Fi blip)
//              'reconnecting'  this page lost the dev server; Vite reloads it once the server is back
//       label  ready-made text, e.g. "Mac relay: reconnecting…", "Mac relay: connected · FP-30 · 9 ms"
//   Handlers run when state / bridge / devices change; a window `relay:status` CustomEvent carries
//   the same object on those changes and on label-only updates (e.g. a new latency figure).
//   relayState() → the current status object.
//
// The bridge page (src/bridge.js): sendRelayMidi(bytes), sendRelayStatus(status), and
// startLatencyProbe(onSample) which pings every page and reports round trips.

const EVENT_MIDI = 'midi-relay:message';
const EVENT_STATUS = 'midi-relay:status';
const EVENT_HELLO = 'midi-relay:hello';
const EVENT_PING = 'midi-relay:ping';
const EVENT_PONG = 'midi-relay:pong';
const STALE_AFTER = 3; // missed heartbeats before the bridge counts as gone

const hot = import.meta.hot;
export const relayAvailable = !!hot;
const randomId = () => Math.random().toString(36).slice(2, 12);
export const pageId = randomId();
const bridgeId = pageId; // the bridge ignores its own messages coming back
let isBridge = false;

// ───────── status (receiving side) ─────────

let server = {bridge: false, devices: [], latency: {}, heartbeatMs: 3000, at: 0};
let lastSeen = 0;        // performance.now() of the last status from the server
let connected = true;    // the dev-server socket
let current = null;
const handlers = new Set();
let staleTimer = null;

function deviceName(devices) {
  return devices.length > 1 ? `${devices.length} keyboards` : devices[0] || 'piano';
}

export function describe({server: s, connected: up, fresh}) {
  const latencyMs = Number.isFinite(s.latency?.[pageId]) ? s.latency[pageId] : null;
  const ms = latencyMs == null ? '' : ` · ${Math.round(latencyMs)} ms`;
  let state, label;
  if (!up) { state = 'reconnecting'; label = 'Mac relay: reconnecting…'; }
  else if (!s.at) { state = 'waiting'; label = 'Mac relay: open bridge.html on the Mac'; }
  else if (s.reason === 'bridge-closed') { state = 'waiting'; label = 'Mac relay: the bridge page was closed'; }
  else if (!fresh) { state = 'stale'; label = 'Mac relay: no signal from the Mac'; }
  else if (s.bridge && s.devices.length) { state = 'connected'; label = `Mac relay: connected · ${deviceName(s.devices)}${ms}`; }
  else { state = 'no-piano'; label = 'Mac relay: no keyboard connected on the Mac'; }
  return {bridge: state === 'connected', devices: state === 'connected' ? s.devices : [], state, label, latencyMs, at: s.at};
}

function recompute() {
  const beat = server.heartbeatMs || 3000;
  const fresh = !!server.at && (server.reason === 'bridge-closed' || performance.now() - lastSeen < beat * STALE_AFTER + 500);
  const next = describe({server, connected, fresh});
  // Handlers (the player clears held relay keys on each call) hear only real changes;
  // the window event also carries label-only updates such as a new latency figure.
  const significant = !current || current.state !== next.state || current.bridge !== next.bridge || current.devices.join('\n') !== next.devices.join('\n');
  const relabelled = !current || current.label !== next.label;
  current = next;
  if (significant) for (const fn of handlers) { try { fn(current); } catch (e) { console.error(e); } }
  if (significant || relabelled) window.dispatchEvent(new CustomEvent('relay:status', {detail: current}));
}

function watchdog() {
  clearTimeout(staleTimer);
  if (!server.at || server.reason === 'bridge-closed') return;
  staleTimer = setTimeout(() => { recompute(); }, (server.heartbeatMs || 3000) * STALE_AFTER + 600);
}

if (hot) {
  hot.on(EVENT_STATUS, data => {
    server = {bridge: !!data?.bridge, devices: Array.isArray(data?.devices) ? data.devices : [], latency: data?.latency || {}, heartbeatMs: data?.heartbeatMs || 3000, at: data?.at || Date.now(), reason: data?.reason};
    lastSeen = performance.now();
    connected = true;
    recompute();
    watchdog();
  });
  hot.on('vite:ws:disconnect', () => { connected = false; recompute(); });
  hot.on('vite:ws:connect', () => { connected = true; hot.send(EVENT_HELLO, {page: pageId}); recompute(); });
  // Latency probe from the bridge: answer at once (the bridge measures the round trip).
  hot.on(EVENT_PING, data => {
    if (isBridge || !data?.id) return;
    hot.send(EVENT_PONG, {id: data.id, t: data.t, page: pageId, label: pageLabel()});
  });
  hot.send(EVENT_HELLO, {page: pageId});
}

function pageLabel() {
  const ua = navigator.userAgent;
  const device = /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone ? ' (home screen)' : '';
  return `${device} ${browser}${standalone}`.trim();
}

export function onRelayMidi(handler) {
  if (!hot) return () => {};
  const listener = data => { if (data?.source !== bridgeId) handler(Uint8Array.from(data.bytes)); };
  hot.on(EVENT_MIDI, listener);
  return () => hot.off?.(EVENT_MIDI, listener);
}

export function onRelayStatus(handler) {
  if (!hot) return () => {};
  handlers.add(handler);
  if (current && server.at) queueMicrotask(() => handlers.has(handler) && handler(current));
  return () => handlers.delete(handler);
}

export const relayState = () => current || describe({server, connected, fresh: false});

// ───────── sending side (the bridge page) ─────────

export function markBridge() { isBridge = true; }

export function sendRelayMidi(bytes) {
  hot?.send(EVENT_MIDI, {bytes: [...bytes], source: bridgeId});
}
export function sendRelayStatus(status) {
  hot?.send(EVENT_STATUS, status);
}
/** Bridge connection events: fn('connect' | 'disconnect'). */
export function onServerConnection(fn) {
  if (!hot) return () => {};
  const up = () => fn('connect'), down = () => fn('disconnect');
  hot.on('vite:ws:connect', up);
  hot.on('vite:ws:disconnect', down);
  return () => { hot.off?.('vite:ws:connect', up); hot.off?.('vite:ws:disconnect', down); };
}

/** Pings every page every `everyMs`; onSample({page, label, rttMs}) for each answer. */
export function startLatencyProbe(onSample, {everyMs = 2000} = {}) {
  if (!hot) return () => {};
  markBridge();
  const sent = new Map();
  const onPong = data => {
    if (!sent.has(data?.id) || !data.page) return;
    onSample({page: data.page, label: data.label || 'Page', rttMs: performance.now() - data.t});
  };
  hot.on(EVENT_PONG, onPong);
  const timer = setInterval(() => {
    const id = randomId();
    sent.set(id, true);
    if (sent.size > 20) sent.delete(sent.keys().next().value);
    hot.send(EVENT_PING, {id, t: performance.now()});
  }, everyMs);
  return () => { clearInterval(timer); hot.off?.(EVENT_PONG, onPong); };
}
