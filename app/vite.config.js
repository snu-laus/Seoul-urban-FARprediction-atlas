import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open, readFile} from 'node:fs/promises';
import {PMTiles} from 'pmtiles';
import {Buffer} from 'node:buffer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PMTILES_ARCHIVES = [
  {id: 'seoul', filename: 'seoul.pmtiles'},  // Protomaps basemap (roads, water, boundaries)
  {id: 'buildings', filename: 'buildings.pmtiles', summaryFilename: 'buildings.pmtiles.json'},
];

// https://vite.dev/config/
export default defineConfig({
  // Base path for GitHub Pages deployment (e.g., '/repo-name/')
  // Set VITE_BASE_PATH env var or defaults to '/' for local dev
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), pmtilesServerPlugin()],
  resolve: {
    alias: {
      events: resolve(__dirname, 'src/shims/events.js'),
      assert: 'assert',
      'node:assert': 'assert',
    },
  },
  optimizeDeps: {
    include: ['@kepler.gl/components', 'mapbox-gl', 'deck.gl', 'assert'],
    exclude: [
      '@deck.gl/widgets',
      '@luma.gl/gltf',
      '@luma.gl/engine',
      '@luma.gl/constants',
      '@luma.gl/shadertools',
    ],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  build: {
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        // Disable code splitting to avoid deck.gl/luma.gl circular dependency issues
        inlineDynamicImports: true,
      },
    },
  },
});

class NodeFileSource {
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

function pmtilesServerPlugin() {
  return {
    name: 'pmtiles-server',
    apply: 'serve',
    configureServer(server) {
      const handlers = createPmtilesHandlers(server.config.logger, PMTILES_ARCHIVES);
      handlers.forEach(({id, middleware, close}) => {
        server.middlewares.use(`/pmtiles/${id}`, middleware);
        server.httpServer?.once('close', close);
      });
    },
    configurePreviewServer(server) {
      const handlers = createPmtilesHandlers(server.config.logger, PMTILES_ARCHIVES);
      handlers.forEach(({id, middleware, close}) => {
        server.middlewares.use(`/pmtiles/${id}`, middleware);
        server.httpServer?.once('close', close);
      });
    },
  };
}

function createPmtilesHandlers(logger, archives) {
  return archives.map(({id, filename, summaryFilename}) => {
    const pmtilesPath = resolve(__dirname, filename);
    const summaryPath = summaryFilename ? resolve(__dirname, summaryFilename) : null;
    const source = new NodeFileSource(pmtilesPath);
    const archive = new PMTiles(source);
    let headerPromise;
    let metadataPromise;
    let summaryPromise;

    async function getHeader() {
      if (!headerPromise) {
        headerPromise = archive.getHeader().then((header) => {
          console.log('[pmtiles] header', {
            id,
            tileCompression: header.tileCompression,
            minZoom: header.minZoom,
            maxZoom: header.maxZoom,
          });
          return header;
        });
      }
      return headerPromise;
    }

    async function getMetadata() {
      if (!metadataPromise) {
        metadataPromise = archive.getMetadata().catch((error) => {
          metadataPromise = null;
          throw error;
        });
      }
      return metadataPromise;
    }

    async function getSummary() {
      if (!summaryPath) {
        return null;
      }

      if (!summaryPromise) {
        summaryPromise = readFile(summaryPath, 'utf8')
          .then((contents) => JSON.parse(contents))
          .catch((error) => {
            summaryPromise = null;
            throw error;
          });
      }

      return summaryPromise;
    }

    const middleware = async (req, res, next) => {
      if (!req.url) {
        next();
        return;
      }

      let pathname = req.url;
      try {
        const composedUrl = new URL(req.url, 'http://localhost');
        pathname = composedUrl.pathname;
      } catch {
        // ignore URL parsing errors and fall back to original path
      }

      if (pathname === '/metadata.json') {
        try {
          const metadata = await getMetadata();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.end(JSON.stringify(metadata));
        } catch (error) {
          logger.error(
            `Failed to serve PMTiles metadata ${id}: ${error instanceof Error ? error.message : error}`,
          );
          res.statusCode = 500;
          res.end();
        }
        return;
      }

      if (summaryPath && pathname === '/summary.json') {
        try {
          const summary = await getSummary();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.end(JSON.stringify(summary));
        } catch (error) {
          logger.error(
            `Failed to serve PMTiles summary ${id}: ${error instanceof Error ? error.message : error}`,
          );
          res.statusCode = 500;
          res.end();
        }
        return;
      }

      const match = pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      if (!match) {
        next();
        return;
      }

      const [, zStr, xStr, yStr] = match;
      const z = Number(zStr);
      const x = Number(xStr);
      const y = Number(yStr);

      try {
        await getHeader();
        const tile = await archive.getZxy(z, x, y);

        if (!tile) {
          res.statusCode = 204;
          res.end();
          return;
        }

        const payload = Buffer.from(tile.data);

        res.setHeader('Content-Type', 'application/x-protobuf');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Content-Length', String(payload.length));

        console.log(`[pmtiles:${id}] ${z}/${x}/${y} -> payload=${payload.length} bytes`);
        res.end(payload);
      } catch (error) {
        logger.error(
          `Failed to serve PMTiles tile ${id} ${z}/${x}/${y}: ${error instanceof Error ? error.message : error}`,
        );
        res.statusCode = 500;
        res.end();
      }
    };

    const close = async () => {
      await source.close();
    };

    return {id, middleware, close};
  });
}
