import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSources } from './buildSources.mjs';

// リアクティブなフィーチャー状態。id 未指定時は内容から決まる id になること、
// 各プロパティの変更が指紋（fingerprint）を変えて購読者へ届くこと、
// 同じ値の再代入は通知しないこと、購読解除で止まることを確かめる。
const { state } = await buildSources('feature-state-tests', { state: 'src/GeoJSONFeatureState.ts' });
const { GeoJSONFeatureState } = state;

const pt = (longitude, latitude) => ({ type: 'Point', longitude, latitude });

test('constructor defaults', () => {
    const s = new GeoJSONFeatureState({ featureId: 'a', geometry: pt(1, 2) });
    assert.equal(s.id, 'a');
    assert.deepEqual(s.properties, {});
    assert.equal(s.strokeColor, null);
    assert.equal(s.fillColor, null);
    assert.equal(s.strokeWidth, null);
    assert.equal(s.pointRadius, null);
    assert.equal(s.visible, true);
});

test('without featureId the id is derived from geometry and properties', () => {
    const a = new GeoJSONFeatureState({ geometry: pt(1, 2), properties: { n: 1 } });
    const b = new GeoJSONFeatureState({ geometry: pt(1, 2), properties: { n: 1 } });
    const c = new GeoJSONFeatureState({ geometry: pt(1, 2), properties: { n: 2 } });
    const d = new GeoJSONFeatureState({ geometry: pt(2, 1), properties: { n: 1 } });
    assert.match(a.id, /^-?\d+$/);
    assert.equal(a.id, b.id, 'same content, same id');
    assert.notEqual(a.id, c.id);
    assert.notEqual(a.id, d.id);
    // style and visibility do not take part in the id
    assert.equal(new GeoJSONFeatureState({ geometry: pt(1, 2), properties: { n: 1 }, fillColor: 5, visible: false }).id, a.id);
});

test('the id does not change when the content changes later', () => {
    const s = new GeoJSONFeatureState({ geometry: pt(1, 2) });
    const id = s.id;
    s.geometry = pt(3, 4);
    s.properties = { x: 1 };
    assert.equal(s.id, id);
});

test('each setter changes its own fingerprint field', () => {
    const s = new GeoJSONFeatureState({ featureId: 'f', geometry: pt(0, 0) });
    let fp = s.fingerPrint();
    const changed = (mutate) => {
        mutate();
        const next = s.fingerPrint();
        const diff = Object.keys(next).filter((k) => next[k] !== fp[k]);
        fp = next;
        return diff;
    };
    assert.deepEqual(changed(() => { s.geometry = pt(1, 1); }), ['geometry']);
    assert.deepEqual(changed(() => { s.properties = { a: 1 }; }), ['properties']);
    assert.deepEqual(changed(() => { s.strokeColor = 0xff00ff00 | 0; }), ['style']);
    assert.deepEqual(changed(() => { s.fillColor = 0x80000000 | 0; }), ['style']);
    assert.deepEqual(changed(() => { s.strokeWidth = 2.5; }), ['style']);
    assert.deepEqual(changed(() => { s.pointRadius = 4; }), ['style']);
    assert.deepEqual(changed(() => { s.visible = false; }), ['visible']);
    assert.equal(fp.visible, 0);
});

test('fractional stroke widths still change the style fingerprint', () => {
    const a = new GeoJSONFeatureState({ featureId: 'f', geometry: pt(0, 0), strokeWidth: 1.5 });
    const b = new GeoJSONFeatureState({ featureId: 'f', geometry: pt(0, 0), strokeWidth: 1.6 });
    assert.notEqual(a.fingerPrint().style, b.fingerPrint().style);
});

test('subscribers get the current fingerprint, then only real changes', () => {
    const s = new GeoJSONFeatureState({ featureId: 'f', geometry: pt(0, 0) });
    const seen = [];
    const unsubscribe = s.asObservable().subscribe((fp) => seen.push(fp));
    assert.equal(seen.length, 1, 'replays the latest value on subscribe');
    assert.deepEqual(seen[0], s.fingerPrint());

    s.visible = true; // unchanged
    s.properties = {}; // a new object with equal content
    assert.equal(seen.length, 1, 'equal fingerprints are not re-emitted');

    s.fillColor = 123;
    assert.equal(seen.length, 2);
    assert.equal(seen[1].style, s.fingerPrint().style);

    unsubscribe();
    s.visible = false;
    assert.equal(seen.length, 2, 'no emissions after unsubscribe');
});

test('properties that JSON cannot serialise do not throw', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const s = new GeoJSONFeatureState({ featureId: 'c', geometry: pt(0, 0), properties: cyclic });
    assert.equal(s.fingerPrint().properties, 0);
    assert.equal(typeof new GeoJSONFeatureState({ geometry: pt(0, 0), properties: cyclic }).id, 'string');
});
