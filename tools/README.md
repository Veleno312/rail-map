# Offline Build Pipeline Skeleton

This directory hosts the scaffolding for the offline build pipeline described in `PROJECT_STATE.txt` `[2.4]`.
The goal is to define the workflow that processes authoritative data into scenario packs, manifests, and tiles that the web client consumes.

## Structure

- `pipeline/index.js`: Command-line stub that enumerates the canonical steps, keeps the output directory ready (`/data/offline`), and prints what each phase will eventually do. Each step currently logs placeholders and can be replaced with real implementations later.
- `tile_scheme.js` + `tile_scheme.md`: Defines the `tile-zoom-x-y` naming convention and neighbor offsets so downstream builders can reference tile IDs consistently.

## Usage

```sh
# Run the entire skeleton (in order)
node tools/pipeline/index.js

# Run only specific steps
node tools/pipeline/index.js gather-data validate-pack

# Show help/list of steps
node tools/pipeline/index.js --help
node tools/pipeline/index.js --list
```

## Pack validation

Use the validator to assert that a scenario pack meets the schema expectations before it gets bundled into `/data/offline`.

```sh
node tools/validate-pack.js /path/to/scenario-pack.json
```

Exit status:
- `0`: pass
- `1`: semantic validation issues documented
- `2`: file read / parse error (broken JSON)

This script mirrors what the UI expects (`schemaVersion` prefix, nodes/edges presence, manifest data).

## Manifest generator

The manifest bundles the dataset/model/schema versions plus summary stats for the offline build. It is the payload the hybrid updater checks before pulling tiles.

```sh
node tools/build-manifest.js /path/to/scenario-pack.json --out data/offline/manifest.json
```

Fields include `datasetVersion`, `modelVersion`, `schemaVersion`, `sourcePack`, `generatedAt`, `tiles`, and counts for nodes/tracks. It defaults to `data/offline/manifest.json`.

## Browser cache (IndexedDB)

The app now keeps the latest manifest and scenario pack in IndexedDB (see `public/app/offline_cache.js`). Use the scenario menu (bottom of the panel) to cache the current manifest/pack and reload it without network access. Cached entries automatically attach to the datasetVersion so you can inspect the current offline snapshot before running the simulation.

## Online mode toggle

The scenario menu also hosts an online/offline toggle, powered by `public/app/ui.js`. It flips `state.onlineMode` to prefer live downloads or cached datasets and updates the cache status message so you can tell when you are offline. Use it before launching the simulator into a low-connectivity environment.

## Pipeline usage

After populating your raw datasets you can run the pipeline to produce the offline snapshot:

```sh
node tools/pipeline/index.js gather-data generate-tiles build-scenario-pack validate-pack export-manifest
```

The run stages copy the production data into `data/offline/staging`, bake a canonical tile definition, build a `rail-luti-scenario-pack@0.1`, validate it, and emit `data/offline/manifest.json` describing the dataset/model/schema plus published tiles.

## Next steps

1. Replace each placeholder (e.g., `gather-data`, `generate-tiles`) with the real transform scripts.
2. Emit files such as `tiles/`, `manifest.json`, and scenario pack bundles inside `/data/offline`.
3. Hook this pipeline into the regression test harness (golden scenarios) so builds stay reproducible.
