[English](./README.md) | [日本語](./README.ja.md) | Español (Latinoamérica)

# @mapconductor/react-geojson

Extensión de capa GeoJSON para el SDK de React de MapConductor. Renderiza features de GeoJSON (puntos, líneas, polígonos — incluidos los agujeros) como una superposición teselada dentro de cualquier vista de mapa de proveedor (`react-for-googlemaps`, `react-for-maplibre`, `react-for-here`, …), con estilos por feature y hit-testing de clics. Funciona en la web y, mediante los módulos de Android/iOS incluidos, en React Native.

## Demostración

[![Líneas de tren de Tokio dibujadas desde GeoJSON](https://raw.githubusercontent.com/MapConductor/react-geojson/main/docs/images/demo.jpg)](https://demo-react.mapconductor.com/maplibre/geojson-layer/en)

La [demo en vivo](https://demo-react.mapconductor.com/maplibre/geojson-layer/en) dibuja con este paquete las líneas de tren de Tokio desde GeoJSON; toca una línea para ver sus propiedades. El proveedor se cambia en la parte superior de la página. El código está en el inicio rápido de abajo.

## Instalación

```shell
npm install @mapconductor/react-geojson
```

`@mapconductor/js-sdk-core` y `@mapconductor/js-sdk-react` se instalan automáticamente como dependencias. Tu código importa directamente de ambos, así que con el `node_modules` estricto (aislado) de pnpm — o siempre que prefieras declarar todo lo que importas — instálalos explícitamente:

```shell
npm install @mapconductor/react-geojson @mapconductor/js-sdk-core @mapconductor/js-sdk-react
```

También necesitas un paquete de proveedor (cualquier `@mapconductor/react-for-*`) para alojar la vista de mapa.

## Inicio rápido

El ejemplo usa MapLibre, pero la capa funciona sin cambios dentro de cualquier vista de proveedor:

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

## Resumen de la API

- `GeoJSONLayer` — el componente de capa; pásale las `features` parseadas y un `GeoJSONLayerState` opcional. Las features también pueden declararse como hijos `GeoJSONFeature` / `GeoJSONFeatures`.
- `GeoJSONLayerState` — estilo de toda la capa (`fillColor`, `strokeColor`, `strokeWidth`, `pointRadius`), visibilidad y rango de zoom, más los callbacks `onClick`, `onLoadStart` y `onLoadComplete`. Cada feature puede sobrescribir el estilo mediante sus propios campos `strokeColor` / `fillColor` / `strokeWidth` / `pointRadius`.
- `GeoJSONParser` / `GeoJSONSeqParser` — parsean documentos GeoJSON y secuencias GeoJSON delimitadas por líneas a `GeoJSONFeatureData`.
- `colorArgb`, `colorRgb`, `argbToCss`, … — helpers para el formato de color ARGB que la capa comparte con el SDK de Android.

## Paquetes relacionados

- [`@mapconductor/js-sdk-core`](../js-sdk-core) — primitivas de geometría, cámara y estado
- [`@mapconductor/js-sdk-react`](../js-sdk-react) — `Marker`, `Markers`, formas y burbujas de información compartidos
- `@mapconductor/react-for-*` — paquetes de proveedor (Google Maps, MapLibre, Mapbox, Leaflet, OpenLayers, ArcGIS, Cesium, HERE)
