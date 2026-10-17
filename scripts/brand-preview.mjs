// Contact sheet for the shipped brand assets: every file, at the sizes it is used
// at, on the two surfaces it has to survive. Run with `npm run brand:preview`;
// output lands in preview/ and is gitignored.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(ROOT, 'src', 'assets', 'brand');
const OUT = join(ROOT, 'preview');
mkdirSync(OUT, { recursive: true });

const read = (name) => readFileSync(join(BRAND, name), 'utf8');

// Take the markup out of a 24-grid asset and give its mask ids a tile-unique suffix.
let tile = 0;
const body = (svg) => {
  tile += 1;
  return svg
    .slice(svg.indexOf('>') + 1)
    .replace('</svg>', '')
    .replace(/td-crescent/g, 'td-c' + tile)
    .replace(/td-cut/g, 'td-k' + tile);
};

// Draw one asset at a true size, magnified by `zoom` without resampling.
const art = (svg, size, x, y, zoom = 2) =>
  `<g transform="translate(${x} ${y}) scale(${zoom * (size / 24)})">${body(svg)}</g>`;

const label = (text, x, y, dim) =>
  `<text x="${x}" y="${y}" font-family="Segoe UI" font-size="11" fill="${dim}">${text}</text>`;

const mark = read('tabdorm-mark.svg');
const mono = read('tabdorm-mark-mono.svg');
const lockDark = read('tabdorm-lockup-dark.svg');
const lockLight = read('tabdorm-lockup-light.svg');

const sheet = (bg, ink, dim, lockup) => {
  const size = (text, x, y, colour) =>
    `<text x="${x}" y="${y}" font-family="Segoe UI" font-size="11" fill="${colour}">${text}</text>`;

  return `
    ${size('mark - 16 / 24 / 32 / 48 px, 2x', 24, 30, dim)}
    ${art(mark, 16, 24, 44)}
    ${art(mark, 24, 78, 44)}
    ${art(mark, 32, 136, 44)}
    ${art(mark, 48, 216, 44)}

    ${size('mono - single colour, crescent cut through', 24, 190, dim)}
    ${art(mono.replace(/currentColor/g, ink), 16, 24, 204)}
    ${art(mono.replace(/currentColor/g, ink), 24, 78, 204)}
    ${art(mono.replace(/currentColor/g, ink), 32, 136, 204)}
    ${art(mono.replace(/currentColor/g, '#6f9fae'), 32, 216, 204)}

    ${size('lockup - 1x and 2x', 24, 330, dim)}
    <g transform="translate(24 344)">${body(lockup)}</g>
    <g transform="translate(24 392) scale(2)">${body(lockup)}</g>
  `;
};

const render = (bg) =>
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="490" viewBox="0 0 640 490">` +
      `<rect width="640" height="490" fill="${bg}"/>` +
      sheet(bg, bg === '#0e0f11' ? '#f4f1ea' : '#17120a', bg === '#0e0f11' ? '#a9a49b' : '#5c5c5c', bg === '#0e0f11' ? lockDark : lockLight) +
      '</svg>',
  ).render().asPng();

writeFileSync(join(OUT, 'brand-sheet-dark.png'), render('#0e0f11'));
writeFileSync(join(OUT, 'brand-sheet-light.png'), render('#f4f1ea'));
console.log('brand sheets in', OUT);
