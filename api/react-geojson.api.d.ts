import { G as GeoJSONFeatureState, a as GeoJSONLayerState, b as GeoJSONFeatureData } from './GeoJSONSeqParser-7GBvl5IV.js';
export { c as GeoJSONDefaults, d as GeoJSONFeatureFingerPrint, e as GeoJSONGeometry, f as GeoJSONHitTestResult, g as GeoJSONLayerStyle, h as GeoJSONParser, i as GeoJSONSeqParser, j as GeoJSONTileRenderer, L as LonLat, k as argbToCss, l as colorAlpha, m as colorArgb, n as colorBlue, o as colorGreen, p as colorRed, q as colorRgb, r as createGeoJSONFeature } from './GeoJSONSeqParser-7GBvl5IV.js';
import React from 'react';
import '@mapconductor/js-sdk-core';

interface GeoJSONLayerProps {
    state?: GeoJSONLayerState;
    features?: GeoJSONFeatureData[];
    tileSize?: number;
    trackFeatureUpdates?: boolean;
    children?: React.ReactNode;
}
declare function GeoJSONLayer(props: GeoJSONLayerProps): React.ReactElement | null;
interface GeoJSONFeatureStateProps {
    state: GeoJSONFeatureState;
    geometry?: never;
}
interface GeoJSONFeatureParamsProps {
    state?: never;
    geometry: GeoJSONFeatureState['geometry'];
    featureId?: string | null;
    properties?: Record<string, unknown>;
    strokeColor?: number | null;
    fillColor?: number | null;
    strokeWidth?: number | null;
    pointRadius?: number | null;
    visible?: boolean;
}
type GeoJSONFeatureProps = GeoJSONFeatureStateProps | GeoJSONFeatureParamsProps;
declare function GeoJSONFeature(props: GeoJSONFeatureStateProps): null;
declare function GeoJSONFeature(props: GeoJSONFeatureParamsProps): React.ReactElement | null;
interface GeoJSONFeaturesProps {
    states: GeoJSONFeatureState[];
}
declare function GeoJSONFeatures({ states }: GeoJSONFeaturesProps): null;

export { GeoJSONFeature, GeoJSONFeatureData, GeoJSONFeatureState, GeoJSONFeatures, GeoJSONLayer, GeoJSONLayerState };
export type { GeoJSONFeatureProps, GeoJSONFeaturesProps, GeoJSONLayerProps };
