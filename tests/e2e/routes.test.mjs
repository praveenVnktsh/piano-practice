// Every place and the player at desktop, iPad portrait and phone sizes:
// renders, no horizontal overflow, no console errors.
import {PLACES, VIEWPORTS, describeViewport, overflow, waitForRoute, waitForSong} from './helpers.mjs';

export const tests = Object.entries(VIEWPORTS).map(([label, viewport]) => ({
  name: `every route at ${label} ${describeViewport(viewport)}`,
  timeout: 150000,
  async run({base, page: open, assert, catalog}) {
    const page = await open(viewport);
    await page.goto(base + '#/today', {settle: 300});
    const routes = [...PLACES, '#/play/' + encodeURIComponent(catalog.songs[0].id)];
    const problems = [];
    for (const hash of routes) {
      await page.eval(`location.hash = ${JSON.stringify(hash)}`);
      await waitForRoute(page, hash);
      if (hash.startsWith('#/play/')) await waitForSong(page);
      await new Promise(r => setTimeout(r, 400)); // let fonts and late layout settle
      const bad = await overflow(page);
      if (bad.length) problems.push(`${hash}: ${bad.join('; ')}`);
    }
    assert.deepEqual(problems, [], 'horizontal overflow');
  },
}));
