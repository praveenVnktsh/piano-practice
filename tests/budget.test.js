import {describe, expect, it} from 'vitest';
import {allowedLayers, decodedBytes, formatBytes, isAppleMobile, isSmallMemoryDevice, layerLoadOrder, nearestLayer, pianoProfile} from '../src/audio/budget.js';
import manifest from '../src/audio/sample-manifest.json';

const centres = manifest.grand.layers.map(l => l.centre); // [.315, .421, .602, .791, .976]
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('small-memory devices', () => {
  it('trusts navigator.deviceMemory when reported', () => {
    expect(isSmallMemoryDevice({deviceMemory: 4, userAgent: MAC_CHROME})).toBe(true);
    expect(isSmallMemoryDevice({deviceMemory: 2})).toBe(true);
    expect(isSmallMemoryDevice({deviceMemory: 8, userAgent: MAC_CHROME})).toBe(false);
    // deviceMemory beats the UA guess
    expect(isSmallMemoryDevice({deviceMemory: 8, userAgent: IPHONE})).toBe(false);
  });
  it('falls back to an iPad / iPhone UA heuristic (Safari has no deviceMemory)', () => {
    expect(isAppleMobile({userAgent: IPAD, maxTouchPoints: 5})).toBe(true);
    expect(isAppleMobile({userAgent: IPAD, maxTouchPoints: 0})).toBe(false); // a real Mac
    expect(isSmallMemoryDevice({userAgent: IPAD, maxTouchPoints: 5})).toBe(true);
    expect(isSmallMemoryDevice({userAgent: IPHONE})).toBe(true);
    expect(isSmallMemoryDevice({userAgent: MAC_CHROME})).toBe(false);
    expect(isSmallMemoryDevice({})).toBe(false);
  });
  it('profile: explicit setting wins, auto asks the device', () => {
    expect(pianoProfile('light', {deviceMemory: 16})).toBe('light');
    expect(pianoProfile('full', {userAgent: IPHONE})).toBe('full');
    expect(pianoProfile('auto', {userAgent: IPHONE})).toBe('light');
    expect(pianoProfile('auto', {userAgent: MAC_CHROME, deviceMemory: 8})).toBe('full');
    expect(pianoProfile(undefined, {})).toBe('full');
  });
});

describe('layer selection', () => {
  it('desktop keeps every layer', () => {
    expect(allowedLayers(5, 'full')).toEqual([0, 1, 2, 3, 4]);
  });
  it('the lighter piano keeps three layers spread from softest to loudest', () => {
    expect(allowedLayers(5, 'light')).toEqual([0, 2, 4]);
    expect(allowedLayers(16, 'light')).toEqual([0, 8, 15]);
    expect(allowedLayers(5, 'light', {lightCount: 2})).toEqual([0, 4]);
    expect(allowedLayers(5, 'light', {lightCount: 1})).toEqual([2]);
    expect(allowedLayers(3, 'light')).toEqual([0, 1, 2]);
    expect(allowedLayers(1, 'light')).toEqual([0]);
    expect(allowedLayers(0, 'light')).toEqual([]);
  });
  it('loads the layer nearest mezzo forte first, then the others nearest-first', () => {
    expect(nearestLayer(centres, [0, 1, 2, 3, 4])).toBe(2);
    expect(layerLoadOrder(centres, [0, 1, 2, 3, 4])).toEqual([2, 1, 3, 0, 4]);
    expect(layerLoadOrder(centres, allowedLayers(5, 'light'))).toEqual([2, 0, 4]);
    expect(layerLoadOrder(centres, [0, 4])).toEqual([0, 4]); // .315 is nearer .6 than .976
    expect(layerLoadOrder(centres, [0, 4], {first: .9})).toEqual([4, 0]);
    expect(layerLoadOrder(centres, [])).toEqual([]);
  });
  it('every velocity still has a layer in the lighter piano', async () => {
    const {layerWeights} = await import('../src/audio/layers.js');
    const ok = new Set(allowedLayers(5, 'light'));
    const available = centres.map((c, i) => ok.has(i));
    for (let v = 0; v <= 1; v += .05) {
      const w = layerWeights(v, centres, {available});
      expect(w.length).toBeGreaterThan(0);
      for (const {layer} of w) expect(ok.has(layer)).toBe(true);
    }
  });
});

describe('memory', () => {
  it('sums decoded buffers at 4 bytes per sample per channel', () => {
    expect(decodedBytes([{length: 48000, numberOfChannels: 1}, {length: 1000, numberOfChannels: 2}])).toBe(48000 * 4 + 8000);
    expect(decodedBytes([null, {}, {length: 10}])).toBe(40);
    expect(decodedBytes(undefined)).toBe(0);
  });
  it('a Salamander layer (~277 s mono at 48 kHz) is about 50 MB', () => {
    expect(formatBytes(decodedBytes([{length: 277 * 48000, numberOfChannels: 1}]))).toBe('50.7 MB');
  });
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});
