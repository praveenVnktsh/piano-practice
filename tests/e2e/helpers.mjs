// Shared bits for the e2e tests.

export const VIEWPORTS = {
  desktop: {width: 1180, height: 820},
  portrait: {width: 820, height: 1180, mobile: true, scale: 2},
  phone: {width: 390, height: 844, mobile: true, scale: 3},
};

/** The four places and their sub-pages (docs/ARCHITECTURE.md "Views and routes"). */
export const PLACES = ['#/today', '#/pieces', '#/exercises', '#/progress', '#/technique', '#/train/reading'];

/** Waits until the shell has rendered the route (nav present, view or player visible). */
export async function waitForRoute(page, hash) {
  const play = hash.startsWith('#/play/');
  await page.waitFor(play
    ? `(() => { const p = document.getElementById('player'); return p && !p.hidden && document.documentElement.dataset.route === 'play'; })()`
    : `(() => { const h = [...document.querySelectorAll('.view-host')].find(v => !v.hidden); return document.documentElement.dataset.route === 'place' && h && h.children.length > 0; })()`,
  {what: `route ${hash} rendered`});
}

/** Waits until the player has a song loaded (title set and keyboard built). */
export async function waitForSong(page) {
  await page.waitFor(`(() => { const s = window.pianoPlayer?.getState?.(); return s && s.songId && s.measureCount > 0 && document.querySelectorAll('#player .pkey').length > 20; })()`,
    {what: 'song loaded in the player', timeout: 30000});
}

/**
 * Horizontal overflow: the page itself must not scroll sideways, and no visible element may
 * stick out past the right edge unless an ancestor clips or scrolls it on purpose.
 * → [] when fine, else descriptions of the offenders.
 */
export function overflow(page) {
  return page.eval(`(() => {
    const W = document.documentElement.clientWidth, out = [];
    if (document.documentElement.scrollWidth > W + 1) out.push('document scrollWidth ' + document.documentElement.scrollWidth + ' > ' + W);
    if (document.body.scrollWidth > W + 1) out.push('body scrollWidth ' + document.body.scrollWidth + ' > ' + W);
    const clipped = el => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o !== 'visible') return true; } return false; };
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= W + 1 || r.left >= W) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.position === 'fixed' && r.left >= W) continue;
      if (clipped(el)) continue;
      const id = el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
      out.push(el.tagName.toLowerCase() + id + ' right=' + Math.round(r.right) + ' > ' + W);
      if (out.length > 8) break;
    }
    return out;
  })()`);
}

export const describeViewport = v => `${v.width}×${v.height}`;
