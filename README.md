English | [日本語](./README.ja.md) | [Español (Latinoamérica)](./README.es-419.md)

# @mapconductor/react-geojson

GeoJSON layer extension for the MapConductor React SDK. Renders GeoJSON
features (points, lines, polygons — holes included) as a tiled overlay inside
any provider map view (`react-for-googlemaps`, `react-for-maplibre`,
`react-for-here`, …), with per-feature styling and click hit-testing. Works on
the web and, through the bundled Android/iOS modules, in React Native.

## Demo

[![Tokyo railway lines drawn from GeoJSON](https://raw.githubusercontent.com/MapConductor/react-geojson/main/docs/images/demo.jpg)](https://demo-react.mapconductor.com/maplibre/geojson-layer/en)

The [live demo](https://demo-react.mapconductor.com/maplibre/geojson-layer/en) draws Tokyo's railway lines from GeoJSON with this package; tap a line to see its properties. The provider can be switched at the top of the page. The code is in the Quick start below.

## Installation

```shell
npm install @mapconductor/react-geojson
```

`@mapconductor/js-sdk-core` and `@mapconductor/js-sdk-react` are installed
automatically as dependencies. Your code imports from them directly, so with
pnpm's strict (isolated) `node_modules` — or whenever you prefer to declare
everything you import — install them explicitly instead:

```shell
npm install @mapconductor/react-geojson @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

You also need a provider package (any `@mapconductor/react-for-*`) to host the
map view.

## Quick start

The example uses MapLibre, but the layer works unchanged inside any provider
view:

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

## API overview

- `GeoJSONLayer` — the layer component; pass parsed `features` and an optional
  `GeoJSONLayerState`. Features can also be declared as `GeoJSONFeature` /
  `GeoJSONFeatures` children.
- `GeoJSONLayerState` — layer-wide style (`fillColor`, `strokeColor`,
  `strokeWidth`, `pointRadius`), visibility and zoom range, plus `onClick`,
  `onLoadStart`, and `onLoadComplete` callbacks. Individual features can
  override the style via their own `strokeColor` / `fillColor` /
  `strokeWidth` / `pointRadius` fields.
- `GeoJSONParser` / `GeoJSONSeqParser` — parse GeoJSON documents and
  line-delimited GeoJSON sequences into `GeoJSONFeatureData`.
- `colorArgb`, `colorRgb`, `argbToCss`, … — helpers for the ARGB color format
  the layer shares with the Android SDK.

## Related packages

- [`@mapconductor/js-sdk-core`](../js-sdk-core) — geometry, camera, and state primitives
- [`@mapconductor/js-sdk-react`](../js-sdk-react) — shared `Marker`, `Markers`, shapes, and info bubbles
- `@mapconductor/react-for-*` — provider packages (Google Maps, MapLibre, Mapbox, Leaflet, OpenLayers, ArcGIS, Cesium, HERE)
