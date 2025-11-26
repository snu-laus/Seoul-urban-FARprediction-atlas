import {applyMiddleware, combineReducers, createStore} from 'redux';
import {taskMiddleware} from 'react-palm/tasks';
import keplerGlReducer, {enhanceReduxMiddleware} from '@kepler.gl/reducers';
import {PMTILES_STYLE_ID, createSeoulPmtilesStyle} from './pmtilesStyle';

const defaultPmtilesStyle = createSeoulPmtilesStyle();

const reducers = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    uiState: {
      readOnly: false,
      currentModal: null,
      activeSidePanel: null,
      isSidePanelOpen: false,
      mapControls: {
        visibleLayers: {show: true},
        mapLegend: {show: true},
        toggle3d: {show: false},
        splitMap: {show: false},
        mapDraw: {show: false},
        mapToggle: {show: false},
        geocoder: {show: false},
      },
      // Default to English until a complete Korean translation pack is provided for kepler.gl
      locale: 'en',
    },
    mapState: {
      latitude: 37.5665,
      longitude: 126.978,
      zoom: 13,
      bearing: 0,
      pitch: 0,
      dragRotate: false,
      isSplit: false,
    },
    mapStyle: {
      styleType: PMTILES_STYLE_ID,
      mapStyles: {
        [PMTILES_STYLE_ID]: {
          id: PMTILES_STYLE_ID,
          label: 'Seoul PMTiles',
          url: null,
          layerGroups: [],
          style: defaultPmtilesStyle,
        },
      },
    },
  }),
});

const middlewares = enhanceReduxMiddleware([taskMiddleware]);

export const store = createStore(reducers, {}, applyMiddleware(...middlewares));

if (typeof window !== 'undefined') {
  window.__APP_STORE__ = store;
}
