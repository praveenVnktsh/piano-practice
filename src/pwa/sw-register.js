// Registers the offline cache (src/pwa/sw.js).
//   production build (npm run build / preview / any static host): always.
//   dev server: only when asked, because a worker in front of Vite can serve stale modules:
//     open the app once with ?sw=1   → registers the network-first dev worker (remembered)
//     open the app once with ?sw=0   → unregisters it and clears its caches
// Needs a secure context: https, or http://localhost. Over plain http://<mac-ip>:5173 (the iPad
// on the dev server) Safari has no service workers at all, so this does nothing there.
const FLAG = 'piano-practice.sw';

const flag = () => { try { return localStorage.getItem(FLAG); } catch { return null; } };
const setFlag = v => { try { v ? localStorage.setItem(FLAG, v) : localStorage.removeItem(FLAG); } catch {} };

export async function unregisterServiceWorker() {
  const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
  await Promise.all(regs.map(r => r.unregister()));
  if (typeof caches !== 'undefined') for (const k of await caches.keys()) if (k.startsWith('piano-practice-')) await caches.delete(k);
}

export async function registerServiceWorker({prod = import.meta.env.PROD} = {}) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  const ask = new URLSearchParams(location.search).get('sw');
  if (ask === '1') setFlag('dev');
  if (ask === '0') {
    setFlag(null);
    await unregisterServiceWorker();
    // The old worker still serves (and caches) this page's remaining requests: clear again after.
    setTimeout(() => unregisterServiceWorker().catch(() => {}), 3000);
    return null;
  }
  if (!prod && flag() !== 'dev') return null;
  try {
    return await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href, {scope: new URL('./', document.baseURI).href, updateViaCache: 'none'});
  } catch (e) {
    console.warn('[pwa] service worker not registered:', e?.message || e);
    return null;
  }
}
