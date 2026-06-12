'use strict';

// Convert a source photo/artwork (JPG) into Chrome extension icon PNGs.
//
//   node tools/jpg-to-icons.js <input.jpg> <output-dir> [--transparent-bg] [--trim]
//
//   --transparent-bg  flood-fill near-white pixels connected to the image
//                     border to transparent (keeps enclosed white details)
//   --trim            crop to the artwork's bounding box, squared + padded
//
// Without flags the image is center-cropped to a square (for full-bleed art).
// Outputs icon16/32/48/128.png. Uses jpeg-js (devDependency) + built-in zlib.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const jpeg = require('jpeg-js');

// ---------- minimal PNG encoder (8-bit RGBA) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- image ops on {width, height, data(RGBA Buffer)} ----------

const WHITE_THRESHOLD = 228; // r,g,b all above => "background white"

function isWhite(img, x, y) {
  const i = (y * img.width + x) * 4;
  return img.data[i] >= WHITE_THRESHOLD &&
         img.data[i + 1] >= WHITE_THRESHOLD &&
         img.data[i + 2] >= WHITE_THRESHOLD;
}

// Flood fill from every border pixel: near-white pixels connected to the
// border become transparent. Enclosed white details are untouched.
function makeBackgroundTransparent(img) {
  const { width, height, data } = img;
  const visited = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) { stack.push(x, 0, x, height - 1); }
  for (let y = 0; y < height; y++) { stack.push(0, y, width - 1, y); }

  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (!isWhite(img, x, y)) continue;
    data[idx * 4 + 3] = 0;
    if (x > 0) stack.push(x - 1, y);
    if (x < width - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < height - 1) stack.push(x, y + 1);
  }
}

// Bounding box of opaque pixels, squared and padded, clamped to the image.
function trimToSquare(img, padRatio = 0.08) {
  const { width, height, data } = img;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img; // nothing opaque

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const side = Math.round(Math.max(bw, bh) * (1 + padRatio * 2));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const left = Math.round(cx - side / 2), top = Math.round(cy - side / 2);

  const out = { width: side, height: side, data: Buffer.alloc(side * side * 4) };
  for (let y = 0; y < side; y++) {
    const sy = top + y;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < side; x++) {
      const sx = left + x;
      if (sx < 0 || sx >= width) continue;
      data.copy(out.data, (y * side + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4);
    }
  }
  return out;
}

function centerCropSquare(img) {
  const side = Math.min(img.width, img.height);
  const left = Math.floor((img.width - side) / 2);
  const top = Math.floor((img.height - side) / 2);
  const out = { width: side, height: side, data: Buffer.alloc(side * side * 4) };
  for (let y = 0; y < side; y++) {
    img.data.copy(
      out.data, y * side * 4,
      ((top + y) * img.width + left) * 4,
      ((top + y) * img.width + left + side) * 4
    );
  }
  return out;
}

// Area-averaging downsample (box filter, alpha-premultiplied) — high quality
// for large shrink ratios.
function resizeTo(img, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = img.width / size; // square input
  for (let y = 0; y < size; y++) {
    const y0 = y * scale, y1 = (y + 1) * scale;
    for (let x = 0; x < size; x++) {
      const x0 = x * scale, x1 = (x + 1) * scale;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const hy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const w = hy * wx;
          const i = (sy * img.width + sx) * 4;
          const pa = img.data[i + 3] / 255;
          r += img.data[i] * pa * w;
          g += img.data[i + 1] * pa * w;
          b += img.data[i + 2] * pa * w;
          a += pa * w;
          area += w;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / area) * 255);
    }
  }
  return out;
}

// ---------- main ----------

const [, , input, outDir, ...flags] = process.argv;
if (!input || !outDir) {
  console.error('usage: node tools/jpg-to-icons.js <input.jpg> <output-dir> [--transparent-bg] [--trim]');
  process.exit(1);
}

let img = jpeg.decode(fs.readFileSync(input), { useTArray: false, formatAsRGBA: true });
img = { width: img.width, height: img.height, data: Buffer.from(img.data) };
console.log(`decoded ${input}: ${img.width}x${img.height}`);

if (flags.includes('--transparent-bg')) makeBackgroundTransparent(img);
img = flags.includes('--trim') ? trimToSquare(img) : centerCropSquare(img);
console.log(`canvas: ${img.width}x${img.height}`);

fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, size, resizeTo(img, size)));
  console.log(`wrote ${file} (${fs.statSync(file).size} bytes)`);
}
