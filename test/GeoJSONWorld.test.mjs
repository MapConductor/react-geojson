import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSources } from './buildSources.mjs';

// 緯度経度 ⇔ 世界座標（0..1 の Web メルカトル）の式、半径による間引き、
// ズームごとの間引き結果のキャッシュ、ジオメトリの世界座標化と範囲計算、
// そしてタイルにかかるフィーチャーを絞る格子索引。どれも副作用のない計算。
const { world, index } = await buildSources('world-tests', {
    world: 'src/GeoJSONWorld.ts',
    index: 'src/GeoJSONSpatialIndex.ts',
});
const {
    lonToWorld, latToWorld, worldToLon, worldToLat, toPixel, segmentOutside, distanceSq,
    simplifyRadial, WorldRing, WorldBounds, MAX_SIMPLIFY_ZOOM, toWorldGeometry, computeBounds,
} = world;
const { SpatialIndex, INDEX_GRID_SIZE } = index;

const close = (actual, expected, eps = 1e-9, msg) =>
    assert.ok(Math.abs(actual - expected) <= eps, msg ?? `${actual} !~ ${expected}`);

test('longitude maps linearly onto 0..1', () => {
    assert.equal(lonToWorld(-180), 0);
    assert.equal(lonToWorld(0), 0.5);
    assert.equal(lonToWorld(180), 1);
    assert.equal(worldToLon(0.75), 90);
});

test('latitude uses Web Mercator, north is up (smaller y)', () => {
    assert.equal(latToWorld(0), 0.5);
    close(latToWorld(85.0511287798), 0, 1e-4);
    close(latToWorld(-85.0511287798), 1, 1e-4);
    assert.ok(latToWorld(35) < 0.5);
    close(latToWorld(45), 0.5 - Math.log(Math.tan(Math.PI / 4 + Math.PI / 8)) / (2 * Math.PI), 1e-12);
});

test('the poles are clamped instead of going to infinity', () => {
    const north = latToWorld(90), south = latToWorld(-90);
    assert.ok(Number.isFinite(north) && Number.isFinite(south));
    assert.ok(north > -0.5 && north < 0.5);
    close(north + south, 1, 1e-12, 'symmetric around the equator');
});

test('world -> lat/lon is the inverse of lat/lon -> world', () => {
    for (const lat of [-80, -45.5, -1, 0, 12.3, 35.681236, 60, 84]) {
        close(worldToLat(latToWorld(lat)), lat, 1e-9);
    }
    for (const lon of [-179.9, -10, 0, 139.767125, 180]) {
        close(worldToLon(lonToWorld(lon)), lon, 1e-9);
    }
});

test('pixel / segment / distance helpers', () => {
    assert.equal(toPixel(0.5, 1024, 256), 256);
    assert.equal(distanceSq(0, 0, 3, 4), 25);
    // both endpoints on the same outside side -> outside
    assert.equal(segmentOutside(-2, 0.5, -1, 0.5, 0, 0, 1, 1), true);
    assert.equal(segmentOutside(0.5, 2, 0.6, 3, 0, 0, 1, 1), true);
    // crossing the box, or one end inside -> not outside
    assert.equal(segmentOutside(-1, 0.5, 2, 0.5, 0, 0, 1, 1), false);
    assert.equal(segmentOutside(0.5, 0.5, 5, 5, 0, 0, 1, 1), false);
    // diagonal past a corner is conservatively kept (cheap test, no clipping)
    assert.equal(segmentOutside(-1, 0.5, 0.5, -1, 0, 0, 1, 1), false);
});

test('simplifyRadial drops points closer than the tolerance and keeps both ends', () => {
    const coords = new Float64Array([0, 0, 0.1, 0, 0.2, 0, 1, 0, 1.05, 0, 2, 0]);
    assert.deepEqual(Array.from(simplifyRadial(coords, 0.5)), [0, 0, 1, 0, 2, 0]);
    // The last point is kept even if it is within tolerance of the previous kept one.
    assert.deepEqual(Array.from(simplifyRadial(new Float64Array([0, 0, 1, 0, 1.01, 0]), 0.5)), [0, 0, 1, 0, 1.01, 0]);
});

test('simplifyRadial returns the same array when there is nothing to do', () => {
    const two = new Float64Array([0, 0, 1, 1]);
    assert.equal(simplifyRadial(two, 10), two, 'two points are never simplified');
    const coords = new Float64Array([0, 0, 1, 0, 2, 0]);
    assert.equal(simplifyRadial(coords, 0), coords, 'zero tolerance');
    assert.equal(simplifyRadial(coords, 0.1), coords, 'all points far enough apart');
});

test('WorldRing simplifies per zoom once and caches it', () => {
    // 1000 points along a short line: at z0 almost everything collapses, at z22 nothing does.
    const n = 1000;
    const coords = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) { coords[i * 2] = 0.5 + i * 1e-7; coords[i * 2 + 1] = 0.5; }
    const ring = new WorldRing(coords);
    const z0 = ring.coordsForZoom(0, 256);
    assert.ok(z0.length < coords.length);
    assert.equal(z0[0], coords[0]);
    assert.equal(z0[z0.length - 2], coords[coords.length - 2], 'end point kept');
    assert.equal(ring.coordsForZoom(0, 256), z0, 'second call is served from the cache');
    assert.equal(ring.coordsForZoom(MAX_SIMPLIFY_ZOOM, 256), coords, 'deep zoom keeps every point');
    assert.equal(ring.coordsForZoom(30, 256), ring.coordsForZoom(MAX_SIMPLIFY_ZOOM, 256), 'zoom above max shares the max slot');

    const tiny = new Float64Array([0, 0, 1, 1]);
    assert.equal(new WorldRing(tiny).coordsForZoom(0, 256), tiny);
});

test('toWorldGeometry maps each GeoJSON type to the render shape', () => {
    const pt = toWorldGeometry({ type: 'Point', longitude: 0, latitude: 0 });
    assert.deepEqual(pt, { type: 'Point', wx: 0.5, wy: 0.5 });

    const mp = toWorldGeometry({ type: 'MultiPoint', points: [{ longitude: -180, latitude: 0 }, { longitude: 180, latitude: 0 }] });
    assert.equal(mp.type, 'Points');
    assert.deepEqual(Array.from(mp.points), [0, 0.5, 1, 0.5]);

    const line = toWorldGeometry({ type: 'LineString', coordinates: [{ longitude: 0, latitude: 0 }, { longitude: 90, latitude: 0 }] });
    assert.equal(line.type, 'Line');
    assert.equal(line.rings.length, 1);
    assert.ok(line.rings[0] instanceof WorldRing);
    assert.deepEqual(Array.from(line.rings[0].coords), [0.5, 0.5, 0.75, 0.5]);

    assert.equal(toWorldGeometry({ type: 'MultiLineString', lines: [[], []] }).rings.length, 2);
    assert.equal(toWorldGeometry({ type: 'Polygon', rings: [[], []] }).type, 'Polygon');

    const mpoly = toWorldGeometry({ type: 'MultiPolygon', polygons: [[[]], [[], []]] });
    assert.equal(mpoly.type, 'Collection');
    assert.deepEqual(mpoly.parts.map((p) => [p.type, p.rings.length]), [['Polygon', 1], ['Polygon', 2]]);

    const gc = toWorldGeometry({ type: 'GeometryCollection', geometries: [{ type: 'Point', longitude: 0, latitude: 0 }, { type: 'Empty' }] });
    assert.deepEqual(gc.parts.map((p) => p.type), ['Point', 'Empty']);
});

test('bounds cover the geometry; degenerate inputs cover the whole world', () => {
    const lonlat = (longitude, latitude) => ({ longitude, latitude });
    const b = computeBounds(toWorldGeometry({ type: 'LineString', coordinates: [lonlat(-90, 0), lonlat(90, 0), lonlat(0, 45)] }));
    assert.equal(b.minX, 0.25);
    assert.equal(b.maxX, 0.75);
    assert.equal(b.maxY, 0.5);
    close(b.minY, latToWorld(45), 0);

    const p = computeBounds({ type: 'Point', wx: 0.3, wy: 0.4 });
    assert.deepEqual([p.minX, p.maxX, p.minY, p.maxY], [0.3, 0.3, 0.4, 0.4]);

    const coll = computeBounds({ type: 'Collection', parts: [{ type: 'Point', wx: 0.1, wy: 0.9 }, { type: 'Point', wx: 0.6, wy: 0.2 }] });
    assert.deepEqual([coll.minX, coll.maxX, coll.minY, coll.maxY], [0.1, 0.6, 0.2, 0.9]);

    const whole = [0, 1, 0, 1];
    for (const g of [
        { type: 'Empty' },
        { type: 'Collection', parts: [] },
        { type: 'Points', points: new Float64Array(0) },
        { type: 'Line', rings: [] },
        { type: 'Polygon', rings: [new WorldRing(new Float64Array(0))] },
    ]) {
        const wb = computeBounds(g);
        assert.deepEqual([wb.minX, wb.maxX, wb.minY, wb.maxY], whole, g.type);
    }
});

test('WorldBounds.intersects is inclusive at the edges', () => {
    const b = new WorldBounds(0.2, 0.4, 0.2, 0.4);
    assert.equal(b.intersects(0.4, 0.4, 0.6, 0.6), true, 'touching corner');
    assert.equal(b.intersects(0.41, 0, 1, 1), false);
    assert.equal(b.intersects(0, 0.41, 1, 1), false);
    assert.equal(b.intersects(0.25, 0.25, 0.3, 0.3), true, 'fully inside');
    assert.equal(b.intersects(0, 0, 1, 1), true, 'fully containing');
});

test('SpatialIndex returns each overlapping feature once, and nothing far away', () => {
    const f = (minX, maxX, minY, maxY) => ({ bounds: new WorldBounds(minX, maxX, minY, maxY) });
    const features = [
        f(0.01, 0.01, 0.01, 0.01),   // 0: top-left point
        f(0.0, 1.0, 0.5, 0.5),       // 1: spans the whole width
        f(0.9, 0.95, 0.9, 0.95),     // 2: bottom-right
        f(-5, -4, -5, -4),           // 3: outside the world, clamped into cell (0,0)
    ];
    const idx = new SpatialIndex(features);
    const sorted = (a) => [...a].sort((x, y) => x - y);

    assert.deepEqual(sorted(idx.query(0, 0, 1, 1)), [0, 1, 2, 3], 'whole world, no duplicates');
    assert.deepEqual(sorted(idx.query(0.45, 0.45, 0.55, 0.55)), [1]);
    assert.deepEqual(sorted(idx.query(0.9, 0.9, 0.91, 0.91)), [2]);
    assert.deepEqual(sorted(idx.query(0, 0, 0.001, 0.001)), [0, 3]);
    assert.deepEqual(idx.query(0.7, 0.1, 0.8, 0.2), []);
    assert.equal(INDEX_GRID_SIZE, 64);
});
