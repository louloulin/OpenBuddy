import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIcoBuffer,
  decodePngSize,
  ICONSET_ENTRIES,
  ICO_SIZES,
} from './generate-desktop-icons.mjs';

/** Minimal valid PNG header (signature + IHDR width/height), enough for the writer. */
function fakePng(width, height, tailBytes = 0) {
  const png = Buffer.alloc(24 + tailBytes, 0x7f);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

test('decodePngSize reads IHDR dimensions and rejects non-PNG input', () => {
  assert.deepEqual(decodePngSize(fakePng(1024, 512)), { width: 1024, height: 512 });
  assert.throws(() => decodePngSize(Buffer.alloc(32)), /missing signature/);
  assert.throws(() => decodePngSize(null), /Invalid PNG/);
});

test('buildIcoBuffer writes a valid header, directory and contiguous payloads', () => {
  const entries = [
    { size: 16, png: fakePng(16, 16, 3) },
    { size: 32, png: fakePng(32, 32, 11) },
    { size: 256, png: fakePng(256, 256, 29) },
  ];
  const ico = buildIcoBuffer(entries);

  assert.equal(ico.readUInt16LE(0), 0); // reserved
  assert.equal(ico.readUInt16LE(2), 1); // icon type
  assert.equal(ico.readUInt16LE(4), entries.length);

  let offset = 6 + 16 * entries.length;
  entries.forEach(({ size, png }, index) => {
    const dir = 6 + index * 16;
    assert.equal(ico[dir], size === 256 ? 0 : size);
    assert.equal(ico[dir + 1], size === 256 ? 0 : size);
    assert.equal(ico.readUInt16LE(dir + 4), 1); // planes
    assert.equal(ico.readUInt16LE(dir + 6), 32); // bpp
    assert.equal(ico.readUInt32LE(dir + 8), png.length);
    assert.equal(ico.readUInt32LE(dir + 12), offset);
    assert.deepEqual(ico.subarray(offset, offset + png.length), png);
    offset += png.length;
  });
  assert.equal(ico.length, offset);
});

test('buildIcoBuffer rejects duplicate, out-of-range and mismatched entries', () => {
  assert.throws(() => buildIcoBuffer([]), /at least one entry/);
  assert.throws(
    () => buildIcoBuffer([{ size: 16, png: fakePng(16, 16) }, { size: 16, png: fakePng(16, 16) }]),
    /Duplicate ICO size/,
  );
  assert.throws(() => buildIcoBuffer([{ size: 257, png: fakePng(257, 257) }]), /Invalid ICO size/);
  assert.throws(() => buildIcoBuffer([{ size: 32, png: fakePng(16, 16) }]), /has 16x16 PNG data/);
});

test('icon manifests cover the required macOS and Windows sizes', () => {
  assert.equal(new Set(ICONSET_ENTRIES.map(entry => entry.name)).size, ICONSET_ENTRIES.length);
  assert.deepEqual(
    [...new Set(ICONSET_ENTRIES.map(entry => entry.size))].sort((a, b) => a - b),
    [16, 32, 64, 128, 256, 512, 1024],
  );
  for (const entry of ICONSET_ENTRIES) {
    assert.match(entry.name, new RegExp(`^icon_\\d+x\\d+(?:@2x)?\\.png$`));
  }
  assert.deepEqual([...ICO_SIZES], [16, 24, 32, 48, 64, 128, 256]);
});
