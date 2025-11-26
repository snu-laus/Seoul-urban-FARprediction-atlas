# 지도 프로젝트 README (kepler.gl + GitHub Pages)

이 문서는 `buildings_merged.geojson`을 kepler.gl API로 시각화하고, GitHub Pages(github.io)로 배포하기 위한 심층 가이드입니다. 내용과 용어, 예시는 워크스페이스의 API Reference를 바탕으로 하며, 스타일과 톤은 `example/` 폴더의 자산 구성(팔레트, 지역/라벨 개념 등)을 참고했습니다.


## 개요

- kepler.gl은 Redux와 연결된 React 컴포넌트로, 데이터셋을 추가하고 레이어/필터/툴팁/맵 상태를 구성하여 대화형 지도를 빠르게 만들 수 있습니다.
- 배경 지도는 Mapbox GL을 사용합니다. Mapbox Access Token이 필요합니다.
- 본 README는 다음을 담고 있습니다.
  - 로컬 개발 환경 구성 (React + Redux + kepler.gl)
  - `buildings_merged.geojson` 로딩 및 시각화
  - 스키마 매니저로 저장/불러오기(템플릿 구성 공유)
  - UI 컴포넌트 교체(Dependency Injection)
  - GitHub Pages 배포

```markdown
# Seoul Urban Atlas

React + kepler.gl 기반으로 서울시 FAR(용적률) 예측 결과를 실시간으로 탐색하는 툴입니다. 대용량 GeoJSON을 직접 로드하지 않고, PMTiles로 타일링한 후 뷰포트에 맞춰 필요한 피처만 스트리밍합니다.

## 저장소 구성

- `app/` – 메인 Vite 프로젝트
  - `src/` – React/Redux, kepler.gl 커스터마이징 코드
  - `public/buildings_merged.geojson` – PMTiles 생성용 원본 GeoJSON (런타임에는 사용하지 않음)
  - `scripts/` – 데이터 파이프라인 유틸 (`buildBuildingsPmtiles.mjs`, `debugPmtiles.mjs`, `inspectPmtiles.mjs`)
  - `buildings.pmtiles` – 변환된 타일셋 (로컬 개발 시 Vite 미들웨어가 제공)
- `API reference/` – kepler.gl 사용 가이드 아카이브
- `buildings_merged.geojson` – 최상위 레퍼런스 데이터 (백업 용도)

## 개발 환경

```cmd
cd app
npm install --legacy-peer-deps
set VITE_MAPBOX_TOKEN=your_token
npm run dev
```

서버가 뜨면 `http://localhost:5173/`에서 확인합니다. Windows CMD 기준 명령이며 PowerShell에서도 동일하게 동작합니다.

### 데이터 리프레시

1. `buildings_merged.geojson` 업데이트
2. PMTiles 재생성

```cmd
cd app\scripts
node buildBuildingsPmtiles.mjs --input ../public/buildings_merged.geojson --output ../buildings.pmtiles
```

3. 생성된 `buildings.pmtiles`와 `.json` 요약은 Vite dev 서버가 자동 노출합니다.

### PMTiles 점검

- `debugPmtiles.mjs z x y` – 특정 타일의 GeoJSON 속성 살펴보기
- `inspectPmtiles.mjs` – 헤더/메타데이터 요약 출력

## 앱 개요

- `loadData.js` : 뷰포트에 따라 PMTiles를 스트리밍하고 kepler.gl 데이터셋으로 합칩니다.
- `pmtilesStyle.js` : Mapbox 스타일에 커스텀 빌딩 채색을 적용합니다.
- `schemaManager.js` : 현재 구성을 저장/로드하고 템플릿(`public/config-template.json`)을 적용합니다.
- `keplerUI.jsx` : 패널, 토글 등 기본 UI를 숨기는 래퍼를 제공합니다.

## 품질 확인

```cmd
cd app
npm run lint
npm run build
npm run test:e2e
```

필요 시 `npm run test:e2e -- --headed`로 실제 지도 인터랙션을 점검할 수 있습니다.

## Mapbox 토큰

프로젝트 전역에서 `VITE_MAPBOX_TOKEN` 환경변수를 사용하며, 예제 토큰은 저장소에 포함되지 않습니다.
```