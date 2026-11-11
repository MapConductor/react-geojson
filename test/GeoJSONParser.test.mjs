import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSources } from './buildSources.mjs';

// GeoJSON / GeoJSON Text Sequence (RFC 8142) の読み込み。
// 各ジオメトリ型の変換、壊れた座標の読み飛ばし、Feature の id と properties の扱い、
// トップレベルが FeatureCollection / Feature / 裸のジオメトリのときの違いを確かめる。
const { parser, seq, feature } = await buildSources('parser-tests', {
    parser: 'src/GeoJSONParser.ts',
    seq: 'src/GeoJSONSeqParser.ts',
    feature: 'src/GeoJSONFeature.ts',
});
const { GeoJSONParser } = parser;
const { GeoJSONSeqParser } = seq;
const { createGeoJSONFeature } = feature;

const ll = (longitude, latitude) => ({ longitude, latitude });

test('every geometry type becomes the matching internal shape', () => {
    assert.deepEqual(GeoJSONParser.parseGeometry('{"type":"Point","coordinates":[139.7,35.6,12]}'),
        { type: 'Point', longitude: 139.7, latitude: 35.6 });
    assert.deepEqual(GeoJSONParser.parseGeometry('{"type":"MultiPoint","coordinates":[[1,2],[3,4]]}'),
        { type: 'MultiPoint', points: [ll(1, 2), ll(3, 4)] });
    assert.deepEqual(GeoJSONParser.parseGeometry('{"type":"LineString","coordinates":[[0,0],[1,1]]}'),
        { type: 'LineString', coordinates: [ll(0, 0), ll(1, 1)] });
    assert.deepEqual(GeoJSONParser.parseGeometry('{"type":"MultiLineString","coordinates":[[[0,0],[1,1]],[[2,2],[3,3]]]}'),
        { type: 'MultiLineString', lines: [[ll(0, 0), ll(1, 1)], [ll(2, 2), ll(3, 3)]] });
    assert.deepEqual(
        GeoJSONParser.parseGeometry('{"type":"Polygon","coordinates":[[[0,0],[4,0],[4,4],[0,0]],[[1,1],[2,1],[2,2],[1,1]]]}'),
        { type: 'Polygon', rings: [[ll(0, 0), ll(4, 0), ll(4, 4), ll(0, 0)], [ll(1, 1), ll(2, 1), ll(2, 2), ll(1, 1)]] });
    assert.deepEqual(
        GeoJSONParser.parseGeometry('{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]],[[[5,5],[6,5],[6,6],[5,5]]]]}'),
        { type: 'MultiPolygon', polygons: [[[ll(0, 0), ll(1, 0), ll(1, 1), ll(0, 0)]], [[ll(5, 5), ll(6, 5), ll(6, 6), ll(5, 5)]]] });
    assert.deepEqual(
        GeoJSONParser.parseGeometry('{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[1,2]},{"type":"Bogus"},{"type":"LineString","coordinates":[[0,0],[1,1]]}]}'),
        { type: 'GeometryCollection', geometries: [
            { type: 'Point', longitude: 1, latitude: 2 },
            { type: 'LineString', coordinates: [ll(0, 0), ll(1, 1)] },
        ] });
});

test('broken coordinates are skipped, not turned into NaN', () => {
    assert.equal(GeoJSONParser.parseGeometry('{"type":"Point","coordinates":[1]}'), null);
    assert.equal(GeoJSONParser.parseGeometry('{"type":"Point","coordinates":["x",2]}'), null);
    assert.deepEqual(GeoJSONParser.parseGeometry('{"type":"Point","coordinates":["1.5","2"]}'),
        { type: 'Point', longitude: 1.5, latitude: 2 }, 'numeric strings are accepted');
    assert.deepEqual(
        GeoJSONParser.parseGeometry('{"type":"LineString","coordinates":[[0,0],[1],"oops",["a",1],[2,2]]}'),
        { type: 'LineString', coordinates: [ll(0, 0), ll(2, 2)] });
    assert.deepEqual(GeoJSONParser.parseGeometry('{"type":"MultiPoint","coordinates":[[1,2],[null,"z"]]}'),
        { type: 'MultiPoint', points: [ll(1, 2)] });
    assert.deepEqual(GeoJSONParser.parseGeometry('{"type":"Polygon","coordinates":null}'),
        { type: 'Polygon', rings: [] });
});

test('unknown types and invalid JSON produce nothing', () => {
    assert.equal(GeoJSONParser.parseGeometry('{"type":"Circle","coordinates":[0,0]}'), null);
    assert.equal(GeoJSONParser.parseGeometry('not json'), null);
    assert.deepEqual(GeoJSONParser.parse('not json'), []);
    assert.deepEqual(GeoJSONParser.parseFeatures('{'), []);
    assert.equal(GeoJSONParser.parseFeature('{'), null);
});

test('parseFeatures reads a FeatureCollection, dropping features without usable geometry', () => {
    const json = JSON.stringify({
        type: 'FeatureCollection',
        features: [
            { type: 'Feature', id: 7, geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'a', none: undefined, n: null } },
            { type: 'Feature', geometry: null, properties: {} },
            { type: 'Feature', id: 'b', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
        ],
    });
    const features = GeoJSONParser.parseFeatures(json);
    assert.equal(features.length, 2);
    assert.deepEqual(features[0], {
        id: '7', // numeric ids are stringified
        geometry: { type: 'Point', longitude: 1, latitude: 2 },
        properties: { name: 'a', n: null },
        visible: true,
    });
    assert.equal(features[1].id, 'b');
    assert.deepEqual(features[1].properties, {}, 'missing properties become an empty object');
});

test('parseFeatures accepts a single Feature or a bare geometry at the top level', () => {
    const one = GeoJSONParser.parseFeatures('{"type":"Feature","geometry":{"type":"Point","coordinates":[3,4]},"properties":{"k":1}}');
    assert.equal(one.length, 1);
    assert.equal(one[0].id, null);
    assert.deepEqual(one[0].properties, { k: 1 });

    const bare = GeoJSONParser.parseFeatures('{"type":"Point","coordinates":[3,4]}');
    assert.deepEqual(bare, [{ id: null, geometry: { type: 'Point', longitude: 3, latitude: 4 }, properties: {}, visible: true }]);
});

test('parse returns reactive feature states with the feature id kept', () => {
    const states = GeoJSONParser.parse(JSON.stringify({
        type: 'FeatureCollection',
        features: [
            { type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { a: 1 } },
            { type: 'Feature', geometry: { type: 'Nope' } },
        ],
    }));
    assert.equal(states.length, 1);
    assert.equal(states[0].id, 'x');
    assert.deepEqual(states[0].properties, { a: 1 });
    assert.equal(states[0].visible, true);
    assert.equal(typeof states[0].asObservable().subscribe, 'function');

    const single = GeoJSONParser.parseFeature('{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]}}');
    assert.ok(single);
    assert.equal(typeof single.id, 'string', 'a feature without id gets a content-derived id');

    const bare = GeoJSONParser.parse('{"type":"LineString","coordinates":[[0,0],[1,1]]}');
    assert.equal(bare.length, 1);
    assert.equal(bare[0].geometry.type, 'LineString');
});

test('streamParse emits each usable feature in order', () => {
    const seen = [];
    GeoJSONParser.streamParse(JSON.stringify({
        type: 'FeatureCollection',
        features: [
            { type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', id: 2, geometry: null },
            { type: 'Feature', id: 3, geometry: { type: 'Point', coordinates: [1, 1] } },
        ],
    }), (f) => seen.push(f.id));
    assert.deepEqual(seen, ['1', '3']);
    GeoJSONParser.streamParse('garbage', () => assert.fail('nothing to emit'));
});

test('GeoJSON Text Sequences split on RS and accept Features and bare geometries', () => {
    const RS = '\u001e';
    const text = [
        '',
        '{"type":"Feature","id":"f1","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"p":true}}\n',
        '  {"type":"LineString","coordinates":[[0,0],[1,1]]}\n',
        '{ broken',
        '42',
        '{"type":"Feature","geometry":null}',
        '\n',
    ].join(RS);
    const features = GeoJSONSeqParser.parse(text);
    assert.equal(features.length, 2);
    assert.equal(features[0].id, 'f1');
    assert.deepEqual(features[0].properties, { p: true });
    assert.deepEqual(features[1], {
        id: null, geometry: { type: 'LineString', coordinates: [ll(0, 0), ll(1, 1)] }, properties: {}, visible: true,
    });

    const streamed = [];
    GeoJSONSeqParser.streamParse(text, (f) => streamed.push(f.geometry.type));
    assert.deepEqual(streamed, ['Point', 'LineString']);
});

test('createGeoJSONFeature fills defaults', () => {
    const geometry = { type: 'Point', longitude: 0, latitude: 0 };
    assert.deepEqual(createGeoJSONFeature({ geometry }), {
        id: null, geometry, properties: {}, strokeColor: null, fillColor: null,
        strokeWidth: null, pointRadius: null, visible: true,
    });
    const styled = createGeoJSONFeature({ id: 'a', geometry, strokeWidth: 0, visible: false, fillColor: 0 });
    assert.equal(styled.strokeWidth, 0, 'zero is kept, not replaced by null');
    assert.equal(styled.fillColor, 0);
    assert.equal(styled.visible, false);
});
