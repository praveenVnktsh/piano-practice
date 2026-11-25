// "Add to Home Screen" on the public site, for iPad (and iPhone) Safari, which has no install prompt
// of its own. One quiet line at the foot of Today, shown until it is dismissed or the app is opened
// from the Home Screen. Never on the Mac's dev server (the iPad link card covers that).
//
//   shouldShowInstallHint({ua, touchPoints, standalone, dismissed, mac}) → boolean   (pure; tested)
//   mountInstallHint(container) → {destroy()}
import './install-hint.css';
import {onMac} from '../app/mac.js';

export const DISMISS_KEY = 'piano-practice.install-hint';

/** iPadOS Safari says "Macintosh" but has touch; iPhone/iPod say so. Other iOS browsers can't add to the Home Screen the same way. */
export function isIosSafari(ua = '', touchPoints = 0) {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function shouldShowInstallHint({ua = '', touchPoints = 0, standalone = false, dismissed = false, mac = false} = {}) {
  return !mac && !standalone && !dismissed && isIosSafari(ua, touchPoints);
}

const read = () => { try { return localStorage.getItem(DISMISS_KEY) === 'dismissed'; } catch { return false; } };

export function mountInstallHint(container) {
  const show = shouldShowInstallHint({
    ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints || 0,
    standalone: navigator.standalone === true || !!globalThis.matchMedia?.('(display-mode: standalone)').matches,
    dismissed: read(), mac: onMac(),
  });
  if (!show) return {destroy() {}};
  const el = document.createElement('aside');
  el.className = 'a2hs';
  el.setAttribute('aria-label', 'Add to Home Screen');
  el.innerHTML = `<p>For a full-screen practice room that opens offline: Share <span aria-hidden="true">→</span> <b>Add to Home Screen</b>.</p>
    <button type="button" class="a2hs-x" aria-label="Dismiss">×</button>`;
  el.querySelector('.a2hs-x').onclick = () => {
    try { localStorage.setItem(DISMISS_KEY, 'dismissed'); } catch {}
    el.remove();
  };
  container.append(el);
  return {destroy() { el.remove(); }};
}
