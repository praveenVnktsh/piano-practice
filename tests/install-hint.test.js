// "Add to Home Screen" hint on the public site (src/pwa/install-hint.js).
import {describe, expect, test} from 'vitest';
import {isIosSafari, shouldShowInstallHint} from '../src/pwa/install-hint.js';

const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';

describe('Add to Home Screen hint', () => {
  test('iPad Safari (which says Macintosh, with touch) and iPhone Safari', () => {
    expect(isIosSafari(IPAD, 5)).toBe(true);
    expect(isIosSafari(IPAD, 0)).toBe(false); // a real Mac
    expect(isIosSafari(IPHONE, 5)).toBe(true);
    expect(isIosSafari(CHROME_IOS, 5)).toBe(false);
  });
  test('only on the public site, not installed, not dismissed', () => {
    expect(shouldShowInstallHint({ua: IPAD, touchPoints: 5})).toBe(true);
    expect(shouldShowInstallHint({ua: IPAD, touchPoints: 5, mac: true})).toBe(false);
    expect(shouldShowInstallHint({ua: IPAD, touchPoints: 5, standalone: true})).toBe(false);
    expect(shouldShowInstallHint({ua: IPAD, touchPoints: 5, dismissed: true})).toBe(false);
  });
});
