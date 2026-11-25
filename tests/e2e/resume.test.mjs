// Practise picks up where the playhead is: switching from Listen mid-piece, or after a pause,
// doesn't go back to the start of the section.
import {VIEWPORTS, waitForSong} from './helpers.mjs';

const state = page => page.eval('window.pianoPlayer.getState()');

export const tests = [
  {
    name: 'practise from the middle: Listen → Practise carries on from the playhead (Wait and Play along)',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`window.pianoPlayer.setSection(0, 7); window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('both'); 1`);
      for (const mode of ['wait', 'timed']) {
        await page.eval(`window.pianoPlayer.stop?.(); window.pianoPlayer.setMode('${mode}'); 1`);
        await page.click('#um-listen');
        await page.click('#um-play');
        await page.waitFor(`window.pianoPlayer.getState().playing && window.pianoPlayer.getState().position > 10`, {what: 'listening into bar 3', timeout: 20000});
        const heard = (await state(page)).position;
        await page.click('#um-practice'); // switching while listening starts practising
        await page.waitFor(`window.pianoPlayer.getState().practicing`, {what: 'practising'});
        // Wait: at the chord that was sounding (or the next one). Play along: a bar's count-in before the playhead's bar.
        const floor = mode === 'wait' ? heard - 2 : Math.floor(heard / 4) * 4 - 4 - .01;
        await page.waitFor(`window.pianoPlayer.getState().position >= ${floor}`, {what: `${mode}: practice near ${heard}, not at the start`, timeout: 5000}).catch(() => {});
        const at = (await state(page)).position;
        assert.ok(at >= floor, `${mode}: practice starts near where it was (${at} after listening to ${heard}), not at the start`);
        await page.click('#um-play'); // stop
        await page.waitFor(`!window.pianoPlayer.getState().practicing`, {what: 'stopped'});
      }
    },
  },
];
