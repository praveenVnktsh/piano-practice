import {describe, expect, it} from 'vitest';
import {buildReport, formatReport} from '../src/diagnostics/report.js';

const full = {
  at: '2026-11-25T08:00:00.000Z',
  app: {version: '0.1.0', commit: 'abc1234', mode: 'dev server', url: 'http://192.168.1.5:5173/#/play/fur-elise'},
  device: {userAgent: 'Mozilla/5.0 (iPad)', platform: 'MacIntel', cores: 8, screen: '820×1180 @2x', standalone: true, smallMemory: true},
  midi: {status: 'unsupported', inputs: []},
  relay: {available: true, state: 'connected', devices: ['FP-30'], bridgeLatencyMs: 9.42, rttMs: 4.2},
  audio: {state: 'running', sampleRate: 48000, baseLatency: .005333, outputLatency: .0213, instrument: 'piano', latencyMs: 30},
  samples: {bytes: 160 * 1024 * 1024, sets: {grand: {profile: 'light', layers: 5, allowed: 3, ready: 2, releases: 88}, harpsichord: {ready: false}, fallback: {ready: false}}},
  storage: {usage: 12 * 1024 * 1024, quota: 1024 ** 3, persisted: false},
  errors: {sent: 2, dropped: 1, last: 'TypeError: x is undefined'},
};
const row = (sections, title, label) => sections.find(s => s.title === title)?.rows.find(([k]) => k === label)?.[1];

describe('diagnostics report', () => {
  it('labels every part', () => {
    const s = buildReport(full);
    expect(s.map(x => x.title)).toEqual(['App', 'MIDI', 'Mac relay', 'Audio', 'Samples', 'Storage', 'Device', 'Errors']);
    expect(row(s, 'App', 'Version')).toBe('0.1.0 (abc1234)');
    expect(row(s, 'MIDI', 'Web MIDI')).toMatch(/not supported/);
    expect(row(s, 'MIDI', 'Inputs')).toBe('none');
    expect(row(s, 'Mac relay', 'Relay')).toBe('connected');
    expect(row(s, 'Mac relay', 'Mac keyboards')).toBe('FP-30');
    expect(row(s, 'Mac relay', 'Round trip to the Mac')).toBe('4.2 ms');
    expect(row(s, 'Mac relay', 'Bridge → this page')).toBe('9.4 ms');
    expect(row(s, 'Audio', 'Sample rate')).toBe('48000 Hz');
    expect(row(s, 'Audio', 'Base latency')).toBe('5.3 ms');
    expect(row(s, 'Audio', 'Output latency')).toBe('21 ms');
    expect(row(s, 'Samples', 'Grand piano')).toBe('2 of 3 loaded · lighter piano: 3 of 5 layers');
    expect(row(s, 'Samples', 'Decoded sample memory')).toBe('160 MB');
    expect(row(s, 'Storage', 'Used')).toBe('12.0 MB');
    expect(row(s, 'Storage', 'Persistent')).toBe('no');
    expect(row(s, 'Device', 'Small-memory device')).toBe('yes');
    expect(row(s, 'Device', 'Memory')).toBe('not reported');
    expect(row(s, 'Errors', 'Reported this session')).toBe('2 (1 held back)');
  });
  it('copes with an empty or partial info object', () => {
    const s = buildReport({});
    expect(row(s, 'Mac relay', 'Relay')).toMatch(/not available/);
    expect(row(s, 'Audio', 'AudioContext')).toMatch(/not started/);
    expect(row(s, 'Audio', 'Sample rate')).toBe('—');
    expect(row(s, 'Samples', 'Grand piano')).toBe('—');
    expect(row(s, 'Storage', 'Used')).toBe('—');
    expect(s.find(x => x.title === 'Errors')).toBeUndefined();
    expect(() => formatReport(s)).not.toThrow();
  });
  it('lists MIDI inputs with their maker and odd states', () => {
    const s = buildReport({midi: {status: 'available', inputs: [{name: 'FP-30', manufacturer: 'Roland', state: 'connected'}, {name: 'X', state: 'disconnected'}]}});
    expect(row(s, 'MIDI', 'Inputs')).toBe('FP-30 (Roland); X · disconnected');
  });
  it('formats as aligned plain text', () => {
    const text = formatReport(buildReport(full));
    expect(text.startsWith('Piano practice diagnostics\n==========================\n')).toBe(true);
    expect(text).toMatch(/\nMac relay\n {2}Relay {2,}connected\n/);
    expect(text).toContain('User agent');
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.split('\n').filter(l => l.startsWith('  '));
    const col = l => l.slice(2).search(/ {2}\S/);
    expect(new Set(lines.map(col)).size).toBe(1); // values line up
  });
});
