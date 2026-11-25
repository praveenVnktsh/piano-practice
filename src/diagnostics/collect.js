// Gathers what Settings → Diagnostics shows (browser side; report.js formats it).
//
//   collectInfo({piano, midiAccess: () => MIDIAccess|null, latencyMs: () => ms, measureRtt = true}) → Promise<info>
import {measureRelayRtt, relayAvailable, relayState} from '../midi-relay.js';
import {isSmallMemoryDevice} from '../audio/budget.js';

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
const APP_COMMIT = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '';

async function midiInfo(access) {
  const inputs = access ? [...access.inputs.values()].map(p => ({name: p.name, manufacturer: p.manufacturer, state: p.state})) : [];
  let status;
  if (access) status = 'available';
  else if (!window.isSecureContext) status = 'insecure';
  else if (!navigator.requestMIDIAccess) status = 'unsupported';
  else {
    status = 'not-requested';
    try { if ((await navigator.permissions?.query({name: 'midi'}))?.state === 'denied') status = 'blocked'; } catch {}
  }
  return {status, inputs};
}

async function storageInfo() {
  const out = {};
  try { Object.assign(out, await navigator.storage?.estimate?.()); } catch {}
  try { out.persisted = await navigator.storage?.persisted?.(); } catch {}
  return {usage: out.usage, quota: out.quota, persisted: out.persisted};
}

export async function collectInfo({piano, midiAccess = () => null, latencyMs = () => null, measureRtt = true} = {}) {
  const nav = navigator;
  const device = {
    userAgent: nav.userAgent, platform: nav.userAgentData?.platform || nav.platform,
    deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency,
    screen: `${screen.width}×${screen.height} @${window.devicePixelRatio || 1}x · window ${innerWidth}×${innerHeight}`,
    standalone: !!(window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone),
  };
  device.smallMemory = isSmallMemoryDevice({deviceMemory: nav.deviceMemory, userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints});

  const rs = relayState();
  const [midi, storage, rttMs] = await Promise.all([
    midiInfo(midiAccess()), storageInfo(),
    relayAvailable && measureRtt ? measureRelayRtt({timeoutMs: 2000}) : Promise.resolve(null),
  ]);
  const relay = {available: relayAvailable, state: rs.state, label: rs.label, devices: rs.devices, bridgeLatencyMs: rs.latencyMs, rttMs};

  const ctx = piano?.context;
  const audio = {
    state: ctx?.state, sampleRate: ctx?.sampleRate, baseLatency: ctx?.baseLatency, outputLatency: ctx?.outputLatency,
    instrument: piano?.instrument, latencyMs: latencyMs(),
  };
  const errors = window.pianoErrors?.stats ? {...window.pianoErrors.stats} : null;
  return {
    at: new Date().toISOString(),
    app: {version: APP_VERSION, commit: APP_COMMIT, mode: import.meta.env?.DEV ? 'dev server' : 'production', url: location.href},
    device, midi, relay, audio, samples: piano?.memory?.() ?? {}, storage, errors,
  };
}
