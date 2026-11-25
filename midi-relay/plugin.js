// Dev server only: relays MIDI from a computer with a keyboard attached to
// other devices on the same network (e.g. an iPad, whose Safari has no Web MIDI).
//
//   Mac:  open http://localhost:5173/bridge.html in Chrome and connect the piano
//   iPad: open http://<mac-ip>:5173/ in Safari
//
// The bridge page sends raw MIDI bytes over Vite's dev WebSocket; this plugin
// rebroadcasts them to every connected page, which treats them like local MIDI.

export const EVENT_MIDI = 'midi-relay:message';
export const EVENT_STATUS = 'midi-relay:status';

export function midiRelay() {
  let lastStatus = {devices: [], bridge: false, at: 0};
  return {
    name: 'midi-relay',
    apply: 'serve',
    configureServer(server) {
      // The bridge page shows which address to open on the iPad.
      server.middlewares.use('/__midi-relay/info', async (req, res) => {
        const {networkInterfaces} = await import('node:os');
        const port = server.config.server.port ?? 5173;
        const addresses = Object.values(networkInterfaces()).flat()
          .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${port}/`);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({addresses, exposed: !!server.config.server.host}));
      });
      server.ws.on(EVENT_MIDI, data => {
        if (!Array.isArray(data?.bytes) || data.bytes.length > 3 || !data.bytes.every(b => Number.isInteger(b) && b >= 0 && b < 256)) return;
        server.ws.send(EVENT_MIDI, {bytes: data.bytes, source: String(data.source ?? '')});
      });
      server.ws.on(EVENT_STATUS, data => {
        lastStatus = {devices: Array.isArray(data?.devices) ? data.devices.map(String).slice(0, 16) : [], bridge: !!data?.bridge, at: Date.now()};
        server.ws.send(EVENT_STATUS, lastStatus);
      });
      // New pages (an iPad joining later) learn the current bridge state.
      server.ws.on('connection', () => { if (lastStatus.at) setTimeout(() => server.ws.send(EVENT_STATUS, lastStatus), 200); });
    },
  };
}
