// Dev server only: relays MIDI from a computer with a keyboard attached to
// other devices on the same network (e.g. an iPad, whose Safari has no Web MIDI).
//
//   Mac:  open http://localhost:5173/bridge.html in Chrome and connect the piano
//   iPad: open http://<mac-ip>:5173/ in Safari
//
// Everything travels over Vite's dev WebSocket (src/midi-relay.js is the browser side):
//   midi-relay:message  bridge → server → every page    {bytes: [status, data1, data2], source}
//   midi-relay:status   bridge → server → every page    heartbeat every few seconds:
//                       {bridge, devices: [names], latency: {<pageId>: ms}, source, heartbeatMs, at}
//                       `source` is the sending bridge's id: a second bridge (bridge.html next to the
//                       app's own relay on Today) sees who is relaying and stands by (src/relay/).
//                       The server also sends {bridge: false, reason: 'bridge-closed'} when the
//                       bridge's socket closes, and answers a page's `hello` with the last status.
//   midi-relay:hello    page → server                   "tell me the current status" (on (re)connect)
//   midi-relay:ping     bridge → server → every page    {id, t}         round-trip latency probe
//   midi-relay:pong     page → server → the bridge      {id, t, page, label}
//   midi-relay:echo     page → server → the same page   {id, t}         page ↔ dev-server round trip
//                       (Settings → Diagnostics measures it; works with or without a bridge)

export const EVENT_MIDI = 'midi-relay:message';
export const EVENT_STATUS = 'midi-relay:status';
export const EVENT_HELLO = 'midi-relay:hello';
export const EVENT_PING = 'midi-relay:ping';
export const EVENT_PONG = 'midi-relay:pong';
export const EVENT_ECHO = 'midi-relay:echo';
export const HEARTBEAT_MS = 3000;

const str = (v, max) => String(v ?? '').slice(0, max);
const ID = /^[A-Za-z0-9_-]{1,32}$/;

export function sanitizeStatus(data, now = Date.now()) {
  const latency = {};
  if (data?.latency && typeof data.latency === 'object') {
    for (const [k, v] of Object.entries(data.latency).slice(0, 16)) if (ID.test(k) && Number.isFinite(v) && v >= 0 && v < 60000) latency[k] = Math.round(v * 10) / 10;
  }
  const source = ID.test(String(data?.source ?? '')) ? String(data.source) : undefined;
  return {
    bridge: !!data?.bridge,
    devices: Array.isArray(data?.devices) ? data.devices.map(d => str(d, 80)).slice(0, 16) : [],
    latency,
    ...(source ? {source} : {}),
    heartbeatMs: HEARTBEAT_MS,
    at: now,
  };
}

export function midiRelay() {
  return {
    name: 'midi-relay',
    apply: 'serve',
    configureServer(server) {
      // Survives nothing: a restarted dev server starts empty and the bridge re-announces itself.
      let lastStatus = {bridge: false, devices: [], latency: {}, heartbeatMs: HEARTBEAT_MS, at: 0};
      let bridgeSocket = null;

      // The bridge page shows which address to open on the iPad.
      server.middlewares.use('/__midi-relay/info', async (req, res) => {
        const {networkInterfaces} = await import('node:os');
        const port = server.config.server.port ?? 5173;
        const addresses = Object.values(networkInterfaces()).flat()
          .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${port}/`);
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({addresses, exposed: !!server.config.server.host}));
      });

      server.ws.on(EVENT_MIDI, data => {
        if (!Array.isArray(data?.bytes) || data.bytes.length > 3 || !data.bytes.every(b => Number.isInteger(b) && b >= 0 && b < 256)) return;
        server.ws.send(EVENT_MIDI, {bytes: data.bytes, source: str(data.source, 32)});
      });

      server.ws.on(EVENT_STATUS, (data, client) => {
        lastStatus = sanitizeStatus(data);
        // Remember which socket is the bridge, so its tab closing (or the Mac sleeping) is
        // announced at once instead of waiting for the heartbeat to go stale.
        const socket = client?.socket;
        if (socket && socket !== bridgeSocket) {
          bridgeSocket = socket;
          socket.once?.('close', () => {
            if (bridgeSocket !== socket) return;
            bridgeSocket = null;
            lastStatus = {...lastStatus, bridge: false, devices: [], latency: {}, at: Date.now(), reason: 'bridge-closed'};
            server.ws.send(EVENT_STATUS, lastStatus);
          });
        }
        server.ws.send(EVENT_STATUS, lastStatus);
      });

      // A page (re)connected: tell just that page where things stand.
      server.ws.on(EVENT_HELLO, (data, client) => {
        if (lastStatus.at) client?.send(EVENT_STATUS, lastStatus);
      });

      server.ws.on(EVENT_PING, data => {
        if (!ID.test(String(data?.id ?? '')) || !Number.isFinite(data?.t)) return;
        server.ws.send(EVENT_PING, {id: data.id, t: data.t});
      });
      server.ws.on(EVENT_ECHO, (data, client) => {
        if (!ID.test(String(data?.id ?? '')) || !Number.isFinite(data?.t)) return;
        client?.send(EVENT_ECHO, {id: data.id, t: data.t});
      });
      server.ws.on(EVENT_PONG, data => {
        if (!bridgeSocket || !ID.test(String(data?.id ?? '')) || !ID.test(String(data?.page ?? '')) || !Number.isFinite(data?.t)) return;
        if (bridgeSocket.readyState !== 1) return;
        bridgeSocket.send(JSON.stringify({type: 'custom', event: EVENT_PONG, data: {id: data.id, t: data.t, page: data.page, label: str(data.label, 60)}}));
      });
    },
  };
}
