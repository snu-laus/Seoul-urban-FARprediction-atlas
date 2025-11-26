#!/usr/bin/env node
/**
 * Build PMTiles archive from GeoJSON.
 * Converts building footprints with FAR predictions to vector tiles.
 *
 * Usage: node buildBuildingsPmtiles.mjs [options]
 * Options:
 *   --input     Path to input GeoJSON (default: ../../buildings_merged.geojson)
 *   --output    Path to output PMTiles (default: ../buildings.pmtiles)
 *   --layer     Layer name (default: buildings)
 *   --minzoom   Minimum zoom level (default: 12)
 *   --maxzoom   Maximum zoom level (default: 13)
 */
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {bbox as turfBbox} from '@turf/bbox';
import {BufferWriter, S2PMTilesWriter, TileType, Compression} from 's2-pmtiles';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

const DEFAULTS = {
  input: '../../buildings_merged.geojson',
  output: '../buildings.pmtiles',
  layer: 'buildings',
  minzoom: 12,
  maxzoom: 13,
  summaryzoom: 13,
  name: 'Seoul FAR Buildings',
  description: 'Building footprints with FAR predictions converted from GeoJSON to PMTiles.',
};

const TILE_OPTIONS = {
  extent: 4096,
  buffer: 32,
  tolerance: 1,
  promoteId: 'pnu',
  debug: 0,
};

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(argv) {
  const args = {...DEFAULTS};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    const value = argv[i + 1];

    if (!(key in DEFAULTS)) {
      throw new Error(`Unknown option: --${key}`);
    }

    if (typeof DEFAULTS[key] === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Expected number for --${key}, got: ${value}`);
      }
      args[key] = parsed;
      i++;
    } else {
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i++;
    }
  }

  args.input = resolve(__dirname, args.input);
  args.output = resolve(__dirname, args.output);
  return args;
}

// ============================================================================
// Tile Utilities
// ============================================================================

const MAX_LATITUDE = 85.0511287798066;

function clampLatitude(lat) {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

function lonLatToTile(lon, lat, zoom) {
  const clampedLat = clampLatitude(lat);
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);

  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

function getTileRange(bounds, zoom) {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const topLeft = lonLatToTile(minLon, maxLat, zoom);
  const bottomRight = lonLatToTile(maxLon, minLat, zoom);

  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    maxX: Math.max(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

// ============================================================================
// Field Type Detection
// ============================================================================

function detectFieldTypes(features, sampleSize = 1000) {
  const types = {};

  for (let i = 0; i < Math.min(features.length, sampleSize); i++) {
    const props = features[i]?.properties;
    if (!props) continue;

    for (const [key, value] of Object.entries(props)) {
      if (types[key] || value == null) continue;

      const type = typeof value;
      types[key] =
        type === 'number' ? 'Float' :
        type === 'boolean' ? 'Boolean' : 'String';
    }
  }

  return types;
}

// ============================================================================
// PMTiles Builder
// ============================================================================

async function buildPmtiles(options) {
  console.log('Reading GeoJSON...');
  const geojsonRaw = await readFile(options.input, 'utf8');
  const geojson = JSON.parse(geojsonRaw);

  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error('Input must be a valid GeoJSON FeatureCollection');
  }

  console.log(`Processing ${geojson.features.length.toLocaleString()} features...`);

  const bounds = turfBbox(geojson);
  const summaryZoom = Math.min(Math.max(options.summaryzoom, options.minzoom), options.maxzoom);

  // Create tile index
  const tileIndex = geojsonvt(geojson, {
    ...TILE_OPTIONS,
    minZoom: options.minzoom,
    maxZoom: options.maxzoom,
  });

  // Write tiles
  const bufferWriter = new BufferWriter();
  const writer = new S2PMTilesWriter(bufferWriter, TileType.Pbf, Compression.Gzip);
  const tileCoords = [];
  let tileCount = 0;

  for (let z = options.minzoom; z <= options.maxzoom; z++) {
    const range = getTileRange(bounds, z);
    console.log(`Zoom ${z}: scanning tiles ${range.minX}-${range.maxX} x ${range.minY}-${range.maxY}`);

    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const tile = tileIndex.getTile(z, x, y);
        if (!tile?.features?.length) continue;

        const tileBuffer = vtpbf.fromGeojsonVt({[options.layer]: tile}, {version: 2});
        await writer.writeTileXYZ(z, x, y, new Uint8Array(tileBuffer));
        tileCount++;

        if (z === summaryZoom) {
          tileCoords.push([z, x, y]);
        }
      }
    }
  }

  if (tileCount === 0) {
    throw new Error('No tiles generated - check input data and zoom levels');
  }

  // Write metadata
  const fields = detectFieldTypes(geojson.features);
  const metadata = {
    tilejson: '3.0.0',
    name: options.name,
    description: options.description,
    version: '1.0.0',
    minzoom: options.minzoom,
    maxzoom: options.maxzoom,
    summaryzoom: summaryZoom,
    bounds,
    vector_layers: [{
      id: options.layer,
      description: options.description,
      minzoom: options.minzoom,
      maxzoom: options.maxzoom,
      version: 2,
      fields,
    }],
  };

  await writer.commit(metadata);
  const pmtilesBytes = bufferWriter.commit();

  // Write output files
  await mkdir(dirname(options.output), {recursive: true});
  await writeFile(options.output, pmtilesBytes);

  const summary = {
    tiles: tileCount,
    tileCoords,
    output: options.output,
    size: pmtilesBytes.length,
    layer: options.layer,
    bounds,
    minzoom: options.minzoom,
    maxzoom: options.maxzoom,
    summaryzoom: summaryZoom,
    fields,
    geojsonFeatures: geojson.features.length,
    tileVersion: 2,
  };

  await writeFile(`${options.output}.json`, JSON.stringify(summary, null, 2) + '\n');

  return summary;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('Building PMTiles archive...');
  console.log(`  Input:  ${options.input}`);
  console.log(`  Output: ${options.output}`);
  console.log(`  Zoom:   ${options.minzoom}-${options.maxzoom}`);

  const stats = await buildPmtiles(options);

  console.log('\n✓ Build complete');
  console.log(`  Tiles:    ${stats.tiles.toLocaleString()}`);
  console.log(`  Features: ${stats.geojsonFeatures.toLocaleString()}`);
  console.log(`  Size:     ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((error) => {
  console.error('\n✗ Build failed:', error.message);
  process.exitCode = 1;
});
