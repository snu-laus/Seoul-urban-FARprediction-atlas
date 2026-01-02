

## Seoul Urban Atlas
This is a React and Kepler.gl-based tool designed for real-time exploration of Floor Area Ratio (FAR) predictions in Seoul. To optimize performance with large-scale urban data, it avoids loading massive GeoJSON datasets directly; instead, it utilizes PMTiles for vector tiling to efficiently stream and render only the features within the current viewport.

### Demo
Try this in [here](https://seoul-urban-farprediction-atlas.pages.dev/).

### Related Research
This project is developed based on my academic research. You can view the related paper here: [KCI Article](https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003276587)
