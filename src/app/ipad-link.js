// "Piano & iPad": on the Mac (dev server, localhost), the piano relay and the address the iPad
// should open on the same Wi-Fi, with a QR code to scan. At the foot of Today, and compact in
// Settings → This device. The relay itself runs app-wide (src/relay/app-relay.js); this card only
// shows it and holds its one "Connect piano" button. Uses the relay's /__midi-relay/info.
//
//   lanInfo()                 → Promise<{addresses: string[], exposed: boolean} | null>  (null: no dev server)
//   isThisMac(location)       → true when the page is opened on the Mac itself (localhost)
//   ipadLinkHTML(info, {qr, relay}) → markup for the address half (pure; tested)
//   pagesHTML(pages)          → the connected pages with round trip and a good/fair/poor dot (pure)
//   mountIpadLink(container, {compact, bridge}) → {el, destroy()}  only renders on the Mac with a dev server
import qrcode from 'qrcode-generator';
import './ipad-link.css';
import {isThisMac, onMac} from './mac.js';
import {appRelay} from '../relay/app-relay.js';
import {formatMs, pagesSummary, pianoStatus} from '../relay/bridge-state.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

export {isThisMac};

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

/** relay: the piano half sits beside it (no need to point at bridge.html). */
export function ipadLinkHTML(info, {qr = true, relay = false} = {}) {
  if (!info) return '';
  const title = relay ? 'On your iPad, open' : 'Open on your iPad';
  if (!info.exposed) {
    return `<div class="ipl-body"><p class="ipl-title">${title}</p>
      <p class="ipl-hint">The app is only listening on this Mac. Start it with <code>npm run dev:ipad</code> to open it on the iPad.</p></div>`;
  }
  if (!info.addresses.length) {
    return `<div class="ipl-body"><p class="ipl-title">${title}</p>
      <p class="ipl-hint">This Mac has no Wi-Fi or network address right now. Connect to Wi-Fi and reopen this page.</p></div>`;
  }
  const [main, ...rest] = info.addresses;
  const hint = relay ? 'Same Wi-Fi as this Mac. In Safari: Share → Add to Home Screen.'
    : 'Same Wi-Fi as this Mac. In Safari: Share → Add to Home Screen. Connect the piano on this Mac at <a href="/bridge.html">bridge.html</a>.';
  return `${qr ? qrSvg(main) : ''}<div class="ipl-body"><p class="ipl-title">${title}</p>
    <p class="ipl-url"><a href="${esc(main)}">${esc(main.replace(/\/$/, ''))}</a></p>
    ${rest.length ? `<p class="ipl-alt">Or ${rest.map(a => `<a href="${esc(a)}">${esc(a.replace(/\/$/, ''))}</a>`).join(', ')}</p>` : ''}
    <p class="ipl-hint">${hint}</p></div>`;
}

const STANDBY_PAGES = 'The relaying tab shows the iPad’s delay.';
const QUALITY = {good: 'instant', fair: 'fine', poor: 'slow'};

export function pagesHTML(pages) {
  if (!pages?.length) return '<li class="ipl-empty">No iPad connected yet.</li>';
  return pages.map(p => `<li title="Round trip, median of the last ${p.samples || 1}: Mac → server → page → back. One way ≈ half.">
    <span class="ipl-pg-name">${esc(p.label)}</span>
    <span class="ipl-pg-ms" data-q="${p.quality}"><span class="ipl-qdot" aria-hidden="true"></span>${formatMs(p.ms)}<span class="sr-only"> (${QUALITY[p.quality] || ''})</span></span></li>`).join('');
}

function pianoPart(el, bridge, {compact}) {
  const part = document.createElement('section');
  part.className = 'ipl-piano';
  part.setAttribute('aria-label', 'Piano relay');
  part.innerHTML = `<p class="ipl-title">${compact ? 'Piano relay' : 'Piano &amp; iPad'}</p>
    <p class="ipl-status" role="status"><span class="ipl-dot" aria-hidden="true"></span><span class="ipl-status-text"></span></p>
    <div class="ipl-actions"><button type="button" class="ipl-connect primary-btn">Connect piano</button></div>
    ${compact ? '<p class="ipl-pages-line"></p>' : '<ul class="ipl-pages" aria-label="Connected pages, round trip"></ul>'}`;
  el.prepend(part);
  const $ = s => part.querySelector(s);
  const button = $('.ipl-connect');
  button.onclick = () => bridge.connect();
  let lastPages = null;
  const unsubscribe = bridge.subscribe(state => {
    const s = pianoStatus(state);
    $('.ipl-status').dataset.tone = s.tone;
    $('.ipl-status-text').textContent = s.text;
    button.hidden = !s.action;
    const label = s.action === 'refresh' ? 'Refresh' : 'Connect piano';
    if (button.textContent !== label) button.textContent = label;
    button.className = 'ipl-connect ' + (s.action === 'refresh' ? 'quiet-btn' : 'primary-btn');
    // Only the relaying bridge hears the pages' answers: standing by, point at the one that does.
    const standby = state.role === 'standby';
    const pagesKey = standby + JSON.stringify(state.pages);
    if (pagesKey !== lastPages) {
      lastPages = pagesKey;
      if (compact) $('.ipl-pages-line').textContent = standby ? STANDBY_PAGES : pagesSummary(state.pages);
      else $('.ipl-pages').innerHTML = standby ? `<li class="ipl-empty">${STANDBY_PAGES}</li>` : pagesHTML(state.pages);
    }
  });
  return unsubscribe;
}

export function mountIpadLink(container, {compact = false, bridge = appRelay()} = {}) {
  const el = document.createElement('aside');
  el.className = 'ipl' + (compact ? ' ipl-compact' : '') + (bridge ? ' ipl-duo' : '');
  el.hidden = true;
  container.append(el);
  let gone = false, unsubscribe = () => {};
  if (isThisMac() && onMac()) {
    lanInfo().then(info => {
      if (gone || !info) return;
      const link = document.createElement('div');
      link.className = 'ipl-link';
      link.innerHTML = ipadLinkHTML(info, {qr: !compact, relay: !!bridge});
      el.append(link);
      if (bridge) unsubscribe = pianoPart(el, bridge, {compact});
      el.hidden = false;
    });
  }
  return {el, destroy() { gone = true; unsubscribe(); el.remove(); }};
}
