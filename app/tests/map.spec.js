import {test, expect} from '@playwright/test';

const LOAD_TIMEOUT = 120_000;

test('KeplerGl loads and exposes Buildings dataset', async ({page}) => {
  test.setTimeout(LOAD_TIMEOUT + 20_000);

  page.on('console', (msg) => {
    console.log('[browser]', msg.type(), msg.text());
  });

  page.on('pageerror', (error) => {
    console.error('[pageerror]', error);
  });

  await page.goto('/', {waitUntil: 'domcontentloaded'});

  // Wait for kepler UI shell to appear.
  await expect(page.locator('.kepler-gl')).toBeVisible({timeout: LOAD_TIMEOUT});

  await page.waitForTimeout(5000);
  const statusSnapshot = await page.evaluate(() => ({
    status: window.__BUILDINGS_DATASET_STATUS__,
    rows: window.__BUILDINGS_DATASET_ROWS__,
    attr: document.body?.dataset?.buildingsDataset,
  }));
  console.log('dataset snapshot', JSON.stringify(statusSnapshot));

  const debugState = await page.evaluate(() => {
    const store = window.__APP_STORE__;
    if (!store) {
      return null;
    }
    const state = store.getState();
    return {
      styleType: state?.keplerGl?.map?.mapStyle?.styleType,
      availableStyles: Object.keys(state?.keplerGl?.map?.mapStyle?.mapStyles ?? {}),
    };
  });
  console.log('map style debug', JSON.stringify(debugState));

  // Dataset rows should be registered on window once loadData completes.
  await page.waitForFunction(
    () => window.__BUILDINGS_DATASET_STATUS__ === 'ready',
    null,
    {timeout: LOAD_TIMEOUT},
  );

  const canvasClasses = await page.evaluate(() =>
    Array.from(document.querySelectorAll('canvas')).map((canvas) => canvas.className),
  );
  console.log('canvas classes', JSON.stringify(canvasClasses));

  const tileStatus = await page.evaluate(() =>
    fetch('/pmtiles/seoul/13/6985/3172.pbf').then((response) => ({
      ok: response.ok,
      status: response.status,
    })),
  );
  console.log('tile probe', JSON.stringify(tileStatus));

  // Deck.gl canvas should be ready for interactions (Zoom/Pan).
  await expect(
    page.locator('canvas.mapboxgl-canvas, canvas.maplibregl-canvas'),
  ).toBeVisible({timeout: LOAD_TIMEOUT});
});
