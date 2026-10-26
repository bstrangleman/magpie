// Render the Magpie logo (web/public/favicon.svg) to PNG icons for the browser extension.
// Chrome needs PNG icons, and this avoids depending on an SVG rasteriser being installed.
//   node scripts/icons.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

type Pt = [number, number];
type Shape = { points: Pt[]; color: [number, number, number] };

// The same geometry as favicon.svg, in its 32×32 coordinate space.
const arc = (cx: number, cy: number, r: number, from: number, to: number, steps = 10): Pt[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

const roundedRect = (x: number, y: number, w: number, h: number, r: number): Pt[] => [
  ...arc(x + r, y + r, r, 180, 270),
  ...arc(x + w - r, y + r, r, 270, 360),
  ...arc(x + w - r, y + h - r, r, 0, 90),
  ...arc(x + r, y + h - r, r, 90, 180),
];

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

const SHAPES: Shape[] = [
  { points: roundedRect(0, 0, 32, 32, 8), color: hex('#171a21') },
  { points: [...arc(11.5, 8.5, 1.5, 180, 270), ...arc(20.5, 8.5, 1.5, 270, 360), [22, 26], [16, 21.8], [10, 26]], color: hex('#ffffff') },
  { points: [[16, 7], ...arc(20.5, 8.5, 1.5, 270, 360), [22, 26], [16, 21.8]], color: hex('#c9cfda') },
  {
    points: [[25, 3.2], [25.95, 5.55], [28.3, 6.5], [25.95, 7.45], [25, 9.8], [24.05, 7.45], [21.7, 6.5], [24.05, 5.55]],
    color: hex('#4cc3e6'),
  },
];

function inside([x, y]: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** RGBA pixels, 4×4 supersampled; the topmost shape under each sample wins. */
function render(size: number): Buffer {
  const SS = 4;
  const scale = 32 / size;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const pt: Pt = [(px + (sx + 0.5) / SS) * scale, (py + (sy + 0.5) / SS) * scale];
          for (let s = SHAPES.length - 1; s >= 0; s--) {
            if (inside(pt, SHAPES[s]!.points)) {
              const [cr, cg, cb] = SHAPES[s]!.color;
              r += cr;
              g += cg;
              b += cb;
              a++;
              break;
            }
          }
        }
      }
      const o = (py * size + px) * 4;
      if (a) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return out;
}

function png(size: number, rgba: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve(import.meta.dirname, '../extension/public/icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `${size}.png`), png(size, render(size)));
}
console.log(`Wrote icons to ${path.relative(process.cwd(), outDir)}`);
