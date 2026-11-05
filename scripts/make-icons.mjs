// Builds the PNG app icons from public/favicon.svg. Run with: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const svg = await readFile(pub('favicon.svg'));

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(pub(name));
  console.log('wrote', name);
}
