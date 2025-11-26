import KeplerGlSchema from '@kepler.gl/schemas';
import {addDataToMap} from '@kepler.gl/actions';

import {store} from './store';

const DATASET_ID = 'buildings';
const TEMPLATE_PATH = `${import.meta.env.BASE_URL}config-template.json`;

const getState = () => store.getState();

function getDatasetFromState() {
  const state = getState();
  return state?.keplerGl?.map?.visState?.datasets?.[DATASET_ID] ?? null;
}

function updateGlobalStatus(status) {
  if (typeof globalThis !== 'undefined') {
    globalThis.__BUILDINGS_DATASET_STATUS__ = status;
  }
}

function normalizeSchemaInput(schema) {
  if (!schema) {
    throw new Error('Schema payload is empty.');
  }
  if (schema.config || schema.datasets) {
    return schema;
  }
  return {config: schema};
}

export function saveCurrentSchema() {
  const state = getState();
  const schema = KeplerGlSchema.save(state?.keplerGl?.map);
  updateGlobalStatus('schema-saved');
  return schema;
}

export function downloadCurrentSchema(filename = 'buildings-schema.json') {
  const schema = saveCurrentSchema();
  const json = JSON.stringify(schema, null, 2);

  if (typeof Blob === 'undefined' || typeof document === 'undefined') {
    throw new Error('Browser environment required to download schema.');
  }

  const blob = new Blob([json], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function applySchema(schemaInput, {centerMap = true} = {}) {
  const schema = normalizeSchemaInput(schemaInput);
  const dataset = getDatasetFromState();

  if (!dataset) {
    throw new Error('Buildings dataset not loaded. Cannot apply schema.');
  }

  updateGlobalStatus('schema-applying');

  const datasetEntry = {
    info: {
      id: DATASET_ID,
      label: dataset.info?.label ?? 'Buildings',
    },
    data: dataset.data,
  };

  const schemaDatasets = schema.datasets && schema.datasets.length
    ? schema.datasets.map((ds) => ({
        ...ds,
        data: dataset.data,
        info: {
          ...ds.info,
          id: DATASET_ID,
          label: dataset.info?.label ?? ds.info?.label ?? 'Buildings',
        },
      }))
    : [datasetEntry];

  const loaded = KeplerGlSchema.load(schemaDatasets, schema.config ?? schema);

  store.dispatch(
    addDataToMap({
      datasets: loaded.datasets,
      config: loaded.config,
      options: {
        centerMap,
        keepExistingConfig: false,
        readOnly: false,
        ...(loaded.options ?? {}),
      },
    }),
  );

  updateGlobalStatus('schema-applied');
  return loaded;
}

export async function loadTemplateSchema(path = TEMPLATE_PATH) {
  updateGlobalStatus('schema-template-loading');

  const response = await fetch(path);
  if (!response.ok) {
    updateGlobalStatus('schema-template-error');
    throw new Error(`Failed to fetch config template: ${response.status} ${response.statusText}`);
  }

  const template = await response.json();
  await applySchema(template, {centerMap: true});
  updateGlobalStatus('schema-template-applied');
  return template;
}
