import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSources } from './buildSources.mjs';

// クリック位置の当たり判定。ジオメトリ単位の判定（点・線の許容距離、面の偶奇判定と穴）、
// レンダラーが「後から描いたもの＝上にあるもの」を優先して返すこと、
// 256 件以上で格子索引に切り替わっても結果が変わらないこと、
// GeoJSONLayerState.processClick のピクセル許容差の換算と onClick 配送を確かめる。
const { hit, world, renderer, layer, feature } = await buildSources('hit-tests', {
    hit: 'src/GeoJSONHitTester.ts',
    world: 'src/GeoJSONWorld.ts',
    renderer: 'src/GeoJSONTileRenderer.ts',
    layer: 'src/GeoJSONLayerState.ts',
    feature: 'src/GeoJSONFeature.ts',
});
const {
    hitTestGeometry, hitTestLine, pointInRing, closestPointOnSegment,
    HIT_LINE_TOLERANCE, HIT_POINT_TOLERANCE,
} = hit;
const { WorldRing, lonToWorld, worldToLat } = world;
const { GeoJSONTileRenderer } = renderer;
const { GeoJSONLayerState } = layer;
const { createGeoJSONFeature } = feature;

const ring = (...xy) => new WorldRing(new Float64Array(xy));
const square = (x0, y0, x1, y1) => ring(x0, y0, x1, y0, x1, y1, x0, y1, x0, y0);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const style = { strokeColor: 0xff000000 | 0, fillColor: 0x80ff0000 | 0, strokeWidth: 2, pointRadius: 8 };
const ll = (longitude, latitude) => ({ longitude, latitude });

test('closestPointOnSegment projects onto the segment and clamps to its ends', () => {
    assert.deepEqual(closestPointOnSegment(0.5, 1, 0, 0, 1, 0), { wx: 0.5, wy: 0, distanceSq: 1 });
    assert.deepEqual(closestPointOnSegment(-1, 0, 0, 0, 1, 0), { wx: 0, wy: 0, distanceSq: 1 });
    assert.deepEqual(closestPointOnSegment(3, 0, 0, 0, 1, 0), { wx: 1, wy: 0, distanceSq: 4 });
    assert.deepEqual(closestPointOnSegment(1, 1, 2, 2, 2, 2), { wx: 2, wy: 2, distanceSq: 2 }, 'zero-length segment');
});

test('pointInRing uses even-odd crossing', () => {
    const sq = square(0, 0, 1, 1).coords;
    assert.equal(pointInRing(0.5, 0.5, sq), true);
    assert.equal(pointInRing(1.5, 0.5, sq), false);
    assert.equal(pointInRing(-0.1, 0.5, sq), false);
    // concave "U": the notch is outside
    const u = new Float64Array([0, 0, 0.3, 0, 0.3, 0.7, 0.7, 0.7, 0.7, 0, 1, 0, 1, 1, 0, 1, 0, 0]);
    assert.equal(pointInRing(0.5, 0.3, u), false);
    assert.equal(pointInRing(0.5, 0.9, u), true);
    assert.equal(pointInRing(0.15, 0.3, u), true);
});

test('points hit within the point tolerance and report the point position', () => {
    const g = { type: 'Point', wx: 0.5, wy: 0.5 };
    const h = hitTestGeometry(0.5 + HIT_POINT_TOLERANCE * 0.9, 0.5, g);
    assert.equal(h.wx, 0.5);
    assert.equal(h.wy, 0.5);
    assert.equal(hitTestGeometry(0.5 + HIT_POINT_TOLERANCE * 1.1, 0.5, g), null);
    assert.ok(hitTestGeometry(0.51, 0.5, g, undefined, 0.02 * 0.02), 'custom tolerance');

    const multi = { type: 'Points', points: new Float64Array([0.1, 0.1, 0.5, 0.5, 0.50001, 0.5]) };
    const best = hitTestGeometry(0.500009, 0.5, multi);
    assert.equal(best.wx, 0.50001, 'nearest of several points wins');
});

test('lines hit within the line tolerance at the closest point', () => {
    const g = { type: 'Line', rings: [ring(0.4, 0.5, 0.6, 0.5), ring(0.4, 0.6, 0.6, 0.6)] };
    const h = hitTestGeometry(0.45, 0.5 + HIT_LINE_TOLERANCE / 2, g);
    close(h.wx, 0.45);
    close(h.wy, 0.5);
    assert.equal(hitTestGeometry(0.45, 0.5 + HIT_LINE_TOLERANCE * 2, g), null);
    assert.ok(hitTestGeometry(0.45, 0.6, g), 'second line of a multi-line');
    assert.equal(hitTestLine(0.5, 0.5, new Float64Array([0.5, 0.5])), null, 'a single point is not a line');
});

test('polygons: inside hits, holes and outside do not', () => {
    const g = { type: 'Polygon', rings: [square(0.2, 0.2, 0.8, 0.8), square(0.4, 0.4, 0.6, 0.6)] };
    assert.deepEqual(hitTestGeometry(0.3, 0.3, g), { wx: 0.3, wy: 0.3, distanceSq: 0 });
    assert.equal(hitTestGeometry(0.5, 0.5, g), null, 'inside the hole');
    assert.equal(hitTestGeometry(0.9, 0.9, g), null);
    assert.equal(hitTestGeometry(0.5, 0.5, { type: 'Polygon', rings: [] }), null);
});

test('polygons with an explicit line tolerance only hit their outline', () => {
    const g = { type: 'Polygon', rings: [square(0.2, 0.2, 0.8, 0.8)] };
    const tolSq = 0.01 * 0.01;
    assert.equal(hitTestGeometry(0.5, 0.5, g, tolSq), null, 'deep inside is not a hit with a tolerance');
    const edge = hitTestGeometry(0.5, 0.205, g, tolSq);
    close(edge.wx, 0.5);
    close(edge.wy, 0.2);
});

test('collections return the closest part; Empty never hits', () => {
    const g = { type: 'Collection', parts: [
        { type: 'Point', wx: 0.5, wy: 0.5 },
        { type: 'Point', wx: 0.5001, wy: 0.5 },
        { type: 'Empty' },
    ] };
    assert.equal(hitTestGeometry(0.50009, 0.5, g).wx, 0.5001);
    assert.equal(hitTestGeometry(0.5, 0.5, { type: 'Empty' }), null);
    assert.equal(hitTestGeometry(0.5, 0.5, { type: 'Collection', parts: [] }), null);
});

test('renderer.hitTest prefers the topmost (last added) feature and returns lon/lat', () => {
    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    const lower = createGeoJSONFeature({ id: 'lower', geometry: { type: 'Polygon', rings: [[ll(-10, -10), ll(10, -10), ll(10, 10), ll(-10, 10), ll(-10, -10)]] } });
    const upper = createGeoJSONFeature({ id: 'upper', geometry: { type: 'Polygon', rings: [[ll(-1, -1), ll(1, -1), ll(1, 1), ll(-1, 1), ll(-1, -1)]] } });
    const hidden = createGeoJSONFeature({ id: 'hidden', visible: false, geometry: { type: 'Point', longitude: 0, latitude: 0 } });
    r.update([lower, upper, hidden], [], style);

    const h = r.hitTest(0, 0);
    assert.equal(h.feature.id, 'upper');
    assert.equal(h.feature.geometry.type, 'Empty', 'render features drop the lon/lat geometry');
    close(h.position.longitude, 0);
    close(h.position.latitude, 0);
    assert.equal(r.hitTest(5, 5).feature.id, 'lower');
    assert.equal(r.hitTest(50, 50), null);
});

test('renderer.hitTest snaps to the line and converts back to lon/lat', () => {
    const r = new GeoJSONTileRenderer();
    r.update([createGeoJSONFeature({ id: 'l', geometry: { type: 'LineString', coordinates: [ll(0, 0), ll(10, 0)] } })], [], style);
    const h = r.hitTest(5, 0.01);
    assert.equal(h.feature.id, 'l');
    close(h.position.longitude, 5, 1e-9);
    close(h.position.latitude, 0, 1e-9);
    assert.equal(r.hitTest(5, 1), null);
});

test('renderer.hitTest gives the same answer once the spatial index kicks in', () => {
    const features = [];
    for (let i = 0; i < 300; i++) {
        features.push(createGeoJSONFeature({ id: `p${i}`, geometry: { type: 'Point', longitude: -150 + i, latitude: (i % 50) - 25 } }));
    }
    const indexed = new GeoJSONTileRenderer();
    indexed.update(features, [], style);
    const plain = new GeoJSONTileRenderer();
    plain.update(features.slice(0, 255), [], style); // below threshold, no index
    for (const i of [0, 17, 120, 254]) {
        const lon = -150 + i, lat = (i % 50) - 25;
        assert.equal(indexed.hitTest(lon, lat).feature.id, `p${i}`);
        assert.equal(plain.hitTest(lon, lat).feature.id, `p${i}`);
    }
    assert.equal(indexed.hitTest(-150 + 299, (299 % 50) - 25).feature.id, 'p299');
    assert.equal(indexed.hitTest(170, 80), null);
});

test('processClick converts pixel tolerance with tileSize and zoom, then calls onClick', () => {
    const clicks = [];
    const state = new GeoJSONLayerState({ onClick: (f, pos) => clicks.push([f.id, pos]) });
    assert.equal(state.processClick(ll(0, 0)), false, 'no renderer yet');

    const r = new GeoJSONTileRenderer({ tileSize: 256 });
    r.update([createGeoJSONFeature({ id: 'eq', geometry: { type: 'LineString', coordinates: [ll(-10, 0), ll(10, 0)] } })], [], style);
    state.renderer = r;

    // At zoom 10 with 256px tiles the world is 262144px wide; 5px ≈ 5/262144 world units.
    const zoom = 10, worldSize = 256 * 2 ** zoom;
    const clickLat = worldToLat(0.5 - 5 / worldSize); // 5px north of the line

    assert.equal(state.processClick(ll(0, clickLat), 3, zoom), false, '5px away, 3px tolerance');
    assert.equal(clicks.length, 0);
    assert.equal(state.processClick(ll(0, clickLat), 10, zoom), true, '5px away, 10px tolerance');
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0][0], 'eq');
    close(clicks[0][1].latitude, 0, 1e-9);
    close(lonToWorld(clicks[0][1].longitude), 0.5, 1e-12);
});

test('GeoJSONLayerState applies the documented defaults', () => {
    const s = new GeoJSONLayerState();
    assert.equal(s.opacity, 1);
    assert.equal(s.strokeWidth, 2);
    assert.equal(s.pointRadius, 8);
    assert.equal(s.visible, true);
    assert.equal(s.minZoom, 0);
    assert.equal(s.maxZoom, 22);
    assert.equal(s.styleProviderId, null);
    assert.equal(s.onClick, null);
    assert.equal(s.renderer, null);
    const custom = new GeoJSONLayerState({ strokeWidth: 0, visible: false, minZoom: 3 });
    assert.equal(custom.strokeWidth, 0);
    assert.equal(custom.visible, false);
    assert.equal(custom.minZoom, 3);
});
