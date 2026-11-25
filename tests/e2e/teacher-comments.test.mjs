// The teacher's bar comments in the player (Phase 14). vite preview has no /__teacher endpoints,
// so the comments arrive the way the Teacher panel hands them on: a `teacher:thread` window event.
// Read / dismiss posts fail quietly here (nothing can reach .teacher/).
import {VIEWPORTS, overflow, waitForSong} from './helpers.mjs';

const COMMENTS = songId => JSON.stringify([
  {id: 1, at: '2026-11-25T10:00:00Z', songId, first: 1, last: 2, text: 'Lift the **wrist** here.'},
  {id: 2, at: '2026-11-25T10:00:00Z', songId, first: 0, last: 0, text: 'Count one bar in.', readAt: '2026-11-25T11:00:00Z'},
  {id: 3, at: '2026-11-25T10:00:00Z', songId: 'another-piece', first: 0, last: 0, text: 'Not this piece'},
  {id: 4, at: '2026-11-25T10:00:00Z', songId, first: 3, last: 3, text: 'Gone', dismissedAt: '2026-11-25T12:00:00Z'},
]);
const send = (page, songId) => page.eval(`window.dispatchEvent(new CustomEvent('teacher:thread', {detail: {messages: [], replies: [], status: {thinking: null}, comments: ${COMMENTS(songId)}}})), true`);
// Read / dismiss posts go to a stub (preview has no /__teacher); the calls are kept for checking.
const stub = page => page.eval(`(() => { window.__posts = []; const f = window.fetch;
  window.fetch = (u, o) => String(u).startsWith('/__teacher/comments/') ? (window.__posts.push(String(u)), Promise.resolve(new Response('{}', {headers: {'content-type': 'application/json'}}))) : f(u, o);
  return true; })()`);
// A click where the element is, without scrolling anything into view (the score's track must stay put).
async function clickAt(page, selector) {
  const box = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && r.width ? {x: r.left + r.width / 2, y: r.top + r.height / 2} : null; })()`);
  if (!box) throw new Error('nothing to click: ' + selector);
  for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', {type, x: box.x, y: box.y, button: 'left', clickCount: 1});
}
const tabs = page => page.eval(`[...document.querySelectorAll('.bn-layer:not([hidden]) .bn-tab')].filter(t => t.getClientRects().length).map(t => t.dataset.id + (t.classList.contains('unread') ? '*' : ''))`);

export const tests = [
  {
    name: 'bar comments: markers on the score, the note, practise these bars, dismiss, ask',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
      await stub(page);
      await send(page, song.id);
      await page.waitFor(`document.querySelectorAll('#um-sheet .bn-tab').length === 2`, {what: 'two markers on the score'});
      assert.deepEqual(await tabs(page), ['2', '1*'], 'bar order; the unread one is marked; other pieces and dismissed ones are left out');

      // The hairline spans bars 2–3 of the score.
      const span = await page.eval(`(() => { const m = document.querySelector('#um-sheet .bn-tab[data-id="1"]').parentElement.getBoundingClientRect();
        const ms = [...document.querySelectorAll('#um-sheet svg .measure')].map(e => e.getBoundingClientRect());
        return {left: m.left - ms[1].left, right: ms[2].right - m.right}; })()`);
      assert.ok(Math.abs(span.left) < 2 && span.right >= 0 && span.right < 6, `marker spans bars 2–3 (${JSON.stringify(span)})`);

      // Keyboard: focus + Enter opens the note; Escape closes it and gives focus back.
      await page.eval(`document.querySelector('#um-sheet .bn-tab[data-id="1"]').focus(), true`);
      await page.key('Enter', {code: 'Enter', keyCode: 13, text: '\r'});
      await page.waitFor(`!document.querySelector('.bn-pop').hidden`, {what: 'the note opens'});
      assert.match(await page.eval(`document.querySelector('.bn-pop .bn-text').innerHTML`), /<strong>wrist<\/strong>/);
      assert.match(await page.eval(`document.querySelector('.bn-pop .bn-head').textContent`), /bars 2–3/);
      assert.equal(await page.eval(`document.querySelector('#um-sheet .bn-tab[data-id="1"]').classList.contains('unread')`), false, 'read once opened');
      assert.deepEqual(await page.eval('window.__posts'), ['/__teacher/comments/1/read']);
      assert.equal(await page.eval(`!!document.querySelector('.bn-pop .bn-ask')`), true, 'ask is offered with a teacher');
      await page.key('Escape', {code: 'Escape', keyCode: 27});
      await page.waitFor(`document.querySelector('.bn-pop').hidden`, {what: 'Escape closes the note'});
      assert.equal(await page.eval(`document.activeElement.dataset.id`), '1');

      // A click opens it; "Practise these bars" sets the section.
      await clickAt(page, '#um-sheet .bn-tab[data-id="1"]');
      await page.waitFor(`!document.querySelector('.bn-pop').hidden`, {what: 'click opens the note'});
      await page.click('.bn-pop .bn-practise');
      await page.waitFor(`JSON.stringify(window.pianoPlayer.getState().section) === '[1,2]'`, {what: 'section set to bars 2–3'});
      assert.equal(await page.eval(`document.querySelector('.bn-pop').hidden`), true);

      // Falling notes: the same marker beside the bar numbers.
      await page.eval(`document.querySelector('input[name="menu-view"][value="falling"]').click(), true`);
      await page.waitFor(`document.querySelectorAll('.bn-roll:not([hidden]) .bn-mark:not([hidden])').length >= 1`, {what: 'marker on the falling notes'});
      await clickAt(page, '.bn-roll .bn-mark:not([hidden]) .bn-tab');
      await page.waitFor(`!document.querySelector('.bn-pop').hidden`, {what: 'the note opens on the roll'});

      // Dismiss takes it off.
      await page.click('.bn-pop .bn-dismiss');
      await page.waitFor(`!document.querySelector('.bn-roll .bn-tab[data-id="1"]')`, {what: 'dismissed'});
      assert.ok((await page.eval('window.__posts')).includes('/__teacher/comments/1/dismiss'));
      await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
      await sleep(200);
      assert.deepEqual(await tabs(page), ['2']);

      // ⋯ → Ask the teacher about bars 2–3: the panel opens with the bars attached.
      await page.click('#more-btn');
      await page.waitFor(`!document.querySelector('.bn-menu').hidden`, {what: 'ask row in the ⋯ menu'});
      assert.match(await page.eval(`document.getElementById('ask-teacher-btn').textContent`), /Ask the teacher about bars 2–3/);
      await page.click('#ask-teacher-btn');
      await page.waitFor(`!document.querySelector('.tch-panel').hidden && !document.querySelector('.tch-attach').hidden`, {what: 'panel open with the attachment'});
      assert.equal(await page.eval(`document.getElementById('more-menu').hidden`), true, 'the menu closed');
      assert.match(await page.eval(`document.querySelector('.tch-attach').textContent`), /bars 2–3/);
      assert.equal(await page.eval(`document.querySelector('.tch-compose textarea').value`), 'About bars 2–3: ');
      await page.click('.tch-attach-x');
      assert.equal(await page.eval(`document.querySelector('.tch-attach').hidden`), true);
      await sleep(500); // the panel slides in
      assert.deepEqual(await overflow(page), []);
    },
  },
  {
    name: 'bar comments fit on a phone and in iPad portrait',
    async run({base, page: open, assert, catalog}) {
      for (const vp of [VIEWPORTS.phone, VIEWPORTS.portrait]) {
        const page = await open(vp);
        const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
        await page.goto(base + '#/play/' + encodeURIComponent(song.id));
        await waitForSong(page);
        await page.eval(`document.querySelector('input[name="menu-view"][value="sheet"]').click(), true`);
        await stub(page);
        await page.eval('window.pianoPlayer.setSection(1, 2), true'); // the comment's bars under the playhead
        await send(page, song.id);
        await page.waitFor(`document.querySelectorAll('#um-sheet .bn-tab').length === 2`, {what: 'markers'});
        await page.waitFor(`(() => { const r = document.querySelector('#um-sheet .bn-tab[data-id="1"]').getBoundingClientRect(); return r.left > 0 && r.right < innerWidth; })()`, {what: 'marker on screen'});
        await clickAt(page, '#um-sheet .bn-tab[data-id="1"]');
        await page.waitFor(`!document.querySelector('.bn-pop').hidden`, {what: 'note open'});
        const fits = await page.eval(`(() => { const r = document.querySelector('.bn-pop').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`);
        assert.ok(fits, `the note fits at ${vp.width}×${vp.height}`);
        assert.deepEqual(await overflow(page), []);
      }
    },
  },
];
