// Generates the EstateFlow icons: a white roof-and-flow monogram with a teal node on a navy→teal gradient.
// Run: node scripts/make-icons.mjs  (needs `npm i --no-save sharp`). CI runs it before every build.
import fs from 'node:fs';
import sharp from 'sharp';

fs.mkdirSync('assets', { recursive: true });
const S = 1024;
const defs = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B2A4A"/><stop offset="1" stop-color="#0F766E"/></linearGradient></defs>';
// Monogram: two rounded diagonal strokes forming an X, the upper-right arm ending in a cyan node.
const mark = (stroke = '#FFFFFF', node = '#2DD4BF', k = 1, ring = '#0B2A4A') => {
  const c = 512, s = (v) => c + (v - 50) * 10.24 * k; // 100-unit logo grid scaled to the canvas
  return `<g fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="${s(26)},${s(52)} ${s(50)},${s(29)} ${s(74)},${s(52)}" stroke-width="${82 * k}"/>
    <path d="M${s(32)} ${s(66)} C${s(41)} ${s(58)} ${s(47)} ${s(74)} ${s(56)} ${s(66)} S${s(68)} ${s(62)} ${s(70)} ${s(66)}" stroke-width="${72 * k}"/></g>
    <circle cx="${s(74)}" cy="${s(52)}" r="${66 * k}" fill="${node}" stroke="${ring}" stroke-width="${18 * k}"/>`;
};
const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${defs}${body}</svg>`);
const out = (name, body, size = S) => sharp(svg(body)).resize(size, size).png().toFile(`assets/${name}`);

const jobs = {
  'icon.png': `<rect width="${S}" height="${S}" fill="url(#g)"/>${mark()}`,
  'splash-icon.png': `<rect x="262" y="262" width="500" height="500" rx="140" fill="url(#g)"/>${mark('#FFFFFF', '#2DD4BF', 0.52, '#134E4A')}`,
  'android-icon-foreground.png': mark('#FFFFFF', '#2DD4BF', 0.78),
  'android-icon-background.png': `<rect width="${S}" height="${S}" fill="url(#g)"/>`,
  'android-icon-monochrome.png': mark('#000000', '#000000', 0.78, '#FFFFFF'),
};
for (const [n, b] of Object.entries(jobs)) await out(n, b);
await out('favicon.png', jobs['icon.png'], 48);
console.log('icons ready');
