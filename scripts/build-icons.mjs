// Rasterise the TabDorm mark into the PNG set the extension manifest needs.
// Chrome does not accept SVG for toolbar or store icons, so the SVG is the
// source of truth and this script is the only way the PNGs get produced.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src', 'assets', 'brand', 'tabdorm-mark.svg');
const OUT = join(ROOT, 'public', 'icon');
const SIZES = [16, 32, 48, 128];

const svgSource = readFileSync(SOURCE, 'utf8');
// The mark keeps 3.2 units of breathing room in a 24 grid, which is right for the
// panel but too timid for a 16 px toolbar slot. Icons therefore crop to a tighter
// square: artwork 17.6 of 20 units, so roughly 1 px of padding at 16 px.
const ICON_VIEWBOX = 'viewBox="2 2 20 20"';

// The source carries its own 24 px size and viewBox; replace both for the target.
const sized = (size) =>
  svgSource
    .replace(/ width="\d+"/, '')
    .replace(/ height="\d+"/, '')
    .replace(/ viewBox="[^"]*"/, ' ' + ICON_VIEWBOX)
    .replace('<svg ', `<svg width="${size}" height="${size}" `);

mkdirSync(OUT, { recursive: true });

const rows = [];
for (const size of SIZES) {
  const png = new Resvg(sized(size), {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng();

  // Assert the raster is exactly the size the manifest promises.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== size || height !== size) {
    throw new Error(`icon ${size}: rendered ${width}x${height}, expected ${size}x${size}`);
  }

  const file = join(OUT, `${size}.png`);
  writeFileSync(file, png);
  rows.push(`${size}x${size}  ${png.length} bytes  ${file.replace(ROOT + '/', '')}`);
}

console.log('TabDorm icons');
for (const row of rows) console.log('  ' + row);
