// Settings → Diagnostics: turns what the browser reports (collect.js) into labelled rows and a
// plain-text report for "Copy report". Pure (unit-tested in Node); every field is optional, so
// a missing API reads "—" or "not available" instead of breaking the sheet.
//
//   buildReport(info) → [{title, rows: [[label, value], …]}, …]
//   formatReport(sections, {title}) → text
//
// info = {
//   at, app: {version, commit, mode, url},
//   device: {userAgent, platform, deviceMemory, cores, screen, standalone, smallMemory},
//   midi: {status: 'available'|'unsupported'|'insecure'|'blocked'|'not-requested', inputs: [{name, manufacturer, state}]},
//   relay: {available, state, label, devices, bridgeLatencyMs, rttMs},
//   audio: {state, sampleRate, baseLatency, outputLatency, instrument, latencyMs},
//   samples: {bytes, sets: {grand: {profile, layers, allowed, ready, samples, releases, bytes}, harpsichord, fallback}},
//   storage: {usage, quota, persisted},
//   errors: {sent, dropped, last},
// }
import {formatBytes} from '../audio/budget.js';

const DASH = '—';
const ms = v => Number.isFinite(v) ? `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)} ms` : DASH;
const sec = v => Number.isFinite(v) ? ms(v * 1000) : DASH;
const text = v => (v === undefined || v === null || v === '' ? DASH : String(v));
const yesNo = v => (v === undefined || v === null ? DASH : v ? 'yes' : 'no');

const MIDI_STATUS = {
  available: 'available',
  unsupported: 'not supported by this browser (use the Mac relay)',
  insecure: 'needs HTTPS or localhost',
  blocked: 'permission declined',
  'not-requested': 'not connected yet (⋯ → Connect piano)',
};

const RELAY_STATE = {
  connected: 'connected',
  'no-piano': 'bridge open, no keyboard on the Mac',
  waiting: 'no bridge page open on the Mac',
  stale: 'no signal from the Mac',
  reconnecting: 'reconnecting to the dev server',
};

function layerLine(g) {
  if (!g) return DASH;
  const total = g.layers ?? 0, allowed = g.allowed ?? total;
  const parts = [`${g.ready ?? 0} of ${allowed} loaded`];
  if (allowed < total) parts.push(`lighter piano: ${allowed} of ${total} layers`);
  return parts.join(' · ');
}

export function buildReport(info = {}) {
  const {app = {}, device = {}, midi = {}, relay = {}, audio = {}, samples = {}, storage = {}, errors = null} = info;
  const sets = samples.sets ?? {};
  const g = sets.grand, h = sets.harpsichord, fb = sets.fallback;
  const inputs = Array.isArray(midi.inputs) ? midi.inputs : [];
  const sections = [];

  sections.push({title: 'App', rows: [
    ['Version', [app.version, app.commit && `(${app.commit})`].filter(Boolean).join(' ') || DASH],
    ['Build', text(app.mode)],
    ['Address', text(app.url)],
    ['Report time', text(info.at)],
  ]});

  sections.push({title: 'MIDI', rows: [
    ['Web MIDI', MIDI_STATUS[midi.status] ?? text(midi.status)],
    ['Inputs', inputs.length ? inputs.map(i => [i.name || 'MIDI input', i.manufacturer && `(${i.manufacturer})`, i.state && i.state !== 'connected' && `· ${i.state}`].filter(Boolean).join(' ')).join('; ') : 'none'],
  ]});

  const relayRows = [['Relay', relay.available ? RELAY_STATE[relay.state] ?? text(relay.state) : 'not available (production build)']];
  if (relay.available) {
    relayRows.push(['Mac keyboards', relay.devices?.length ? relay.devices.join('; ') : 'none']);
    relayRows.push(['Round trip to the Mac', ms(relay.rttMs)]);
    relayRows.push(['Bridge → this page', ms(relay.bridgeLatencyMs)]);
  }
  sections.push({title: 'Mac relay', rows: relayRows});

  sections.push({title: 'Audio', rows: [
    ['AudioContext', text(audio.state ?? 'not started (play a note first)')],
    ['Sample rate', Number.isFinite(audio.sampleRate) ? `${audio.sampleRate} Hz` : DASH],
    ['Base latency', sec(audio.baseLatency)],
    ['Output latency', sec(audio.outputLatency)],
    ['Play-along calibration', ms(audio.latencyMs)],
    ['Instrument', text(audio.instrument)],
  ]});

  const sampleRows = [
    ['Grand piano', layerLine(g)],
  ];
  if (g?.releases) sampleRows.push(['Release noises', `${g.releases}`]);
  sampleRows.push(['Harpsichord', h?.ready ? 'loaded' : 'not loaded']);
  if (fb?.ready) sampleRows.push(['Fallback piano', 'loaded (the layered grand could not load)']);
  sampleRows.push(['Decoded sample memory', formatBytes(samples.bytes ?? 0)]);
  sections.push({title: 'Samples', rows: sampleRows});

  sections.push({title: 'Storage', rows: [
    ['Used', formatBytes(storage.usage)],
    ['Available to this site', formatBytes(storage.quota)],
    ['Persistent', yesNo(storage.persisted)],
  ]});

  sections.push({title: 'Device', rows: [
    ['Memory', Number.isFinite(device.deviceMemory) ? `${device.deviceMemory} GB` : 'not reported'],
    ['Small-memory device', yesNo(device.smallMemory)],
    ['CPU cores', text(device.cores)],
    ['Screen', text(device.screen)],
    ['Home-screen app', yesNo(device.standalone)],
    ['Platform', text(device.platform)],
    ['User agent', text(device.userAgent)],
  ]});

  if (errors) sections.push({title: 'Errors', rows: [
    ['Reported this session', `${errors.sent ?? 0}${errors.dropped ? ` (${errors.dropped} held back)` : ''}`],
    ['Last', text(errors.last)],
  ]});
  return sections;
}

export function formatReport(sections, {title = 'Piano practice diagnostics'} = {}) {
  const width = Math.max(0, ...sections.flatMap(s => s.rows.map(([k]) => k.length)));
  const lines = [title, '='.repeat(title.length)];
  for (const s of sections) {
    lines.push('', s.title);
    for (const [k, v] of s.rows) lines.push(`  ${k.padEnd(width)}  ${v}`);
  }
  return lines.join('\n') + '\n';
}
