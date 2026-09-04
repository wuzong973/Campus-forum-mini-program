// Generate scroll-top icon using pure Node.js (no external deps)
// Creates a minimal PNG file manually

const fs = require('fs');
const path = require('path');

const SIZE = 200;
const CX = 100;

// Create RGBA pixel buffer
const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);

function setPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

function drawLine(x1, y1, x2, y2, r, g, b, a, width) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  const halfW = Math.floor(width / 2);

  while (true) {
    for (let ox = -halfW; ox <= halfW; ox++) {
      for (let oy = -halfW; oy <= halfW; oy++) {
        if (ox * ox + oy * oy <= halfW * halfW + halfW) {
          setPixel(x1 + ox, y1 + oy, r, g, b, a);
        }
      }
    }
    if (x1 === x2 && y1 === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x1 += sx; }
    if (e2 < dx) { err += dx; y1 += sy; }
  }
}

function drawCircle(cx, cy, radius, r, g, b, a) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        setPixel(cx + x, cy + y, r, g, b, a);
      }
    }
  }
}

// Draw light gray circle background (#e1e1e1)
drawCircle(100, 100, 90, 225, 225, 225, 255);

const color = [50, 50, 50, 255];

// Vertical shaft: from (100, 170) to (100, 58)
drawLine(100, 170, 100, 58, ...color, 4);

// Arrowhead V: (80, 78) -> (100, 52) -> (120, 78)
drawLine(80, 78, 100, 52, ...color, 4);
drawLine(120, 78, 100, 52, ...color, 4);

// Horizontal bar near top: (76, 68) -> (124, 68)
drawLine(76, 68, 124, 68, ...color, 4);

// Build minimal PNG
function createPNG(width, height, rgbaData) {
  const zlib = require('zlib');

  function crc32(buf) {
    let crc = -1;
    const table = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const combined = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([len, combined, crc]);
  }

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - raw image data with filter byte 0 per row
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0; // filter none
    rgbaData.copy(rawData, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(rawData);

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend)
  ]);
}

const png = createPNG(SIZE, SIZE, pixels);
const outPath = path.join(__dirname, 'assets', 'icons', 'scroll-top.png');
fs.writeFileSync(outPath, png);
console.log('Icon saved to', outPath);
