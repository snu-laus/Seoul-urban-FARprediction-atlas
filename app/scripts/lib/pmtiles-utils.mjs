/**
 * Shared utilities for PMTiles scripts.
 */
import {open} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import {PMTiles} from 'pmtiles';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';

/**
 * Node.js file source adapter for PMTiles.
 * Provides random byte access to a local file.
 */
export class NodeFileSource {
  constructor(path) {
    this.path = path;
    this.handlePromise = null;
  }

  async getHandle() {
    if (!this.handlePromise) {
      this.handlePromise = open(this.path, 'r');
    }
    return this.handlePromise;
  }

  async getBytes(offset, length) {
    const handle = await this.getHandle();
    const buffer = Buffer.alloc(length);
    const {bytesRead} = await handle.read(buffer, 0, length, offset);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
    return {data: arrayBuffer};
  }

  getKey() {
    return this.path;
  }

  async close() {
    if (this.handlePromise) {
      const handle = await this.handlePromise;
      await handle.close();
      this.handlePromise = null;
    }
  }
}

/**
 * Opens a PMTiles archive from a file path.
 * @param {string} filePath - Absolute path to the .pmtiles file
 * @returns {{archive: PMTiles, source: NodeFileSource}}
 */
export function openArchive(filePath) {
  const source = new NodeFileSource(filePath);
  const archive = new PMTiles(source);
  return {archive, source};
}

/**
 * Decodes a raw tile buffer into a VectorTile.
 * @param {ArrayBuffer|Uint8Array} data - Raw tile data
 * @returns {VectorTile}
 */
export function decodeTile(data) {
  const buffer = Buffer.from(data);
  return new VectorTile(new Pbf(buffer));
}

/**
 * Extracts GeoJSON features from a vector tile layer.
 * @param {object} layer - Vector tile layer
 * @param {number} x - Tile X coordinate
 * @param {number} y - Tile Y coordinate
 * @param {number} z - Tile zoom level
 * @param {number} [limit] - Max features to extract (default: all)
 * @returns {object[]} Array of GeoJSON features
 */
export function extractFeatures(layer, x, y, z, limit = Infinity) {
  const count = Math.min(layer.length, limit);
  const features = [];
  for (let i = 0; i < count; i++) {
    features.push(layer.feature(i).toGeoJSON(x, y, z));
  }
  return features;
}

export {PMTiles, VectorTile, Pbf, Buffer};
