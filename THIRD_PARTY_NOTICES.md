# Third-party notices

The repository's MIT license applies to original application code and the demo SVG illustrations. It does not override the licenses of bundled data, geometry, software or dependencies.

| Material | Source | License and attribution |
| --- | --- | --- |
| Province SVG geometry | [amCharts China SVG map](https://www.amcharts.com/svg-maps/china/) | CC BY 4.0; retain “Map by amCharts” attribution, source URL and modification notes. Original SVG and license under `assets/maps/`. |
| South China Sea illustrative inset | [Apache ECharts 6.0.0](https://github.com/apache/echarts/blob/6.0.0/src/coord/geo/fix/nanhai.ts) | Apache-2.0; LICENSE, NOTICE and original coordinate source under `assets/maps/`. |
| City coordinate source | [modood/Administrative-divisions-of-China](https://github.com/modood/Administrative-divisions-of-China) | MulanPSL-2.0; full text in `assets/maps/city-geo-LICENSE.txt`. |
| Supplemental city coordinates | [SimpleMaps China cities](https://simplemaps.com/data/cn-cities) | MIT; copyright and full text in `assets/maps/simplemaps-LICENSE.txt`. |
| Administrative division dictionary | [china-division / modood](https://github.com/modood/Administrative-divisions-of-China) | MulanPSL-2.0; used to generate `scripts/regions.sql` and `public/regions/`. Preserve upstream license. |

The on-page map attribution and `public/images/maps/licenses.txt` must remain available when redistributing the map. Geometry has been translated and labeled; the inset uses illustrative screen coordinates, not geographic coordinates. It is not an official map approval claim.

Other npm dependencies retain their respective licenses, available in installed packages. The lockfile records reproducible dependency versions.
