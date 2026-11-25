// Parameters after "?" in the hash route (#/play/<id>?review=<takeId>, ?exam=<examId>).
// The router (src/app/router.js) ignores them, so they never change which piece is open.
export const hashParams = (hash = location.hash) => { const i = hash.indexOf('?'); return new URLSearchParams(i < 0 ? '' : hash.slice(i + 1)); };
export const hashSongId = (hash = location.hash) => {
  const m = hash.replace(/^#/, '').split('?')[0].match(/^\/play\/(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
};
/** Drops one parameter without a hashchange (nothing reloads). */
export function dropHashParam(name) {
  const p = hashParams();
  if (!p.has(name)) return;
  p.delete(name);
  const base = location.hash.split('?')[0], rest = p.toString();
  try { history.replaceState(history.state, '', base + (rest ? '?' + rest : '')); } catch {}
}
