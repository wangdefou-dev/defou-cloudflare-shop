import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeImage } from '../src/lib/image-sanitize';
test('JPEG uploads lose EXIF/XMP/IPTC/comments and trailing data without changing encoded pixels', () => {
  const original = new Uint8Array(readFileSync('tests/fixtures/tiny.jpg'));
  const metadata = new TextEncoder().encode('Exif\0\0GPS PRIVATE-LOCATION XMP AUTHOR');
  const app = new Uint8Array(metadata.length + 4);
  app.set([255, 225]);
  new DataView(app.buffer).setUint16(2, metadata.length + 2);
  app.set(metadata, 4);
  const injected = new Uint8Array(original.length + app.length + 16);
  injected.set(original.subarray(0, 2));
  injected.set(app, 2);
  injected.set(original.subarray(2), 2 + app.length);
  injected.set(new TextEncoder().encode('PRIVATE-TRAILER'), original.length + app.length);
  const safe = sanitizeImage(injected, 'image/jpeg'),
    expected = sanitizeImage(original, 'image/jpeg');
  assert.equal(safe.width, 2);
  assert.equal(safe.height, 2);
  assert.deepEqual(safe.bytes, expected.bytes);
  assert(!new TextDecoder().decode(safe.bytes).includes('PRIVATE'));
});
test('WebP uploads remove metadata chunks, update RIFF length and clear metadata flags while retaining pixel dimensions', () => {
  const source = new Uint8Array(
      readFileSync('tests/fixtures/tiny-lossless.webp'),
    ),
    extra = new TextEncoder().encode('GPS=PRIVATE;AUTHOR=PRIVATE');
  const appended = new Uint8Array(source.length + 8 + extra.length + (extra.length & 1));
  appended.set(source);
  appended.set(new TextEncoder().encode('EXIF'), source.length);
  new DataView(appended.buffer).setUint32(source.length + 4, extra.length, true);
  appended.set(extra, source.length + 8);
  new DataView(appended.buffer).setUint32(4, appended.length - 8, true);
  const safe = sanitizeImage(appended, 'image/webp'),
    original = sanitizeImage(source, 'image/webp');
  assert.deepEqual(safe, original);
  assert.equal(safe.width, 2);
  assert(!new TextDecoder().decode(safe.bytes).includes('PRIVATE'));
});
test('fake/truncated image signatures, malformed chunk sizes and animated uploads fail closed', () => {
  for (const [bytes, type] of [
    [new Uint8Array([255, 216, 1, 2]), 'image/jpeg'],
    [new Uint8Array([137, 80]), 'image/png'],
    [new Uint8Array(20), 'image/webp'],
  ] as const)
    assert.throws(() => sanitizeImage(bytes, type));
});
test('lossy WebP pixels remain decodable after metadata removal', () => {
  const source = new Uint8Array(
    readFileSync('tests/fixtures/tiny-lossy.webp'),
  );
  const safe = sanitizeImage(source, 'image/webp');
  assert.equal(safe.width, 2);
  assert(safe.height > 0);
});
test('PNG text and EXIF chunks are removed while transparent pixels remain unchanged', () => {
  const source = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=',
    'base64',
  );
  const text = Buffer.from('GPS\0PRIVATE LOCATION'),
    chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length);
  chunk.write('tEXt', 4);
  text.copy(chunk, 8);
  const injected = Buffer.concat([source.subarray(0, 33), chunk, source.subarray(33)]);
  const safe = sanitizeImage(injected, 'image/png');
  assert.equal(safe.width, 1);
  assert.equal(safe.height, 1);
  assert.deepEqual(safe.bytes, new Uint8Array(source));
});
