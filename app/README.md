## Seoul Urban Atlas (app/)

Vite + React 앱으로 kepler.gl을 최소 UI 상태로 감싸고, PMTiles에서 건물 FAR 데이터를 뷰포트 단위로 스트리밍합니다. 이 README는 `app/` 폴더 내 개발 워크플로를 정리한 문서입니다.

### 1. 환경 변수

루트(`app/.env`) 또는 셸 변수로 Mapbox 토큰을 지정합니다.

```
VITE_MAPBOX_TOKEN=pk.xxx
```

### 2. 개발/빌드 명령

```cmd
# Windows CMD 기준
cd app
npm install --legacy-peer-deps
set VITE_MAPBOX_TOKEN=your_token
npm run dev

# 품질 확인
npm run lint
npm run build
npm run test:e2e
```

Vite dev 서버는 기본적으로 `http://localhost:5173`에서 실행됩니다. 포트 충돌 시 자동으로 다른 포트를 선택합니다.

### 3. 데이터 파이프라인

원본 GeoJSON(`../buildings_merged.geojson`)을 PMTiles로 변환하여 `buildings.pmtiles`를 생성하고, 요약 메타(`buildings.pmtiles.json`)까지 같이 유지합니다. 요약 파일에는 `tileCoords`, `bounds`, `minzoom`, `maxzoom`, `summaryzoom`, `fields`, `geojsonFeatures`, `tileVersion`, `layer`, `size`, `output` 등 모든 필드가 포함되어 있으며 런타임에 그대로 소비됩니다.

```cmd
cd app\scripts
node buildBuildingsPmtiles.mjs
```

- `debugPmtiles.mjs z x y` : 특정 타일의 피처 샘플을 출력
- `inspectPmtiles.mjs <file>` : PMTiles 헤더·메타데이터를 요약

개발 서버는 `/pmtiles/buildings/{z}/{x}/{y}.pbf` 경로를 통해 타일을 제공합니다.

### 4. 주요 소스

- `src/loadData.js` – PMTiles 요약/메타 정보를 모두 읽어 `DatasetType.VECTOR_TILE` 원격 데이터셋을 kepler에 등록하고, 각 필드를 레이어 색상/툴팁/상태로 매핑
- `src/pmtilesStyle.js` – Mapbox 스타일 정의. 기본 지도와 빌딩 채색이 여기에 포함됩니다.
- `src/schemaManager.js` – kepler schema 저장/불러오기 및 템플릿 로더
- `src/keplerUI.jsx` – 사이드패널·컨트롤을 숨긴 kepler.gl 래퍼

### 5. 테스트

Playwright 기반 E2E 테스트는 `tests/map.spec.js`에서 정의됩니다. 실행 전에는 `VITE_MAPBOX_TOKEN`이 유효해야 하며, dev 서버가 아닌 Playwright 자체가 `npm run dev` 없이도 Vite build artifact를 기반으로 실행됩니다.

필요 시 `playwright.config.js`에서 스크린샷/비디오 옵션을 조정하세요.
