import viridis from './assets/viridis';

const SEOUL_TILESET_ID = 'seoul';
const BUILDINGS_TILESET_ID = 'buildings';
const DEFAULT_GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const BUILDINGS_MIN_ZOOM = 12;
const BUILDINGS_MAX_ZOOM = 15;
const PROTOMAPS_SOURCE_ID = 'protomaps';
const PROTOMAPS_MIN_ZOOM = 0;
const PROTOMAPS_MAX_ZOOM = 15;
const FAR_PROPERTY = 'FAR_prediction';
const FAR_DOMAIN = [0, 800];
const EXTRUSION_SCALE = 0.1;
export const PMTILES_STYLE_ID = 'seoul-pmtiles';

// CDN URL configuration - set via environment variables for production
const CDN_BUILDINGS_URL = import.meta.env.VITE_CDN_BUILDINGS_URL || '';
const CDN_BASEMAP_URL = import.meta.env.VITE_CDN_BASEMAP_URL || '';

function createPaletteExpression({
  palette = viridis,
  property = FAR_PROPERTY,
  range = FAR_DOMAIN,
} = {}) {
  const [min, max] = range;
  const stops = Math.max(palette.length - 1, 1);
  const span = Math.max(max - min, 1);
  const expression = [
    'interpolate',
    ['linear'],
    ['coalesce', ['to-number', ['get', property]], min],
  ];

  palette.forEach((color, index) => {
    const position = min + (span * index) / stops;
    expression.push(position, color);
  });

  return expression;
}

export function createExtrusionHeightExpression({
  scale = EXTRUSION_SCALE,
  property = FAR_PROPERTY,
} = {}) {
  const numericValue = ['coalesce', ['to-number', ['get', property]], 0];
  return ['max', 0, ['*', scale, numericValue]];
}

const trimTrailingSlash = (value = '') => (value.endsWith('/') ? value.slice(0, -1) : value);
const tileTemplate = (baseUrl) => `${baseUrl}/{z}/{x}/{y}.pbf`;

function resolveOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  if (typeof globalThis !== 'undefined' && globalThis.location?.origin) {
    return globalThis.location.origin;
  }

  return '';
}

/**
 * Construct the base URL for a PMTiles archive.
 * In production with CDN configured, returns the CDN URL.
 * In development, returns the local Vite dev server path.
 */
export function getPmtilesArchiveBaseUrl(id = SEOUL_TILESET_ID) {
  const normalizedId = id || SEOUL_TILESET_ID;

  // Check for CDN URL configuration (production)
  if (normalizedId === BUILDINGS_TILESET_ID && CDN_BUILDINGS_URL) {
    return trimTrailingSlash(CDN_BUILDINGS_URL);
  }
  if (normalizedId === SEOUL_TILESET_ID && CDN_BASEMAP_URL) {
    return trimTrailingSlash(CDN_BASEMAP_URL);
  }

  // Fallback to local dev server paths
  const origin = resolveOrigin();
  const trimmedOrigin = trimTrailingSlash(origin);
  if (trimmedOrigin) {
    return `${trimmedOrigin}/pmtiles/${normalizedId}`;
  }
  return `/pmtiles/${normalizedId}`;
}

const roadColorExpression = [
  'match',
  ['get', 'pmap:kind'],
  'highway', '#fdd38c',
  'major_road', '#fbbf24',
  'minor_road', '#94a3b8',
  'path', '#475569',
  /* default */ '#1f2937',
];

const roadWidthExpression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  0.1,
  10,
  0.4,
  12,
  0.8,
  14,
  2.5,
  16,
  5,
];

function createBasemapLayers(sourceId = PROTOMAPS_SOURCE_ID) {
  return [
    {
      id: 'basemap-earth',
      type: 'fill',
      source: sourceId,
      'source-layer': 'earth',
      paint: {
        'fill-color': '#050b17',
      },
    },
    {
      id: 'basemap-landuse',
      type: 'fill',
      source: sourceId,
      'source-layer': 'landuse',
      paint: {
        'fill-color': '#0b1428',
        'fill-opacity': 0.4,
      },
    },
    {
      id: 'basemap-water',
      type: 'fill',
      source: sourceId,
      'source-layer': 'water',
      paint: {
        'fill-color': '#0d1b35',
      },
    },
    {
      id: 'basemap-boundaries',
      type: 'line',
      source: sourceId,
      'source-layer': 'boundaries',
      layout: {
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#1f2937',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.2, 10, 0.6, 14, 1.4],
        'line-opacity': 0.6,
      },
    },
    {
      id: 'basemap-road-outline',
      type: 'line',
      source: sourceId,
      'source-layer': 'roads',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#010409',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 11, 0.8, 16, 5],
        'line-opacity': 0.85,
      },
    },
    {
      id: 'basemap-roads',
      type: 'line',
      source: sourceId,
      'source-layer': 'roads',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': roadColorExpression,
        'line-width': roadWidthExpression,
        'line-opacity': 0.95,
      },
    },
    {
      id: 'basemap-transit',
      type: 'line',
      source: sourceId,
      'source-layer': 'transit',
      paint: {
        'line-color': '#6366f1',
        'line-opacity': 0.6,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.2, 14, 1.5],
        'line-dasharray': [2, 2],
      },
    },
  ];
}

function createExtrusionLayer() {
  const extrusionHeight = createExtrusionHeightExpression();
  return {
    id: 'far-buildings-extrusion',
    type: 'fill-extrusion',
    source: 'buildings',
    'source-layer': 'buildings',
    minzoom: 14,
    filter: ['<=', ['coalesce', ['to-number', ['get', 'FAR_prediction']], 0], 2000],
    layout: {
      visibility: 'none',
    },
    paint: {
      'fill-extrusion-color': createPaletteExpression(),
      'fill-extrusion-opacity': 0.95,
      'fill-extrusion-height': extrusionHeight,
      'fill-extrusion-base': 0,
    },
  };
}

/**
 * Returns a ready-to-use Mapbox style object that renders FAR-colored building tiles over a Protomaps basemap.
 */
export function createSeoulPmtilesStyle({
  buildingsBaseUrl = getPmtilesArchiveBaseUrl(BUILDINGS_TILESET_ID),
  protomapsBaseUrl = getPmtilesArchiveBaseUrl(SEOUL_TILESET_ID),
} = {}) {
  const buildingsTiles = tileTemplate(buildingsBaseUrl);
  const protomapsTiles = tileTemplate(protomapsBaseUrl);
  const basemapLayers = createBasemapLayers();
  const extrusionLayer = createExtrusionLayer();

  return {
    version: 8,
    name: 'Seoul PMTiles',
    glyphs: DEFAULT_GLYPHS_URL,
    sources: {
      [PROTOMAPS_SOURCE_ID]: {
        type: 'vector',
        tiles: [protomapsTiles],
        minzoom: PROTOMAPS_MIN_ZOOM,
        maxzoom: PROTOMAPS_MAX_ZOOM,
        scheme: 'xyz',
      },
      buildings: {
        type: 'vector',
        tiles: [buildingsTiles],
        minzoom: BUILDINGS_MIN_ZOOM,
        maxzoom: BUILDINGS_MAX_ZOOM,
        scheme: 'xyz',
        promoteId: 'pnu',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#050b17',
        },
      },
      ...basemapLayers,
      {
        id: 'far-buildings-fill',
        type: 'fill',
        source: 'buildings',
        'source-layer': 'buildings',
        minzoom: 14,
        maxzoom: 24,
        filter: ['<=', ['coalesce', ['to-number', ['get', 'FAR_prediction']], 0], 2000],
        paint: {
          'fill-color': createPaletteExpression(),
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.55, 18, 0.85],
        },
      },
      extrusionLayer,
      {
        id: 'far-buildings-outline',
        type: 'line',
        source: 'buildings',
        'source-layer': 'buildings',
        minzoom: 12,
        filter: ['<=', ['coalesce', ['to-number', ['get', 'FAR_prediction']], 0], 2000],
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#ff3366', // Bright pink for selected
            '#0f172a',
          ],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            1.0,
            0.15,
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            4,
            0.3,
          ],
        },
      },
      {
        id: 'far-buildings-points',
        type: 'circle',
        source: 'buildings',
        'source-layer': 'buildings',
        minzoom: 12,
        maxzoom: 14,
        filter: ['<=', ['coalesce', ['to-number', ['get', 'FAR_prediction']], 0], 2000],
        paint: {
          'circle-color': createPaletteExpression(),
          'circle-opacity': 0.9,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 14, 1.25, 17, 3.5, 20, 6.5],
          'circle-stroke-width': 0,
        },
      },
    ],
  };
}

export { SEOUL_TILESET_ID, BUILDINGS_TILESET_ID };
