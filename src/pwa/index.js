// Home-screen app support, loaded from index.html <head> (independent of src/main.js):
//   • keeps the screen awake while practising (wakelock.js)
//   • registers the offline cache (sw-register.js; production builds, or ?sw=1 in dev)
//   • keeps <meta name="theme-color"> (status bar, splash) in step with the Paper / Concert hall theme
// window.pianoPWA = {wakeLock, holdAwake, backup()} for other modules, the teacher and the e2e tests
// (backup() lazily loads src/pwa/backup.js: {exportBackup, restoreBackup, mountBackupControls, …}).
import {holdAwake, startWakeLock} from './wakelock.js';
import {registerServiceWorker} from './sw-register.js';

const wakeLock = startWakeLock();
window.pianoPWA = {wakeLock, holdAwake, backup: () => import('./backup.js')};

function syncThemeColor() {
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  if (!paper) return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = paper;
}
new MutationObserver(syncThemeColor).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => setTimeout(syncThemeColor));
window.addEventListener('load', syncThemeColor);

if (document.readyState === 'complete') registerServiceWorker();
else window.addEventListener('load', () => registerServiceWorker(), {once: true});
