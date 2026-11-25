// MIDI Bridge page (bridge.html, dev server only): reads the piano with Web MIDI and forwards
// every message through the dev server to other devices (see midi-relay/plugin.js).
//   • reconnects by itself: Vite reloads this page when the dev server comes back, and the page
//     reconnects the piano without a click once MIDI permission has been granted;
//   • sends a heartbeat every 3 s so the iPad can tell "connected" from "stale";
//   • measures the round trip to every open app page and shows it (and tells each page its own).
import './styles/tokens.css';
import {onServerConnection, relayAvailable, sendRelayMidi, sendRelayStatus, startLatencyProbe} from './midi-relay.js';

const $ = id => document.getElementById(id);
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
const HEARTBEAT_MS = 3000;
const PAGE_TIMEOUT_MS = 8000;
let access = null, count = 0, inputs = [];

function setStatus(text, state = '') {
  $('status-text').textContent = text;
  $('status').dataset.state = state;
}

// ───────── heartbeat ─────────

const pages = new Map(); // pageId → {label, samples: [rtt…], seen}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

function heartbeat() {
  const latency = {};
  for (const [id, p] of pages) latency[id] = median(p.samples);
  sendRelayStatus({bridge: inputs.length > 0, devices: inputs.map(i => i.name || 'MIDI input'), latency});
}

function wire() {
  inputs = access ? [...access.inputs.values()].filter(i => i.state === 'connected') : [];
  for (const input of inputs) {
    input.onmidimessage = e => {
      const [status, n, v] = e.data;
      const cmd = status & 0xf0;
      if (cmd !== 0x90 && cmd !== 0x80 && cmd !== 0xb0) return; // notes and pedal/controllers only
      sendRelayMidi(e.data.slice(0, 3));
      if (cmd === 0x90 && v > 0) $('last').textContent = `${++count} notes sent · last ${noteName(n)}`;
    };
  }
  heartbeat();
  const names = inputs.map(i => i.name || 'MIDI input');
  if (inputs.length) setStatus('Relaying ' + names.join(', '), 'on');
  else setStatus('No keyboard found · check the USB cable and that the piano is on', 'warn');
}

async function connect({quiet = false} = {}) {
  if (!relayAvailable) { setStatus('The relay only works on the dev server (npm run dev:ipad)', 'warn'); return; }
  if (!navigator.requestMIDIAccess) { setStatus('Open this page in Chrome or Edge on the computer', 'warn'); return; }
  try {
    access = await navigator.requestMIDIAccess({sysex: false});
    access.onstatechange = wire;
    wire();
    $('connect').textContent = 'Refresh';
  } catch {
    if (!quiet) setStatus('MIDI access was blocked · allow it in the browser’s site settings', 'warn');
  }
}
$('connect').onclick = () => connect();

// Reconnect without a click when permission was granted before (e.g. after Vite reloaded the page).
navigator.permissions?.query({name: 'midi'}).then(p => { if (p.state === 'granted') connect({quiet: true}); }).catch(() => {});

setInterval(heartbeat, HEARTBEAT_MS);
heartbeat();
window.addEventListener('pagehide', () => sendRelayStatus({bridge: false, devices: []}));

// ───────── dev-server link ─────────

onServerConnection(state => {
  $('server').dataset.state = state === 'connect' ? 'on' : 'warn';
  $('server-text').textContent = state === 'connect' ? 'Connected to the dev server' : 'Dev server unreachable · reconnecting…';
  if (state === 'connect') heartbeat();
});
if (relayAvailable) { $('server').dataset.state = 'on'; $('server-text').textContent = 'Connected to the dev server'; }

// ───────── latency ─────────

function renderPages() {
  const now = performance.now();
  for (const [id, p] of pages) if (now - p.seen > PAGE_TIMEOUT_MS) pages.delete(id);
  const list = $('pages');
  if (!pages.size) { list.innerHTML = '<li class="empty">No app page is open yet. Open the address below on the iPad.</li>'; return; }
  list.replaceChildren(...[...pages.values()].map(p => {
    const li = document.createElement('li');
    const ms = median(p.samples);
    const quality = ms < 30 ? 'good' : ms < 80 ? 'fair' : 'poor';
    li.innerHTML = `<span class="pg-name"></span><span class="pg-ms" data-q="${quality}"><b>${Math.round(ms)}</b> ms</span>`;
    li.querySelector('.pg-name').textContent = p.label;
    li.title = `Round trip, median of the last ${p.samples.length}: Mac → server → page → server → Mac. One way ≈ half.`;
    return li;
  }));
}

startLatencyProbe(({page, label, rttMs}) => {
  const p = pages.get(page) || {label, samples: [], seen: 0};
  p.label = label; p.seen = performance.now();
  p.samples.push(rttMs);
  if (p.samples.length > 10) p.samples.shift();
  pages.set(page, p);
  renderPages();
});
setInterval(renderPages, 2000);
renderPages();

// ───────── address for the iPad ─────────

fetch('/__midi-relay/info').then(r => r.json()).then(({addresses, exposed}) => {
  const box = $('urls');
  if (!exposed) {
    box.innerHTML = '<p>The dev server is only listening on this computer. Restart it with <code>npm run dev:ipad</code> so the iPad can reach it.</p>';
    return;
  }
  box.innerHTML = addresses.length
    ? addresses.map(a => `<div class="url">${a}</div>`).join('') + '<p class="hint">Both devices must be on the same Wi-Fi. In Safari: Share → Add to Home Screen for a full-screen app.</p>'
    : '<p>No network address found · is this computer on Wi-Fi?</p>';
}).catch(() => { $('urls').innerHTML = '<p>Relay unavailable · start the app with <code>npm run dev:ipad</code>.</p>'; });
