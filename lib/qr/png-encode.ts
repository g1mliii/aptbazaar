import "server-only";

// Phase 7.1: a hand-rolled, dependency-free PNG encoder (1-bit indexed) used to rasterize QR
// art server-side. The `qrcode` lib's PNG path goes through pngjs → Node streams + zlib, which is
// fragile under the OpenNext Worker runtime. A *stored* (uncompressed) DEFLATE stream needs no
// compressor — only CRC32 + Adler32 framing — so this stays pure JS and Workers-safe. QR art only
// needs two colors, so packing one palette index per bit keeps downloads and embedded flyer PNGs
// small even without real DEFLATE compression.

export type Rgb = readonly [number, number, number];

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wrap raw bytes in a zlib stream made only of stored (BTYPE=00) DEFLATE blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blockCount = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blockCount * 5 + raw.length + 4);
  let p = 0;
  // zlib header: CMF=0x78 (32K window, deflate), FLG=0x01 → (0x78*256 + 0x01) % 31 === 0.
  out[p++] = 0x78;
  out[p++] = 0x01;
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const len = Math.min(MAX_BLOCK, raw.length - offset);
    out[p++] = i === blockCount - 1 ? 1 : 0; // BFINAL on the last block, BTYPE=00
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    const nlen = ~len & 0xffff;
    out[p++] = nlen & 0xff;
    out[p++] = (nlen >>> 8) & 0xff;
    out.set(raw.subarray(offset, offset + len), p);
    p += len;
    offset += len;
  }
  const adler = adler32(raw);
  out[p++] = (adler >>> 24) & 0xff;
  out[p++] = (adler >>> 16) & 0xff;
  out[p++] = (adler >>> 8) & 0xff;
  out[p] = adler & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeIndexed1BitPng(
  width: number,
  height: number,
  packedRows: Uint8Array,
  dark: Rgb,
  light: Rgb
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 3; // color type 3 = indexed color
  // ihdr[10..12] = compression / filter / interlace, all 0 (defaults).

  const plte = new Uint8Array([...dark, ...light]);

  return concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", zlibStored(packedRows)),
    chunk("IEND", new Uint8Array(0))
  ]);
}

export interface ModuleMatrix {
  size: number;
  data: Uint8Array;
}

/**
 * Rasterize a QR module matrix to a PNG. `scale` is pixels per module; `quietZone` is the
 * light border in modules. Dark modules use `dark`, everything else `light`.
 */
export function rasterizeQrPng(
  matrix: ModuleMatrix,
  scale: number,
  quietZone: number,
  dark: Rgb,
  light: Rgb
): Uint8Array {
  const n = matrix.size;
  const dim = (n + quietZone * 2) * scale;
  const bytesPerRow = Math.ceil(dim / 8);
  const rows = new Uint8Array(dim * (bytesPerRow + 1));

  for (let y = 0; y < dim; y++) {
    const rowStart = y * (bytesPerRow + 1);
    rows[rowStart] = 0; // filter type 0 (none) per scanline
    rows.fill(0xff, rowStart + 1, rowStart + 1 + bytesPerRow); // palette index 1 = light
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!matrix.data[row * n + col]) continue;
      const x0 = (col + quietZone) * scale;
      const y0 = (row + quietZone) * scale;
      for (let dy = 0; dy < scale; dy++) {
        const rowStart = (y0 + dy) * (bytesPerRow + 1) + 1;
        for (let dx = 0; dx < scale; dx++) {
          const x = x0 + dx;
          const byteIndex = rowStart + (x >> 3);
          rows[byteIndex] = rows[byteIndex]! & ~(0x80 >> (x & 7)); // palette index 0 = dark
        }
      }
    }
  }

  return encodeIndexed1BitPng(dim, dim, rows, dark, light);
}
