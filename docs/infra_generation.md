# Spain rail infrastructure derivation

This project now relies on preprocessed GeoJSON exports instead of parsing OSM PBF files directly. Use the following `osmium` CLI workflow to generate the inputs consumed by `tools/build_es_rail_infra.py`:

```
osmium tags-filter spain-latest.osm.pbf n/railway=station,n/railway=halt -o stations.osm.pbf
osmium tags-filter spain-latest.osm.pbf w/railway=rail,w/railway=light_rail,w/railway=highspeed -o tracks.osm.pbf
osmium export stations.osm.pbf -o data/raw/es/stations.geojson
osmium export tracks.osm.pbf -o data/raw/es/tracks.geojson
```

- Place the resulting GeoJSON files in `data/raw/es/`.
- Run `python tools/build_es_rail_infra.py` to produce `data/es/stations_es.json`, `data/es/rail_nodes_es.json`, and `data/es/rail_links_es.json`.

The script now only depends on the standard Python `json`/`math`/`pathlib` libraries and reads these GeoJSON files directly before snapping stations to rail nodes.

You can automate both steps with:

```
npm run data:es:geojson
npm run data:es:build
```

On top of the local tooling, GitHub Actions keeps `public/data/es/*.json` refreshed on `workflow_dispatch` or monthly via `.github/workflows/generate_es_infra.yml`.

Additionally, the build now generates micro population points from OSM place nodes:

```
osmium tags-filter spain-latest.osm.pbf n/place=city,town,village,hamlet,suburb,neighbourhood -o places.osm.pbf
osmium export places.osm.pbf -o data/raw/es/places.geojson
python tools/build_pop_points.py public/data/es
```

This produces `public/data/es/pop_points_es.json`, which the app reads at startup to estimate how many people live within 2/5/10/20 km of a potential station. The same step is embedded in `npm run data:es:pop` and the GH workflow that updates the prebuilt dataset.
