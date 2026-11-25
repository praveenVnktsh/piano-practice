// @vitest-environment jsdom
import {describe, expect, it, vi, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWakeLock} from '../src/pwa/wakelock.js';
import {summarize, FORMAT} from '../src/pwa/backup.js';
import {precacheList} from '../src/pwa/plugin.js';
import {sanitizeStatus} from '../midi-relay/plugin.js';
import {describe as describeRelay, pageId} from '../src/midi-relay.js';

function fakeWakeLock() {
  const lock = {requests: 0, active: null};
  lock.api = {
    request: async () => {
      lock.requests++;
      const listeners = [];
      const s = {released: false, addEventListener: (t, fn) => listeners.push(fn), release: async () => { s.released = true; lock.active = null; listeners.forEach(fn => fn()); }};
      lock.active = s;
      return s;
    },
  };
  return lock;
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('wake lock', () => {
  let wl;
  afterEach(() => { wl?.destroy(); document.body.innerHTML = ''; location.hash = ''; });

  it('holds the screen while the player is listening or practising, and lets go elsewhere', async () => {
    document.body.innerHTML = '<div id="player" class="app"></div>';
    const lock = fakeWakeLock();
    let t = 1000;
    wl = createWakeLock({nav: {wakeLock: lock.api}, graceMs: 60000, now: () => t});
    expect(wl.state().wanted).toBe(false);
    location.hash = '#/play/fur-elise';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(wl.state().held).toBe(true);
    document.getElementById('player').classList.add('playing');
    await flush();
    t += 120000; // long after the grace period, still playing
    wl.update(); await flush();
    expect(wl.state().held).toBe(true);
    document.getElementById('player').classList.remove('playing');
    await flush();
    t += 120000;
    wl.update(); await flush();
    expect(wl.state().held).toBe(false);
    expect(lock.active).toBe(null);
  });

  it('keeps the drill awake and honours holdAwake()', async () => {
    const lock = fakeWakeLock();
    let t = 0;
    wl = createWakeLock({nav: {wakeLock: lock.api}, graceMs: 1000, now: () => t});
    location.hash = '#/train/reading';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    expect(wl.state().held).toBe(true);
    location.hash = '#/progress';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    t = 5000; wl.update(); await flush();
    expect(wl.state().held).toBe(false);
    const release = wl.holdAwake('page-turn');
    await flush();
    expect(wl.state().held).toBe(true);
    release(); await flush();
    expect(wl.state().held).toBe(false);
  });

  it('falls back to a muted inline video without the Wake Lock API', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    wl = createWakeLock({nav: {}, videoSrc: 'data:video/mp4;base64,', now: () => 0});
    location.hash = '#/train/reading';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flush();
    const video = document.querySelector('video');
    expect(video.muted && video.loop && video.hasAttribute('playsinline')).toBe(true);
    expect(wl.state()).toMatchObject({held: true, method: 'video'});
    wl.destroy(); wl = null;
    expect(pause).toHaveBeenCalled();
    play.mockRestore(); pause.mockRestore();
  });
});

describe('backup file validation (browser)', () => {
  const ok = {format: FORMAT, version: 1, exportedAt: '2026-11-24T10:00:00Z', server: {data: {'progress.json': {events: [{}, {}], journal: [{}]}}, teacher: {'messages.jsonl': '{"id":1}\n', 'student.md': '#'}}, browser: {localStorage: {'piano-practice.theme': 'dark', 'trainer:reading:stats': '{}'}, imports: []}};
  it('summarises a good backup', () => {
    expect(summarize(ok)).toMatchObject({events: 2, journal: 1, teacherMessages: 1, teacherProfile: true, settings: 2, hasServer: true});
  });
  it('rejects other files and foreign settings', () => {
    expect(() => summarize({hello: 1})).toThrow(/not a Piano Practice backup/);
    expect(() => summarize({...ok, version: 7})).toThrow(/newer version/);
    expect(() => summarize({...ok, browser: {localStorage: {'other-app.token': 'x'}}})).toThrow(/settings/);
    expect(() => summarize({...ok, browser: {imports: [{id: 'nope'}]}})).toThrow(/damaged/);
  });
});

describe('offline cache precache list', () => {
  it('lists built files, skips private songs and the worker, and versions by content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pp-sw-'));
    try {
      for (const f of ['index.html', 'assets/index-abc.js', 'samples/piano/A0.mp3', 'songs/a.musicxml', 'songs/local/secret.musicxml', 'sw.js']) {
        mkdirSync(join(dir, f, '..'), {recursive: true});
        writeFileSync(join(dir, f), f);
      }
      const a = precacheList(dir, {includeLocal: false});
      expect(a.files).toEqual(['assets/index-abc.js', 'index.html', 'samples/piano/A0.mp3', 'songs/a.musicxml']);
      writeFileSync(join(dir, 'songs/a.musicxml'), 'changed');
      expect(precacheList(dir, {includeLocal: false}).version).not.toBe(a.version);
      expect(precacheList(dir, {includeLocal: true}).files).toContain('songs/local/secret.musicxml');
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
});

describe('MIDI relay status', () => {
  it('sanitises the bridge heartbeat', () => {
    const s = sanitizeStatus({bridge: 1, devices: ['FP-30', 42], latency: {abc123: 12.345, '../x': 5, def456: -1}}, 7);
    expect(s).toEqual({bridge: true, devices: ['FP-30', '42'], latency: {abc123: 12.3}, heartbeatMs: 3000, at: 7});
  });
  it('describes each state for the iPad', () => {
    const base = {bridge: true, devices: ['FP-30'], latency: {[pageId]: 8.6}, at: 1};
    expect(describeRelay({server: base, connected: false, fresh: true})).toMatchObject({state: 'reconnecting', bridge: false, label: 'Mac relay: reconnecting…'});
    expect(describeRelay({server: {...base, at: 0}, connected: true, fresh: false}).state).toBe('waiting');
    expect(describeRelay({server: base, connected: true, fresh: false})).toMatchObject({state: 'stale', bridge: false});
    expect(describeRelay({server: base, connected: true, fresh: true})).toMatchObject({state: 'connected', bridge: true, devices: ['FP-30'], latencyMs: 8.6, label: 'Mac relay: connected · FP-30 · 9 ms'});
    expect(describeRelay({server: {...base, bridge: false, devices: []}, connected: true, fresh: true}).state).toBe('no-piano');
    expect(describeRelay({server: {...base, bridge: false, devices: [], reason: 'bridge-closed'}, connected: true, fresh: true}).state).toBe('waiting');
  });
});
