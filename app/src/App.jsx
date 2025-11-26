import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import AutoSizer from 'react-virtualized/dist/commonjs/AutoSizer';
import {
  MapStateActions,
  MapStyleActions,
  VisStateActions,
  toggleSplitMap,
} from '@kepler.gl/actions';

import './App.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import './keplerTheme.css';
import { loadBuildings } from './loadData';
import KeplerGl from './keplerUI';
import {
  PMTILES_STYLE_ID,
  createSeoulPmtilesStyle,
  createExtrusionHeightExpression,
} from './pmtilesStyle';

// Layer IDs for click detection - use fill layer for polygons (zoom 14+)
// Points layer is excluded because circle geometries return all circles within radius
const FILL_LAYER_ID = 'far-buildings-fill';
const POINTS_LAYER_ID = 'far-buildings-points';
const EXTRUSION_LAYER_ID = 'far-buildings-extrusion';

// Minimum zoom level where fill layer is visible
const FILL_LAYER_MIN_ZOOM = 14;

const resolveMapInstance = (mapLike) => {
  if (!mapLike) {
    return null;
  }

  if (typeof mapLike.getMap === 'function') {
    const directMap = mapLike.getMap();
    if (directMap) {
      return directMap;
    }
  }

  if (mapLike.map) {
    if (typeof mapLike.map.getMap === 'function') {
      const nestedMap = mapLike.map.getMap();
      if (nestedMap) {
        return nestedMap;
      }
    }

    return mapLike.map;
  }

  return mapLike;
};

function App() {
  const dispatch = useDispatch();
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  const isTestMode = import.meta.env.VITE_APP_TEST_MODE === 'true';

  const splitCount = useSelector(
    (state) => state.keplerGl?.map?.uiState?.splitMaps?.length ?? 0,
  );
  const isSplit = splitCount > 0;
  const farLayer = useSelector((state) =>
    state.keplerGl?.map?.visState?.layers?.find((layer) => layer.id === 'buildings-far-3d'),
  );
  const isExtrusionEnabled = Boolean(farLayer?.config?.visConfig?.enable3d);
  const mapboxRef = useRef(null);
  const hoverDetachRef = useRef(null);
  const hoverStyleListenerRef = useRef(null);
  const extrusionEnabledRef = useRef(isExtrusionEnabled);
  const [hoverInfo, setHoverInfo] = useState(null);

  const [loadInfo, setLoadInfo] = useState(() => ({
    status:
      typeof window !== 'undefined'
        ? window.__BUILDINGS_DATASET_STATUS__ ?? 'idle'
        : 'idle',
    rows:
      typeof window !== 'undefined'
        ? window.__BUILDINGS_DATASET_ROWS__ ?? 0
        : 0,
    duration:
      typeof window !== 'undefined'
        ? window.__BUILDINGS_LOAD_TIME_MS__ ?? null
        : null,
  }));
  const didRequestDataset = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const pmtilesStyle = createSeoulPmtilesStyle();

    // Helpful trace during development to confirm PMTiles style registration.
    console.log('[pmtiles] Loading custom style', {
      basemap: pmtilesStyle.sources?.protomaps?.tiles,
      buildings: pmtilesStyle.sources?.buildings?.tiles,
    });

    dispatch(
      MapStyleActions.loadMapStyles({
        [PMTILES_STYLE_ID]: {
          id: PMTILES_STYLE_ID,
          label: 'Seoul PMTiles',
          url: null,
          layerGroups: [],
          style: pmtilesStyle,
        },
      }),
    );

    dispatch(MapStyleActions.mapStyleChange(PMTILES_STYLE_ID));

    return undefined;
  }, [dispatch]);

  useEffect(() => {
    // Load GeoJSON dataset once Redux store is ready
    if (didRequestDataset.current) {
      return undefined;
    }

    didRequestDataset.current = true;

    let cancelled = false;

    loadBuildings(dispatch).catch((error) => {
      if (cancelled) {
        return;
      }

      if (typeof globalThis !== 'undefined') {
        globalThis.__BUILDINGS_DATASET_STATUS__ = 'error';
      }
      console.error('Unable to load buildings dataset', error);
    });

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLoadInfo({
        status: window.__BUILDINGS_DATASET_STATUS__ ?? 'idle',
        rows: window.__BUILDINGS_DATASET_ROWS__ ?? 0,
        duration: window.__BUILDINGS_LOAD_TIME_MS__ ?? null,
      });

      if (window.__BUILDINGS_DATASET_STATUS__ === 'ready') {
        window.clearInterval(interval);
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, []);

  const handleToggleSplit = useCallback(() => {
    dispatch(toggleSplitMap());
  }, [dispatch]);

  const displayStatus = useMemo(() => {
    return (loadInfo.status ?? 'idle').replace(/-/g, ' ').toUpperCase();
  }, [loadInfo.status]);

  const displayRows = useMemo(() => {
    if (typeof loadInfo.rows === 'number') {
      return loadInfo.rows.toLocaleString();
    }
    return loadInfo.rows ?? '—';
  }, [loadInfo.rows]);

  const didRequestWebGLExtension = useRef(false);

  const ensureBlendExtension = useCallback((map) => {
    if (!map || didRequestWebGLExtension.current) {
      return;
    }

    didRequestWebGLExtension.current = true;

    try {
      const canvas = map.getCanvas?.();
      if (!canvas) {
        return;
      }

      const glContext =
        canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl');

      if (!glContext) {
        console.warn('[pmtiles] Unable to access WebGL context for blend extension');
        return;
      }

      const isBlendExtensionAvailable = glContext.getExtension('EXT_blend_minmax');

      if (!isBlendExtensionAvailable) {
        console.warn('[pmtiles] EXT_blend_minmax extension unavailable; deck blending may warn');
      }
    } catch (error) {
      console.warn('[pmtiles] Failed to initialize EXT_blend_minmax extension', error);
    }
  }, []);

  const syncExtrusionVisibility = useCallback(
    (enabled) => {
      const map = mapboxRef.current;
      if (!map || typeof map.getLayer !== 'function') {
        return;
      }

      const apply = () => {
        if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
          return false;
        }

        let hasLayer = false;
        try {
          hasLayer = Boolean(map.getLayer(EXTRUSION_LAYER_ID));
        } catch {
          return false;
        }

        if (!hasLayer) {
          return false;
        }
        const heightExpression = enabled ? createExtrusionHeightExpression() : 0;
        map.setPaintProperty(EXTRUSION_LAYER_ID, 'fill-extrusion-height', heightExpression);
        const visibility = enabled ? 'visible' : 'none';
        const currentVisibility = map.getLayoutProperty(EXTRUSION_LAYER_ID, 'visibility');
        if (currentVisibility !== visibility) {
          map.setLayoutProperty(EXTRUSION_LAYER_ID, 'visibility', visibility);
        }
        return true;
      };

      if (!apply()) {
        const handleStyleOnce = () => {
          if (apply()) {
            map.off('styledata', handleStyleOnce);
          }
        };
        map.on('styledata', handleStyleOnce);
      }
    },
    [],
  );

  useEffect(() => {
    extrusionEnabledRef.current = isExtrusionEnabled;
  }, [isExtrusionEnabled]);

  const attachHoverHandlers = useCallback((map) => {
    if (!map) {
      return false;
    }

    // Check if fill layer exists (we only use fill layer for accurate polygon detection)
    const hasFillLayer = Boolean(map.getLayer(FILL_LAYER_ID));
    const hasPointsLayer = Boolean(map.getLayer(POINTS_LAYER_ID));

    console.log('[click] Layer check:', {
      fillLayer: hasFillLayer,
      pointsLayer: hasPointsLayer,
      currentZoom: map.getZoom?.()?.toFixed(1)
    });

    if (!hasFillLayer && !hasPointsLayer) {
      console.warn('[click] No building layers found, click disabled');
      return false;
    }

    if (hoverDetachRef.current) {
      console.log('[click] Detaching previous handlers');
      hoverDetachRef.current();
    }

    console.log('[click] Setting up click handlers...');

    let selectedFeatureId = null;

    /**
     * Query features at a point using ONLY the fill layer for accurate polygon hit testing.
     * The points (circle) layer returns all circles within radius, which is imprecise.
     */
    const queryFeaturesAtPoint = (point) => {
      const zoom = map.getZoom();

      // Only query fill layer - it provides accurate polygon hit testing
      // The fill layer is visible at zoom 14+
      if (zoom >= FILL_LAYER_MIN_ZOOM && map.getLayer(FILL_LAYER_ID)) {
        const features = map.queryRenderedFeatures(
          [point.x, point.y],
          { layers: [FILL_LAYER_ID] }
        );
        console.log(`[click] Fill layer query at zoom ${zoom.toFixed(1)}: ${features.length} features`);
        return features;
      }

      // At low zoom (< 14), buildings are rendered as circles via points layer
      // For circles, use a small bounding box and take the closest one
      if (zoom < FILL_LAYER_MIN_ZOOM && map.getLayer(POINTS_LAYER_ID)) {
        // Create a small bounding box (5px radius) around click point
        const tolerance = 5;
        const bbox = [
          [point.x - tolerance, point.y - tolerance],
          [point.x + tolerance, point.y + tolerance]
        ];

        const features = map.queryRenderedFeatures(bbox, { layers: [POINTS_LAYER_ID] });
        console.log(`[click] Points layer query at zoom ${zoom.toFixed(1)}: ${features.length} features in bbox`);

        // If we got multiple features, find the closest one to click point
        if (features.length > 1) {
          // Get map coordinates of click point
          const clickLngLat = map.unproject([point.x, point.y]);

          // Sort by distance to click point (approximate using lng/lat)
          features.sort((a, b) => {
            const aCoords = a.geometry?.coordinates;
            const bCoords = b.geometry?.coordinates;

            if (!aCoords || !bCoords) return 0;

            // For points, coordinates are [lng, lat]
            // For polygons, coordinates are [[ring of [lng, lat]]]
            const aLng = Array.isArray(aCoords[0]) ? aCoords[0][0][0] : aCoords[0];
            const aLat = Array.isArray(aCoords[0]) ? aCoords[0][0][1] : aCoords[1];
            const bLng = Array.isArray(bCoords[0]) ? bCoords[0][0][0] : bCoords[0];
            const bLat = Array.isArray(bCoords[0]) ? bCoords[0][0][1] : bCoords[1];

            const aDist = Math.pow(aLng - clickLngLat.lng, 2) + Math.pow(aLat - clickLngLat.lat, 2);
            const bDist = Math.pow(bLng - clickLngLat.lng, 2) + Math.pow(bLat - clickLngLat.lat, 2);

            return aDist - bDist;
          });

          console.log('[click] Sorted features by distance, closest:', features[0]?.properties?.pnu);
        }

        return features;
      }

      console.log('[click] No appropriate layer for current zoom level:', zoom.toFixed(1));
      return [];
    };

    const handleClick = (point) => {
      console.log('[click] Processing click at', point);

      const features = queryFeaturesAtPoint(point);

      // Take first feature (closest if sorted)
      const feature = features?.[0];

      if (feature) {
        // Use pnu property as the feature ID (this is the promoteId)
        const featureId = feature.properties?.pnu ?? feature.id;
        console.log('[click] Feature found:', {
          pnu: feature.properties?.pnu,
          featureId: featureId,
          layer: feature.layer?.id,
          FAR: feature.properties?.FAR_prediction,
        });

        // Clear previous selection
        if (selectedFeatureId !== null && selectedFeatureId !== featureId) {
          map.setFeatureState(
            { source: 'buildings', sourceLayer: 'buildings', id: selectedFeatureId },
            { selected: false }
          );
        }

        // If clicking the same feature, deselect it
        if (selectedFeatureId === featureId) {
          map.setFeatureState(
            { source: 'buildings', sourceLayer: 'buildings', id: featureId },
            { selected: false }
          );
          selectedFeatureId = null;
          setHoverInfo(null);
          console.log('[click] Deselected feature');
          return;
        }

        // Select new feature
        selectedFeatureId = featureId;
        map.setFeatureState(
          { source: 'buildings', sourceLayer: 'buildings', id: selectedFeatureId },
          { selected: true }
        );

        // Update tooltip at click position
        setHoverInfo({
          x: point.x + 12,
          y: point.y + 12,
          properties: feature.properties ?? {},
        });
        console.log('[click] Selected feature:', selectedFeatureId);
      } else {
        // Clear selection when clicking empty area
        if (selectedFeatureId !== null) {
          map.setFeatureState(
            { source: 'buildings', sourceLayer: 'buildings', id: selectedFeatureId },
            { selected: false }
          );
        }
        selectedFeatureId = null;
        setHoverInfo(null);
        console.log('[click] No feature at click point');
      }
    };

    // Use window-level event capture to bypass deck.gl interception
    const mapContainer = map.getContainer();
    if (!mapContainer) {
      console.warn('[click] Map container not available');
      return false;
    }

    const handleWindowClick = (domEvent) => {
      // Check if click is over the map container
      const rect = mapContainer.getBoundingClientRect();
      const isOverMap =
        domEvent.clientX >= rect.left &&
        domEvent.clientX <= rect.right &&
        domEvent.clientY >= rect.top &&
        domEvent.clientY <= rect.bottom;

      if (!isOverMap) {
        return;
      }

      // Convert DOM event to Mapbox-compatible point
      const point = {
        x: domEvent.clientX - rect.left,
        y: domEvent.clientY - rect.top,
      };

      console.log('[click] Window click at', point);

      // Query features at click point
      handleClick(point);
    };

    // Use capture phase to get events before deck.gl
    window.addEventListener('click', handleWindowClick, { capture: true });

    console.log('[click] ✓ Click handlers attached to window (capture phase)');

    hoverDetachRef.current = () => {
      window.removeEventListener('click', handleWindowClick, { capture: true });
      hoverDetachRef.current = null;
    };

    return true;
  }, []);

  const ensureHoverHandlers = useCallback(
    (map) => {
      if (!map) {
        return;
      }

      console.log('[click] ensureClickHandlers called');

      // Try to attach immediately
      let attachResult = attachHoverHandlers(map);
      console.log('[click] Initial attach result:', attachResult);

      // If style not loaded yet, wait for it
      if (!attachResult) {
        const retryAttach = () => {
          console.log('[click] Retrying attach after style load...');
          const result = attachHoverHandlers(map);
          console.log('[click] Retry result:', result);
          return result;
        };

        if (!map.isStyleLoaded()) {
          console.log('[click] Style not loaded, waiting...');
          map.once('style.load', retryAttach);
          map.once('load', retryAttach);
        }

        // Also retry after a delay
        setTimeout(() => {
          if (!hoverDetachRef.current) {
            console.log('[click] Delayed retry...');
            attachHoverHandlers(map);
          }
        }, 1000);

        setTimeout(() => {
          if (!hoverDetachRef.current) {
            console.log('[click] Second delayed retry...');
            attachHoverHandlers(map);
          }
        }, 3000);
      }

      // Listen for style changes (kepler.gl swaps styles)
      if (!hoverStyleListenerRef.current) {
        const handleStyleData = () => {
          console.log('[click] styledata event fired');
          // Only reattach if not already attached
          if (!hoverDetachRef.current) {
            attachHoverHandlers(map);
          }
          syncExtrusionVisibility(extrusionEnabledRef.current);
        };

        map.on('styledata', handleStyleData);
        hoverStyleListenerRef.current = () => {
          map.off('styledata', handleStyleData);
          hoverStyleListenerRef.current = null;
        };
      }
    },
    [attachHoverHandlers, syncExtrusionVisibility],
  );

  useEffect(() => () => {
    if (hoverDetachRef.current) {
      hoverDetachRef.current();
    }
    if (hoverStyleListenerRef.current && mapboxRef.current) {
      hoverStyleListenerRef.current();
    }
  }, []);

  const handleToggleExtrusion = useCallback(() => {
    if (!farLayer) {
      return;
    }

    const nextEnabled = !isExtrusionEnabled;

    dispatch(
      VisStateActions.layerVisConfigChange(farLayer, {
        enable3d: nextEnabled,
        elevationScale: 0.1,
      }),
    );

    dispatch(
      MapStateActions.updateMap(
        {
          pitch: nextEnabled ? 60 : 0,
          bearing: 0,
          dragRotate: nextEnabled,
        },
        0,
      ),
    );

    syncExtrusionVisibility(nextEnabled);
  }, [dispatch, farLayer, isExtrusionEnabled, syncExtrusionVisibility]);

  useEffect(() => {
    syncExtrusionVisibility(isExtrusionEnabled);
  }, [isExtrusionEnabled, syncExtrusionVisibility]);

  // Keep kepler.gl layer always hidden - Mapbox style layers handle rendering
  // This allows queryRenderedFeatures to work for hover/click events
  useEffect(() => {
    if (!farLayer || farLayer.config?.isVisible === false) {
      return;
    }
    dispatch(
      VisStateActions.layerConfigChange(farLayer, {
        isVisible: false,
      }),
    );
  }, [dispatch, farLayer]);

  const disableDeckGlPointerEvents = useCallback((map) => {
    if (!map) return;

    // Find deck.gl canvas overlaying the Mapbox canvas
    // deck.gl creates a canvas with class 'deck-canvas' or inside a deck-container
    const mapContainer = map.getContainer?.();
    if (!mapContainer) return;

    const disablePointerEvents = () => {
      // Try multiple selectors for deck.gl canvas
      const deckCanvases = mapContainer.querySelectorAll(
        'canvas.deck-canvas, .deck-container canvas, [class*="deck"] canvas'
      );

      if (deckCanvases.length === 0) {
        // Also check for any canvas that's not the mapbox-gl one
        const allCanvases = mapContainer.querySelectorAll('canvas');
        const mapboxCanvas = map.getCanvas?.();

        allCanvases.forEach((canvas) => {
          if (canvas !== mapboxCanvas && !canvas.classList.contains('mapboxgl-canvas')) {
            canvas.style.pointerEvents = 'none';
            console.log('[click] Disabled pointer-events on deck.gl canvas');
          }
        });
      } else {
        deckCanvases.forEach((canvas) => {
          canvas.style.pointerEvents = 'none';
          console.log('[click] Disabled pointer-events on deck.gl canvas (direct match)');
        });
      }
    };

    // Run immediately and also after a delay (deck.gl might initialize later)
    disablePointerEvents();
    setTimeout(disablePointerEvents, 500);
    setTimeout(disablePointerEvents, 1500);
  }, []);

  const handleMapboxRef = useCallback(
    (mapLike) => {
      const map = resolveMapInstance(mapLike);
      if (!map) {
        return;
      }
      mapboxRef.current = map;
      ensureBlendExtension(map);
      ensureHoverHandlers(map);
      syncExtrusionVisibility(extrusionEnabledRef.current);
      disableDeckGlPointerEvents(map);
    },
    [ensureBlendExtension, ensureHoverHandlers, syncExtrusionVisibility, disableDeckGlPointerEvents],
  );

  const renderKepler = useCallback(
    ({ width, height }) => (
      <KeplerGl
        id="map"
        width={width}
        height={height}
        mapboxApiAccessToken={token}
        getMapboxRef={handleMapboxRef}
      />
    ),
    [handleMapboxRef, token],
  );

  return (
    <div className="app">
      <div className="control-panel" role="region" aria-label="Map tooling">
        <div className="control-buttons">
          <button type="button" onClick={handleToggleSplit} className="control-button">
            {isSplit ? 'Merge View' : 'Split View'}
          </button>
          <button
            type="button"
            onClick={handleToggleExtrusion}
            className={`control-button secondary ${isExtrusionEnabled ? 'active' : ''}`}
            disabled={!farLayer}
          >
            {isExtrusionEnabled ? 'Disable 3D' : 'Enable 3D'}
          </button>
        </div>
        <div className="control-status" aria-live="polite">
          <span className="status-label">{displayStatus}</span>
          <span className="status-detail">rows: {displayRows}</span>
          {typeof loadInfo.duration === 'number' && (
            <span className="status-detail">{loadInfo.duration}ms</span>
          )}
        </div>
        {isTestMode && <span className="test-badge">TEST MODE</span>}
      </div>
      {hoverInfo ? (
        <div
          className="map-tooltip"
          style={{ left: hoverInfo.x, top: hoverInfo.y }}
          role="status"
          aria-live="polite"
        >
          <p className="map-tooltip__label">PNU</p>
          <p className="map-tooltip__value">{hoverInfo.properties?.pnu ?? '—'}</p>
          {hoverInfo.properties?.a10 ? (
            <>
              <p className="map-tooltip__label">Building</p>
              <p className="map-tooltip__value">{hoverInfo.properties.a10}</p>
            </>
          ) : null}
          {(() => {
            const MAX_FAR = 2000;
            const originalFar = hoverInfo.properties?.a30;
            const predictedFar = hoverInfo.properties?.FAR_prediction;
            const hasValidOriginal = typeof originalFar === 'number' && originalFar <= MAX_FAR;
            const hasValidPredicted = typeof predictedFar === 'number' && predictedFar <= MAX_FAR;

            if (hasValidOriginal) {
              return (
                <>
                  <p className="map-tooltip__label">FAR (원본)</p>
                  <p className="map-tooltip__value">{originalFar.toFixed(2)}</p>
                </>
              );
            } else if (hasValidPredicted) {
              return (
                <>
                  <p className="map-tooltip__label">FAR (예측)</p>
                  <p className="map-tooltip__value">{predictedFar.toFixed(2)}</p>
                </>
              );
            } else {
              return (
                <>
                  <p className="map-tooltip__label">FAR</p>
                  <p className="map-tooltip__value">—</p>
                </>
              );
            }
          })()}
        </div>
      ) : null}
      <AutoSizer>{renderKepler}</AutoSizer>
      <div className="custom-attribution">
        Developed by{' '}
        <a href="https://laus.snu.ac.kr" target="_blank" rel="noopener noreferrer">
          SNU LAUS
        </a>
        {' | Powered by '}
        <a href="https://kepler.gl" target="_blank" rel="noopener noreferrer">
          kepler.gl
        </a>
        {' | © '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap
        </a>
        {' contributors'}
      </div>
    </div>
  );
}

export default App;
