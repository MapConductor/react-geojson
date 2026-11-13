import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, inflateSync } from 'node:zlib';
import { buildSources } from './buildSources.mjs';

// 自前の PNG エンコーダ（無圧縮 zlib の格納ブロック）が正しい PNG を出すこと:
// シグネチャ、IHDR、各チャンクの CRC、IDAT を zlib で展開して元の RGBA に戻ること。
// あわせてタイルの LRU（KB 単位の上限と追い出し順）と、ARGB 色ヘルパーを確かめる。
const { png, cache, defaults } = await buildSources('png-tests', {
    png: 'src/GeoJSONPngEncoder.ts',
    cache: 'src/GeoJSONTileCache.ts',
    defaults: 'src/GeoJSONDefaults.ts',
});
const { encodePng, DynamicBuffer } = png;
const { LruCache } = cache;
const {
    colorArgb, colorRgb, colorAlpha, colorRed, colorGreen, colorBlue, argbToCss, GeoJSONDefaults,
} = defaults;

function readChunks(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    let off = 8;
    while (off < bytes.length) {
        const len = view.getUint32(off);
        const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
        const data = bytes.subarray(off + 8, off + 8 + len);
        const crc = view.getUint32(off + 8 + len);
        chunks.push({ type, data, crc, crcInput: bytes.subarray(off + 4, off + 8 + len) });
        off += 12 + len;
    }
    assert.equal(off, bytes.length, 'chunks end exactly at the end of the file');
    return chunks;
}

function rgbaPattern(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + 11) & 0xff;
    return rgba;
}

test('encodePng writes a valid RGBA PNG whose pixels round-trip through zlib', () => {
    const w = 5, h = 3;
    const rgba = rgbaPattern(w, h);
    const bytes = encodePng(rgba, w, h, new DynamicBuffer(16));

    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks = readChunks(bytes);
    assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
    for (const c of chunks) assert.equal(c.crc, crc32(c.crcInput), `${c.type} CRC`);

    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
    assert.equal(ihdr.getUint32(0), w);
    assert.equal(ihdr.getUint32(4), h);
    assert.deepEqual(Array.from(chunks[0].data.subarray(8)), [8, 6, 0, 0, 0], '8-bit RGBA, no interlace');
    assert.equal(chunks[2].data.length, 0);

    // inflateSync also verifies the Adler-32 trailer.
    const raw = inflateSync(chunks[1].data);
    const rowLen = 1 + w * 4;
    assert.equal(raw.length, rowLen * h);
    for (let y = 0; y < h; y++) {
        assert.equal(raw[y * rowLen], 0, 'filter type None');
        assert.deepEqual(Array.from(raw.subarray(y * rowLen + 1, (y + 1) * rowLen)),
            Array.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)));
    }
});

test('encodePng reuses its buffer and returns an independent copy each time', () => {
    const buf = new DynamicBuffer(16);
    const a = encodePng(rgbaPattern(2, 2), 2, 2, buf);
    const aCopy = Uint8Array.from(a);
    const b = encodePng(new Uint8ClampedArray(64 * 64 * 4), 64, 64, buf);
    assert.deepEqual(a, aCopy, 'earlier result is not overwritten');
    assert.ok(b.length > a.length);
    assert.equal(inflateSync(readChunks(b)[1].data).length, (1 + 64 * 4) * 64);
});

test('a full 512px tile stays within one stored block per row', () => {
    const bytes = encodePng(new Uint8ClampedArray(512 * 512 * 4), 512, 512, new DynamicBuffer());
    const raw = inflateSync(readChunks(bytes)[1].data);
    assert.equal(raw.length, (1 + 512 * 4) * 512);
});

test('DynamicBuffer grows and writes big-endian ints', () => {
    const b = new DynamicBuffer(1);
    for (let i = 0; i < 40; i++) b.writeByte(i);
    b.writeInt32BE(0x01020304);
    b.setInt32BE(0, -1);
    const out = b.toUint8Array();
    assert.equal(out.length, 44);
    assert.deepEqual(Array.from(out.subarray(0, 4)), [255, 255, 255, 255]);
    assert.deepEqual(Array.from(out.subarray(40)), [1, 2, 3, 4]);
    b.reset();
    assert.equal(b.position(), 0);
});

test('LruCache evicts least recently used entries by KB budget', () => {
    const kb = (n) => new Uint8Array(n * 1024);
    const c = new LruCache(3);
    c.put('a', kb(1)); c.put('b', kb(1)); c.put('c', kb(1));
    assert.ok(c.get('a'), 'touch a so b becomes the oldest');
    c.put('d', kb(1));
    assert.equal(c.get('b'), undefined);
    assert.ok(c.get('a') && c.get('c') && c.get('d'));

    c.put('big', kb(2));
    assert.equal(c.get('a'), undefined);
    assert.equal(c.get('c'), undefined);
    assert.ok(c.get('d') && c.get('big'));
});

test('LruCache counts tiny entries as 1KB and re-puts replace, not add', () => {
    const c = new LruCache(2);
    const empty = new Uint8Array(0);
    c.put('x', empty); c.put('y', empty);
    assert.equal(c.get('x'), empty);
    c.put('y', new Uint8Array(10)); // replacing keeps the total at 2
    assert.ok(c.get('x'), 'x survives a replace of y (and is now the most recent)');
    c.put('z', empty);
    assert.equal(c.get('y'), undefined, 'third 1KB entry pushes out the least recent');
    assert.ok(c.get('x') && c.get('z'));
    c.evictAll();
    assert.equal(c.get('x'), undefined);
    assert.equal(c.get('z'), undefined);
});

test('ARGB helpers pack to signed 32-bit and unpack each channel', () => {
    const c = colorArgb(128, 30, 136, 229);
    assert.equal(c, (0x801e88e5 | 0));
    assert.ok(c < 0, 'alpha >= 128 is a negative int, like Android Color');
    assert.deepEqual([colorAlpha(c), colorRed(c), colorGreen(c), colorBlue(c)], [128, 30, 136, 229]);
    assert.equal(colorRgb(1, 2, 3), colorArgb(255, 1, 2, 3));
    assert.equal(argbToCss(colorArgb(255, 1, 2, 3)), 'rgba(1,2,3,1.0000)');
    assert.equal(argbToCss(colorArgb(0, 0, 0, 0)), 'rgba(0,0,0,0.0000)');
    assert.equal(argbToCss(GeoJSONDefaults.DEFAULT_FILL_COLOR), 'rgba(30,136,229,0.5020)');
    assert.equal(colorAlpha(GeoJSONDefaults.DEFAULT_STROKE_COLOR), 255);
});
