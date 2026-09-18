// Generates a plain 512x512 RGBA PNG (no dependencies) used as the source for
// `npx tauri icon` to derive every platform icon. Writes vantra-square.png
// in the repo root's scripts/icons-src/ dir (kept for regeneration).
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

const SIZE = 512;
const px = Buffer.alloc(SIZE * SIZE * 4);
// Solid Vantra brand-ish ultramarine blue, full opacity. Placeholder artwork —
// swap for the real brand mark by replacing this bitmap or pointing `tauri icon`
// at a real 1024x1024 source.
for (let i = 0; i < SIZE * SIZE; i++) {
  px[i * 4] = 79; // R
  px[i * 4 + 1] = 70; // G
  px[i * 4 + 2] = 229; // B
  px[i * 4 + 3] = 255; // A
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  let crc = 0xffffffff;
  for (const b of crcInput) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Each scanline prefixed with filter byte 0.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(scriptsDir, "icons-src");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "vantra-square.png");
writeFileSync(outFile, png);
console.log("wrote", outFile, png.length, "bytes");