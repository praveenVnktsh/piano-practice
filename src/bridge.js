// MIDI Bridge page (bridge.html, dev server only): the stand-alone relay, for a computer that
// only relays (the app on the Mac's Today relays by itself too). The work is done by
// src/relay/bridge-core.js; this page draws its state:
//   • reconnects by itself: Vite reloads this page when the dev server comes back, and the page
//     reconnects the piano without a click once MIDI permission has been granted;
//   • sends a heartbeat every 3 s so the iPad can tell "connected" from "stale";
//   • measures the round trip to every open app page and shows it (and tells each page its own);
//   • stands by while another tab (the app's own relay) is already relaying, and takes over when
//     that one stops, so the iPad never hears a note twice.
import './styles/tokens.css';
import {onServerConnection, relayAvailable} from './midi-relay.js';
import {createBridge} from './relay/bridge-core.js';
import {formatMs, noteName, pianoStatus} from './relay/bridge-state.js';

const $ = id => document.getElementById(id);
const bridge = createBridge({announceIdle: 'always'}).start();

$('connect').onclick = () => {
  if (!relayAvailable) return;
  bridge.connect();
};

let lastPages = null;
bridge.subscribe(state => {
  // The server line below speaks for the dev server; this line is about the piano.
  const s = pianoStatus({...state, server: true});
  const text = !relayAvailable ? 'The relay only works on the dev server (npm run dev:ipad)'
    : state.midi === 'unsupported' ? 'Open this page in Chrome or Edge on the computer'
    : state.midi === 'on' && state.role === 'relaying' ? 'Relaying ' + state.devices.join(', ') : s.text;
  $('status-text').textContent = text;
  $('status').dataset.state = s.tone;
  $('connect').textContent = state.midi === 'off' || state.midi === 'blocked' ? 'Connect piano' : 'Refresh';
  if (state.notesSent) $('last').textContent = `${state.notesSent} notes sent · last ${noteName(state.lastNote)}`;
  const key = JSON.stringify(state.pages);
  if (key !== lastPages) { lastPages = key; renderPages(state.pages); }
});
bridge.autoConnect();

// ───────── dev-server link ─────────

onServerConnection(state => {
  $('server').dataset.state = state === 'connect' ? 'on' : 'warn';
  $('server-text').textContent = state === 'connect' ? 'Connected to the dev server' : 'Dev server unreachable · reconnecting…';
});
if (relayAvailable) { $('server').dataset.state = 'on'; $('server-text').textContent = 'Connected to the dev server'; }

// ───────── latency ─────────

function renderPages(pages) {
  const list = $('pages');
  if (!pages.length) { list.innerHTML = '<li class="empty">No app page is open yet. Open the address below on the iPad.</li>'; return; }
  list.replaceChildren(...pages.map(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="pg-name"></span><span class="pg-ms" data-q="${p.quality}"><b>${formatMs(p.ms).replace(' ms', '')}</b> ms</span>`;
    li.querySelector('.pg-name').textContent = p.label;
    li.title = `Round trip, median of the last ${p.samples}: Mac → server → page → server → Mac. One way ≈ half.`;
    return li;
  }));
}

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
