// @vitest-environment jsdom
// src/record/store.js with the dev server's disk store. QA regression: a take saved while the
// Mac was unreachable was kept in the browser but missing from the list ("No takes yet").
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const take = (id, at) => ({v: 1, id, songId: 'ode-to-joy', title: 'Ode to Joy', name: 'Take 1', at, durationMs: 1000, notes: [[0, 60, 80, 400]]});
const json = body => ({ok: true, status: 200, statusText: 'OK', headers: new Headers({'content-type': 'application/json'}), json: async () => body});

let store, putFails, disk;
beforeEach(async () => {
  const mem = new Map();
  vi.stubGlobal('localStorage', {getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k)});
  vi.resetModules();
  putFails = true;
  disk = [];
  vi.stubGlobal('fetch', vi.fn(async (url, {method = 'GET'} = {}) => {
    if (method === 'PUT') {
      if (putFails) throw new TypeError('Failed to fetch'); // Wi-Fi gone, server restarting
      return json({take: {id: 'x'}});
    }
    return json({store: 'disk', takes: disk});
  }));
  store = await import('../src/record/store.js');
});
afterEach(() => vi.unstubAllGlobals());

describe('recordings store (disk mode)', () => {
  test('a take kept in the browser while the Mac was unreachable is still listed', async () => {
    await store.saveTake(take('takeaaaa01', 2000));
    const list = await store.listTakes('ode-to-joy');
    expect(list.map(m => m.id)).toEqual(['takeaaaa01']);
    expect(await store.listTakes()).toHaveLength(1);
    expect(await store.listTakes('fur-elise')).toHaveLength(0);
  });
  test('merges with the server list, newest first, without duplicates', async () => {
    await store.saveTake(take('takeaaaa01', 2000));
    disk = [{id: 'takebbbb02', songId: 'ode-to-joy', at: 3000}, {id: 'takeaaaa01', songId: 'ode-to-joy', at: 2000}];
    const list = await store.listTakes('ode-to-joy');
    expect(list.map(m => m.id)).toEqual(['takebbbb02', 'takeaaaa01']);
  });
});
