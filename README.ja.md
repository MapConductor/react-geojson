[English](./README.md) | 日本語 | [Español (Latinoamérica)](./README.es-419.md)

# @mapconductor/react-geojson

MapConductor React SDK の GeoJSON レイヤー拡張です。GeoJSON のフィーチャ(ポイント・ライン・ポリゴン。穴付きポリゴンにも対応)を、任意のプロバイダのマップビュー(`react-for-googlemaps`、`react-for-maplibre`、`react-for-here` など)の中にタイル化されたオーバーレイとして描画し、フィーチャ単位のスタイル指定とクリックのヒットテストをサポートします。Web と、同梱の Android/iOS モジュールを通じて React Native の両方で動作します。

## デモ

[![GeoJSON で描いた東京の鉄道路線](https://raw.githubusercontent.com/MapConductor/react-geojson/main/docs/images/demo.jpg)](https://demo-react.mapconductor.com/maplibre/geojson-layer/en)

[ライブデモ](https://demo-react.mapconductor.com/maplibre/geojson-layer/en)では、このパッケージで東京の鉄道路線を GeoJSON から描いています。線をタップすると属性を表示します。プロバイダは画面上部で切り替えられます。コードは下のクイックスタートにあります。

## インストール

```shell
npm install @mapconductor/react-geojson
```

`@mapconductor/js-sdk-core` と `@mapconductor/js-sdk-react` は依存関係として自動的にインストールされます。ただしアプリケーションコードはこの2つから直接 import するため、pnpm の strict(isolated)な `node_modules` を使う場合や、import するものをすべて明示的に宣言したい場合は、次のように明示的にインストールしてください:

```shell
npm install @mapconductor/react-geojson @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

マップビューをホストするプロバイダパッケージ(いずれかの `@mapconductor/react-for-*`)も必要です。

## クイックスタート

以下は MapLibre の例ですが、レイヤーはどのプロバイダビューでもそのまま動作します:

```tsx
import { useMemo } from 'react';
import { createGeoPoint, createMapCameraPosition } from '@mapconductor/js-sdk-core';
import {
  GeoJSONLayer,
  GeoJSONLayerState,
  GeoJSONParser,
  colorArgb,
} from '@mapconductor/react-geojson';
import {
  MapLibreDesign,
  MapLibreMapView2D,
  useMapLibreViewState,
} from '@mapconductor/react-for-maplibre';
import '@mapconductor/react-for-maplibre/style.css';

const GEOJSON = `{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[
        [139.75, 35.68], [139.78, 35.68], [139.78, 35.70], [139.75, 35.70], [139.75, 35.68]
      ]]
    },
    "properties": { "name": "Marunouchi" }
  }]
}`;

export function App() {
  const state = useMapLibreViewState({
    mapDesignType: MapLibreDesign.OsmBrightJa,
    cameraPosition: createMapCameraPosition({
      position: createGeoPoint({ latitude: 35.6812, longitude: 139.7671 }),
      zoom: 12,
    }),
  });
  const layerState = useMemo(
    () =>
      new GeoJSONLayerState({
        fillColor: colorArgb(127, 0x3b, 0xb2, 0xd0),
        strokeColor: colorArgb(255, 0x1d, 0x70, 0x82),
        strokeWidth: 2,
        onClick: feature => console.log('clicked', feature.properties),
      }),
    [],
  );
  const features = useMemo(() => GeoJSONParser.parseFeatures(GEOJSON), []);

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <MapLibreMapView2D state={state}>
        <GeoJSONLayer state={layerState} features={features} />
      </MapLibreMapView2D>
    </div>
  );
}
```

## API 概要

- `GeoJSONLayer` — レイヤーコンポーネント。パース済みの `features` と任意の `GeoJSONLayerState` を渡します。フィーチャは `GeoJSONFeature` / `GeoJSONFeatures` の子要素として宣言的に記述することもできます。
- `GeoJSONLayerState` — レイヤー全体のスタイル(`fillColor`、`strokeColor`、`strokeWidth`、`pointRadius`)、表示/非表示とズーム範囲、`onClick`・`onLoadStart`・`onLoadComplete` コールバック。各フィーチャは自身の `strokeColor` / `fillColor` / `strokeWidth` / `pointRadius` フィールドでスタイルを上書きできます。
- `GeoJSONParser` / `GeoJSONSeqParser` — GeoJSON ドキュメントおよび行区切りの GeoJSON シーケンスを `GeoJSONFeatureData` にパースします。
- `colorArgb`、`colorRgb`、`argbToCss` など — Android SDK と共通の ARGB カラー形式のヘルパー。

## 関連パッケージ

- [`@mapconductor/js-sdk-core`](../js-sdk-core) — ジオメトリ・カメラ・状態のプリミティブ
- [`@mapconductor/js-sdk-react`](../js-sdk-react) — 共有の `Marker`・`Markers`・シェイプ・インフォバブル
- `@mapconductor/react-for-*` — プロバイダパッケージ(Google Maps、MapLibre、Mapbox、Leaflet、OpenLayers、ArcGIS、Cesium、HERE)
