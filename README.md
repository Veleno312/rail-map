# Ultimate Mega-Roadmap – World-Scale, Realistic, Playable, Publishable
A giant checklist with dependencies + optional implementation paths.
Goal: a simulator that is both:
- **Casual & engaging** (missions, visuals, events, “toy” satisfaction)
- **Serious & publishable** (calibrated models, differential equations, reproducible datasets)
- **World-scale** (start anywhere; progressive expansion; tiles; multi-resolution)

Legend:
- [ID] Task ID
- (S/M/L) small/medium/large
- Depends on: [ID], [ID]
- 📄 = directly supports publishable/math-tool objective
- Optional path = alternative implementation method

============================================================
0) NORTH STAR (keep you aligned)
============================================================
- Reproducible runs: datasetVersion + modelVersion + seed pinned 📄
- Units everywhere; never “magic numbers” without documented meaning 📄
- Multi-resolution + tiles = world scale without loading Earth at once
- Pure sim core, separate from UI rendering
- Player loop: problem → action → feedback (alerts, KPIs, visuals)

============================================================
1) FOUNDATIONS: stability, structure, reproducibility 📄
============================================================

[1.1] Error banner instead of blank page (S)
Depends on: none

[1.2] Debug drawer with last error + last sim stats (S)
Depends on: [1.1]

[1.3] State validator (S)
- check nodes/tracks/lines; warnings not crashes
Depends on: [1.2] (optional)

[1.4] Deterministic RNG + seed UI (S) 📄
Depends on: none

[1.5] Version stamps in state/saves: dataset/model/schema (S) 📄
Depends on: none

[1.6] Sim core extraction (`sim_core.js` pure functions) (M) 📄
Depends on: [1.3] recommended

[1.7] Render isolation (`render_network`, `render_overlay`) (M)
Depends on: none (easier after [1.6])

[1.8] Save/load with migrations (M) 📄
Depends on: [1.5]

[1.9] Golden test scenarios (S)
Depends on: [1.6] recommended

[1.10] Regression tests runner (M) 📄
Depends on: [1.9], [1.6]

[1.11] Model report export (JSON/CSV) (S) 📄
Depends on: [1.5], [1.6]

============================================================
2) SCENARIOS & DATASETS: offline / hybrid / online 📄
============================================================

[2.1] Scenario pack format spec (S) 📄
- nodes, edges, services, zones, industry, elevation, metadata, license
Depends on: none

[2.2] Scenario loader for packs (S)
Depends on: [1.3]

[2.3] Scenario menu + new game flow (S)
Depends on: [2.2]

[2.4] Offline build pipeline skeleton (`tools/`) (M) 📄
Depends on: none

[2.5] Pack validation tool (schema + sanity) (M) 📄
Depends on: [2.1], [2.4]

[2.6] Hybrid updater: manifest.json (S) 📄
Depends on: [1.5], [2.2]

[2.7] Cached datasets via IndexedDB (M) 📄
Depends on: [2.6]

[2.8] Save pinned to datasetVersion (S) 📄
Depends on: [1.5], [2.2]

[2.9] Online mode toggle (S)
Depends on: [2.6] or [2.2]

[2.10] Online dataset builder service (L) (Optional)
Depends on: [2.4], [2.6]

[2.11] Live updates overlay layer (M/L) (Optional online)
Depends on: [2.10]

### Station-first demand overlays
- The station-first foundation from `Replace.txt` now powers the comarcas/demand heat/underserved/catchment overlays, and the recompute button reruns the cells->stations allocation so those layers match the current station network.
- Scenario and Economy panels now offer quick controls that share the same map-layer state as the Network tab, so toggling from any tab keeps the visualization consistent while reflecting the station-first model.

============================================================
3) WORLD SCALE CORE: tiles + indexes + progressive expansion 📄
============================================================

---- W-INDEX & TILE SCHEME ----
[3.1] Tile ID scheme + neighbor definition (S)
Depends on: none

[3.2] Tile index format (tiles.json: bbox, files, sizes, neighbors) (S)
Depends on: [3.1]

[3.3] Country index format (countries.json: ISO, bbox, default starts, tiles) (S)
Depends on: [3.2]

---- TILE LOADER MVP ----
[3.4] Loader: load tiles into state (merge/dedupe) (M)
- `loadWorldTiles({version, tileIds})`
Depends on: [2.2], [1.3] recommended

[3.5] Start-anywhere UI (M)
- pick country/city; loads required tiles
Depends on: [3.3], [3.4]

[3.6] Save stores loaded tile IDs (S) 📄
Depends on: [2.8], [3.4]

---- PROGRESSIVE EXPANSION ----
[3.7] Load neighbor tiles on demand (M)
Depends on: [3.4]

[3.8] Expand-to-neighbor-country mechanic (S/M)
Depends on: [3.3], [3.7]

[3.9] Memory guardrails: max tiles/nodes; prompt to unload (S)
Depends on: [3.7]

[3.10] Tile unload + summarization (L)
- keep aggregated stats; drop geometry
Depends on: [3.9], multi-resolution [4.*] recommended

============================================================
4) “EVERY TOWN ≥ 500 POP” + MULTI-RESOLUTION SIM 📄
============================================================

[4.1] Settlement threshold config (S)
Depends on: [2.2]

[4.2] Multi-resolution node sets: L0/L1/L2 (M) 📄
Depends on: [1.6] recommended

[4.3] Dynamic aggregation by zoom/selection (M) 📄
Depends on: [4.2]

[4.4] OD caps + sampling policy (M) 📄
Depends on: [4.3]

[4.5] Active simulation set definition (S)
- active tiles + selected region = active nodes
Depends on: [1.6] recommended

[4.6] Precompute neighbor lists offline (M)
Depends on: [2.4]

[4.7] Dataset size & compile-time budget doc (S) 📄
Depends on: none

[4.8] Runtime profiling HUD (S)
Depends on: [1.2]

============================================================
5) WORLD DATA BUILD PIPELINE (offline, scalable) 📄
============================================================

[5.1] Tile the world builder (M)
Depends on: [3.1]

[5.2] OSM → rail edges per tile (L)
Depends on: [5.1]

[5.3] Population/settlements ≥500 → nodes per tile (M/L)
Depends on: [5.1]

[5.4] GTFS → services per tile (L)
- where available; else empty
Depends on: [5.3], [5.1]

[5.5] Zones per tile (M)
Depends on: [5.1]

[5.6] Industry proxies per tile (M/L)
Depends on: [5.1]

[5.7] Elevation samples per tile (optional) (M/L)
Depends on: [5.1]

[5.8] Build indexes: tiles.json + countries.json (M)
Depends on: [5.2–5.5]

[5.9] Compress + size report (S)
Depends on: [5.8]

[5.10] Spain “starter tiles” first (M)
Depends on: [5.1–5.5] but can be done as pilot

[5.11] Europe pack next (L)
Depends on: [5.10]

[5.12] World pack later (L)
Depends on: [5.11]

============================================================
6) BASE NETWORKS & SERVICES (Spain → Europe → World)
============================================================

[6.1] Spain base services from GTFS (M)
Depends on: [2.4], [2.2]

[6.2] Europe infrastructure base (L)
Depends on: [5.2]

[6.3] Snap services onto infrastructure graph (M/L)
Depends on: [6.1], [6.2]

[6.4] Cross-border service continuity (M)
Depends on: [6.3], [3.7]

============================================================
7) TRACK REALISM: terrain + tunnels/bridges + gradients 📄
============================================================

[7.1] Elevation source A (offline tiles) (M)
Depends on: [5.7]

[7.2] Elevation source B (online fetch+cache) (M) Optional
Depends on: [2.7] or online [2.9]

[7.3] Slope estimator (S)
Depends on: [7.1] or [7.2]

[7.4] Track cost model v1 (S) 📄
Depends on: [7.3]

[7.5] Track type: surface / tunnel / bridge (S)
Depends on: [7.4]

[7.6] Structure time multipliers (S)
Depends on: [7.5]

[7.7] Visual styling by type (S)
Depends on: [7.5]

[7.8] Auto-suggest tunnel/bridge (M)
Depends on: [7.5]

[7.9] Grade limits by technology/mode (M)
Depends on: [7.4], mode framework [10.1]

============================================================
8) CONSTRUCTION & TIME (projects feel real)
============================================================

[8.1] Construction queue (S/M)
Depends on: [1.3]

[8.2] Projects take months/years; show ETA (S)
Depends on: [8.1]

[8.3] Tunnel/bridge longer construction (S)
Depends on: [7.6], [8.1]

[8.4] Land acquisition/urban penalty (M)
Depends on: [7.4]

============================================================
9) OPERATIONS METRICS: measurable constraints 📄
============================================================

[9.1] Station train moves/day (S)
Depends on: lines+freq exist

[9.2] Platform throughput capacity (S)
Depends on: [9.1]

[9.3] Utilization display + alerts (S)
Depends on: [9.2]

[9.4] Delays if utilization>1 (M)
Depends on: [9.3]

[9.5] Delay propagation (M)
Depends on: [9.4]

[9.6] Dwell model (M)
Depends on: boardings estimation [12.6] or demand model [12.*]

============================================================
10) MULTIMODAL FOUNDATION (bus/metro/tram/ferry/air)
============================================================

[10.1] Mode field on lines (S)
Depends on: none

[10.2] Mode defaults: speed/capacity/cost/km (S)
Depends on: [10.1]

[10.3] Transfer penalty model (S)
Depends on: [10.1]

[10.4] Interchanges (M)
Depends on: [10.3]

[10.5] Airports/ports special nodes (M)
Depends on: [10.4] recommended

============================================================
11) PASSENGERS VS CARGO (separate layers + filters) 📄
============================================================

[11.1] Demand separation in state (S)
Depends on: none

[11.2] Passenger/cargo overlay filters (S)
Depends on: [11.1]

[11.3] Cargo terminals model (M)
Depends on: [11.1], nodes/industry [5.6] recommended

============================================================
12) DEMAND, ASSIGNMENT, CAPACITY (transport modeling) 📄
============================================================

[12.1] Generalized cost graph (S/M) 📄
Depends on: [1.6] recommended

[12.2] Passenger demand model v1 (M) 📄
Depends on: [12.1], multi-res [4.*] for world

[12.3] Cargo demand model v1 (M) 📄
Depends on: [12.1], [5.6], [11.3]

[12.4] Assignment v1 (shortest path) (M) 📄
Depends on: [12.2]/[12.3]

[12.5] Capacity constraints + spill (M) 📄
Depends on: [12.4]

[12.6] Boardings/alightings estimation (M)
Depends on: [12.5]

[12.7] Stochastic route choice (M/L) 📄
Depends on: [12.4]

[12.8] Time-of-day demand + peaks (M)
Depends on: timetable [13.*], [12.2]

============================================================
13) TIMETABLES & SERVICE PATTERNS
============================================================

[13.1] Frequency editor UI (S)
Depends on: lines exist

[13.2] Service span + peak/off-peak profiles (M)
Depends on: [13.1]

[13.3] Express/local skip-stop patterns (M)
Depends on: [13.2]

[13.4] Timed transfers (M)
Depends on: [10.4], [13.2]

============================================================
14) ECONOMICS: serious-but-readable operator math 📄
============================================================

[14.1] Capex vs opex separation (S)
Depends on: none

[14.2] Passenger revenue = pax-km * fare/km (M) 📄
Depends on: [12.5]

[14.3] Cargo revenue = tonne-km * rate (M) 📄
Depends on: [12.5]

[14.4] Costs per train-km by mode (M) 📄
Depends on: [10.2]

[14.5] Station ops costs + retail tied to footfall (M)
Depends on: [12.6]

[14.6] Subsidies/PSO contracts (M)
Depends on: [14.2], [14.4]

============================================================
15) STATIONS: realism + upgrades that actually do things
============================================================

[15.1] Station types (S)
Depends on: none

[15.2] Concourse capacity + crowding (M)
Depends on: [12.6]

[15.3] Amenities reduce crowding; platforms increase throughput (M)
Depends on: [15.2], [9.2]

[15.4] Retail revenue tied to footfall (M)
Depends on: [12.6], [14.5]

[15.5] Freight terminals capacity (M)
Depends on: [11.3], [12.5]

============================================================
16) EVENTS SYSTEM (Plague.inc vibe but reproducible) 📄
============================================================

[16.1] Event framework: type, region, severity, duration (S) 📄
Depends on: [1.4], [1.6 recommended]

[16.2] Seeded random event generator (S) 📄
Depends on: [16.1]

[16.3] Weather events: speed reductions, cancellations (M)
Depends on: [16.1], [10.2]

[16.4] Illness/pandemic events: demand shocks (M) 📄
Depends on: [16.1], [12.2]

[16.5] Disasters: closures, infrastructure damage (M)
Depends on: [16.1], [7.5], construction [8.1]

[16.6] Politics/regulation: subsidies, strikes, borders (M)
Depends on: [16.1], [14.6], [3.7]

[16.7] News timeline UI + event cards (S/M)
Depends on: [16.1], KPI dashboard [18.1]

============================================================
17) DIFFERENTIAL EQUATIONS / MACRO DYNAMICS (publishable) 📄
============================================================

[17.1] Macro variables per region: P,G,I,H (S) 📄
Depends on: multi-res regions [4.2], sim core [1.6] recommended

[17.2] Accessibility index A_i from travel times & service (S/M) 📄
Depends on: [12.1]

[17.3] ODE solver module (RK4 / stable integrator) (M) 📄
Depends on: [17.1]

[17.4] Population dynamics equation dP/dt (M) 📄
Depends on: [17.2], [17.3]

[17.5] GDP/industry dynamics dG/dt, dI/dt (M) 📄
Depends on: [17.2], [17.3]

[17.6] Coupling: macro → demand & demand → macro (M) 📄
Depends on: [12.2][12.3], [17.4][17.5]

[17.7] Stability “foolproof” constraints (M) 📄
- non-negativity, bounded growth, sanity caps
Depends on: [17.3]

[17.8] Sensitivity analysis runner (L) 📄
Depends on: [1.11], [17.7]

[17.9] Paper experiment runner (headless) (M/L) 📄
Depends on: [1.10], [17.8]

============================================================
18) OPTIMIZERS + SCORING (smart buttons + “most effective line”)
============================================================

[18.1] KPI dashboard (S)
Depends on: any metrics (grows over time)

[18.2] Score function (S)
Depends on: [18.1]

[18.3] Suggest best new line (M)
Depends on: unmet demand [12.5], [18.1]

[18.4] Suggest best frequency upgrades (S/M)
Depends on: [12.5], [18.1]

[18.5] Suggest best station upgrades (S/M)
Depends on: [9.3], [15.2]

[18.6] Advanced optimizer (GA/annealing) (L)
Depends on: [18.3–18.5]

[18.7] “Most effective line” ranking (S/M)
Depends on: [18.1], [18.2], revenue/cost [14.*]

============================================================
19) UX FOR CASUAL + PRO TOOL MODES
============================================================

[19.1] Toolbar + Inspector to replace tab clutter (M)
Depends on: [1.7]

[19.2] Hotkeys (S)
Depends on: none

[19.3] Casual mode preset (S)
Depends on: [18.2] optional

[19.4] Pro mode preset + exports + calibration UI (M) 📄
Depends on: [1.11], [17.*]

[19.5] Tutorials + missions (M)
Depends on: scenario system [2.3], events [16.*] optional

============================================================
20) VISUALS & FEEL (engagement)
============================================================

[20.1] Station crowd dots (M)
Depends on: [15.2] or [12.6]

[20.2] Cargo particles (M)
Depends on: [11.3], [12.5]

[20.3] Heatmaps (M)
Depends on: [18.1]

[20.4] Charts/trends (M)
Depends on: [18.1], [1.11]

[20.5] Sound/ambience (optional) (M)
Depends on: none

============================================================
21) LINE TOOLS (your requested “nice touches”)
============================================================

[21.1] Line color changing tool (S)
Depends on: lines exist

[21.2] Line rename + icon tool (S)
Depends on: lines exist

[21.3] Line service class (HSR/Regional/Freight/etc.) (S/M)
Depends on: [10.1] or simple enums

============================================================
22) RECOMMENDED START (big vision, practical steps)
============================================================

Start with a “Publishable Spine” + “World-loader spine”:

A) Publishable spine (math + reproducibility):
1) [1.4] Seed + deterministic runs 📄
2) [1.5] Version stamps 📄
3) [16.1] Event framework (seeded) 📄
4) [17.3] ODE solver module 📄
5) [17.1][17.2] Macro variables + accessibility 📄
6) [1.11] Model export 📄

B) World spine (scale):
7) [3.1–3.5] Tiles + indexes + start-anywhere loader
8) [4.2–4.4] Multi-resolution + aggregation for performance

C) Quick delight (anytime):
- [21.1] line color tool
- [20.1] station crowds
- [18.1] KPI dashboard

===========================================================
23) Optimizer new
===========================================================

A) Make the optimizer work between two places and get the most optimal route
