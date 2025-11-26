import {addDataToMap, MapStateActions} from '@kepler.gl/actions';
import {DatasetType, RemoteTileFormat, REMOTE_TILE, ALL_FIELD_TYPES} from '@kepler.gl/constants';

import viridis from './assets/viridis';
import {PMTILES_STYLE_ID, BUILDINGS_TILESET_ID, getPmtilesArchiveBaseUrl} from './pmtilesStyle';

const DATASET_ID = 'buildings';
const VECTOR_LAYER_ID = 'buildings-far-3d';
const TILESET_ID = BUILDINGS_TILESET_ID;
const SUMMARY_FILENAME = 'summary.json';
const METADATA_FILENAME = 'metadata.json';
const DEFAULT_CENTER = {longitude: 126.978, latitude: 37.5665, zoom: 13};
const FALLBACK_FIELD = {name: 'value', fieldType: ALL_FIELD_TYPES.real};

const STATUS_KEYS = {
  status: '__BUILDINGS_DATASET_STATUS__',
  rows: '__BUILDINGS_DATASET_ROWS__',
  duration: '__BUILDINGS_LOAD_TIME_MS__',
  summary: '__BUILDINGS_DATASET_SUMMARY__',
};

const FIELD_TYPE_MAP = {
  string: ALL_FIELD_TYPES.string,
  varchar: ALL_FIELD_TYPES.string,
  float: ALL_FIELD_TYPES.real,
  number: ALL_FIELD_TYPES.real,
  double: ALL_FIELD_TYPES.real,
  integer: ALL_FIELD_TYPES.integer,
  int: ALL_FIELD_TYPES.integer,
  boolean: ALL_FIELD_TYPES.boolean,
  bool: ALL_FIELD_TYPES.boolean,
};

function nowMs() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  return Date.now();
}

function normalizeTileCoords(rawCoords) {
  if (!Array.isArray(rawCoords)) {
    return [];
  }

  return rawCoords
    .map((coord) => {
      if (!Array.isArray(coord) || coord.length !== 3) {
        return null;
      }
      const [z, x, y] = coord.map(Number);
      if (![z, x, y].every(Number.isFinite)) {
        return null;
      }
      return {z, x, y, key: `${z}/${x}/${y}`};
    })
    .filter(Boolean);
}

function lonFromTile(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function latFromTile(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileBounds({z, x, y}) {
  const minLon = lonFromTile(x, z);
  const maxLon = lonFromTile(x + 1, z);
  const maxLat = latFromTile(y, z);
  const minLat = latFromTile(y + 1, z);
  return [minLon, minLat, maxLon, maxLat];
}

function deriveBounds(coords = []) {
  if (!coords.length) {
    return null;
  }

  return coords.reduce(
    (acc, coord) => {
      const [minLon, minLat, maxLon, maxLat] = tileBounds(coord);
      return [
        Math.min(acc[0], minLon),
        Math.min(acc[1], minLat),
        Math.max(acc[2], maxLon),
        Math.max(acc[3], maxLat),
      ];
    },
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function computeCenter(bounds, zoom) {
  if (Array.isArray(bounds) && bounds.length === 4) {
    const longitude = (bounds[0] + bounds[2]) / 2;
    const latitude = (bounds[1] + bounds[3]) / 2;
    return {
      longitude,
      latitude,
      zoom: Number.isFinite(zoom) ? zoom : DEFAULT_CENTER.zoom,
    };
  }

  return {...DEFAULT_CENTER};
}

async function fetchJson(url, errorLabel) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `${errorLabel ?? 'Request'} failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

function mapFieldEntries(summaryFields = {}) {
  return Object.entries(summaryFields).map(([name, typeValue]) => {
    const normalizedType = FIELD_TYPE_MAP[String(typeValue || '').toLowerCase()] ?? ALL_FIELD_TYPES.string;
    return {
      name,
      rawType: typeValue,
      fieldType: normalizedType,
    };
  });
}

function buildKeplerFields(summaryFields) {
  if (!Array.isArray(summaryFields) || !summaryFields.length) {
    return [
      {
        name: FALLBACK_FIELD.name,
        type: FALLBACK_FIELD.fieldType,
        format: '',
      },
    ];
  }

  return summaryFields.map((field) => ({
    name: field.name,
    type: field.fieldType ?? ALL_FIELD_TYPES.string,
    format: '',
  }));
}

function buildTooltipEntries(summaryFields, fallbackEntries) {
  if (Array.isArray(summaryFields) && summaryFields.length) {
    return summaryFields.map((field) => ({name: field.name, format: null}));
  }
  return fallbackEntries;
}

function pickFieldName(fields, predicate, fallbackName) {
  const found = fields.find(predicate);
  if (found) {
    return found.name;
  }
  return fallbackName;
}

function bytesToMegabytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return null;
  }
  return bytes / 1024 / 1024;
}

function setGlobalStatus({status, rows, duration, summary}) {
  if (typeof globalThis === 'undefined') {
    return;
  }

  globalThis[STATUS_KEYS.status] = status;
  if (rows !== undefined) {
    globalThis[STATUS_KEYS.rows] = rows;
  }
  if (duration !== undefined) {
    globalThis[STATUS_KEYS.duration] = duration;
  }
  if (summary !== undefined) {
    globalThis[STATUS_KEYS.summary] = summary;
  }
}

function buildLayerConfig({colorFieldName, colorFieldType, labelFieldName}) {
  return {
    id: VECTOR_LAYER_ID,
    type: 'vectorTile',
    config: {
      dataId: DATASET_ID,
      label: 'FAR Extrusion',
      color: [247, 111, 74],
      isVisible: false,  // Hidden - use Mapbox style layers for rendering (enables hover)
      columns: {},
      visConfig: {
        opacity: 0.85,
        strokeOpacity: 0.2,
        stroked: false,
        filled: true,
        thickness: 1,
        colorRange: {
          name: 'Sunset Glow',
          type: 'custom',
          category: 'Custom',
          colors: viridis,
        },
        elevationScale: 3,
        enable3d: false,
        coverage: 1,
      },
      textLabel: [
        {
          field: labelFieldName
            ? {
                name: labelFieldName,
                type: ALL_FIELD_TYPES.string,
              }
            : null,
          color: [255, 255, 255],
          size: 12,
          offset: [0, 0],
          anchor: 'start',
          alignment: 'left',
        },
      ],
    },
    visualChannels: {
      colorField: colorFieldName
        ? {
            name: colorFieldName,
            type: colorFieldType,
          }
        : null,
      colorScale: 'quantile',
      strokeColorField: null,
      strokeColorScale: 'quantile',
      sizeField: colorFieldName
        ? {
            name: colorFieldName,
            type: colorFieldType,
          }
        : null,
      sizeScale: 'linear',
      elevationField: colorFieldName
        ? {
            name: colorFieldName,
            type: colorFieldType,
          }
        : null,
      elevationScale: 'linear',
    },
  };
}

function buildMapConfig(layerInputs, tooltipFields) {
  return {
    mapStyle: {
      styleType: PMTILES_STYLE_ID,
    },
    visState: {
      layerBlending: 'normal',
      layers: [buildLayerConfig(layerInputs)],
      interactionConfig: {
        tooltip: {
          enabled: true,
          fieldsToShow: {
            [DATASET_ID]: tooltipFields,
          },
        },
      },
    },
  };
}

function buildDatasetMetadata({
  baseUrl,
  summary,
  normalizedTileCoords,
  bounds,
  center,
  summaryFields,
}) {
  return {
    type: REMOTE_TILE,
    remoteTileFormat: RemoteTileFormat.MVT,
    tilesetDataUrl: `${baseUrl}/{z}/{x}/{y}.pbf`,
    tilesetMetadataUrl: `${baseUrl}/${METADATA_FILENAME}`,
    bounds,
    center: [center.longitude, center.latitude, center.zoom],
    minZoom: Number.isFinite(summary.minzoom) ? summary.minzoom : undefined,
    maxZoom: Number.isFinite(summary.maxzoom) ? summary.maxzoom : undefined,
    summaryZoom: center.zoom,
    tileCoords: normalizedTileCoords,
    tileCount: Number.isFinite(summary.tiles) ? summary.tiles : normalizedTileCoords.length,
    archivePath: summary.output ?? null,
    archiveSizeBytes: Number.isFinite(summary.size) ? summary.size : null,
    geojsonFeatures: Number.isFinite(summary.geojsonFeatures) ? summary.geojsonFeatures : null,
    tileVersion: summary.tileVersion ?? null,
    layer: summary.layer ?? 'buildings',
    fields: summaryFields,
  };
}

function buildSummarySnapshot({summary, metadata, normalizedTileCoords, center, colorFieldName, labelFieldName}) {
  return {
    layerId: metadata.layer,
    declaredTileCount: summary.tiles ?? null,
    resolvedTileCount: metadata.tileCount,
    tileKeys: normalizedTileCoords.map((coord) => coord.key),
    archivePath: metadata.archivePath,
    archiveSizeBytes: metadata.archiveSizeBytes,
    archiveSizeMegabytes: bytesToMegabytes(metadata.archiveSizeBytes),
    minZoom: metadata.minZoom,
    maxZoom: metadata.maxZoom,
    summaryZoom: metadata.summaryZoom,
    center,
    geojsonFeatures: metadata.geojsonFeatures,
    tileVersion: metadata.tileVersion,
    valueField: colorFieldName,
    labelField: labelFieldName,
  };
}

function buildDataset(metadata, datasetLabel, summaryFields) {
  return {
    info: {
      label: datasetLabel,
      id: DATASET_ID,
    },
    data: {
      fields: buildKeplerFields(summaryFields),
      rows: [],
    },
    type: DatasetType.VECTOR_TILE,
    metadata,
  };
}

export async function loadBuildings(dispatch) {
  const loadStart = nowMs();
  const baseUrl = getPmtilesArchiveBaseUrl(TILESET_ID);
  const summaryUrl = `${baseUrl}/${SUMMARY_FILENAME}`;

  setGlobalStatus({status: 'fetching-summary', rows: 0, duration: 0});

  let summary;
  try {
    summary = await fetchJson(summaryUrl, 'PMTiles summary request');
  } catch (error) {
    setGlobalStatus({status: 'error'});
    throw error;
  }

  const normalizedTileCoords = normalizeTileCoords(summary.tileCoords);
  const derivedBounds = deriveBounds(normalizedTileCoords);
  const bounds = Array.isArray(summary.bounds) && summary.bounds.length === 4 ? summary.bounds : derivedBounds;
  const center = computeCenter(bounds, summary.summaryzoom);
  const summaryFields = mapFieldEntries(summary.fields);
  const colorFieldName = pickFieldName(
    summaryFields,
    (field) => field.fieldType === ALL_FIELD_TYPES.real || field.fieldType === ALL_FIELD_TYPES.integer,
    FALLBACK_FIELD.name,
  );
  const colorFieldType =
    summaryFields.find((field) => field.name === colorFieldName)?.fieldType ?? FALLBACK_FIELD.fieldType;
  const labelFieldName = pickFieldName(
    summaryFields,
    (field) => field.fieldType === ALL_FIELD_TYPES.string,
    'pnu',
  );

  const metadata = buildDatasetMetadata({
    baseUrl,
    summary,
    normalizedTileCoords,
    bounds,
    center,
    summaryFields,
  });
  const datasetLabel = summary.layer ?? 'Buildings';
  const dataset = buildDataset(metadata, datasetLabel, summaryFields);
  const tooltipFields = buildTooltipEntries(summaryFields, [
    {name: labelFieldName ?? 'pnu', format: null},
    {name: colorFieldName ?? FALLBACK_FIELD.name, format: '.2f'},
  ]);

  dispatch(
    addDataToMap({
      datasets: [dataset],
      options: {
        centerMap: false,
        readOnly: false,
        keepExistingConfig: false,
      },
      config: buildMapConfig({
        colorFieldName,
        colorFieldType,
        labelFieldName,
      }, tooltipFields),
    }),
  );

  dispatch(
    MapStateActions.updateMap(
      {
        longitude: center.longitude,
        latitude: center.latitude,
        zoom: center.zoom,
        bearing: 0,
        pitch: 0,
        dragRotate: false,
      },
      0,
    ),
  );

  const loadDuration = Math.round(nowMs() - loadStart);
  const summarySnapshot = buildSummarySnapshot({
    summary,
    metadata,
    normalizedTileCoords,
    center,
    colorFieldName,
    labelFieldName,
  });

  setGlobalStatus({
    status: 'ready',
    rows: metadata.geojsonFeatures ?? 0,
    duration: loadDuration,
    summary: summarySnapshot,
  });

  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.buildingsDataset = 'ready';
  }

  if (typeof console !== 'undefined') {
    console.log('[loadData] vector tile dataset registered', {
      baseUrl,
      metadataUrl: `${baseUrl}/${METADATA_FILENAME}`,
      summaryUrl,
      datasetLabel,
      tileCount: metadata.tileCount,
      declaredTiles: summary.tiles,
      geojsonFeatures: metadata.geojsonFeatures,
      tileVersion: metadata.tileVersion,
      archiveSizeMB: bytesToMegabytes(metadata.archiveSizeBytes),
      bounds,
      center,
      colorFieldName,
      labelFieldName,
    });
  }
}
