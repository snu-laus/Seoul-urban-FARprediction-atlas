#!/usr/bin/env node
/**
 * Debug a specific tile from a PMTiles archive.
 * Usage: node debugPmtiles.mjs [file] [z] [x] [y]
 * Example: node debugPmtiles.mjs ../buildings.pmtiles 13 6983 3174
 */
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openArchive, decodeTile} from './lib/pmtiles-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const [
    fileArg = '../buildings.pmtiles',
    zArg = '13',
    xArg = '6983',
    yArg = '3174',
  ] = process.argv.slice(2);

  const z = Number(zArg);
  const x = Number(xArg);
  const y = Number(yArg);

  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Invalid z/x/y coordinates. Usage: node debugPmtiles.mjs [file] [z] [x] [y]');
  }

  return {
    filePath: resolve(__dirname, fileArg),
    z,
    x,
    y,
  };
}

function summarizeLayers(vt, x, y, z) {
  return Object.keys(vt.layers).map((layerName) => {
    const layer = vt.layers[layerName];
    const sampleCount = Math.min(layer.length, 5);
    const samples = [];

    for (let i = 0; i < sampleCount; i++) {
      const feature = layer.feature(i);
      const geojson = feature.toGeoJSON(x, y, z);
      samples.push({
        id: feature.id ?? null,
        properties: geojson.properties,
        geomType: geojson.geometry?.type ?? null,
        coordSample: geojson.geometry?.coordinates?.[0]?.[0] ?? null,
      });
    }

    return {
      layerName,
      featureCount: layer.length,
      extent: layer.extent,
      samples,
    };
  });
}

async function main() {
  const {filePath, z, x, y} = parseArgs();
  const {archive, source} = openArchive(filePath);

  try {
    const tile = await archive.getZxy(z, x, y);
    if (!tile) {
      console.error(`Tile not found: ${z}/${x}/${y}`);
      process.exitCode = 1;
      return;
    }

    const vt = decodeTile(tile.data);
    const result = {
      file: filePath,
      tile: {z, x, y},
      layers: summarizeLayers(vt, x, y, z),
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await source.close();
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});
