// Receiving side of the MIDI relay (see midi-relay/plugin.js).
// Works only on the dev server; in a production build these are no-ops.
//
//   onRelayMidi(bytes => ...)      raw MIDI messages forwarded from the bridge
//   onRelayStatus(status => ...)   {bridge: bool, devices: [names]} when the bridge changes

const EVENT_MIDI = 'midi-relay:message';
const EVENT_STATUS = 'midi-relay:status';

export function onRelayMidi(handler) {
  if (!import.meta.hot) return () => {};
  const listener = data => { if (data?.source !== bridgeId) handler(Uint8Array.from(data.bytes)); };
  import.meta.hot.on(EVENT_MIDI, listener);
  return () => import.meta.hot.off?.(EVENT_MIDI, listener);
}

export function onRelayStatus(handler) {
  if (!import.meta.hot) return () => {};
  import.meta.hot.on(EVENT_STATUS, handler);
  return () => import.meta.hot.off?.(EVENT_STATUS, handler);
}

// Sending side, used by the bridge page.
const bridgeId = Math.random().toString(36).slice(2);
export function sendRelayMidi(bytes) {
  import.meta.hot?.send(EVENT_MIDI, {bytes: [...bytes], source: bridgeId});
}
export function sendRelayStatus(status) {
  import.meta.hot?.send(EVENT_STATUS, status);
}
export const relayAvailable = !!import.meta.hot;
