// The control key and the repair loop: on a (fake) MIDI piano, C8 starts practising; three wrong
// notes get the student stuck and offer "Loop bar N slowly?"; C8 accepts it, the bar loops in Wait,
// three clean passes end it, and practice carries on after the bar with the section put back.
// C8 itself is never a note: no piano:note, never a wrong note.
import {VIEWPORTS, waitForSong} from './helpers.mjs';

// A stand-in Web MIDI keyboard (as in musicality.test.mjs): window.__midi([status, note, velocity]).
const FAKE_MIDI = `(() => {
  const input = {id: 'e2e', name: 'E2E keys', state: 'connected', onmidimessage: null};
  const access = {inputs: new Map([['e2e', input]]), outputs: new Map(), onstatechange: null};
  Object.defineProperty(navigator, 'requestMIDIAccess', {configurable: true, value: async () => access});
  window.__midi = data => input.onmidimessage?.({data: new Uint8Array(data), timeStamp: performance.now()});
})();`;

const state = page => page.eval('window.pianoPlayer.getState()');
const C8 = 108;

async function press(page, sleep, notes) {
  for (const n of notes) await page.eval(`__midi([144, ${n}, 72]); 1`);
  await sleep(50);
  for (const n of notes) await page.eval(`__midi([128, ${n}, 0]); 1`);
  await sleep(50);
}
const targets = page => page.eval(`[...document.querySelectorAll('#player .pkey.attack')].map(k => +k.dataset.note)`);

export const tests = [
  {
    name: 'control key: C8 starts, accepts the stuck offer; the repair loop runs, ends and resumes after the bar',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.send('Page.addScriptToEvaluateOnNewDocument', {source: FAKE_MIDI});
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/today');
      await page.eval(`localStorage.setItem('piano-practice:settings', JSON.stringify({view: 'sheet'})); 1`);
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`document.getElementById('um-midi').click(); 1`);
      await page.waitFor(`document.getElementById('midi-chip').dataset.state === 'on'`, {what: 'the fake piano connected'});
      await page.eval(`window.pianoPlayer.setSection(0, 7); window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('right'); window.pianoPlayer.setLoop(false);
        window.__results = []; addEventListener('practice:result', e => __results.push(e.detail));
        window.__notes = []; addEventListener('piano:note', e => __notes.push(e.detail.note)); 1`);
      assert.equal(await page.eval(`document.getElementById('ctl-key').textContent`), 'C8', 'Settings names the control key');
      const before = await state(page);
      assert.equal(before.controlKey, C8);
      const tempo0 = before.tempo;

      // C8 with nothing running: start practising.
      await press(page, sleep, [C8]);
      await page.waitFor(`window.pianoPlayer.getState().practicing && document.querySelector('#player .pkey.attack')`, {what: 'C8 starts practising', timeout: 20000});

      // Play into the second bar, then three wrong notes: stuck, with the offer.
      for (let i = 0; i < 30 && (await state(page)).position < 5; i++) await press(page, sleep, await targets(page));
      const chord = await targets(page);
      const wrong = [];
      for (let n = 40; wrong.length < 3; n++) if (!chord.includes(n)) wrong.push(n);
      for (const n of wrong) await press(page, sleep, [n]);
      await page.waitFor(`document.getElementById('player').classList.contains('stuck') && document.querySelector('#um-practice-status [data-repair]')`, {what: 'the stuck hint with the offer'});
      const offerText = await page.eval(`document.querySelector('#um-practice-status [data-repair]').textContent`);
      assert.match(offerText, /^Loop bars? [\d–]+ slowly\? Press C8 \(your control key\) or tap here$/);
      const offer = (await state(page)).repairOffer;
      assert.ok(offer && offer[0] === 1, `the offer is the stuck bar (${JSON.stringify(offer)})`);

      // C8 accepts it: the bar alone, looping, Wait's tempo left alone.
      await press(page, sleep, [C8]);
      await page.waitFor(`window.pianoPlayer.getState().repair && window.pianoPlayer.getState().practicing`, {what: 'the repair loop'});
      let st = await state(page);
      assert.deepEqual(st.section, offer, 'the section is the stuck bar');
      assert.equal(st.loop, true, 'loop on');
      assert.equal(st.tempo, tempo0, 'Wait keeps the tempo');
      assert.deepEqual(st.repair.original.section, [0, 7]);
      assert.match(await page.eval(`document.getElementById('um-status').textContent`), /^Repair loop · Bars? [\d–]+ · clean 0 of 3$/);
      assert.match(await page.eval(`document.getElementById('um-strategy').textContent`), /Repair loop · bars? [\d–]+ · End loop/);
      const startPos = st.position;

      // C8 during the loop restarts the pass: one note in, then back to the first.
      await press(page, sleep, await targets(page));
      await press(page, sleep, [C8]);
      await page.waitFor(`window.pianoPlayer.getState().practicing && window.pianoPlayer.getState().position === ${startPos}`, {what: 'the pass restarted'});

      // Three clean passes, then it ends by itself.
      for (let i = 0; i < 80 && (await state(page)).repair; i++) {
        const notes = await targets(page);
        if (notes.length) await press(page, sleep, notes); else await sleep(80);
      }
      await page.waitFor(`!window.pianoPlayer.getState().repair && window.pianoPlayer.getState().practicing`, {what: 'the repair loop finished and practice resumed'});
      st = await state(page);
      assert.deepEqual(st.section, [0, 7], 'the original section is back');
      assert.equal(st.loop, false, 'the loop setting is back');
      assert.equal(st.tempo, tempo0, 'the tempo is back');
      const after = (offer[1] + 1) * 4; // 4/4, no pickup: bar index k starts at beat 4k
      assert.ok(st.position >= after - 1e-6 && st.position < after + 4, `resumed in the bar after the repaired one (at ${st.position}, expected bar from ${after})`);

      const results = await page.eval('__results');
      const repairs = results.filter(r => r.repair);
      assert.equal(repairs.length, 3, 'three repair passes reported');
      assert.ok(repairs.every(r => r.wrong === 0 && r.accuracy === 100), 'C8 never counted as a wrong note');
      assert.ok(repairs.every(r => r.section[0] === offer[0] && r.section[1] === offer[1]), 'repair results name the small section');
      assert.ok(!(await page.eval('__notes')).includes(C8), 'C8 is never announced as a note');
      await page.click('#um-play');
      await page.waitFor(`!window.pianoPlayer.getState().practicing`, {what: 'stopped'});
    },
  },
  {
    name: 'control key: End loop ends a repair loop early and puts everything back',
    async run({base, page: open, assert, catalog, sleep}) {
      const page = await open(VIEWPORTS.desktop);
      await page.send('Page.addScriptToEvaluateOnNewDocument', {source: FAKE_MIDI});
      const song = catalog.songs.find(s => s.id === 'ode-to-joy') || catalog.songs[0];
      await page.goto(base + '#/play/' + encodeURIComponent(song.id));
      await waitForSong(page);
      await page.eval(`document.getElementById('um-midi').click(); 1`);
      await page.waitFor(`document.getElementById('midi-chip').dataset.state === 'on'`, {what: 'the fake piano connected'});
      await page.eval(`window.pianoPlayer.setSection(0, 3); window.pianoPlayer.setMode('wait'); window.pianoPlayer.setHands('right'); window.pianoPlayer.setLoop(true); 1`);
      await page.click('#um-practice');
      await page.click('#um-play');
      await page.waitFor(`window.pianoPlayer.getState().practicing && document.querySelector('#player .pkey.attack')`, {what: 'practising', timeout: 20000});
      const chord = await targets(page);
      for (let n = 40, k = 0; k < 3; n++) if (!chord.includes(n)) { await press(page, sleep, [n]); k++; }
      await page.waitFor(`document.querySelector('#um-practice-status [data-repair]')`, {what: 'the offer'});
      await page.click('#um-practice-status [data-repair]'); // tapping the offer works too
      await page.waitFor(`window.pianoPlayer.getState().repair`, {what: 'the repair loop'});
      assert.deepEqual((await state(page)).section, [0, 0]);
      await page.click('#um-strategy');
      await page.waitFor(`!window.pianoPlayer.getState().repair`, {what: 'the loop ended'});
      const st = await state(page);
      assert.deepEqual(st.section, [0, 3]);
      assert.equal(st.loop, true, 'the loop setting as it was');
      assert.equal(st.practicing, false);
      assert.match(await page.eval(`document.getElementById('um-practice-status').textContent`), /Loop ended/);
      assert.equal(await page.eval(`document.getElementById('um-strategy').hidden`), true);
    },
  },
];
