/**
 * Icon generator (spec 94).
 *
 * Draws the launcher icon from code so the brand direction is reviewable and
 * reproducible: deep navy rounded square, a simplified white pay-cycle clock and
 * a red clock hand/checkmark accent. No dollar signs, coins, banks or maple
 * leaves. Renders at 2x and downsamples for anti-aliasing, then writes PNGs.
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAVY = [14, 27, 42];
const WHITE = [255, 255, 255];
const RED = [213, 43, 30];
const SUPERSAMPLE = 2;

function createCanvas(size) {
  return { size, data: new Uint8ClampedArray(size * size * 4) };
}

function blend(canvas, x, y, colour, alpha) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size || alpha <= 0) return;
  const index = (y * canvas.size + x) * 4;
  const a = Math.min(1, alpha);
  for (let channel = 0; channel < 3; channel += 1) {
    canvas.data[index + channel] = Math.round(canvas.data[index + channel] * (1 - a) + colour[channel] * a);
  }
  canvas.data[index + 3] = Math.max(canvas.data[index + 3], Math.round(255 * a));
}

/** Rounded square, used for the icon base. */
function roundedSquare(canvas, x, y, w, h, radius, colour) {
  for (let py = Math.floor(y); py < y + h; py += 1) {
    for (let px = Math.floor(x); px < x + w; px += 1) {
      const dx = Math.max(x + radius - px, px - (x + w - radius), 0);
      const dy = Math.max(y + radius - py, py - (y + h - radius), 0);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius) blend(canvas, px, py, colour, 1);
    }
  }
}

function circleRing(canvas, cx, cy, radius, thickness, colour, fromAngle = 0, toAngle = Math.PI * 2) {
  for (let py = Math.floor(cy - radius - thickness); py <= cy + radius + thickness; py += 1) {
    for (let px = Math.floor(cx - radius - thickness); px <= cx + radius + thickness; px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const edge = Math.abs(distance - radius);
      if (edge > thickness / 2) continue;
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += Math.PI * 2;
      if (angle < fromAngle || angle > toAngle) continue;
      const coverage = Math.min(1, thickness / 2 - edge + 0.5);
      blend(canvas, px, py, colour, coverage);
    }
  }
}

function roundRect(canvas, x, y, w, h, radius, colour) {
  for (let py = Math.floor(y); py <= y + h; py += 1) {
    for (let px = Math.floor(x); px <= x + w; px += 1) {
      const nearestX = Math.max(x + radius, Math.min(px, x + w - radius));
      const nearestY = Math.max(y + radius, Math.min(py, y + h - radius));
      const dx = px - nearestX;
      const dy = py - nearestY;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) blend(canvas, px, py, colour, 1);
    }
  }
}

function thickLine(canvas, x1, y1, x2, y2, thickness, colour) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(length * 2));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const cx = x1 + (x2 - x1) * t;
    const cy = y1 + (y2 - y1) * t;
    for (let py = Math.floor(cy - thickness); py <= cy + thickness; py += 1) {
      for (let px = Math.floor(cx - thickness); px <= cx + thickness; px += 1) {
        const distance = Math.hypot(px - cx, py - cy);
        if (distance > thickness / 2) continue;
        blend(canvas, px, py, colour, Math.min(1, thickness / 2 - distance + 0.6));
      }
    }
  }
}

/** The mark: pay-cycle clock + red hand/check. */
function drawMark(canvas, size, withBackground) {
  const centre = size / 2;
  if (withBackground) {
    roundedSquare(canvas, size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.22, NAVY);
  }
  const radius = size * 0.26;
  circleRing(canvas, centre, centre, radius, size * 0.058, WHITE, Math.PI * 0.15, Math.PI * 2 + Math.PI * 0.02);
  // clock hands
  thickLine(canvas, centre, centre, centre, centre - radius * 0.58, size * 0.05, WHITE);
  thickLine(canvas, centre, centre, centre + radius * 0.42, centre + radius * 0.1, size * 0.05, WHITE);
  // red accent: a check that reads as "your pay is right"
  thickLine(canvas, centre - radius * 0.06, centre + radius * 0.92, centre + radius * 0.3, centre + radius * 1.24, size * 0.052, RED);
  thickLine(canvas, centre + radius * 0.3, centre + radius * 1.24, centre + radius * 0.96, centre + radius * 0.5, size * 0.052, RED);
}

function downsample(canvas, factor) {
  const size = canvas.size / factor;
  const output = createCanvas(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const index = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          r += canvas.data[index];
          g += canvas.data[index + 1];
          b += canvas.data[index + 2];
          a += canvas.data[index + 3];
        }
      }
      const count = factor * factor;
      const out = (y * size + x) * 4;
      output.data[out] = Math.round(r / count);
      output.data[out + 1] = Math.round(g / count);
      output.data[out + 2] = Math.round(b / count);
      output.data[out + 3] = Math.round(a / count);
    }
  }
  return output;
}

// --- Minimal PNG encoder ---------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0 ^ -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(canvas) {
  const { size, data } = canvas;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size * 4; x += 1) {
      raw[y * (size * 4 + 1) + 1 + x] = data[y * size * 4 + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size, mode) {
  const canvas = createCanvas(size * SUPERSAMPLE);
  if (mode === 'foreground') {
    drawMark(canvas, canvas.size, false);
  } else if (mode === 'monochrome') {
    drawMark(canvas, canvas.size, false);
    for (let index = 0; index < canvas.data.length; index += 4) {
      const alpha = canvas.data[index + 3];
      canvas.data[index] = 255;
      canvas.data[index + 1] = 255;
      canvas.data[index + 2] = 255;
      canvas.data[index + 3] = alpha;
    }
  } else if (mode === 'mark-only') {
    drawMark(canvas, canvas.size, false);
  } else {
    drawMark(canvas, canvas.size, true);
  }
  return downsample(canvas, SUPERSAMPLE);
}

const outputs = [
  ['assets/icon.png', 1024, 'full'],
  ['assets/android-icon-foreground.png', 1024, 'foreground'],
  ['assets/android-icon-monochrome.png', 1024, 'monochrome'],
  ['assets/android-icon-background.png', 1024, 'background'],
  ['assets/splash-icon.png', 512, 'mark-only'],
  ['assets/favicon.png', 96, 'mark-only'],
];

for (const [path, size, mode] of outputs) {
  const canvas = mode === 'background' ? (() => {
    const c = createCanvas(size * SUPERSAMPLE);
    for (let py = 0; py < c.size; py += 1) {
      for (let px = 0; px < c.size; px += 1) blend(c, px, py, NAVY, 1);
    }
    return downsample(c, SUPERSAMPLE);
  })() : render(size, mode);
  writeFileSync(join(root, path), encodePng(canvas));
  console.log(`wrote ${path} (${size}x${size}, ${mode})`);
}
