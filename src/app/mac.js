// Is the Mac's dev server behind this page? Decided once, without a request.
//
// The Mac-only endpoints (/__progress, /__teacher, /__songs, /__midi-relay, /__recordings,
// /__collections, /__backup, /__errors) are Vite dev-server plugins (`apply: 'serve'`), so a built
// copy never has them: the public site on GitHub Pages, `vite preview`, any static host. Those get
// 'static' and Mac-only features stay quiet instead of firing requests that 404.
//
//   detectWhere({dev, loc, override}) → 'mac' | 'static'   (pure; tested)
//   onMac() → boolean      cached for the session
//   MAC_ONLY                the one quiet line shown where a Mac-only feature would be (Progress, a take's Send)
//
// sessionStorage 'piano-practice.where' = 'mac' | 'static' overrides it for this tab (tests).

export const MAC_ONLY = 'The teacher lives on your Mac — open the app there.';
export const OVERRIDE_KEY = 'piano-practice.where';

/** localhost, a LAN address or a .local name: somewhere the Mac's dev server could be. */
export function isLocalHost(hostname = '') {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h.endsWith('.local') || /^127\./.test(h) || /^10\./.test(h) ||
    /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

/** An https page on a public host (GitHub Pages): certainly not the Mac's dev server. */
export const isStaticOrigin = (loc = globalThis.location) => loc?.protocol === 'https:' && !isLocalHost(loc.hostname);

export function detectWhere({dev = false, loc = globalThis.location, override = null} = {}) {
  if (override === 'mac' || override === 'static') return override;
  if (isStaticOrigin(loc)) return 'static';
  return dev ? 'mac' : 'static'; // the endpoints exist only on the dev server
}

let cached = null;
const readOverride = () => { try { return globalThis.sessionStorage?.getItem(OVERRIDE_KEY) ?? null; } catch { return null; } };

export function onMac() {
  cached ??= detectWhere({dev: !!import.meta.env?.DEV, override: readOverride()});
  return cached === 'mac';
}
