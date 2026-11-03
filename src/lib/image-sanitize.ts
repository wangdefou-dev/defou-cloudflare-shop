type SafeImage = { bytes: Uint8Array; width: number; height: number };
const fail = () => {
  throw Error('图片格式无效或暂不支持，请重新导出静态 JPG、PNG 或 WebP');
};
const word = (a: Uint8Array, p: number, n: number) =>
  new TextDecoder().decode(a.subarray(p, p + n));
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of parts) {
    out.set(a, p);
    p += a.length;
  }
  return out;
};
function result(bytes: Uint8Array, width: number, height: number): SafeImage {
  if (!width || !height || width > 12000 || height > 12000 || width * height > 40000000)
    throw Error('图片尺寸过大，请先缩小至 4000 万像素以内');
  return { bytes, width, height };
}
// Structural, lossless metadata removal is enforced again at the Worker. Client
// resizing is an optimization, not a security boundary. No image leaves the site.
export function sanitizeImage(a: Uint8Array, type: string): SafeImage {
  const view = new DataView(a.buffer, a.byteOffset, a.byteLength);
  if (type === 'image/jpeg') {
    if (a[0] !== 255 || a[1] !== 216) return fail();
    const parts = [a.subarray(0, 2)];
    let p = 2,
      width = 0,
      height = 0,
      scan = false,
      hasScan = false;
    while (p < a.length) {
      if (scan) {
        const start = p;
        while (p < a.length - 1) {
          if (a[p] === 255 && a[p + 1] !== 0 && !(a[p + 1] >= 208 && a[p + 1] <= 215)) break;
          p += a[p] === 255 ? 2 : 1;
        }
        if (p >= a.length - 1) return fail();
        parts.push(a.subarray(start, p));
        scan = false;
      }
      const start = p;
      if (a[p++] !== 255) return fail();
      while (a[p] === 255) p++;
      const marker = a[p++];
      if (marker === 217) {
        if (!hasScan) return fail();
        parts.push(a.subarray(start, p));
        return result(join(parts), width, height);
      }
      if (marker === 216 || marker === 0 || p + 2 > a.length) return fail();
      const len = view.getUint16(p);
      if (len < 2 || p + len > a.length) return fail();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (len < 8) return fail();
        height = view.getUint16(p + 3);
        width = view.getUint16(p + 5);
      }
      // APP0..APP15 and COM can contain GPS, EXIF, XMP, IPTC, thumbnails and authors.
      // Adobe APP14 is retained only for its fixed, non-text colorspace record.
      const adobe = marker === 238 && len === 14 && word(a, p + 2, 5) === 'Adobe';
      if (((marker < 224 || marker > 239) && marker !== 254) || adobe)
        parts.push(a.subarray(start, p + len));
      p += len;
      if (marker === 218) {
        scan = true;
        hasScan = true;
      }
    }
    return fail();
  }
  if (type === 'image/png') {
    if (a.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => a[i] === n))
      return fail();
    const parts = [a.subarray(0, 8)];
    let p = 8,
      width = 0,
      height = 0,
      idat = false;
    while (p + 12 <= a.length) {
      const size = view.getUint32(p),
        name = word(a, p + 4, 4),
        end = p + 12 + size;
      if (end > a.length) return fail();
      if (p === 8 && name !== 'IHDR') return fail();
      if (name === 'IHDR') {
        if (size !== 13 || width) return fail();
        width = view.getUint32(p + 8);
        height = view.getUint32(p + 12);
      }
      if (name === 'acTL') return fail();
      if (name === 'IDAT') idat = true;
      if (['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'cHRM'].includes(name))
        parts.push(a.subarray(p, end));
      else if (name[0] === name[0].toUpperCase()) return fail();
      p = end;
      if (name === 'IEND') {
        if (size || !idat) return fail();
        return result(join(parts), width, height);
      }
    }
    return fail();
  }
  if (type === 'image/webp') {
    if (
      a.length < 20 ||
      word(a, 0, 4) !== 'RIFF' ||
      word(a, 8, 4) !== 'WEBP' ||
      view.getUint32(4, true) + 8 !== a.length
    )
      return fail();
    const parts: Uint8Array[] = [];
    let p = 12,
      width = 0,
      height = 0,
      pixels = 0;
    while (p + 8 <= a.length) {
      const name = word(a, p, 4),
        size = view.getUint32(p + 4, true),
        end = p + 8 + size + (size & 1);
      if (end > a.length) return fail();
      if (['ANIM', 'ANMF'].includes(name)) return fail();
      if (name === 'VP8X') {
        if (size !== 10 || a[p + 8] & 2) return fail();
        const copy = a.slice(p, end);
        copy[8] &= ~(32 | 8 | 4);
        parts.push(copy);
        width = 1 + (a[p + 12] | (a[p + 13] << 8) | (a[p + 14] << 16));
        height = 1 + (a[p + 15] | (a[p + 16] << 8) | (a[p + 17] << 16));
      }
      if (name === 'VP8 ') {
        if (size < 10 || a[p + 11] !== 0x9d || a[p + 12] !== 1 || a[p + 13] !== 0x2a) return fail();
        width = view.getUint16(p + 14, true) & 16383;
        height = view.getUint16(p + 16, true) & 16383;
        parts.push(a.subarray(p, end));
        pixels++;
      }
      if (name === 'VP8L') {
        if (size < 5 || a[p + 8] !== 47) return fail();
        const bits = view.getUint32(p + 9, true);
        width = (bits & 16383) + 1;
        height = ((bits >>> 14) & 16383) + 1;
        parts.push(a.subarray(p, end));
        pixels++;
      }
      if (name === 'ALPH') parts.push(a.subarray(p, end));
      p = end;
    }
    if (p !== a.length || pixels !== 1) return fail();
    const header = new Uint8Array(12);
    header.set(a.subarray(0, 12));
    new DataView(header.buffer).setUint32(4, 4 + parts.reduce((n, b) => n + b.length, 0), true);
    return result(join([header, ...parts]), width, height);
  }
  return fail();
}
