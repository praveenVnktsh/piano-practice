// The note-reading drill takes answers from the on-screen keys.
import {VIEWPORTS, waitForRoute} from './helpers.mjs';

export const tests = [{
  name: 'note-reading drill accepts input',
  async run({base, page: open, assert}) {
    const page = await open(VIEWPORTS.portrait);
    await page.goto(base + '#/train/reading');
    await waitForRoute(page, '#/train/reading');
    await page.waitFor(`document.querySelector('.trainer [data-ref="keys"] .tr-key.tr-white')`, {what: 'trainer keys'});
    const progress = () => page.eval(`document.querySelector('.trainer [data-ref="progress"]').textContent`);
    const before = await progress();
    await page.tap('.trainer [data-ref="keys"] .tr-key.tr-white[data-note="60"]', {hold: 60});
    await page.waitFor(`['ok', 'bad'].includes(document.querySelector('.trainer [data-ref="card"]').dataset.state)`, {what: 'the answer judged'});
    assert.ok((await page.eval(`document.querySelector('.trainer [data-ref="feedback"]').textContent.trim()`)).length > 0, 'feedback shown');
    await page.waitFor(`document.querySelector('.trainer [data-ref="progress"]').textContent !== ${JSON.stringify(before)}`, {what: 'the drill moved on', timeout: 5000});
  },
}];
