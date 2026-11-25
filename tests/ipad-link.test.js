import {describe, expect, it} from 'vitest';
import {ipadLinkHTML, isThisMac, qrSvg} from '../src/app/ipad-link.js';

describe('iPad link', () => {
  it('shows the first LAN address big, with the others and a QR code', () => {
    const html = ipadLinkHTML({addresses: ['http://192.168.1.20:5173/', 'http://10.0.0.4:5173/'], exposed: true});
    expect(html).toContain('http://192.168.1.20:5173<');
    expect(html).toContain('href="http://10.0.0.4:5173/"');
    expect(html).toContain('<svg class="ipl-qr"');
    expect(ipadLinkHTML({addresses: ['http://192.168.1.20:5173/'], exposed: true}, {qr: false})).not.toContain('<svg');
  });
  it('explains how to expose the server, or that there is no network', () => {
    expect(ipadLinkHTML({addresses: ['http://192.168.1.20:5173/'], exposed: false})).toContain('npm run dev:ipad');
    expect(ipadLinkHTML({addresses: [], exposed: true})).toContain('no Wi-Fi');
    expect(ipadLinkHTML(null)).toBe('');
  });
  it('escapes addresses', () => {
    expect(ipadLinkHTML({addresses: ['http://a"<b/'], exposed: true})).not.toContain('a"<b');
  });
  it('knows when it is on the Mac', () => {
    expect(isThisMac({hostname: 'localhost'})).toBe(true);
    expect(isThisMac({hostname: '127.0.0.1'})).toBe(true);
    expect(isThisMac({hostname: '192.168.1.20'})).toBe(false);
    expect(isThisMac({hostname: 'example.github.io'})).toBe(false);
  });
  it('draws a square QR code', () => {
    const svg = qrSvg('http://192.168.1.20:5173/');
    const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(w).toBe(h);
    expect(svg).toMatch(/<path d="M/);
  });
});
