// Renders the home-screen icons (public/icons/*.png) from the two SVGs with headless Chrome.
// Run after editing an SVG:  node src/pwa/make-icons.mjs
//   icon.svg           rounded, transparent corners → icon-192/512.png, favicon-32.png ("any")
//   icon-maskable.svg  full-bleed, art inside the safe zone → maskable-512.png, apple-touch-icon.png
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchChrome} from '../../tests/e2e/cdp.mjs';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/icons');
const OUT = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'favicon-32.png', 32],
  ['icon-maskable.svg', 'maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
];

const browser = await launchChrome();
try {
  for (const [src, name, size] of OUT) {
    const page = await browser.newPage({width: size, height: size});
    await page.send('Emulation.setDefaultBackgroundColorOverride', {color: {r: 0, g: 0, b: 0, a: 0}});
    const svg = readFileSync(join(DIR, src), 'utf8');
    const html = `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
    await page.goto('data:text/html;base64,' + Buffer.from(html).toString('base64'), {settle: 100});
    writeFileSync(join(DIR, name), await page.screenshot());
    page.close();
    console.log('wrote', name);
  }
} finally {
  await browser.close();
}
