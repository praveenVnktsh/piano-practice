// "Is the Mac's dev server behind this page?" (src/app/mac.js), decided without a request.
import {describe, expect, test} from 'vitest';
import {detectWhere, isLocalHost, isStaticOrigin} from '../src/app/mac.js';

const loc = href => new URL(href);

describe('Mac or static site', () => {
  test('the public site (https, public host) is static, even in a dev build', () => {
    expect(isStaticOrigin(loc('https://someone.github.io/piano-practice-site/'))).toBe(true);
    expect(detectWhere({dev: true, loc: loc('https://someone.github.io/piano-practice-site/')})).toBe('static');
    expect(detectWhere({dev: false, loc: loc('https://example.com/')})).toBe('static');
  });

  test('the dev server on the Mac or over the LAN is the Mac', () => {
    for (const href of ['http://localhost:5173/', 'http://127.0.0.1:5173/', 'http://[::1]:5173/', 'http://192.168.1.20:5173/', 'http://10.0.0.4:5173/', 'http://172.20.1.2:5173/', 'http://studio.local:5173/', 'https://192.168.1.20:5173/']) {
      expect(detectWhere({dev: true, loc: loc(href)}), href).toBe('mac');
    }
  });

  test('a built copy has no dev-server endpoints, wherever it is served (vite preview, LAN)', () => {
    expect(detectWhere({dev: false, loc: loc('http://127.0.0.1:4173/')})).toBe('static');
    expect(detectWhere({dev: false, loc: loc('http://192.168.1.20:8080/')})).toBe('static');
  });

  test('an override wins (tests); anything else is ignored', () => {
    expect(detectWhere({dev: false, loc: loc('http://127.0.0.1:4173/'), override: 'mac'})).toBe('mac');
    expect(detectWhere({dev: true, loc: loc('http://localhost:5173/'), override: 'static'})).toBe('static');
    expect(detectWhere({dev: true, loc: loc('http://localhost:5173/'), override: 'bogus'})).toBe('mac');
  });

  test('local and private hosts', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('172.15.0.1')).toBe(false);
    expect(isLocalHost('172.31.255.1')).toBe(true);
    expect(isLocalHost('fd12:3456::1')).toBe(true);
    expect(isLocalHost('github.io')).toBe(false);
    expect(isLocalHost('')).toBe(false);
    expect(isStaticOrigin(undefined)).toBe(false);
    expect(isStaticOrigin(loc('http://example.com/'))).toBe(false); // plain http: leave it to the build flag
  });
});
