// A calm, skippable introduction on first launch (docs/ROADMAP.md, Phase 11).
// Shown once (localStorage flag); Progress → Settings → "Show the introduction again" reopens it.
// The dialog itself (src/onboarding/dialog.js) is loaded only when it is shown.
export const SEEN_KEY = 'piano-practice.onboarded';

const seen = () => { try { return !!localStorage.getItem(SEEN_KEY); } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {} };

let showing = null;

/** First launch only: shows the introduction once the first screen has painted. */
export function startOnboarding() {
  if (seen()) return;
  const go = () => { if (!seen()) openOnboarding(); };
  if ('requestIdleCallback' in window) requestIdleCallback(go, {timeout: 1200}); else setTimeout(go, 400);
}

/** Opens the introduction (again) → a promise of how it ended ('done' | 'skip'). */
export function openOnboarding() {
  showing ||= import('./dialog.js')
    .then(m => m.showOnboarding({markSeen}))
    .finally(() => { showing = null; });
  return showing;
}
