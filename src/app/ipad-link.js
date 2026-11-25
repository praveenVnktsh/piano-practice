// "Open on your iPad": on the Mac (dev server), show the address the iPad should open on the same
// Wi-Fi, with a QR code to scan. Uses the relay's /__midi-relay/info (LAN IPv4 addresses).
//
//   lanInfo()                 → Promise<{addresses: string[], exposed: boolean} | null>  (null: no dev server)
//   isThisMac(location)       → true when the page is opened on the Mac itself (localhost)
//   ipadLinkHTML(info)        → markup for the card (pure; tested)
//   mountIpadLink(container, {compact}) → {el, destroy()}  only renders on the Mac with a dev server
import qrcode from 'qrcode-generator';
import './ipad-link.css';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

export const isThisMac = (loc = globalThis.location) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc?.hostname || '');

export async function lanInfo() {
  try {
    const res = await fetch('/__midi-relay/info', {cache: 'no-store'});
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    const data = await res.json();
    const addresses = (Array.isArray(data?.addresses) ? data.addresses : []).filter(a => typeof a === 'string' && /^http:\/\//.test(a));
    return {addresses, exposed: !!data?.exposed};
  } catch {
    return null;
  }
}

/** A QR code as an inline SVG (ink on paper, via currentColor). */
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 2; // quiet zone in modules
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg class="ipl-qr" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img" aria-label="QR code for ${esc(text)}" shape-rendering="crispEdges"><rect width="100%" height="100%" class="ipl-qr-bg"/><path d="${d}"/></svg>`;
}

export function ipadLinkHTML(info, {qr = true} = {}) {
  if (!info) return '';
  if (!info.exposed) {
    return `<div class="ipl-body"><p class="ipl-title">Open on your iPad</p>
      <p class="ipl-hint">The app is only listening on this Mac. Start it with <code>npm run dev:ipad</code> to open it on the iPad.</p></div>`;
  }
  if (!info.addresses.length) {
    return `<div class="ipl-body"><p class="ipl-title">Open on your iPad</p>
      <p class="ipl-hint">This Mac has no Wi-Fi or network address right now. Connect to Wi-Fi and reopen this page.</p></div>`;
  }
  const [main, ...rest] = info.addresses;
  return `${qr ? qrSvg(main) : ''}<div class="ipl-body"><p class="ipl-title">Open on your iPad</p>
    <p class="ipl-url"><a href="${esc(main)}">${esc(main.replace(/\/$/, ''))}</a></p>
    ${rest.length ? `<p class="ipl-alt">Or ${rest.map(a => `<a href="${esc(a)}">${esc(a.replace(/\/$/, ''))}</a>`).join(', ')}</p>` : ''}
    <p class="ipl-hint">Same Wi-Fi as this Mac. In Safari: Share → Add to Home Screen. Connect the piano on this Mac at <a href="/bridge.html">bridge.html</a>.</p></div>`;
}

export function mountIpadLink(container, {compact = false} = {}) {
  const el = document.createElement('aside');
  el.className = 'ipl' + (compact ? ' ipl-compact' : '');
  el.hidden = true;
  container.append(el);
  let gone = false;
  if (isThisMac()) {
    lanInfo().then(info => {
      if (gone || !info) return;
      el.innerHTML = ipadLinkHTML(info, {qr: !compact});
      el.hidden = false;
    });
  }
  return {el, destroy() { gone = true; el.remove(); }};
}
