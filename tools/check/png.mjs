// Reads PNG screenshots (8-bit RGB or RGBA, as Chrome writes them) and tells how two differ.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function decode(file) {
    const buf = readFileSync(file);
    let pos = 8, width = 0, height = 0, bpp = 4;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bpp = { 2: 3, 6: 4 }[data[9]]; }
        if (type === 'IDAT') idat.push(data);
        pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat)), stride = width * bpp, px = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            px[y * stride + x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
        }
    }
    return { width, height, bpp, px };
}

/** { size?: 'different sizes', pixels, box: [x0, y0, x1, y1], strongest (0-255) } */
export function diff(fileA, fileB) {
    const A = decode(fileA), B = decode(fileB);
    if (A.width !== B.width || A.height !== B.height) return { size: `${A.width}×${A.height} → ${B.width}×${B.height}` };
    let pixels = 0, strongest = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
        const i = (y * A.width + x) * A.bpp;
        const d = Math.max(Math.abs(A.px[i] - B.px[i]), Math.abs(A.px[i + 1] - B.px[i + 1]), Math.abs(A.px[i + 2] - B.px[i + 2]));
        if (!d) continue;
        pixels++;
        strongest = Math.max(strongest, d);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { pixels, box: [x0, y0, x1, y1], strongest };
}
