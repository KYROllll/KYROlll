// The supplied SVG embeds a raster mask. Trace its actual alpha edges, including
// the petal gaps and center cutouts, rather than substituting a stock flower.
import sharp from 'sharp';
import { copyFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { brandedEmailHtml } from './worker/src/brand-email.js';

// Import once; subsequent builds use the checked-in reference, not Downloads.
const secondarySource = process.argv.indexOf('--secondary-source');
if (secondarySource !== -1) {
  if (!process.argv[secondarySource + 1]) throw new Error('Missing secondary logo source path');
  await copyFile(process.argv[secondarySource + 1], 'assets/logos/kyrolll-secondary-source.png');
}
const reference = await sharp('assets/logos/kyrolll-secondary-source.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: refWidth, height: refHeight } = reference.info;
// Separate the brown brush mark from the neutral gray lettering by color.
// Recover opacity against the reference's black background, retaining its
// original soft brush edges and brown hue rather than drawing a generic X.
let peakBrown = [0, 0, 0];
for (let i = 0; i < reference.data.length; i += 4) {
  const [r, g, b] = reference.data.subarray(i, i + 3);
  if (r > g * 1.1 && r > b * 1.15 && r > peakBrown[0]) peakBrown = [r, g, b];
}
if (!peakBrown[0]) throw new Error('Brown X not found in secondary reference');
for (const markOnly of [true, false]) {
  const pixels = Buffer.alloc(reference.data.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, alpha] = reference.data.subarray(i, i + 4);
    const brown = r > g * 1.1 && r > b * 1.15 && r > 3;
    if (markOnly && !brown) continue;
    const opacity = brown ? Math.min(1, r / peakBrown[0]) : Math.min(1, Math.max(r, g, b) / 102);
    if (opacity < .025) continue;
    pixels[i] = r / opacity; pixels[i + 1] = g / opacity; pixels[i + 2] = b / opacity;
    pixels[i + 3] = Math.round(alpha * opacity);
  }
  await sharp(pixels, { raw: { width: refWidth, height: refHeight, channels: 4 } })
    .trim({ background: '#00000000', threshold: 1 }).png()
    .toFile(markOnly ? 'assets/kyrolll-brown-x.png' : 'assets/kyrolll-secondary.png');
}

const size = 768;
const source = await sharp('assets/LOGO KYROlll.svg').resize(1024).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let left = 1024, top = 1024, right = 0, bottom = 0;
for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
  if (source.data[(y * 1024 + x) * 4 + 3] < 128) continue;
  left = Math.min(left, x); top = Math.min(top, y);
  right = Math.max(right, x); bottom = Math.max(bottom, y);
}
const { data } = await sharp(source.data, { raw: source.info })
  .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
  .resize(size - 32, size - 32, { fit: 'contain', background: '#00000000' })
  .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#00000000' })
  .raw().toBuffer({ resolveWithObject: true });
const solid = (x, y) => x >= 0 && y >= 0 && x < size && y < size && data[(y * size + x) * 4 + 3] >= 128;
const edges = new Map();
const key = (x, y) => y * (size + 1) + x;
const edge = (x, y, X, Y) => {
  const k = key(x, y);
  if (!edges.has(k)) edges.set(k, []);
  edges.get(k).push(key(X, Y));
};
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  if (!solid(x, y)) continue;
  if (!solid(x, y - 1)) edge(x, y, x + 1, y);
  if (!solid(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
  if (!solid(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
  if (!solid(x - 1, y)) edge(x, y + 1, x, y);
}
function simplify(points, tolerance = .7) {
  const a = points[0], b = points.at(-1);
  let max = tolerance * tolerance, at = 0;
  points.slice(1, -1).forEach((p, i) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const distance = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
    if (distance > max) { max = distance; at = i + 1; }
  });
  return at ? [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)] : [a, b];
}
const contours = [];
while (edges.size) {
  const start = edges.keys().next().value;
  let current = start;
  const points = [];
  do {
    points.push([current % (size + 1), Math.floor(current / (size + 1))]);
    const next = edges.get(current);
    if (!next) throw new Error('Open logo contour');
    const end = next.pop();
    if (!next.length) edges.delete(current);
    current = end;
  } while (current !== start);
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  if (Math.abs(area) > 30) contours.push({ area, points: simplify([...points, points[0]]).slice(0, -1) });
}
await writeFile('assets/kyrolll-contours.json', JSON.stringify({ size, contours }));
const path = contours.map(({ points }) => `M${points.map(p => p.join(',')).join('L')}Z`).join('');
const metallic = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 808 808">
<defs><linearGradient id="pearl" x1="0" y1="0" x2=".85" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#ffffff"/><stop offset=".28" stop-color="#e8e9e6"/><stop offset=".5" stop-color="#f7f7f5"/><stop offset=".72" stop-color="#d4d6d3"/><stop offset="1" stop-color="#eef0ed"/></linearGradient></defs>
<path d="${path}" fill="#c9cbc7" fill-rule="evenodd" stroke="#8f928e" stroke-width="4" transform="translate(7 11)"/>
<path d="${path}" fill="url(#pearl)" fill-rule="evenodd" stroke="#f2f3f1" stroke-width="2"/>
</svg>`;
await writeFile('assets/kyrolll-metal.svg', metallic);
await sharp(Buffer.from(metallic)).resize(640).png().toFile('assets/kyrolll-metal.png');
await sharp(Buffer.from(metallic)).resize(640).flatten({ background: '#080809' }).jpeg({ quality: 92 }).toFile('assets/kyrolll-social.jpg');
await sharp('assets/kyrolll-doodles.svg').resize(1200, 152, { fit: 'cover', position: 'top' }).flatten({ background: '#080809' }).png().toFile('assets/kyrolll-email-doodles.png');
await build({ entryPoints: ['brand-logo.js'], outfile: 'assets/brand-logo.min.js', bundle: true, minify: true, format: 'esm', target: ['es2020'], legalComments: 'eof' });
await build({ entryPoints: ['background-x.js'], outfile: 'assets/background-x.min.js', bundle: true, minify: true, format: 'esm', target: ['es2020'], legalComments: 'eof' });
// A reference template built with the same shell as live purchase emails.
await writeFile('email-template.html', brandedEmailHtml({
  title: 'Your sound. Unlocked.',
  eyebrow: 'KYROlll / ORDER CONFIRMED',
  subtitle: 'Payment verified · Your beats and licenses are ready.',
  content: `<p style="margin:0 0 12px;">Hey {{field:ArtistName}},</p>
<p style="margin:0 0 22px;">Thank you for choosing <strong>KYROlll</strong>. Your next creation starts with these files.</p>
<div style="padding:18px;background-color:#17171a;border:1px solid #38383e;">
<h2 style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2px;color:#a4a4aa;">YOUR RECEIPT &amp; DOWNLOADS</h2>
{{field:PaymentDetailsHtml}}</div>
<h2 style="font-size:10px;letter-spacing:2px;color:#a4a4aa;margin:24px 0 10px;">LICENSE ATTACHMENTS</h2>
<p style="margin:0;font-size:12px;color:#a4a4aa;">Your purchased MP3, WAV, or exclusive license contracts are attached as PDF and text files. Keep them as proof of purchase.</p>
<p style="margin:16px 0 0;font-size:12px;color:#a4a4aa;">Follow the instructions inside each license attachment before using a beat in a release.</p>`
}));
console.log(`Built metallic artwork and 3D renderer from ${contours.length} source contours.`);
