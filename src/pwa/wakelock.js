// Keeps the screen awake while the student is practising (Screen Wake Lock API;
// Safari 16.4+, Chrome). Nothing here edits the player: it watches signals that exist.
//
// The screen is kept on while
//   • the player (#/play/…) is listening or practising: #player has class `playing`
//     or `practicing` (src/player.js setButtons), and for a grace period afterwards
//     (between passes, while reading the results, while a key is being played);
//   • a note-reading drill is open (#/train/reading) and was used recently;
//   • anything calls holdAwake(reason) (e.g. a future page-turn mode), until release().
// The lock is dropped when the page is hidden (the browser does that anyway) and taken
// again on visibilitychange, as the API requires.
//
// Fallback: the Wake Lock API needs a secure context, and the iPad opens the Mac's dev server
// over plain http://<mac-ip>:5173, where Safari has no navigator.wakeLock. There a tiny, muted,
// inline looping video (keep-awake.mp4, 2.5 KB) plays instead, which keeps iOS from dimming
// the screen (the approach NoSleep.js uses). The installed home-screen app behaves the same.
import keepAwakeVideo from './keep-awake.mp4?url';

const GRACE_MS = 3 * 60 * 1000;     // after the last activity in the player / drill

export function createWakeLock({doc = document, win = window, nav = navigator, graceMs = GRACE_MS, now = () => Date.now(), videoSrc = keepAwakeVideo} = {}) {
  let sentinel = null, pending = null, video = null, videoOn = false;
  let lastActive = 0, timer = null;
  const holds = new Set();
  const listeners = new Set();

  const route = () => (win.location.hash.replace(/^#/, '') || '/').split('?')[0];
  const inPlayer = () => route().startsWith('/play/');
  const inDrill = () => route().replace(/\/+$/, '') === '/train/reading';
  const playerBusy = () => {
    const el = doc.getElementById('player');
    return !!el && !el.hidden && (el.classList.contains('playing') || el.classList.contains('practicing'));
  };

  function wanted() {
    if (doc.visibilityState !== 'visible') return false;
    if (holds.size) return true;
    if (inPlayer() && playerBusy()) return true;
    return (inPlayer() || inDrill()) && now() - lastActive < graceMs;
  }

  const state = () => ({held: (!!sentinel && !sentinel.released) || videoOn, wanted: wanted(), method: nav?.wakeLock ? 'wake-lock' : 'video'});

  function startVideo() {
    if (!video) {
      video = doc.createElement('video');
      video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('aria-hidden', 'true');
      video.muted = true; video.loop = true; video.disableRemotePlayback = true;
      video.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      video.src = videoSrc;
      doc.body.append(video);
    }
    const played = video.play();
    videoOn = true;
    played?.catch?.(() => { videoOn = false; notify(); }); // blocked until a user gesture: retried on the next one
    notify();
  }
  function stopVideo() {
    if (!video) return;
    video.pause();
    videoOn = false;
    notify();
  }
  const notify = () => { const s = state(); for (const fn of listeners) fn(s); };

  async function acquire() {
    if (!nav?.wakeLock) { if (!videoOn || video?.paused) startVideo(); return; }
    if (pending || (sentinel && !sentinel.released)) return;
    pending = nav.wakeLock.request('screen').then(s => {
      sentinel = s;
      s.addEventListener?.('release', () => { if (sentinel === s) sentinel = null; notify(); });
      // The page may have stopped wanting it while the request was in flight.
      if (!wanted()) release();
    }).catch(() => {
      // Refused (policy, low-power mode, or a Safari home-screen app bug): use the video instead.
      if (wanted()) startVideo();
    })
      .finally(() => { pending = null; notify(); });
    await pending;
  }

  function release() {
    stopVideo();
    const s = sentinel;
    sentinel = null;
    s?.release?.().catch(() => {});
    notify();
  }

  function update() {
    clearTimeout(timer);
    if (wanted()) {
      acquire();
      // Re-check when the grace period would run out.
      if (!holds.size && !playerBusy()) timer = setTimeout(update, Math.max(1000, graceMs - (now() - lastActive) + 50));
    } else if (sentinel || videoOn) release();
  }

  const touch = () => { lastActive = now(); update(); };

  // Signals.
  const onVisibility = () => update();
  const onHash = () => { if (inPlayer() || inDrill()) lastActive = now(); update(); };
  const onActivity = () => { if (inPlayer() || inDrill()) touch(); };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('hashchange', onHash);
  for (const type of ['piano:note', 'practice:result', 'practice:session', 'trainer:result']) win.addEventListener(type, onActivity);
  doc.addEventListener('pointerdown', onActivity, {passive: true});
  doc.addEventListener('keydown', onActivity);

  // #player's class flips when listening / practising starts or stops.
  let observer = null;
  const watchPlayer = () => {
    const el = doc.getElementById('player');
    if (!el || observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(() => { if (playerBusy()) lastActive = now(); update(); });
    observer.observe(el, {attributes: true, attributeFilter: ['class', 'hidden']});
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', watchPlayer, {once: true}); else watchPlayer();
  // Opened straight into the player or a drill (a bookmark, the home-screen app resuming).
  if (inPlayer() || inDrill()) { lastActive = now(); update(); }

  return {
    state,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Keeps the screen on for `reason` until the returned function is called. */
    holdAwake(reason = 'manual') {
      const token = {reason};
      holds.add(token);
      update();
      return () => { holds.delete(token); update(); };
    },
    update,
    destroy() {
      clearTimeout(timer);
      observer?.disconnect();
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('hashchange', onHash);
      for (const type of ['piano:note', 'practice:result', 'practice:session', 'trainer:result']) win.removeEventListener(type, onActivity);
      doc.removeEventListener('pointerdown', onActivity);
      doc.removeEventListener('keydown', onActivity);
      release();
    },
  };
}

let shared = null;
/** The app-wide instance (src/pwa/index.js starts it). */
export function startWakeLock() {
  if (!shared && typeof document !== 'undefined') shared = createWakeLock();
  return shared;
}
export const holdAwake = reason => startWakeLock()?.holdAwake(reason) ?? (() => {});
