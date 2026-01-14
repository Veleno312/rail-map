# Outstanding station-first tasks

1. **Smooth handling**
   - Ensure state.debug.perf flag controls lightweight timing logs for recompute/routing/overlay work.
   - Debounce the demand/route recompute (500ms) and expose `applyPendingChanges` commit button.
   - Cache station-to-station routes and cell-to-station distances; invalidate on graph rebuild.
   - Reduce render churn: use layer groups, skip rail infra under zoom 7, reuse markers/polylines.

2. **Track construction cost**
   - Provide `getElevation(lat, lon)` sampling DEM or synthetic fallback.
   - Sample N=25 points between stations, compute grade, add grade/tunnel/bridge penalties.
   - Estimate build/maintenance cost, distance, max speed, tunnel length; store on track edge.
   - Show preview popup before confirming build with stats.

3. **Station demand assignment**
   - Build `state.cityToStationAllocation` with main/secondary station share (70-90%).
   - Compute served population/industry per station and show in hover/side panel.
   - Keep cities overlay-only; comarcas remain demand containers.

4. **Unused stations**
   - Compute line counts, set `station.status`.
   - Highlight unused stations, add list panel, update when lines change.

5. **Population micro-point data**
   - GitHub Action now emits `public/data/es/pop_points_es.json` by exporting place nodes and running `tools/build_pop_points.py`.
   - Local tooling exposes `npm run data:es:pop` to regenerate these estimates.
   - Runtime uses a grid index to sum populations within 2/5/10/20 km during station placement preview and shows the nearest station overlap in the new preview overlay.

6. **Data documentation**
   - Document new data outputs (e.g., pop_points_es.json) and how GH Actions generates them.
