import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { buildSources } from './buildSources.mjs';

// タイル描画の段取りを、canvas だけ記録用の偽物に差し替えて実クラスで動かす。
// どのタイルに何が描かれるか（点・線・面のパス、塗り/線のスタイル解決）、
// 空タイルは null、経度方向の折り返し、範囲外の y、キャッシュと update() による無効化、
// canvas を 1 枚だけ使い回すことを確かめる。DOM も実 canvas も要らない。
const { renderer, renderFeature, featureState, feature, defaults } = await buildSources('renderer-tests', {
    renderer: 'src/GeoJSONTileRenderer.ts',
    renderFeature: 'src/GeoJSONRenderFeature.ts',
    featureState: 'src/GeoJSONFeatureState.ts',
    feature: 'src/GeoJSONFeature.ts',
    defaults: 'src/GeoJSONDefaults.ts',
});
const { GeoJSONTileRenderer } = renderer;
const { buildRenderFeatureFromData, buildRenderFeatureFromState } = renderFeature;
const { GeoJSONFeatureState } = featureState;
const { createGeoJSONFeature } = feature;
const { colorArgb, argbToCss } = defaults;

// ─── fake canvas ─────────────────────────────────────────────────────────────
let canvases = [];
let ops = [];
class FakeCtx {
    constructor(size) { this.size = size; }
    clearRect(...a) { ops.push(['clearRect', ...a]); }
    beginPath() { ops.push(['beginPath']); }
    closePath() { ops.push(['closePath']); }
    moveTo(x, y) { ops.push(['moveTo', x, y]); }
    lineTo(x, y) { ops.push(['lineTo', x, y]); }
    arc(x, y, r) { ops.push(['arc', x, y, r]); }
    fill(rule) { ops.push(['fill', this.fillStyle, rule]); }
    stroke() { ops.push(['stroke', this.strokeStyle, this.lineWidth]); }
    getImageData(x, y, w, h) {
        ops.push(['getImageData']);
        const data = new Uint8ClampedArray(w * h * 4);
        data.fill(7);
        return { data };
    }
}
const hadOffscreen = 'OffscreenCanvas' in globalThis;
const prevOffscreen = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; canvases.push(this); this.ctx = new FakeCtx(w); }
    getContext(kind) { assert.equal(kind, '2d'); return this.ctx; }
};
after(() => { if (hadOffscreen) globalThis.OffscreenCanvas = prevOffscreen; else delete globalThis.OffscreenCanvas; });
beforeEach(() => { canvases = []; ops = []; });

const RED = colorArgb(255, 255, 0, 0);
const BLUE_HALF = colorArgb(128, 0, 0, 255);
const style = { strokeColor: RED, fillColor: BLUE_HALF, strokeWidth: 3, pointRadius: 5 };
const ll = (longitude, latitude) => ({ longitude, latitude });
const point = (id, lon, lat, extra = {}) => createGeoJSONFeature({ id, geometry: { type: 'Point', longitude: lon, latitude: lat }, ...extra });
const opNames = () => ops.map((o) => o[0]);

test('no features: every tile is empty and no canvas is created', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 4 });
    assert.equal(r.tileSize, 4);
    assert.equal(r.renderTile({ x: 0, y: 0, z: 0 }), null);
    assert.equal(new GeoJSONTileRenderer().tileSize, 512, 'default tile size');
    assert.equal(canvases.length, 0);
});

test('a point is drawn at its pixel position and encoded as a PNG of the tile size', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 4 });
    r.update([point('p', 0, 0)], [], style);
    const bytes = r.renderTile({ x: 0, y: 0, z: 0 });
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual(Array.from(bytes.subarray(1, 4)), [0x50, 0x4e, 0x47]);
    const idatStart = 8 + 12 + 13; // signature + IHDR chunk
    const idatLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(idatStart);
    const raw = inflateSync(bytes.subarray(idatStart + 8, idatStart + 8 + idatLen));
    assert.equal(raw.length, (1 + 4 * 4) * 4);
    assert.equal(raw[1], 7, 'pixels come from getImageData');

    assert.deepEqual(ops.filter((o) => o[0] === 'arc'), [['arc', 2, 2, 5], ['arc', 2, 2, 5]]);
    assert.deepEqual(ops.find((o) => o[0] === 'fill'), ['fill', argbToCss(BLUE_HALF), undefined]);
    assert.deepEqual(ops.find((o) => o[0] === 'stroke'), ['stroke', argbToCss(RED), 3]);
});

test('tiles that the feature does not touch come back null; out-of-range y too', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    r.update([point('tokyo', 139.7, 35.7)], [], style);
    // z1: Tokyo is in the north-east quadrant (x=1, y=0)
    assert.ok(r.renderTile({ x: 1, y: 0, z: 1 }));
    assert.equal(r.renderTile({ x: 0, y: 0, z: 1 }), null);
    assert.equal(r.renderTile({ x: 1, y: 1, z: 1 }), null);
    assert.equal(r.renderTile({ x: 1, y: 2, z: 1 }), null);
    assert.equal(r.renderTile({ x: 1, y: -1, z: 1 }), null);
});

test('x wraps around the antimeridian', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    r.update([point('tokyo', 139.7, 35.7)], [], style);
    assert.ok(r.renderTile({ x: 1, y: 0, z: 1 }));
    const arcs1 = ops.filter((o) => o[0] === 'arc');
    ops = [];
    assert.ok(r.renderTile({ x: -1, y: 0, z: 1 }), 'x=-1 is x=1');
    assert.deepEqual(ops.filter((o) => o[0] === 'arc'), arcs1);
    ops = [];
    assert.ok(r.renderTile({ x: 3, y: 0, z: 1 }), 'x=3 is x=1');
});

test('rendered and empty tiles are cached until update()', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 8 });
    r.update([point('a', 10, 10)], [], style);
    const first = r.renderTile({ x: 1, y: 0, z: 1 });
    assert.equal(r.renderTile({ x: 0, y: 1, z: 1 }), null);
    const drawn = ops.length;
    assert.equal(r.renderTile({ x: 1, y: 0, z: 1 }), first, 'same bytes from the cache');
    assert.equal(r.renderTile({ x: 0, y: 1, z: 1 }), null, 'empty result is cached as well');
    assert.equal(ops.length, drawn, 'nothing re-rendered');

    r.update([point('b', -10, -10)], [], style);
    assert.equal(r.renderTile({ x: 1, y: 0, z: 1 }), null, 'old content gone after update');
    assert.ok(r.renderTile({ x: 0, y: 1, z: 1 }));
    assert.equal(canvases.length, 1, 'one canvas reused for all tiles');
});

test('polygons fill even-odd and close each ring; degenerate rings draw nothing', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    const poly = createGeoJSONFeature({ id: 'poly', geometry: { type: 'Polygon', rings: [
        [ll(-90, -45), ll(90, -45), ll(90, 45), ll(-90, 45), ll(-90, -45)],
        [ll(-10, -10), ll(10, -10), ll(10, 10), ll(-10, -10)],
    ] } });
    r.update([poly], [], style);
    assert.ok(r.renderTile({ x: 0, y: 0, z: 0 }));
    assert.equal(ops.filter((o) => o[0] === 'closePath').length, 2);
    assert.deepEqual(ops.find((o) => o[0] === 'fill'), ['fill', argbToCss(BLUE_HALF), 'evenodd']);
    // first vertex (-90, -45): x is a quarter of the tile, y is the Mercator row of 45°S
    const [, mx, my] = ops.find((o) => o[0] === 'moveTo');
    assert.equal(mx, 64);
    const mercY = 0.5 - Math.log(Math.tan(Math.PI / 4 + (-45 * Math.PI / 180) / 2)) / (2 * Math.PI);
    assert.ok(Math.abs(my - mercY * 256) < 1e-9, `${my}`);

    ops = [];
    const r2 = new GeoJSONTileRenderer({ tileSize: 256 });
    r2.update([createGeoJSONFeature({ geometry: { type: 'Polygon', rings: [[ll(0, 0), ll(1, 1)]] } })], [], style);
    assert.equal(r2.renderTile({ x: 0, y: 0, z: 0 }), null);
    assert.ok(!opNames().includes('getImageData'));
});

test('lines stroke with the stroke colour, or the fill colour when there is no visible stroke', () => {
    const line = (extra) => createGeoJSONFeature({ geometry: { type: 'LineString', coordinates: [ll(-45, 0), ll(45, 0)] }, ...extra });

    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    r.update([line({})], [], style);
    assert.ok(r.renderTile({ x: 0, y: 0, z: 0 }));
    assert.deepEqual(ops.filter((o) => o[0] === 'moveTo' || o[0] === 'lineTo'), [['moveTo', 96, 128], ['lineTo', 160, 128]]);
    assert.deepEqual(ops.find((o) => o[0] === 'stroke'), ['stroke', argbToCss(RED), 3]);

    ops = [];
    r.update([line({ strokeColor: colorArgb(0, 255, 0, 0) })], [], style);
    r.renderTile({ x: 0, y: 0, z: 0 });
    assert.deepEqual(ops.find((o) => o[0] === 'stroke'), ['stroke', argbToCss(BLUE_HALF), 3], 'transparent stroke falls back to fill colour');
});

test('lines far outside the tile (beyond its margin) are skipped', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    // z2 tile (0,0) covers lon -180..-90; the line runs at 75°N (row 0); its 100..120 segment is far off to the east.
    r.update([createGeoJSONFeature({ geometry: { type: 'LineString', coordinates: [ll(-170, 75), ll(-100, 75), ll(100, 75), ll(120, 75)] } })], [], style);
    assert.ok(r.renderTile({ x: 0, y: 0, z: 2 }));
    const path = ops.filter((o) => o[0] === 'moveTo' || o[0] === 'lineTo');
    assert.equal(path[0][0], 'moveTo');
    assert.equal(path.length, 3, 'the segments touching the tile are drawn, the far 100..120 one is dropped');
});

test('per-feature style overrides the layer style; zero-width or transparent strokes are dropped', () => {
    const green = colorArgb(255, 0, 255, 0);
    const own = buildRenderFeatureFromData(point('x', 0, 0, { fillColor: green, strokeWidth: 1, pointRadius: 9 }), style);
    assert.equal(own.fillStyle, argbToCss(green));
    assert.equal(own.strokeStyle, argbToCss(RED));
    assert.equal(own.strokeWidth, 1);
    assert.equal(own.pointRadius, 9);
    assert.equal(own.source.id, 'x');
    assert.equal(own.source.geometry.type, 'Empty', 'lon/lat geometry is not kept twice');
    assert.equal(own.worldGeometry.type, 'Point');

    const inherited = buildRenderFeatureFromData(point('y', 0, 0), style);
    assert.equal(inherited.fillStyle, argbToCss(BLUE_HALF));
    assert.equal(inherited.pointRadius, 5);

    assert.equal(buildRenderFeatureFromData(point('z', 0, 0, { strokeWidth: 0 }), style).strokeStyle, null);
    assert.equal(buildRenderFeatureFromData(point('z', 0, 0, { strokeColor: colorArgb(0, 1, 2, 3) }), style).strokeStyle, null);

    const s = new GeoJSONFeatureState({ featureId: 's', geometry: { type: 'Point', longitude: 1, latitude: 2 }, strokeWidth: 7, properties: { k: 1 } });
    const fromState = buildRenderFeatureFromState(s, style);
    assert.equal(fromState.strokeWidth, 7);
    assert.equal(fromState.fillStyle, argbToCss(BLUE_HALF));
    assert.deepEqual(fromState.source.properties, { k: 1 });
    assert.equal(fromState.source.id, 's');
});

test('update() combines static and reactive features, skipping invisible ones', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    const dyn = new GeoJSONFeatureState({ featureId: 'dyn', geometry: { type: 'Point', longitude: -100, latitude: -40 } });
    const hiddenDyn = new GeoJSONFeatureState({ featureId: 'hidden', visible: false, geometry: { type: 'Point', longitude: 100, latitude: -40 } });
    r.update([point('static', 100, 40), point('off', -100, 40, { visible: false })], [dyn, hiddenDyn], style);
    assert.ok(r.renderTile({ x: 1, y: 0, z: 1 }), 'static NE');
    assert.ok(r.renderTile({ x: 0, y: 1, z: 1 }), 'reactive SW');
    assert.equal(r.renderTile({ x: 0, y: 0, z: 1 }), null, 'invisible static');
    assert.equal(r.renderTile({ x: 1, y: 1, z: 1 }), null, 'invisible reactive');
    assert.equal(r.hitTest(-100, -40).feature.id, 'dyn');
});

test('many features go through the spatial index and still land on the right tiles', () => {
    const features = [];
    for (let i = 0; i < 400; i++) features.push(point(`p${i}`, 10 + (i % 20), 10 + Math.floor(i / 20)));
    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    r.update(features, [], style);
    assert.ok(r.renderTile({ x: 1, y: 0, z: 1 }));
    assert.equal(ops.filter((o) => o[0] === 'arc').length, 800, 'fill + stroke arc per point');
    for (const [x, y] of [[0, 0], [0, 1], [1, 1]]) assert.equal(r.renderTile({ x, y, z: 1 }), null);
});
