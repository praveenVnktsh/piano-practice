// Memory budget for the sampled instruments (pure; unit-tested in Node).
//
// Decoded samples are 32-bit floats: one Salamander layer is ~277 s of mono audio,
// about 53 MB at 48 kHz, so the full five-layer grand needs ~270 MB once decoded.
// That is fine on a Mac and a real risk on an iPad (Safari kills the tab without
// warning). Small-memory devices get a "lighter" grand: three of the five layers
// spread across the dynamic range, loaded nearest-to-mezzo-forte first.
//
//   isSmallMemoryDevice({deviceMemory, userAgent, maxTouchPoints}) → bool
//   pianoProfile(setting 'auto'|'light'|'full', device) → 'light' | 'full'
//   allowedLayers(layerCount, profile, {lightCount}) → [layer indices]
//   layerLoadOrder(centres, allowed, {first}) → allowed indices, nearest to `first` first
//   decodedBytes(buffers) → bytes (Σ length × channels × 4)
//   formatBytes(n) → '53.1 MB'

export const PIANO_PROFILES = ['auto', 'light', 'full'];
export const LIGHT_LAYERS = 3;
// The layer most notes use (mezzo forte); the first to load.
export const FIRST_VELOCITY = .6;

/** iPad / iPhone (an iPad on iPadOS 13+ says "Macintosh" but has touch points). */
export function isAppleMobile({userAgent = '', maxTouchPoints = 0} = {}) {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * A device that should get the lighter piano: navigator.deviceMemory ≤ 4 GB where the
 * browser reports it (Chrome, Edge, Android), otherwise iPad / iPhone (Safari reports none).
 */
export function isSmallMemoryDevice({deviceMemory, userAgent = '', maxTouchPoints = 0} = {}) {
  if (Number.isFinite(deviceMemory) && deviceMemory > 0) return deviceMemory <= 4;
  return isAppleMobile({userAgent, maxTouchPoints});
}

/** 'light' or 'full' from the Settings choice ('auto' asks the device). */
export function pianoProfile(setting, device = {}) {
  if (setting === 'light' || setting === 'full') return setting;
  return isSmallMemoryDevice(device) ? 'light' : 'full';
}

/** Which layers may load: all of them, or `lightCount` spread evenly from softest to loudest. */
export function allowedLayers(count, profile, {lightCount = LIGHT_LAYERS} = {}) {
  const all = Array.from({length: Math.max(0, count | 0)}, (_, i) => i);
  if (profile !== 'light' || count <= lightCount) return all;
  if (lightCount <= 1) return [Math.floor((count - 1) / 2)];
  const out = new Set();
  for (let k = 0; k < lightCount; k++) out.add(Math.round(k * (count - 1) / (lightCount - 1)));
  return [...out].sort((a, b) => a - b);
}

/** The allowed layer whose centre velocity is nearest to `velocity`. */
export function nearestLayer(centres, allowed, velocity = FIRST_VELOCITY) {
  let best = null;
  for (const i of allowed) if (best == null || Math.abs(centres[i] - velocity) < Math.abs(centres[best] - velocity)) best = i;
  return best;
}

/**
 * Load order: the layer nearest to `first` (a velocity, default mezzo forte) first, then the
 * others by distance of their centre from it (ties: the softer one first).
 */
export function layerLoadOrder(centres, allowed, {first = FIRST_VELOCITY} = {}) {
  const start = nearestLayer(centres, allowed, first);
  if (start == null) return [];
  const c = centres[start];
  return [...allowed].sort((a, b) => (Math.abs(centres[a] - c) - Math.abs(centres[b] - c)) || a - b);
}

/** Decoded size of AudioBuffer-like objects ({length, numberOfChannels}): 4 bytes per sample. */
export function decodedBytes(buffers) {
  let n = 0;
  for (const b of buffers ?? []) if (b && Number.isFinite(b.length)) n += b.length * (b.numberOfChannels || 1) * 4;
  return n;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}
