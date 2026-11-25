// MIDI Bridge page: reads the piano with Web MIDI and forwards every message
// through the dev server to other devices (see midi-relay/plugin.js).
import {relayAvailable, sendRelayMidi, sendRelayStatus} from './midi-relay.js';

const $ = id => document.getElementById(id);
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
let access = null, count = 0;

function setStatus(text, state) {
  $('status-text').textContent = text;
  $('status').className = 'status ' + (state ?? '');
}

function wire() {
  const inputs = [...access.inputs.values()].filter(i => i.state === 'connected');
  for (const input of inputs) {
    input.onmidimessage = e => {
      const [status, n, v] = e.data;
      const cmd = status & 0xf0;
      if (cmd !== 0x90 && cmd !== 0x80 && cmd !== 0xb0) return; // notes and pedal/controllers only
      sendRelayMidi(e.data.slice(0, 3));
      if (cmd === 0x90 && v > 0) $('last').textContent = `${++count} notes sent · last ${noteName(n)}`;
    };
  }
  const names = inputs.map(i => i.name || 'MIDI input');
  sendRelayStatus({bridge: inputs.length > 0, devices: names});
  if (inputs.length) setStatus('Relaying: ' + names.join(', '), 'on');
  else setStatus('No MIDI keyboard found · check the USB cable and that the piano is on', 'warn');
}

$('connect').onclick = async () => {
  if (!relayAvailable) { setStatus('The relay only works on the dev server (npm run dev:ipad)', 'warn'); return; }
  if (!navigator.requestMIDIAccess) { setStatus('Open this page in Chrome or Edge on the computer', 'warn'); return; }
  try {
    access = await navigator.requestMIDIAccess({sysex: false});
    access.onstatechange = wire;
    wire();
    $('connect').textContent = 'Refresh';
  } catch {
    setStatus('MIDI access was blocked · allow it in the browser’s site settings', 'warn');
  }
};

// Re-announce periodically so pages that load later see the bridge.
setInterval(() => { if (access) wire(); }, 10000);
window.addEventListener('pagehide', () => sendRelayStatus({bridge: false, devices: []}));

fetch('/__midi-relay/info').then(r => r.json()).then(({addresses, exposed}) => {
  const box = $('urls');
  if (!exposed) {
    box.innerHTML = '<p>The dev server is only listening on this computer. Restart it with <code>npm run dev:ipad</code> so the iPad can reach it.</p>';
    return;
  }
  box.innerHTML = addresses.length
    ? addresses.map(a => `<div class="url">${a}</div>`).join('') + '<p>Both devices must be on the same Wi-Fi. Tip: in Safari, Share → Add to Home Screen for a full-screen app.</p>'
    : '<p>No network address found · is this computer on Wi-Fi?</p>';
}).catch(() => { $('urls').innerHTML = '<p>Relay unavailable · start the app with <code>npm run dev:ipad</code>.</p>'; });
