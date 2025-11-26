#!/usr/bin/env node
/**
 * Inspect PMTiles archive metadata and header.
 * Usage: node inspectPmtiles.mjs [file]
 * Example: node inspectPmtiles.mjs ../buildings.pmtiles
 */
import {readFile} from 'node:fs/promises';
import {brotliDecompressSync, gunzipSync} from 'node:zlib';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Compression, bytesToHeader} from 'pmtiles';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEADER_LENGTH = 512;

function parseMetadataBytes(arrayBuffer, header) {
  const {jsonMetadataOffset, jsonMetadataLength, internalCompression} = header;

  if (typeof jsonMetadataOffset !== 'number' || typeof jsonMetadataLength !== 'number') {
    return null;
  }

  let metadataBytes = new Uint8Array(
    arrayBuffer.slice(jsonMetadataOffset, jsonMetadataOffset + jsonMetadataLength)
  );

  if (!metadataBytes.length) {
    return null;
  }

  // Decompress if needed
  if (internalCompression === Compression.Gzip) {
    metadataBytes = gunzipSync(metadataBytes);
  } else if (internalCompression === Compression.Brotli) {
    metadataBytes = brotliDecompressSync(metadataBytes);
  }

  const decoded = new TextDecoder('utf-8').decode(metadataBytes);
  return JSON.parse(decoded);
}

function extractLayerSummaries(metadata) {
  if (!metadata) return [];

  const vectorLayers =
    metadata.vector_layers ??
    metadata.layers ??
    metadata.tilejson?.vector_layers ??
    metadata.tilestats?.layers ??
    [];

  if (!Array.isArray(vectorLayers)) return [];

  return vectorLayers.map((layer) => ({
    id: layer.id ?? layer.layer ?? 'unknown',
    minzoom: layer.minzoom ?? layer.minZoom ?? metadata.minzoom ?? null,
    maxzoom: layer.maxzoom ?? layer.maxZoom ?? metadata.maxzoom ?? null,
    fieldCount: typeof layer.fields === 'object' ? Object.keys(layer.fields).length : null,
    fields: layer.fields ?? null,
  }));
}

async function main() {
  const inputArg = process.argv[2] ?? '../buildings.pmtiles';
  const filePath = resolve(__dirname, inputArg);

  const fileBuffer = await readFile(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );

  const header = bytesToHeader(arrayBuffer.slice(0, HEADER_LENGTH));

  let metadata = null;
  let parseError = null;

  try {
    metadata = parseMetadataBytes(arrayBuffer, header);
  } catch (error) {
    parseError = error.message;
  }

  const result = {
    file: filePath,
    fileSize: {
      bytes: fileBuffer.byteLength,
      megabytes: (fileBuffer.byteLength / 1024 / 1024).toFixed(2),
    },
    header: {
      version: header.specVersion,
      tileType: header.tileType,
      tileCompression: header.tileCompression,
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      numTileEntries: header.numTileEntries,
      numAddressedTiles: header.numAddressedTiles,
    },
    metadata: metadata
      ? {
          name: metadata.name ?? null,
          description: metadata.description ?? null,
          minzoom: metadata.minzoom ?? null,
          maxzoom: metadata.maxzoom ?? null,
          bounds: metadata.bounds ?? null,
          layers: extractLayerSummaries(metadata),
        }
      : {error: parseError ?? 'No metadata found'},
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exitCode = 1;
});
