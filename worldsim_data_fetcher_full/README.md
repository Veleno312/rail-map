# worldsim_data_fetcher_full

Downloaders + generators for world-scale transport & economy simulator datasets.
Everything is:
- deterministic (seeded)
- versioned (datasetVersion folder)
- auditable (sources.json + checksums.sha256 + manifest.json)

## Included modules
Downloaders:
- Natural Earth (resolve zip from official download page)
- OSM via Geofabrik extracts (.osm.pbf)
- WorldPop (REST API discovery; records candidates if no direct URL)
- World Bank WDI (V2 API)
- FAOSTAT (Fenix API; domain-based)
- UN Comtrade (World Bank Comtrade API mirror; calibration use)
- Transitland GTFS (optional; discovery varies; licenses vary)

Generators (explicitly synthetic):
- Rival competitor services (seeded)
- Spatial production disaggregation skeleton (seeded inputs)

## Run
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config/example.yaml config/local.yaml
python -m scripts.run_all --config config/local.yaml --dataset-version 2026-01-06-demo
