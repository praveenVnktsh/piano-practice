// @vitest-environment jsdom
// The MIDI bridge (src/relay/): pure state, the one-relaying-source rule, "prefer local over
// relay", and the core run against a fake Web MIDI and a fake relay socket.
import {describe, expect, it, vi} from 'vitest';
import {
  arbitrate, formatMs, initialState, isAppleTouch, latencyQuality, median, needsPianoHint, pageList, pagesSummary,
  pianoStatus, preferLocal, reduceBridge,
} from '../src/relay/bridge-state.js';
import {MIDI_GRANTED_EVENT, createBridge} from '../src/relay/bridge-core.js';
import {pagesHTML} from '../src/app/ipad-link.js';

describe('bridge state', () => {
  it('reduces server, midi, notes, pages and role events', () => {
    let s = initialState(true);
    expect(s).toMatchObject({server: true, midi: 'off', devices: [], notesSent: 0, role: 'idle', pages: []});
    s = reduceBridge(s, {type: 'midi', midi: 'on', devices: ['FP-30']});
    s = reduceBridge(s, {type: 'note', note: 60});
    s = reduceBridge(s, {type: 'note', note: 64});
    expect(s).toMatchObject({midi: 'on', devices: ['FP-30'], notesSent: 2, lastNote: 64});
    expect(reduceBridge(s, {type: 'midi', devices: []}).midi).toBe('none');
    expect(reduceBridge(s, {type: 'server', up: false}).server).toBe(false);
    expect(reduceBridge(s, {type: 'role', role: 'standby', other: {source: 'b', devices: ['FP-30']}}).other).toEqual({source: 'b', devices: ['FP-30']});
    expect(reduceBridge(s, {type: 'role', role: 'relaying', other: {source: 'b'}}).other).toBe(null);
    expect(reduceBridge(s, {type: 'nonsense'})).toBe(s);
  });

  it('formats latency with good / fair / poor', () => {
    expect([latencyQuality(12), latencyQuality(45), latencyQuality(120), latencyQuality(null)]).toEqual(['good', 'fair', 'poor', 'poor']);
    expect(formatMs(8.6)).toBe('9 ms');
    expect(formatMs(null)).toBe('—');
    expect(median([30, 10, 20])).toBe(20);
    expect(median([])).toBe(null);
    const pages = new Map([['a', {label: 'iPad Safari', samples: [10, 14, 12], seen: 100}], ['b', {label: 'Old', samples: [5], seen: 0}]]);
    const list = pageList(pages, 8050);
    expect(list).toEqual([{id: 'a', label: 'iPad Safari', ms: 12, quality: 'good', samples: 3}]);
    expect(pages.has('b')).toBe(false);
    expect(pagesSummary(list)).toBe('iPad Safari · 12 ms');
    expect(pagesSummary([])).toBe('No iPad connected yet');
    expect(pagesSummary([...list, {label: 'iPhone', ms: 40}])).toBe('2 pages · up to 40 ms');
    expect(pagesHTML(list)).toContain('data-q="good"');
    expect(pagesHTML([{label: '<b>', ms: 1, quality: 'good'}])).not.toContain('<b>');
  });

  it('says what the piano is doing, with one action', () => {
    const s = initialState(true);
    expect(pianoStatus(s)).toEqual({tone: '', text: 'Piano not connected', action: 'connect'});
    expect(pianoStatus({...s, server: false}).action).toBe(null);
    expect(pianoStatus({...s, midi: 'blocked'}).action).toBe('connect');
    expect(pianoStatus({...s, midi: 'none'}).action).toBe('refresh');
    expect(pianoStatus({...s, midi: 'on', role: 'relaying', devices: ['FP-30'], notesSent: 42})).toEqual({tone: 'on', text: 'Relaying FP-30 · 42 notes', action: 'refresh'});
    expect(pianoStatus({...s, midi: 'on', role: 'relaying', devices: ['FP-30'], notesSent: 1}).text).toBe('Relaying FP-30 · 1 note');
    expect(pianoStatus({...s, midi: 'on', role: 'standby', other: {devices: ['FP-30']}}).text).toBe('Another tab is relaying FP-30 · this one stands by');
  });
});

describe('one relaying source', () => {
  const other = (source, seenAt = 1000) => ({source, bridge: true, seenAt});
  it('relays when nobody else does', () => {
    expect(arbitrate({id: 'm', hasInputs: true, role: 'idle', other: null, now: 1000})).toBe('relaying');
    expect(arbitrate({id: 'm', hasInputs: false, role: 'idle', other: null, now: 1000})).toBe('idle');
  });
  it('stands by while another bridge relays, and takes over when it goes quiet', () => {
    expect(arbitrate({id: 'z', hasInputs: true, role: 'idle', other: other('a'), now: 2000})).toBe('standby');
    expect(arbitrate({id: 'a', hasInputs: true, role: 'idle', other: other('z'), now: 2000})).toBe('standby'); // not relaying yet: defer
    expect(arbitrate({id: 'z', hasInputs: true, role: 'standby', other: other('a'), now: 1000 + 10000})).toBe('relaying');
    expect(arbitrate({id: 'z', hasInputs: true, role: 'standby', other: {...other('a'), bridge: false}, now: 2000})).toBe('relaying');
  });
  it('breaks a tie (both relaying) by the lower id', () => {
    expect(arbitrate({id: 'a', hasInputs: true, role: 'relaying', other: other('z'), now: 2000})).toBe('relaying');
    expect(arbitrate({id: 'z', hasInputs: true, role: 'relaying', other: other('a'), now: 2000})).toBe('standby');
  });
  it('ignores its own heartbeat', () => {
    expect(arbitrate({id: 'a', hasInputs: true, role: 'idle', other: other('a'), now: 2000})).toBe('relaying');
  });
});

describe('prefer local over relay', () => {
  it('ignores the relay when it carries a keyboard this page already reads', () => {
    expect(preferLocal({localNames: ['FP-30'], relayDevices: ['FP-30']})).toBe(true);
    expect(preferLocal({localNames: ['fp-30 '], relayDevices: ['FP-30']})).toBe(true);
    expect(preferLocal({localNames: ['FP-30'], relayDevices: []})).toBe(true);
  });
  it('keeps the relay with no local input, or for another keyboard', () => {
    expect(preferLocal({localNames: [], relayDevices: ['FP-30']})).toBe(false);
    expect(preferLocal({localNames: ['FP-30'], relayDevices: ['Clavinova']})).toBe(false);
  });
});

describe('no-piano hint', () => {
  it('shows once on an iPad without Web MIDI or a relay', () => {
    expect(needsPianoHint({webMidi: false, relayState: 'waiting', dismissed: false})).toBe(true);
    expect(needsPianoHint({webMidi: false, relayState: 'connected', dismissed: false})).toBe(false);
    expect(needsPianoHint({webMidi: true, relayState: 'waiting', dismissed: false})).toBe(false);
    expect(needsPianoHint({webMidi: false, relayState: 'waiting', dismissed: true})).toBe(false);
    expect(needsPianoHint({webMidi: false, relayState: '', dismissed: false, apple: false})).toBe(false);
  });
  it('knows an iPad (which says it is a Mac) from a Mac', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(isAppleTouch({userAgent: mac, maxTouchPoints: 5})).toBe(true);
    expect(isAppleTouch({userAgent: mac, maxTouchPoints: 0})).toBe(false);
    expect(isAppleTouch({userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'})).toBe(true);
  });
});

// ───────── the core with fakes ─────────

function fakeInput(name = 'FP-30') {
  const t = new EventTarget();
  return Object.assign(t, {id: name, name, state: 'connected', onmidimessage: null,
    send(data) { // like a MIDIInput: the onmidimessage handler and every listener
      const e = Object.assign(new Event('midimessage'), {data: new Uint8Array(data)});
      t.onmidimessage?.(e);
      t.dispatchEvent(e);
    }});
}
function fakeMidi(inputs) {
  const access = Object.assign(new EventTarget(), {inputs: new Map(inputs.map(i => [i.id, i])), outputs: new Map()});
  return {access, nav: {requestMIDIAccess: vi.fn(async () => access), permissions: {query: async () => ({state: 'granted'})}}};
}
function fakeRelay(id = 'mmm') {
  const r = {
    available: true, id, sent: [], statuses: [], status: null, probe: null, timers: [],
    sendMidi: b => r.sent.push(b), sendStatus: s => r.statuses.push(s),
    onServerStatus: fn => { r.status = fn; return () => {}; },
    onServerConnection: () => () => {},
    startLatencyProbe: fn => { r.probe = fn; return () => {}; },
  };
  return r;
}
function fakeClock() {
  const c = {t: 0, jobs: [], now: () => c.t, every: (fn, ms) => { c.jobs.push({fn, ms}); return () => {}; },
    tick(ms) { c.t += ms; for (const j of c.jobs) if (j.ms <= ms) j.fn(); }};
  return c;
}

describe('bridge core', () => {
  it('relays notes from a connected keyboard and counts them', async () => {
    const input = fakeInput();
    const {nav} = fakeMidi([input]);
    const relay = fakeRelay(), clock = fakeClock();
    const granted = vi.fn();
    window.addEventListener(MIDI_GRANTED_EVENT, granted);
    const bridge = createBridge({relay, nav, win: window, clock}).start();
    const states = [];
    bridge.subscribe(s => states.push(s));
    expect(relay.statuses).toEqual([]); // 'connected' mode: silent until MIDI is allowed
    await bridge.connect();
    expect(granted).toHaveBeenCalled();
    expect(bridge.getState()).toMatchObject({midi: 'on', devices: ['FP-30'], role: 'relaying'});
    expect(relay.statuses.at(-1)).toMatchObject({bridge: true, devices: ['FP-30']});
    input.send([0x90, 60, 80]);
    input.send([0x80, 60, 0]);
    input.send([0xf8]); // clock: not relayed
    expect(relay.sent).toEqual([[0x90, 60, 80], [0x80, 60, 0]]);
    expect(bridge.getState()).toMatchObject({notesSent: 1, lastNote: 60});
    relay.probe({page: 'ipad1', label: 'iPad Safari', rttMs: 14});
    expect(bridge.getState().pages).toEqual([{id: 'ipad1', label: 'iPad Safari', ms: 14, quality: 'good', samples: 1}]);
    clock.tick(3000);
    expect(relay.statuses.at(-1).latency).toEqual({ipad1: 14});
    window.dispatchEvent(new Event('pagehide'));
    expect(relay.statuses.at(-1)).toEqual({bridge: false, devices: []});
    bridge.stop();
  });

  it('does not take onmidimessage from the player in the same tab', async () => {
    const input = fakeInput();
    const player = vi.fn();
    input.onmidimessage = player;
    const {nav} = fakeMidi([input]);
    const relay = fakeRelay();
    const bridge = createBridge({relay, nav, clock: fakeClock()}).start();
    await bridge.connect();
    input.send([0x90, 62, 70]);
    expect(input.onmidimessage).toBe(player);
    expect(player).toHaveBeenCalledTimes(1);
    expect(relay.sent).toHaveLength(1);
  });

  it('stands by while bridge.html relays, so no note goes out twice, then takes over', async () => {
    const input = fakeInput();
    const {nav} = fakeMidi([input]);
    const relay = fakeRelay('zzz'), clock = fakeClock();
    const bridge = createBridge({relay, nav, clock}).start();
    relay.status({bridge: true, devices: ['FP-30'], source: 'aaa'});
    await bridge.connect();
    expect(bridge.getState()).toMatchObject({role: 'standby', other: {source: 'aaa', devices: ['FP-30']}});
    input.send([0x90, 60, 80]);
    expect(relay.sent).toEqual([]);
    const beats = relay.statuses.length;
    clock.tick(3000);
    expect(relay.statuses.length).toBe(beats); // silent while standing by
    relay.status({bridge: false, devices: [], latency: {}, reason: 'bridge-closed', source: 'aaa'});
    expect(bridge.getState().role).toBe('relaying');
    expect(relay.statuses.at(-1)).toMatchObject({bridge: true});
    input.send([0x90, 64, 80]);
    expect(relay.sent).toEqual([[0x90, 64, 80]]);
  });

  it('yields when two start together and the other has the lower id', async () => {
    const input = fakeInput();
    const {nav} = fakeMidi([input]);
    const relay = fakeRelay('zzz');
    const bridge = createBridge({relay, nav, clock: fakeClock()}).start();
    await bridge.connect();
    expect(bridge.getState().role).toBe('relaying');
    relay.status({bridge: true, devices: ['FP-30'], source: 'aaa'});
    expect(bridge.getState().role).toBe('standby');
    relay.status({bridge: true, devices: ['FP-30'], source: 'zzz'}); // its own echo: ignored
    expect(bridge.getState().role).toBe('standby');
  });

  it('auto-connects when MIDI was allowed before, and reports blocked or missing MIDI', async () => {
    const {nav} = fakeMidi([fakeInput()]);
    const bridge = createBridge({relay: fakeRelay(), nav, clock: fakeClock()}).start();
    expect(await bridge.autoConnect()).toBe(true);
    await vi.waitFor(() => expect(bridge.getState().midi).toBe('on'));

    const blocked = createBridge({relay: fakeRelay(), nav: {requestMIDIAccess: async () => { throw new Error('no'); }}, clock: fakeClock()});
    await blocked.connect();
    expect(blocked.getState().midi).toBe('blocked');
    const none = createBridge({relay: fakeRelay(), nav: {}, clock: fakeClock()});
    await none.connect();
    expect(none.getState().midi).toBe('unsupported');
  });

  it('announces "no keyboard" from bridge.html (announceIdle: always), never from an untouched app tab', () => {
    const always = fakeRelay();
    createBridge({relay: always, nav: {}, clock: fakeClock(), announceIdle: 'always'}).start();
    expect(always.statuses).toEqual([{bridge: false, devices: [], latency: {}}]);
    const app = fakeRelay();
    createBridge({relay: app, nav: {}, clock: fakeClock()}).start();
    expect(app.statuses).toEqual([]);
  });
});

describe('the server keeps the sender', () => {
  it('passes a valid source id through and drops a bad one', async () => {
    const {sanitizeStatus} = await import('../midi-relay/plugin.js');
    expect(sanitizeStatus({bridge: true, devices: [], source: 'abc123'}, 1).source).toBe('abc123');
    expect(sanitizeStatus({bridge: true, devices: [], source: '../x'}, 1)).not.toHaveProperty('source');
  });
});

describe('Piano & iPad card (Today, Settings → This device)', () => {
  it('shows the piano with one button, the pages and the address on the Mac', async () => {
    sessionStorage.setItem('piano-practice.where', 'mac');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({addresses: ['http://192.168.1.20:5173/'], exposed: true}), {headers: {'content-type': 'application/json'}}));
    const {mountIpadLink} = await import('../src/app/ipad-link.js');
    const input = fakeInput();
    const {nav} = fakeMidi([input]);
    const relay = fakeRelay();
    const bridge = createBridge({relay, nav, clock: fakeClock()}).start();
    const box = document.createElement('div');
    document.body.append(box);
    const card = mountIpadLink(box, {bridge});
    await vi.waitFor(() => expect(card.el.hidden).toBe(false));
    const $ = s => card.el.querySelector(s);
    expect($('.ipl-piano .ipl-title').textContent).toBe('Piano & iPad');
    expect($('.ipl-status-text').textContent).toBe('Piano not connected');
    expect($('.ipl-connect').textContent).toBe('Connect piano');
    expect($('.ipl-connect').className).toContain('primary-btn');
    expect($('.ipl-qr')).not.toBe(null);
    expect($('.ipl-pages').textContent).toContain('No iPad connected yet');
    $('.ipl-connect').click();
    await vi.waitFor(() => expect($('.ipl-status-text').textContent).toBe('Relaying FP-30 · 0 notes'));
    input.send([0x90, 60, 80]);
    expect($('.ipl-status-text').textContent).toBe('Relaying FP-30 · 1 note');
    expect($('.ipl-connect').textContent).toBe('Refresh');
    expect($('.ipl-connect').className).toContain('quiet-btn');
    relay.probe({page: 'p1', label: 'iPad Safari (home screen)', rttMs: 55});
    expect($('.ipl-pages').textContent).toContain('iPad Safari (home screen)');
    expect($('.ipl-pages [data-q]').dataset.q).toBe('fair');

    const compact = mountIpadLink(box, {bridge, compact: true});
    await vi.waitFor(() => expect(compact.el.hidden).toBe(false));
    expect(compact.el.querySelector('.ipl-pages-line').textContent).toBe('iPad Safari (home screen) · 55 ms');
    expect(compact.el.querySelector('.ipl-qr')).toBe(null);
    card.destroy(); compact.destroy();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });
});
