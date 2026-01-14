/* eslint-disable no-undef, no-unused-vars, no-empty */
// ======================
// Config
// ======================
const CONFIG = {
  CLUSTER_RADIUS_KM: 30,
  CLUSTER_VIEW_MAX_ZOOM: 7,
  SPAIN_VIEW: { center: [40.0, -3.7], zoom: 6 },
  WORLD_VIEW: { center: [20.0, 0.0], zoom: 2 },

  // Infra
  TRACK_COST_PER_KM: 5_000_000,
  TRACK_MAINTENANCE_PER_KM: 250_000,
  TRACK_BUILD_DAYS_PER_KM: 2.4,
  TRACK_BUILD_MAX_CREWS: 3,
  TRACK_BUILD_COST_MULT_TUNNEL: 2.8,
  TRACK_BUILD_COST_MULT_BRIDGE: 1.9,
  TRACK_BUILD_COST_MULT_OVERPASS: 1.25,
  TRACK_BUILD_ISSUE_CHANCE: 0.18,
  TRACK_BUILD_ISSUE_COST_MIN: 0.04,
  TRACK_BUILD_ISSUE_COST_MAX: 0.12,
  TRACK_DEMO_LABOR_MULT: 0.22,
  TRACK_DEMO_SALVAGE_MULT: 0.08,
  LINE_RETIRE_DAYS: 7,

  // Rolling stock
  TRAIN_MAINT_PER_CARRIAGE_PER_YEAR: 1_500_000,
  TRAIN_MAINT_MULT_SMALL: 1.0,
  TRAIN_MAINT_MULT_MEDIUM: 1.2,
  TRAIN_MAINT_MULT_FAST: 1.6,
  TRAIN_MAINT_MULT_HIGH: 2.6,
  TRAIN_MAINT_MULT_BULLET: 4.0,


  STARTING_BUDGET: 15_000_000_000_000,
  ANNUAL_BUDGET: 1_000_000_000,

  // production proxy (until real stats)
  PROD_EUR_PER_PERSON_MIN: 900,
  PROD_EUR_PER_PERSON_MAX: 2200,

  // auto-track settings
  AUTO_TRACK_LANES_PASSENGER: 2,
  AUTO_TRACK_LANES_CARGO: 3,
  AUTO_TRACK_LANES_MIXED: 2,
};

const COUNTRY_CATALOG = [
  {
    id: "ES",
    name: "Spain",
    citiesUrl: "./cities_es.json",
    borderUrl: "./data/spain_border.geojson",
    productionUrl: "./data/production_es_macro.json",
    tracksUrl: "./data/adif_rail_spain.json",
    tracksFallbackUrl: "./data/osm_rail_spain.json"
  },
  {
    id: "PT",
    name: "Portugal",
    citiesUrl: "./data/cities_pt.json",
    borderUrl: "./data/portugal_border.geojson",
    productionUrl: "./data/production_pt_macro.json",
    tracksUrl: "./data/osm_rail_portugal.json"
  },
  {
    id: "FR",
    name: "France",
    citiesUrl: "./data/cities_fr.json",
    borderUrl: "./data/france_border.geojson",
    productionUrl: "./data/production_fr_macro.json",
    tracksUrl: "./data/osm_rail_france.json"
  },
  {
    id: "IT",
    name: "Italy",
    citiesUrl: "./data/cities_it.json",
    borderUrl: "./data/italy_border.geojson",
    productionUrl: "./data/production_it_macro.json",
    tracksUrl: "./data/osm_rail_italy.json"
  },
  {
    id: "DE",
    name: "Germany",
    citiesUrl: "./data/cities_de.json",
    borderUrl: "./data/germany_border.geojson",
    productionUrl: "./data/production_de_macro.json",
    tracksUrl: "./data/osm_rail_germany.json"
  }
];

const COUNTRY_UNLOCK_RULES = [
  { id: "PT", minInterconnectPct: 55, minMonthlyProfit: 50_000_000 },
  { id: "FR", minInterconnectPct: 65, minMonthlyProfit: 150_000_000 },
  { id: "IT", minInterconnectPct: 72, minMonthlyProfit: 250_000_000 },
  { id: "DE", minInterconnectPct: 78, minMonthlyProfit: 350_000_000 }
];

const LINE_DAY_END_MIN = 24 * 60;
const LINE_NIGHT_END_MIN = 8 * 60;
const LINE_NIGHT_COST_MULT = 1.25;

// ======================
// Helpers
// ======================

function line_sortedDepartures(line){
const deps = Array.isArray(line?.departures) ? line.departures.slice() : [];
deps.sort((a,b)=>a-b);
return deps;
}

function line_operatingCostEURPerDay(line){
if (!line) return 0;

// service level proxy: departures/day
const deps = Array.isArray(line.departures) ? line.departures.length : 0;
if (deps <= 0) return 0;

const carriages = Math.max(1, Number(line.carriages ?? 4));
const sc = String(line.speedClass || "medium");

// speed class multiplier (tunable)
const mult =
  sc === "small" ? 1.00 :
  sc === "medium" ? 1.20 :
  sc === "fast" ? 1.60 :
  sc === "high" ? 2.20 :
  sc === "highspeed" ? 2.20 :
  sc === "bullet" ? 3.00 :
  1.20;

// base cost per departure per carriage (tunable, simple, stable)
// Interpret as staff+energy+maintenance allocation in explore mode.
const basePerDepPerCar = 22; // EUR
const cost = deps * carriages * basePerDepPerCar * mult;

  // night service surcharge (if you model it)
  if (line.nightService) return cost * LINE_NIGHT_COST_MULT;

return cost;
}

function network_operatingCostEURPerDay(){
let sum = 0;
for (const line of state.lines.values()){
  sum += line_operatingCostEURPerDay(line);
}
return sum;
}


function line_calcDerivedMetrics(line){
// Assumes line_recalcDerived(line) has run (but we can be defensive)
try { line_recalcDerived(line); } catch(_) {}

const dep = Array.isArray(line.departures) ? line.departures.slice() : [];
dep.sort((a,b)=> (a.startMin ?? 0) - (b.startMin ?? 0));

// headway in minutes (based on timetable)
let headwayMin = null;
if (dep.length >= 2){
  let sum = 0, n = 0;
  for (let i=1;i<dep.length;i++){
    const a = dep[i-1].startMin ?? 0;
    const b = dep[i].startMin ?? 0;
    const d = b - a;
    if (d > 0) { sum += d; n++; }
  }
  if (n > 0) headwayMin = sum / n;
}

// Service window
  const serviceStartMin = clamp(Number(line.serviceStartMin ?? 0), 0, 1439);
  const serviceEndMin   = LINE_DAY_END_MIN;
  let serviceWindowMin = Math.max(0, serviceEndMin - serviceStartMin);
  if (line.nightService) serviceWindowMin += LINE_NIGHT_END_MIN;

// "Cycle time" (end-to-end + end-to-end + turnarounds).
// We use line.roundTripMin if you already compute it, else approximate from travelMin.
const oneWayMin = Number(line.travelMin ?? line.oneWayMin ?? 0);
const roundTripMin = Number(line.roundTripMin ?? (oneWayMin > 0 ? (2*oneWayMin) : 0));

// Required trains ≈ ceil(roundTrip / headway)
let requiredTrains = null;
if (roundTripMin > 0 && headwayMin && headwayMin > 0){
  requiredTrains = Math.ceil(roundTripMin / headwayMin);
}

// Planned departures per day (from timetable, within service window)
// (simple count; you can refine later for night wrap)
const plannedDepartures = dep.length;

return {
  headwayMin,
  serviceWindowMin,
  oneWayMin,
  roundTripMin,
  plannedDepartures,
  requiredTrains
};
}

function line_avgHeadwayMin(line){
const deps = line_sortedDepartures(line);
if (deps.length < 2) return null;
let sum = 0;
for (let i=1;i<deps.length;i++) sum += (deps[i]-deps[i-1]);
return sum / (deps.length - 1);
}

// Uses your existing travel-time estimator if present; falls back to geometric length/speed.
function line_estimateOneWayRunMin(line){
// Prefer your existing function if you have it:
try {
  if (typeof line_estimateTravelMin === "function") return Number(line_estimateTravelMin(line) || 0);
  if (typeof service_estimateLineTravelMin === "function") return Number(service_estimateLineTravelMin(line) || 0);
} catch(_) {}

// Fallback: approximate from polyline length if available
const speedKmh =
  (line.speedKmh ? Number(line.speedKmh) :
   (typeof TRAIN_SPEEDS === "object" && TRAIN_SPEEDS[line.speedClass] ? TRAIN_SPEEDS[line.speedClass] : 90));

const stops = Array.isArray(line.stops) ? line.stops : [];
const km = Number(line.lengthKm || line.km || 0); // if you store it
if (km > 0 && speedKmh > 0) return (km / speedKmh) * 60;

// last resort: 2.5 min per hop
return Math.max(0, (stops.length - 1) * 2.5);
}

function line_cycleTimeMin(line){
const oneWay = line_estimateOneWayRunMin(line);
const stops = Array.isArray(line?.stops) ? line.stops.length : 0;

const dwellMin = Number(line.dwellMin ?? 0.5);
const turnaroundMin = Number(line.turnaroundMin ?? 6); // add if missing, default 6

// dwell at intermediate stops (approx: every stop except first)
const dwellTotal = Math.max(0, stops - 1) * dwellMin;

// round trip + turnaround at both ends
return (2 * oneWay) + (2 * turnaroundMin) + (2 * dwellTotal);
}

function line_requiredTrains(line){
const headway = line_avgHeadwayMin(line);
if (!headway || headway <= 0) return 0;
const cycle = line_cycleTimeMin(line);
return Math.max(1, Math.ceil(cycle / headway));
}

// Capacity per carriage (simple defaults; later can be editable by rolling stock)
function line_capacityPerCarriage(line){
const type = line?.type || "passenger";
if (type === "cargo") return 80;      // tons per carriage (placeholder)
if (type === "mixed") return 60;      // pax-equivalent (placeholder)
return 100;                           // passengers per carriage (placeholder)
}

function line_dailyCapacity(line){
const deps = line_sortedDepartures(line);
const trips = deps.length; // each departure is one trip in one direction in your current model
const carriages = Math.max(1, Number(line.carriages ?? 4));
const capCar = line_capacityPerCarriage(line);
return trips * carriages * capCar;
}

// Simple operating cost model (tunable & publishable)
function line_operatingCostPerDay(line){
const req = line_requiredTrains(line);
if (req <= 0) return 0;

const speedClass = line?.speedClass || "medium";
const carriages = Math.max(1, Number(line.carriages ?? 4));

const mult =
  speedClass === "small" ? 1.0 :
  speedClass === "medium" ? 1.2 :
  speedClass === "fast" ? 1.6 :
  speedClass === "high" ? 2.2 :
  speedClass === "highspeed" ? 2.2 :
  speedClass === "bullet" ? 3.0 :
  1.2;

// approximate train-km/day from departures × one-way km
const oneWayMin = line_estimateOneWayRunMin(line);
const speedKmh =
  (line.speedKmh ? Number(line.speedKmh) :
   (typeof TRAIN_SPEEDS === "object" && TRAIN_SPEEDS[line.speedClass] ? TRAIN_SPEEDS[line.speedClass] : 90));
const oneWayKm = (oneWayMin / 60) * speedKmh;

const trips = line_sortedDepartures(line).length;
const trainKmDay = Math.max(0, trips * oneWayKm);

// Base €/train-km scaled by class and carriages (placeholder numbers)
const basePerTrainKm = 8; // €/train-km baseline
const perTrainKm = basePerTrainKm * mult * (0.6 + 0.1 * carriages);

return trainKmDay * perTrainKm;
}

async function ui_runMonths(n=24){
// run n monthly ticks, fast, without animating
for (let i = 0; i < n; i++){
  if (typeof luti_monthTick === "function") luti_monthTick();
}
updateUI();
// refresh report if on dynamics tab
try { if (state.activeTab === "dynamics") ui_renderLutiReport(); } catch(_) {}
showToast(`Ran ${n} months`, "success");
}
window.ui_runMonths = ui_runMonths;

function line_timetableStats(line){
const deps = Array.isArray(line?.departures) ? line.departures.slice().sort((a,b)=>a-b) : [];
const n = deps.length;
if (!n) return { n:0, first:null, last:null, avgHeadway:null };
const first = deps[0], last = deps[n-1];
let avgHeadway = null;
if (n >= 2){
  const diffs = [];
  for (let i=1;i<n;i++) diffs.push(deps[i]-deps[i-1]);
  avgHeadway = diffs.reduce((s,x)=>s+x,0) / diffs.length;
}
return { n, first, last, avgHeadway };
}


function minToHHMM(min){
min = Math.floor(Number(min || 0));
const h = Math.floor(min / 60) % 24;
const m = min % 60;
return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

async function buildResultsArtifact(){
const { snap, hash } = await computeAssumptionsHash();


// Minimal outputs for v0.1
const lm = state.luti?.lastMonth || {};
const accessDay = state.luti?.accessDay || new Map();
const accessNight = state.luti?.accessNight || new Map();

// Accessibility summary (store per-zone scalar, not full matrices yet)
const accessibilityByZone = {};
for (const [id, v] of accessDay.entries()){
  accessibilityByZone[id] = accessibilityByZone[id] || {};
  accessibilityByZone[id].day = Number(v || 0);
}
for (const [id, v] of accessNight.entries()){
  accessibilityByZone[id] = accessibilityByZone[id] || {};
  accessibilityByZone[id].night = Number(v || 0);
}

return {
  schemaVersion: "rail-luti-results@0.1",
  scenarioHash: hash,
  runMeta: {
    createdAt: new Date().toISOString(),
    model: { name: "RailLUTI", version: "dev" },
    engine: { name: "ExploreMode", version: "browser" },
    assumptions: snap,
    assumptionsHash: hash
  },
  month: lm.monthLabel || (typeof calendar_label === "function" ? calendar_label() : ""),
  impacts: {
    totalPopDelta: Number(lm.totalPopDelta || 0),
    populationDeltaById: lm.popDeltaById || {}
  },
  accessibility: {
    byZone: accessibilityByZone
  }
};
}

async function exportResultsArtifact(){
const obj = await buildResultsArtifact();
const hash8 = (obj.scenarioHash || "nohash").slice(0,8);
const a8 = (obj.runMeta?.assumptionsHash || "noahash").slice(0,8);
const month = (obj.time?.monthLabel || "now").toString().replaceAll("/", "-").replaceAll(" ", "_");
downloadJSON(obj, `results.${hash8}.${a8}.${month}.json`);
}
window.exportResultsArtifact = exportResultsArtifact;




/** Results Import (LUTI outputs)
 * Loads a previously exported results artifact JSON and stores it in state for inspection/comparison.
 * This does NOT mutate the base scenario inputs (nodes/lines). It only updates report data/maps.
 */
function applyResultsArtifact(obj){
if (!obj || typeof obj !== "object") throw new Error("Invalid results artifact (not an object).");
const sv = String(obj.schemaVersion || "");
if (!sv.startsWith("rail-luti-results@")) throw new Error(`Unsupported results schemaVersion: ${sv || "(missing)"}`);

state.results = state.results || {};
state.results.lastImported = obj;

// Ensure LUTI container
state.luti = state.luti || {};
state.luti.lastMonth = state.luti.lastMonth || {};
state.luti.lastMonth.monthLabel = obj.month || state.luti.lastMonth.monthLabel || "";
state.luti.lastMonth.totalPopDelta = Number(obj.impacts?.totalPopDelta || 0);
state.luti.lastMonth.popDeltaById = obj.impacts?.populationDeltaById || {};
state.luti.lastMonth._imported = true;

// Restore accessibility (day/night scalars by zone)
const byZone = obj.accessibility?.byZone || {};
const dayMap = new Map();
const nightMap = new Map();
for (const id of Object.keys(byZone)){
  const z = byZone[id] || {};
  if (z.day != null) dayMap.set(id, Number(z.day || 0));
  if (z.night != null) nightMap.set(id, Number(z.night || 0));
}
state.luti.accessDay = dayMap;
state.luti.accessNight = nightMap;

state.resultsMeta = state.resultsMeta || {};
state.resultsMeta.assumptionsHash = obj?.runMeta?.assumptionsHash || null;
state.resultsMeta.assumptions = obj?.runMeta?.assumptions || null;


// Record provenance
state.resultsMeta = {
  importedAt: new Date().toISOString(),
  scenarioHash: obj.scenarioHash || null,
  schemaVersion: sv
};
}

function ui_pickResultsImport(){
const input = document.getElementById("resultsImportFile");
if (!input) return alert("Results import input not found (resultsImportFile).");
input.value = "";
input.click();
}

async function ui_importResultsFile(file){
try{
  if (!file) return;
  const txt = await file.text();
  const obj = JSON.parse(txt);
  applyResultsArtifact(obj);
  try { ui_renderLutiReport(); } catch(_) {}
  try { updateUI(); } catch(_) {}
  if (typeof toast === "function") toast(`Imported results: ${file.name}`, 2000);
}catch(e){
  console.error(e);
  alert("Failed to import results: " + (e?.message || e));
}
}

window.applyResultsArtifact = applyResultsArtifact;
window.ui_pickResultsImport = ui_pickResultsImport;
window.ui_importResultsFile = ui_importResultsFile;


function canonicalize(value){
if (value === null || typeof value !== "object") return value;

if (Array.isArray(value)){
  return value.map(canonicalize);
}

const out = {};
const keys = Object.keys(value).sort();
for (const k of keys){
  out[k] = canonicalize(value[k]);
}
return out;
}

function buildAssumptionsSnapshot(){
return {
  // LUTI / accessibility
  beta: Number(state.luti?.beta ?? 0.045),

  // generalized cost
  transferPenaltyMin: Number(state.params?.generalizedCost?.transferPenaltyMin ?? 8),
  waitTimeFactor: Number(state.params?.generalizedCost?.waitTimeFactor ?? 0.5),
  inVehicleTimeFactor: Number(state.params?.generalizedCost?.inVehicleTimeFactor ?? 1.0),

  // time discretization / calendar (keeps runs comparable)
  daysPerMonth: Number(state.calendar?.daysPerMonth ?? 30),

  // (optional) if you have cutoffs or windows stored anywhere:
  cutoffsMin: Array.isArray(state.luti?.cutoffsMin) ? [...state.luti.cutoffsMin].sort((a,b)=>a-b) : [30,45,60]
};
}

async function computeAssumptionsHash(){
const snap = buildAssumptionsSnapshot();
const canon = canonicalJSONString(snap);
const hash = await sha256Hex(canon);
return { snap, hash };
}

window.computeAssumptionsHash = computeAssumptionsHash;


function canonicalJSONString(obj){
return JSON.stringify(canonicalize(obj));
}

async function sha256Hex(text){
const enc = new TextEncoder();
const data = enc.encode(text);
const digest = await crypto.subtle.digest("SHA-256", data);
const bytes = new Uint8Array(digest);
return Array.from(bytes).map(b => b.toString(16).padStart(2,"0")).join("");
}

function downloadJSON(obj, filename){
const text = JSON.stringify(obj, null, 2);
const blob = new Blob([text], { type: "application/json" });
const url = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = url;
a.download = filename || "scenario.json";
document.body.appendChild(a);
a.click();
a.remove();

setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.downloadJSON = downloadJSON;

async function exportScenario(){
// Zones: use whatever you already store in state.nodes
const zones = Array.from(state.nodes.values()).map(n => ({
  id: String(n.id),
  name: n.name ? String(n.name) : String(n.id),
  centroid: [Number(n.lon), Number(n.lat)],
  population: Number(n.population ?? n.pop ?? 0),

  // placeholders for later (keeps schema stable)
  jobs: Number(n.jobs || 0),
  housing: Number(n.housing || 0),
  rentIndex: Number(n.rentIndex || 1.0),
  incomeIndex: Number(n.incomeIndex || 1.0)
}));
zones.sort((a,b)=>String(a.id).localeCompare(String(b.id)));


// Calendar: use your calendar if present, otherwise fall back
const c = state.calendar || { year: 2025, month: 1, day: 1, daysPerMonth: 30 };

const scenario = {
  schemaVersion: "rail-luti-scenario@0.1",
  meta: {
    scenarioId: "local-export",
    title: "Exported from RailLUTI",
    createdAt: new Date().toISOString(),
    sourceApp: { name: "RailLUTI", version: "dev" }
  },
  studyArea: {
    crs: "EPSG:4326",
    bbox: (() => {
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const z of zones){
        const lon = z.centroid[0], lat = z.centroid[1];
        if (!isFinite(lon) || !isFinite(lat)) continue;
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
      if (!isFinite(minLon)) return [-10, 35, 5, 45]; // fallback
      return [minLon, minLat, maxLon, maxLat];
    })(),
    country: String(state.countryId || "ES"),
    name: "Export"
  },
  calendar: {
    baseDate: `${c.year}-${String(c.month).padStart(2,"0")}-${String(c.day).padStart(2,"0")}`,
    daysPerMonth: Number(c.daysPerMonth || 30),
    timeStep: { opsSeconds: 1, landUseDays: Number(c.daysPerMonth || 30) }
  },
  parameters: {
    generalizedCost: { transferPenaltyMin: 8, waitTimeFactor: 0.5, inVehicleTimeFactor: 1.0 },
    accessibility: { decayBetaPerMin: (state.luti && state.luti.beta) ? Number(state.luti.beta) : 0.045, cutoffsMin: [30,45,60] },
    landUseDynamics: { residentRelocationRatePerTick: 0.01, jobRelocationRatePerTick: 0.008 }
  },
  zones,
  networks: {
rail: {
  lines: Array.from(state.lines.values()).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(exportLineToSchema)
}
},
  landUse: { zoning: [], projects: [] },
  freight: { commodities: [], producers: [], consumers: [] }
};

// make export deterministic
// ---- build stable hash input (exclude volatile meta fields) ----
const hashInput = structuredClone(scenario);
if (hashInput.meta){
  delete hashInput.meta.createdAt;
  delete hashInput.meta.scenarioHash;
  delete hashInput.meta.hashMethod;
}
const canon = canonicalJSONString(hashInput);

// compute hash
const hash = await sha256Hex(canon);

// store it for display + provenance
scenario.meta = scenario.meta || {};
scenario.meta.scenarioHash = hash;

// optional: store canonicalization info
scenario.meta.hashMethod = "sha256(canonical-json keys-sorted)";

// download (deterministic ordering; includes scenarioHash)
const canonOut = canonicalJSONString(scenario);
downloadJSON(JSON.parse(canonOut), `scenario.${hash.slice(0,8)}.json`);

// keep in state so UI can show it
state.scenarioHash = hash;
}

window.exportScenario = exportScenario;

function exportLineToSchema(line){
// Stops: keep order. Use zoneId = nodeId for now (we’ll refine later)
const stops = (line.stops || []).map(id => ({
  zoneId: String(id),
  role: "minor" // later: major/minor from your UI if you add it
}));

// Schedule: use explicit departures list (your system already has this)
const departuresMin = Array.isArray(line.departures) ? [...line.departures] : [];
departuresMin.sort((a,b)=>a-b);

// Service hours: default if missing
  const startMin = Number(line.serviceStartMin ?? 330);
  const endMin   = LINE_DAY_END_MIN;

// Capacity per carriage: use your current defaults
const paxPerCar = Number(line.paxPerCarriage ?? 80);
const cargoPerCar = Number(line.cargoUnitsPerCarriage ?? 250);

// Mixed ratio (if you’re using mixed lines)
const mixedRatioPax =
  line.type === "mixed" ? 0.5 :
  line.type === "cargo" ? 0.0 : 1.0;

// Costs: keep conservative placeholders if you don’t have these yet
const maint = Number(line.maintEurPerTrainPerYear ?? 0);

return {
  id: String(line.id),
  name: String(line.name || line.id),
  mode: "rail",

  serviceClass: String(line.speedClass || "fast"),
  speedKmh: Number(line.speedKmh || 120),
  dwellSec: Number(line.dwellSec || 60),
  turnaroundMin: Number(line.turnaroundMin || 0),

  carriages: Number(line.carriages || 1),
  capacity: {
    paxPerCarriage: paxPerCar,
    cargoUnitsPerCarriage: cargoPerCar,
    mixedRatioPax: mixedRatioPax
  },

  serviceHours: {
    startMin,
    endMin,
    nightService: !!line.nightService,
    nightHeadwayMin: Number(line.nightHeadwayMin || 60)
  },

  stops,

  schedule: {
    type: "explicit_departures",
    departuresMin
  },

  fares: {
    eurPerTrip: Number(line.fareEur || 0)
  },

  costs: {
    capexEur: Number(line.capexEur || 0),
    opexEurPerVehKm: Number(line.opexEurPerVehKm || 0),
    maintEurPerTrainPerYear: maint
  }
};
}

function scenario_applyZonesToNodes(){
if (!Array.isArray(state.zones) || !state.nodes) return;

// build lookup: zoneId -> zone
const zById = new Map(state.zones.map(z => [String(z.id), z]));

let applied = 0;
for (const n of state.nodes.values()){
  const z = zById.get(String(n.id));
  if (!z) continue;

  // overwrite node attributes from scenario
n.population = Number(z.population ?? n.population ?? n.pop ?? 0);
// optional: keep alias so old code still works
n.pop = n.population;

  n.jobs = Number(z.jobs ?? n.jobs ?? 0);
  n.housing = Number(z.housing ?? n.housing ?? 0);
  n.rentIndex = Number(z.rentIndex ?? n.rentIndex ?? 1);
  n.incomeIndex = Number(z.incomeIndex ?? n.incomeIndex ?? 1);

  applied++;
}

console.log(`[scenario] applied zones to nodes: ${applied}/${state.nodes.size}`);
}

const BASE_SCENARIO_SCHEMA_PREFIX = "rail-luti-scenario@";
const SCENARIO_PACK_SCHEMA_PREFIX = "rail-luti-scenario-pack@";

function normalizeScenarioPackNode(node = {}, idx){
  const id = String(node.id ?? node.nodeId ?? node.zoneId ?? `pack-node-${idx}`);
  const lat = Number(node.lat ?? node.latitude ?? node.y ?? 0);
  const lon = Number(node.lon ?? node.longitude ?? node.x ?? 0);
  return {
    id,
    name: node.name || node.label || id,
    lat: Number.isFinite(lat) ? lat : 0,
    lon: Number.isFinite(lon) ? lon : 0,
    population: Number(node.population ?? node.pop ?? 0),
    jobs: Number(node.jobs ?? 0),
    housing: Number(node.housing ?? 0),
    rentIndex: Number(node.rentIndex ?? 1),
    incomeIndex: Number(node.incomeIndex ?? 1),
    ...node
  };
}

function buildScenarioPackNodes(nodes = []){
  const map = new Map();
  nodes.forEach((node, idx) => {
    const normalized = normalizeScenarioPackNode(node, idx);
    map.set(normalized.id, normalized);
  });
  return map;
}

function buildScenarioPackTracks(edges = []){
  const map = new Map();
  edges.forEach((edge = {}, idx) => {
  const from = String(edge.from ?? edge.fromId ?? (edge.a || ""));
  const to = String(edge.to ?? edge.toId ?? (edge.b || ""));
    if (!from || !to) return;
    const trackId = String(edge.id ?? `pack-track-${from}-${to}-${idx}`);
    const lanes = Math.max(1, Number(edge.lanes ?? edge.numLanes ?? 1));
    const status = edge.status || "built";
    let progress = Number(edge.progress ?? (status === "built" ? 1 : 0));
    if (!Number.isFinite(progress)) progress = (status === "built" ? 1 : 0);
    const track = {
      id: trackId,
      from,
      to,
      lanes,
      cost: { constructionCost: Number(edge.cost?.constructionCost ?? edge.constructionCost ?? 0) },
      status,
      progress: Math.min(1, Math.max(0, progress)),
      _layer: null,
      _label: null
    };
    map.set(trackId, track);
  });
  return map;
}

function buildBaseScenarioFromPack(pack){
  const base = pack.scenario || {};
  return {
    schemaVersion: base.schemaVersion || "rail-luti-scenario@0.1",
    meta: base.meta || pack.meta || {},
    calendar: base.calendar || pack.calendar,
    parameters: base.parameters || pack.parameters,
    zones: base.zones || pack.zones,
    networks: base.networks || pack.networks || {},
  };
}

function applyScenarioPackToState(pack){
if (!pack || typeof pack !== "object") throw new Error("Scenario pack is empty");
const schemaVersion = String(pack.schemaVersion || "");
if (!schemaVersion.startsWith(SCENARIO_PACK_SCHEMA_PREFIX)) {
  throw new Error(`Unknown pack schemaVersion: ${pack.schemaVersion}`);
}

  const nodes = buildScenarioPackNodes(pack.nodes);
  state.nodes = nodes;
  if (!state.nodes.size) throw new Error("Scenario pack requires at least one node");
  state.tracks = buildScenarioPackTracks(pack.edges);

  const manifest = pack.manifest || {};
  if (typeof window !== "undefined"){
    if (manifest.datasetVersion) window.datasetVersion = manifest.datasetVersion;
    if (manifest.modelVersion) window.modelVersion = manifest.modelVersion;
    if (manifest.schemaVersion) window.schemaVersion = manifest.schemaVersion;
  }

  state.scenarioPackManifest = manifest;
  state.scenarioPackLicense = pack.license || null;

  const baseScenario = buildBaseScenarioFromPack(pack);
  baseScenario.meta = {
    ...(baseScenario.meta || {}),
    sourcePack: manifest.name || pack.meta?.title || "scenario-pack"
  };
  applyScenarioToState(baseScenario);

  state.scenarioPackMeta = {
    name: manifest.name || pack.meta?.title || "scenario-pack",
    datasetVersion: manifest.datasetVersion,
    updatedAt: manifest.updatedAt,
    tiles: manifest.tiles || [],
  };
}

function ui_cloneScenarioPayload(value){
  if (!value) return null;
  if (typeof structuredClone === "function") return structuredClone(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    console.warn("Scenario clone fallback failed:", err);
    return value;
  }
}

function ui_restartScenarioRun(){
  if (!state.scenarioPayload) {
    showToast("Load a scenario pack before restarting", "warning");
    return;
  }
  try {
    applyScenarioToState(ui_cloneScenarioPayload(state.scenarioPayload));
    updateUI();
    showToast("Scenario run restarted from pack", "success");
  } catch (e) {
    console.error(e);
    showToast(`Failed to restart scenario: ${String(e)}`, "error");
  }
}

async function ui_importScenario(){
const inp = document.getElementById("scenarioFile");
const file = inp?.files?.[0];
if (!file) { showToast("Choose a scenario .json first", "warning"); return; }

let scenario;
try {
  scenario = JSON.parse(await file.text());
} catch (e) {
  console.error(e);
  showToast("Invalid JSON file", "error");
  return;
}

try {
  const payload = ui_cloneScenarioPayload(scenario);
  if (!payload) throw new Error("Scenario payload is empty");
  state.scenarioPayload = payload;
  applyScenarioToState(ui_cloneScenarioPayload(payload));
  updateUI();
  showToast(`Scenario loaded: ${scenario?.meta?.title || "OK"}`, "success");
} catch (e) {
  console.error(e);
  showToast(`Scenario import failed: ${String(e)}`, "error");
}
}

// minimal, non-destructive: only sets scenario-related state
function applyScenarioToState(s){
if (!s || typeof s !== "object") throw new Error("Scenario is empty");
const schemaVersion = String(s.schemaVersion || "");
if (schemaVersion.startsWith(SCENARIO_PACK_SCHEMA_PREFIX)) return applyScenarioPackToState(s);
if (!schemaVersion.startsWith(BASE_SCENARIO_SCHEMA_PREFIX))
  throw new Error(`Unknown schemaVersion: ${s.schemaVersion}`);

// Calendar (your sim already has a clock/calendar concept)
state.calendar = state.calendar || {};
const baseDate = s.calendar?.baseDate || "2025-01-01";
state.calendar.baseDate = baseDate;
state.calendar.daysPerMonth = Number(s.calendar?.daysPerMonth ?? 30);

// If you use ops seconds/day ticks:
state.calendar.timeStep = state.calendar.timeStep || {};
state.calendar.timeStep.opsSeconds = Number(s.calendar?.timeStep?.opsSeconds ?? 1);
state.calendar.timeStep.landUseDays = Number(s.calendar?.timeStep?.landUseDays ?? 30);

// LUTI / parameters
state.luti = state.luti || {};
state.luti.beta = Number(s.parameters?.accessibility?.decayBetaPerMin ?? 0.045);

state.params = state.params || {};
state.params.generalizedCost = {
  transferPenaltyMin: Number(s.parameters?.generalizedCost?.transferPenaltyMin ?? 8),
  waitTimeFactor: Number(s.parameters?.generalizedCost?.waitTimeFactor ?? 0.5),
  inVehicleTimeFactor: Number(s.parameters?.generalizedCost?.inVehicleTimeFactor ?? 1),
};

state.params.landUseDynamics = {
  residentRelocationRatePerTick: Number(s.parameters?.landUseDynamics?.residentRelocationRatePerTick ?? 0.01),
  jobRelocationRatePerTick: Number(s.parameters?.landUseDynamics?.jobRelocationRatePerTick ?? 0.008),
};

// Zones (store them; later we’ll map them onto nodes/clusters)
state.zones = Array.isArray(s.zones) ? s.zones.map(z => ({
  id: String(z.id),
  name: z.name,
  centroid: z.centroid,
  population: Number(z.population ?? 0),
  jobs: Number(z.jobs ?? 0),
  housing: Number(z.housing ?? 0),
  rentIndex: Number(z.rentIndex ?? 1),
  incomeIndex: Number(z.incomeIndex ?? 1),
})) : [];

state.scenarioHash = s?.meta?.scenarioHash || null;


// meta for display/research provenance
state.scenarioMeta = s.meta || {};

  // refresh deterministic run metadata (keeps datasetVersion pinned)
  if (typeof window.makeRunMeta === "function") {
    const scenarioId = state.scenarioMeta?.id || state.scenarioMeta?.scenarioId || "default";
    const seed = Number(state.simSeed ?? state.meta?.seed ?? 1);
    const dataset = state.scenarioPackManifest?.datasetVersion || window.datasetVersion;
    const model = state.scenarioPackManifest?.modelVersion || window.modelVersion;
    const schema = state.scenarioPackManifest?.schemaVersion || window.schemaVersion;
    state.meta = window.makeRunMeta({
      seed,
      scenarioId,
      dataset,
      model,
      schema
    });
    window.datasetVersion = state.meta?.datasetVersion || window.datasetVersion;
    window.modelVersion = state.meta?.modelVersion || window.modelVersion;
    window.schemaVersion = state.meta?.schemaVersion || window.schemaVersion;
  }
// Lines (import rail network lines)
if (s.networks?.rail?.lines && Array.isArray(s.networks.rail.lines)){
  // Clear existing lines and re-import
  if (!(state.lines instanceof Map)) state.lines = new Map();
  state.lines.clear();

  const rawLines = s.networks.rail.lines;
  let firstId = null;

  for (let i=0;i<rawLines.length;i++){
    const rl = rawLines[i] || {};
    const ratio = Number(rl.capacity?.mixedRatioPax ?? 0.5);
    const type = (ratio <= 0.001) ? "cargo" : (ratio >= 0.999) ? "passenger" : "mixed";
    const d = lineDefaults(type);

    const id = String(rl.id || `LN-IMPORT-${Date.now()}-${i}`);
    if (!firstId) firstId = id;

    const ln = {
      id,
      name: String(rl.name || id),
      type,
      color: String(rl.color || d.color),
      stops: Array.isArray(rl.stops) ? rl.stops.map(s=>String(s.zoneId)).filter(Boolean) : [],
      circular: !!rl.circular,

      // legacy field kept
      frequencyPerDay: 0,

      // capacity + speed model
      carriages: clamp(Math.round(Number(rl.carriages ?? d.carriages ?? 4)), 1, 50),
      mixedRatioPax: clamp(Number(rl.capacity?.mixedRatioPax ?? 0.5), 0, 1),
      speedClass: (typeof rl.serviceClass === "string" && TRAIN_SPEED_CLASSES[rl.serviceClass]) ? rl.serviceClass : d.speedClass,
      speedKmh: Number.isFinite(Number(rl.speedKmh)) ? Math.max(10, Number(rl.speedKmh)) : (TRAIN_SPEED_CLASSES[(typeof rl.serviceClass === "string" && TRAIN_SPEED_CLASSES[rl.serviceClass]) ? rl.serviceClass : d.speedClass] || 120),

      // dwell + service hours
      dwellSec: clamp(Math.round(Number(rl.dwellSec ?? d.dwellSec ?? 45)), 0, 600),
      serviceStartMin: clamp(Math.round(Number(rl.serviceHours?.startMin ?? 330)), 0, 1439),
      serviceEndMin: LINE_DAY_END_MIN,

      // timetable
      trains: 0,
      departures: Array.isArray(rl.schedule?.departuresMin) ? rl.schedule.departuresMin.map(Number).filter(Number.isFinite) : [],
    };

    // normalize departures
    ln.departures = ln.departures.map(m=>((m%1440)+1440)%1440).sort((a,b)=>a-b);

    line_recalcDerived(ln);
    ui_lineRecalcTrainsFromDepartures(ln);

    state.lines.set(id, ln);
  }

  state.activeLine = firstId;
}

scenario_applyZonesToNodes();
if (typeof luti_computeAccessibility === "function") luti_computeAccessibility();
}

window.ui_importScenario = ui_importScenario;
window.ui_restartScenarioRun = ui_restartScenarioRun;


function ui_lineSetServiceStart(v){
const line = state.lines.get(state.activeLine);
if (!line) return;
line.serviceStartMin = hhmmToMin(v);
ui_lineRecalcTrainsFromDepartures(line);
updateUI();
}

function ui_lineSetServiceEnd(v){
const line = state.lines.get(state.activeLine);
if (!line) return;
line.serviceEndMin = LINE_DAY_END_MIN;
ui_lineRecalcTrainsFromDepartures(line);
updateUI();
}

function ui_lineToggleNight(v){
const line = state.lines.get(state.activeLine);
if (!line) return;
line.nightService = !!v;
ui_lineRecalcTrainsFromDepartures(line);
updateUI();
}

function ui_lineSetNightHeadway(v){
const line = state.lines.get(state.activeLine);
if (!line) return;
line.nightHeadwayMin = Math.max(15, Number(v));
ui_lineRecalcTrainsFromDepartures(line);
updateUI();
}

Object.assign(window, {
ui_lineSetServiceStart,
ui_lineSetServiceEnd,
ui_lineToggleNight,
ui_lineSetNightHeadway
});


function luti_bestTimeApprox(aId, bId){
if (!state.luti || !state.luti.bestT) return Infinity;
const v = state.luti.bestT.get(`${aId}|${bId}`);
return (v == null) ? Infinity : v;
}

function autoGenerateDepartures(line, count){
  const deps = [];

  const start = clamp(Number(line.serviceStartMin || 0), 0, 1439);
  const end = LINE_DAY_END_MIN;

if (end > start && count > 0){
  const span = end - start;
  for (let i = 0; i < count; i++){
    const t = start + (i * span) / count;
    deps.push(Math.round(t));
  }
}

// optional night service
  if (line.nightService){
    let t = end;
    const nightEndAbs = LINE_DAY_END_MIN + LINE_NIGHT_END_MIN;
    while (t < nightEndAbs){
      deps.push(t % 1440);
      t += Number(line.nightHeadwayMin || 60);
    }
  }

return deps.sort((a,b)=>a-b);
}


function luti_topContributors(nodeId, k=5){
const beta = (state.luti && state.luti.beta) || 0.045;
const out = [];

const nodes = Array.from(state.nodes.values());
for (const other of nodes){
  if (other.id === nodeId) continue;

  // reuse your best-time approximation from luti_computeAccessibility
  const t = luti_bestTimeApprox(nodeId, other.id);
  if (!isFinite(t)) continue;

  const jobsProxy = Number(other.population || 0);
  const contrib = jobsProxy * Math.exp(-beta * t);
  out.push({ id: other.id, name: other.name || other.id, t, contrib, jobsProxy });
}

out.sort((a,b)=>b.contrib - a.contrib);
return out.slice(0, k);
}

function service_requestDeparture(line, schedAbsMin){
const lineId = line.id;
const active = state.service.runs.filter(r => r.lineId === lineId).length;
const cap = Number(line.trains || 0);

// train available → depart on time
if (active < cap){
  service_spawnRun(line, schedAbsMin, schedAbsMin);
  return;
}

// no train → queue it
if (!state.service.pending.has(lineId)){
  state.service.pending.set(lineId, []);
}
state.service.pending.get(lineId).push(schedAbsMin);
}

function calendar_label(){
const c = state.calendar;
const yy = c.year;
const mm = String(c.month).padStart(2, "0");
const dd = String(c.day).padStart(2, "0");
return `${yy}-${mm}-${dd}`;
}

function unlock_initState(){
  if (!state.unlocks || typeof state.unlocks != "object") state.unlocks = {};
  const u = state.unlocks;
  u.currentCountry = u.currentCountry || state.countryId || "ES";
  if (!Array.isArray(u.unlockedCountries) || !u.unlockedCountries.length) u.unlockedCountries = ["ES"];
  if (!u.unlockedCountries.includes("ES")) u.unlockedCountries.unshift("ES");
  if (!Number.isFinite(u.interconnectivityPct)) u.interconnectivityPct = 0;
  if (!Number.isFinite(u.monthlyProfit)) u.monthlyProfit = 0;
  if (!Number.isFinite(u.lastMonthProfit)) u.lastMonthProfit = u.monthlyProfit || 0;
  if (!Number.isFinite(u.monthStartProfit)) u.monthStartProfit = Number(state.profit || 0);
  if (typeof u.lastMonthLabel != "string") u.lastMonthLabel = "";
}

function unlock_computeInterconnectivityPct(){
  if (typeof renderGraph_buildTrackAdj !== "function") return 0;
  const adj = renderGraph_buildTrackAdj();
  if (!adj || !adj.size || !state.nodes) return 0;

  const clusterIds = new Set();
  for (const n of state.nodes.values()){
    if (n && n.kind === "cluster") clusterIds.add(n.id);
  }
  const total = clusterIds.size;
  if (total <= 1) return 0;

  const visitedNodes = new Set();
  const visitedClusters = new Set();
  let maxComponent = 0;

  for (const id of clusterIds){
    if (visitedClusters.has(id)) continue;

    const queue = [id];
    let compClusters = 0;

    while (queue.length){
      const cur = queue.pop();
      if (visitedNodes.has(cur)) continue;
      visitedNodes.add(cur);

      if (clusterIds.has(cur)){
        visitedClusters.add(cur);
        compClusters += 1;
      }

      const nbrs = adj.get(cur);
      if (!nbrs) continue;
      for (const e of nbrs){
        if (e && e.to != null && !visitedNodes.has(e.to)) queue.push(e.to);
      }
    }

    if (compClusters > maxComponent) maxComponent = compClusters;
  }

  return Math.round((maxComponent / total) * 1000) / 10;
}

function unlock_refreshMetrics({ force = false } = {}){
  unlock_initState();
  const u = state.unlocks;
  const now = Date.now();
  if (!force && u._lastMetricTs && (now - u._lastMetricTs) < 1500) return;
  u._lastMetricTs = now;
  u.interconnectivityPct = unlock_computeInterconnectivityPct();
}

function unlock_evalRules(){
  unlock_initState();
  const u = state.unlocks;
  const unlocked = new Set(u.unlockedCountries || []);
  let added = false;

  for (const rule of COUNTRY_UNLOCK_RULES){
    if (!rule || !rule.id) continue;
    if (unlocked.has(rule.id)) continue;

    if (Number(u.interconnectivityPct || 0) >= Number(rule.minInterconnectPct || 0) &&
        Number(u.lastMonthProfit || 0) >= Number(rule.minMonthlyProfit || 0)) {
      unlocked.add(rule.id);
      const spec = getCountrySpec(rule.id);
      showToast(`New country unlocked: ${spec ? spec.name : rule.id}`, "success");
      added = true;
    }
  }

  if (added) u.unlockedCountries = Array.from(unlocked);
}

function unlock_monthTick(){
  unlock_initState();
  const u = state.unlocks;
  const profitNow = Number(state.profit || 0);
  const start = Number(u.monthStartProfit || profitNow);
  const delta = profitNow - start;
  u.lastMonthProfit = delta;
  u.monthlyProfit = delta;
  u.lastMonthLabel = (typeof calendar_label === "function") ? calendar_label() : "";
  u.monthStartProfit = profitNow;
  unlock_refreshMetrics({ force: true });
  unlock_evalRules();
}

function calendar_advanceDay(){
const c = state.calendar;
c.day += 1;
c.dayOfWeek = ((c.dayOfWeek || 1) % 7) + 1;

if (c.day > (c.daysPerMonth || 30)){
  c.day = 1;
  c.month += 1;

  if (state.calendar.day === 1) {
   luti_monthTick();  // recompute accessibility + update pop/jobs later
   try { if (typeof unlock_monthTick === "function") unlock_monthTick(); } catch(_) {}
   try { if (typeof economy_monthTick === "function") economy_monthTick(state); } catch(_) {}
   updateUI();

  if (c.month > 12){
    c.month = 1;
    c.year += 1;
    luti_yearTick();
  }
}
}

// Construction progress ticks daily (sim-time)
try { if (typeof construction_advanceDay === "function") construction_advanceDay(); } catch(_) {}
try { if (typeof line_retireTick === "function") line_retireTick(); } catch(_) {}
}

function line_retireTick(){
  const dayNow = Number(state.service?.day || 0);
  const removed = [];

  for (const [id, line] of state.lines.entries()){
    if (!line || !line.retiring) continue;
    const start = Number(line.retireStartDay || 0);
    const wait = Number(line.retireDays || CONFIG.LINE_RETIRE_DAYS || 7);
    if ((dayNow - start) >= wait) {
      removed.push(id);
    }
  }

  if (!removed.length) return;

  for (const id of removed){
    state.lines.delete(id);
    if (state.activeLine === id) state.activeLine = null;
  }

  renderLines();
  updateUI();
  showToast(`Line removed after retirement`, "warning");
}

function luti_monthTick(){
luti_computeAccessibility();
luti_monthlyPopulationUpdate();
}

window.luti_monthTick = luti_monthTick;



function luti_yearTick(){
// placeholder: later budgets, long-term growth constraints, etc.
}

function luti_computeAccessibility(){
const beta = Number(state.luti.beta || 0.045);

// Use node "pop" as a proxy for "jobs" for now (we’ll split jobs vs residents later)
// If you already have jobs somewhere, swap it in.
const nodes = Array.from(state.nodes.values());
const idList = nodes.map(n => n.id);

// Build a very rough best travel time between nodes:
// For now: if two nodes are on the same line, use that line's runtime as time between them
// Otherwise: Infinity (later we add transfers + network shortest path)
state.luti.bestT = new Map(); // "a|b" -> minutes
const bestT = new Map();


for (const line of state.lines.values()){
  const stops = (line.stops || []).filter(Boolean);
  if (stops.length < 2) continue;

  const rt = ui_lineRuntimeMin(line); // includes dwell now
  if (!(rt > 0)) continue;

  // crude: distribute runtime across stop pairs by index distance
  for (let i=0;i<stops.length;i++){
    for (let j=0;j<stops.length;j++){
      if (i===j) continue;
      const a = stops[i], b = stops[j];
      const frac = Math.abs(j - i) / (stops.length - 1);
      const tij = rt * frac;

      const k = `${a}|${b}`;
      const prev = bestT.get(k);
      if (prev == null || tij < prev) bestT.set(k, tij);
    }
  }
}

// Accessibility score per node
state.luti.accessJobs.clear();

for (const aId of idList){
  let score = 0;
  for (const bId of idList){
    if (aId === bId) continue;

    const tb = bestT.get(`${aId}|${bId}`);
    if (tb == null) continue;

    const b = state.nodes.get(bId);
    const jobsProxy = Number(b?.population ?? b?.pop ?? 0);
    score += jobsProxy * Math.exp(-beta * tb);
  }
  state.luti.accessJobs.set(aId, score);
}
}


function ui_renderLineLegend(){
  const el = document.getElementById("lineLegend");
  if (!el) return;
  const isProd = state.primaryTab === "production";
  el.style.display = "";

  let lines = Array.from(state.lines?.values?.() || []);
  const allowed = isProd ? ["cargo"] : ["passenger"];
  lines = lines.filter(l => allowed.includes(l?.type || "passenger"));
  const lineNumber = (line) => {
    if (!line) return "";
    const n = Number(line.number);
    if (Number.isFinite(n) && n > 0) return String(n);
    const m = String(line.name || "").match(/\\b(\\d+)\\b/);
    return m ? m[1] : "";
  };
  const lineLabel = (line) => {
    const num = lineNumber(line);
    const base = line?.name || line?.id || "Line";
    return num ? `#${num} ${base}` : base;
  };
if (!lines.length) {
  el.innerHTML = `
    <div class="title">Lines</div>
    <div style="color:#64748b;font-weight:900;">No lines yet</div>
  `;
  return;
}

// show most “important” lines first (by freq*capacity)
lines.sort((a,b) => {
  const as = (Number(a.frequencyPerDay||0) * Number(a.vehicleCapacity||0)) || 0;
  const bs = (Number(b.frequencyPerDay||0) * Number(b.vehicleCapacity||0)) || 0;
  return bs - as;
});

const top = lines.slice(0, 10);

el.innerHTML = `
  <div class="title">Lines</div>
  ${top.map(l => {
    const isActive = (l.id === state.activeLine);
    const freq = Math.round(Number(l.frequencyPerDay || 0));
    const cap = Math.round(Number(l.vehicleCapacity || 0));
    const stops = Array.isArray(l.stops) ? l.stops.length : 0;

    return `
      <div class="item ${isActive ? "active" : ""}" onclick="selectLine('${l.id}')">
        <div class="left">
          <span class="swatch" style="background:${l.color || "#2b6cff"}"></span>
          <div class="name">${lineLabel(l)}</div>
        </div>
        <div class="meta">${l.type || "passenger"} • ${stops} stops</div>
      </div>
    `;
  }).join("")}
  <div style="margin-top:8px;color:#64748b;font-weight:850;font-size:11px;">
    Click a line to select. (Shows top 10 by capacity.)
  </div>
`;
}

function ui_lineSetDwellSec(v){
const line = state.lines.get(state.activeLine);
if (!line) return;
line.dwellSec = clamp(Number(v || 0), 0, 600);

// dwell changes runtime -> affects arrivals + trains required
if (typeof ui_lineRecalcTrainsFromDepartures === "function") ui_lineRecalcTrainsFromDepartures(line);
updateUI();
}
Object.assign(window, { ui_lineSetDwellSec });


function service_activeTrainsOnLine(lineId){
return (state.service?.runs || []).filter(r => r.lineId === lineId).length;
}

function service_runDistanceAtElapsed(line, points, elapsedMin){
// returns { distM, done }
const n = points.length;
if (n < 2) return { distM: 0, done: true };

const speed = Math.max(10, Number(line.speedKmh || 120));
const dwellMin = Math.max(0, Number(line.dwellSec || 0)) / 60;

// precompute segment lengths (meters)
const segM = [];
let totalM = 0;
for (let i = 0; i < n - 1; i++){
  const a = points[i], b = points[i+1];
  const d = map.distance([a.lat, a.lon], [b.lat, b.lon]);
  segM.push(d);
  totalM += d;
}
if (totalM <= 0) return { distM: 0, done: true };

// walk segments in time order: travel seg -> dwell at arrival stop (except final)
let t = Math.max(0, Number(elapsedMin || 0));
let dist = 0;

for (let i = 0; i < segM.length; i++){
  const segKm = segM[i] / 1000;
  const travelMin = (segKm / speed) * 60;

  // traveling this segment
  if (t <= travelMin){
    const f = travelMin <= 0 ? 1 : (t / travelMin);
    dist += segM[i] * f;
    return { distM: dist, done: false, totalM };
  }
  t -= travelMin;
  dist += segM[i];

  // dwell at stop i+1 (skip dwell after final stop)
  if (i < segM.length - 1){
    if (t <= dwellMin){
      // staying exactly at the stop
      return { distM: dist, done: false, totalM };
    }
    t -= dwellMin;
  }
}

// past the end
return { distM: totalM, done: true, totalM };
}

function service_latLngAtDistance(points, distM){
if (!points || points.length < 2) return null;

// build segment lengths
let total = 0;
const seg = [];
for (let i = 0; i < points.length - 1; i++){
  const a = points[i], b = points[i+1];
  const d = map.distance([a.lat, a.lon], [b.lat, b.lon]);
  seg.push(d);
  total += d;
}
if (total <= 0) return [points[0].lat, points[0].lon];

let target = Math.max(0, Math.min(total, Number(distM || 0)));
for (let i = 0; i < seg.length; i++){
  const d = seg[i];
  if (target <= d || i === seg.length - 1){
    const a = points[i], b = points[i+1];
    const f = d <= 0 ? 0 : (target / d);
    const lat = a.lat + (b.lat - a.lat) * f;
    const lon = a.lon + (b.lon - a.lon) * f;
    return [lat, lon];
  }
  target -= d;
}
return [points.at(-1).lat, points.at(-1).lon];
}


function ui_centerOnSelected(){
const id = state.selectedNodeId;
const n = id ? state.nodes.get(id) : null;
if (!n || !map) return;
map.setView([Number(n.lat), Number(n.lon)], Math.max(map.getZoom(), 10), { animate:true });
}

function ui_centerOnNodeId(nodeId){
const n = nodeId ? state.nodes.get(nodeId) : null;
if (!n || !map) return;
map.setView([Number(n.lat), Number(n.lon)], Math.max(map.getZoom(), 10), { animate:true });
}


function ui_startLineAtSelected(){
const id = state.selectedNodeId;
const n = id ? state.nodes.get(id) : null;
if (!n) { showToast("Select a node first", "warning"); return; }

createNewLine();
const line = state.activeLine ? state.lines.get(state.activeLine) : null;
if (!line) return;

line.stops = [n.id];
state.lineBuildMode = true;
state.trackBuildMode = false;
state.pendingTrackNode = null;

renderLines();
updateUI();
showToast(`Started new line at ${n.name || n.id} (add-stops ON)`, "success");
}

function ui_toggleAddStops(){
if (!state.activeLine) { showToast("Select a line first", "warning"); return; }
if (state.trackBuildMode) {
  showToast("Exit track build mode first", "warning");
  return;
}
setLineBuildMode(!state.lineBuildMode);
}

function setLineBuildMode(on, { silent=false } = {}){
  if (on && state.trackBuildMode) {
    if (typeof setTrackBuildMode === "function") setTrackBuildMode(false, { silent: true });
    else state.trackBuildMode = false;
  }
  if (on) state.pendingTrackNode = null;
  state.lineBuildMode = !!on;

  if (state.lineBuildMode) {
    if (state.clock && typeof state.clock.running === "boolean") {
      state.clock._wasRunningBeforeLineBuild = !!state.clock.running;
    }
    if (typeof clock_stop === "function") clock_stop();
  } else {
    if (state.clock && state.clock._wasRunningBeforeLineBuild) {
      if (typeof clock_start === "function") clock_start();
    }
    if (state.clock) state.clock._wasRunningBeforeLineBuild = false;
  }

  updateUI();
  if (!silent) showToast(state.lineBuildMode ? "Add-stops ON" : "Add-stops OFF", "info");
}

function getStation(nodeId){
const id = String(nodeId);
if (!state.stations.has(id)) {
  state.stations.set(id, { level: 0, platforms: 1, amenities: 0, retail: 0 });
}
return state.stations.get(id);
}

function retailUpgradeCost(st){
// escalating cost: 20M, 33M, 54M, ...
return Math.round(20_000_000 * Math.pow(1.65, Number(st.retail || 0)));
}



function upgradeRetailOnSelected(){
const n = state.selectedNode;
if (!n) { showToast("Select a station first", "warning"); return; }

const st = getStation(n.id);
const cost = retailUpgradeCost(st);

if (state.budget < cost) {
  showToast("Not enough budget", "warning");
  return;
}

state.budget -= cost;
st.retail = (Number(st.retail || 0) + 1);

showToast(`Retail upgraded at ${n.name} (level ${st.retail})`, "success");
updateUI();
}

function computeRetailRentEURPerYear(){
// Simple, readable model:
// rent = baseRent * retailLevel * (1 + localPopFactor)
// Uses node population if present.
let rent = 0;

for (const [id, st] of state.stations.entries()){
  const lvl = Math.max(0, Number(st?.retail || 0));
  if (lvl <= 0) continue;

  const n = state.nodes.get(String(id));
  const pop = Math.max(0, Number(n?.population || 0));

  // pop factor: 0..~2.0 for big cities/clusters
  const popFactor = Math.min(2.0, Math.log10(1 + pop) / 5);

  const baseRent = 8_000_000; // €8M per retail level per year (tweak later)
  rent += baseRent * lvl * (1 + popFactor);
}

return Math.round(rent);
}

function stationUpgradeCost(kind, st){
// Simple escalating costs (tweak later)
const base =
  kind === "platforms" ? 25_000_000 :
  kind === "amenities" ? 15_000_000 :
  kind === "retail" ? 18_000_000 : 20_000_000;

const lvl =
  kind === "platforms" ? (st.platforms - 1) :
  kind === "amenities" ? st.amenities :
  kind === "retail" ? st.retail : st.level;

return Math.round(base * (1 + lvl * 0.65));
}

function upgradeStation(kind){
const n = state.selectedNode;
if (!n) return;

const st = getStation(n.id);
const cost = stationUpgradeCost(kind, st);
if (state.budget < cost) {
  showToast("Not enough budget for this upgrade", "warning");
  return;
}

state.budget -= cost;

if (kind === "platforms") st.platforms += 1;
else if (kind === "amenities") st.amenities += 1;
else if (kind === "retail") st.retail += 1;

st.level = Math.max(st.level, st.platforms - 1, st.amenities, st.retail);

updateUI();
showToast(`Upgraded ${kind} at ${n.name}`, "success");

// refresh rings (busyness can later incorporate station capacity)
try { render_overlay(); } catch (_) {}
}

function fmtNum(x){
  if (x === null || x === undefined || Number.isNaN(Number(x))) return "—";
  return Number(x).toLocaleString();
}
function formatCurrency(amount){
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return "—";
  const a = Number(amount);
  if (a >= 1e12) return '€' + (a/1e12).toFixed(2) + 'T';
  if (a >= 1e9)  return '€' + (a/1e9).toFixed(2) + 'B';
  if (a >= 1e6)  return '€' + (a/1e6).toFixed(2) + 'M';
  if (a >= 1e3)  return '€' + (a/1e3).toFixed(0) + 'K';
  return '€' + a.toFixed(0);
}
function showToast(msg, type="info"){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  t.style.background =
    type==="error" ? "#ef4444" :
    type==="success" ? "#10b981" :
    type==="warning" ? "#f59e0b" : "#0f172a";
  setTimeout(()=> t.style.display="none", 2200);
}
async function loadJSON(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return await res.json();
}
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }

// deterministic hash -> 0..1
function hash01(str){
  let h = 2166136261;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000000) / 1000000;
}

function edgeKey(a,b){
  a=String(a); b=String(b);
  return a<b ? `${a}—${b}` : `${b}—${a}`;
}
function getCountryCatalog(){
  if (state && Array.isArray(state.countryCatalog) && state.countryCatalog.length) return state.countryCatalog;
  return COUNTRY_CATALOG;
}

function getCountrySpec(id){
  const cid = String(id || "").toUpperCase();
  return getCountryCatalog().find(c => String(c.id || "").toUpperCase() === cid) || null;
}

function getCountryUnlockRule(id){
  const cid = String(id || "").toUpperCase();
  return COUNTRY_UNLOCK_RULES.find(r => String(r.id || "").toUpperCase() === cid) || null;
}


// ======================
// State
// ======================
var state = {
    clock: { tMin: 8*60, running: true, speed: 60, lastTs: null, rafId: 0 },
  nodes: new Map(),   // id -> {id,name,lat,lon,kind,population,production,clusterId?}
  cities: [],
  clusters: new Map(),// clusterId -> {id, hubCityId, hubName, lat, lon, population, cityIds:Set, bounds, totalProduction, biggestProduction}
  stations: new Map(), // nodeId -> { level, platforms, amenities, retail }
    tracks: new Map(),  // trackId -> {id, from, to, lanes, cost, _layer, _label}
    railNodes: new Map(), // nodeId -> { id, lat, lon }
    railLinks: new Map(), // linkId -> raw link metadata
  construction: { queue: [], active: [], history: [] },
  stationPressure: new Map(), // nodeId -> { demand, supply, pressurePct }
  lines: new Map(),   // lineId -> {id,name,type,color,stops:[],circular, frequencyPerDay, vehicleCapacity, speedKmh}
  scenarioMeta: null,
  scenarioPayload: null,
  scenarioHash: null,
  scenarioPackManifest: null,
  scenarioPackMeta: null,
  scenarioPackLicense: null,
  offlineManifest: null,

  year: 2024,
  budget: CONFIG.STARTING_BUDGET,
  annualBudget: CONFIG.ANNUAL_BUDGET,
  revenue: 0,
  costs: 0,
  profit: 0,
  countryId: "ES",
  countryCatalog: COUNTRY_CATALOG,
  countryView: null,
  countryBorder: null,
  worldBorder: null,
  mapTheme: "default",
  worldView: false,
  onlineMode: true,
  unlocks: {
    currentCountry: "ES",
    unlockedCountries: ["ES"],
    interconnectivityPct: 0,
    monthlyProfit: 0,
    lastMonthProfit: 0,
    monthStartProfit: 0,
    lastMonthLabel: ""
  },
  // Undo (last actions)
  undo: { stack: [], max: 60 },

// ===== Dynamics (filled by economy.js later) =====
dynamics: {
  enabled: true,
  showOverlay: true,
  mode: "both", // "goods" | "passengers" | "both"
},

// Summary numbers to display (economy.js should update these)
flowSummary: {
  goodsDelivered: 0,
  goodsDemand: 0,
  goodsByRail: 0,
  goodsByOther: 0,
  goodsUnmet: 0,
  passengerTrips: 0,
  passengerUnmet: 0,
  demandMetPct: 0,          // 0..100
  topExportName: "—",
  topExportValue: 0,
  topNeedName: "—",
  topNeedValue: 0,
  topBottleneck: "—",
  topBottleneckValue: 0,
},

  primaryTab: "population",
  activeTab: "network",
  activeLine: null,

  
  activeLinePanel: "service", // "service" | "timetable" | "diagram"
// modes
  trackBuildMode: false,
  pendingTrackNode: null,
  pendingTrackLanes: 1,

  // clustering UX
  activeClusterId: null,
  selectedNode: null,

  selectedNodeId: null,
  selectedCellId: null,
// line building toggle
  lineBuildMode: true,
  trackBuildAction: "build",

  viewMode: "stations",
  mapLayers: {
    showStations: true,
    showCities: false,
    showClusters: false,
    showTracks: true,
    showLines: true,
    showTrains: true,
    showComarcaBorders: false,
    showDemandHeat: false,
    showCatchments: false,
    showUnderserved: false,
    showRealInfra: true,
    highlightUnusedStations: false
  },
  stationPlacementMode: false,
  stationPlacementDraft: null,
  stationFilterTerm: "",
  debug: { perf: false },
  dirty: {
    demand: false,
    network: false
  },
  customStations: new Map(),
  disabledStations: new Set(),
  simConfig: {
    accessSpeedKmh: 50,
    maxAccessKm: 60,
    gravityAlpha: 2.2,
    railBeta: 0.6,
    candidateStationsK: 12,
    congestionGamma: 2.0,
    serviceQualityWeight: 0.25,
    paxFactor: 0.35,
    freightFactor: 0.08
  },
  cells: new Map(),
  cellsGeoJSON: null,
  cellToStationAllocation: new Map(),
  stationLoad: new Map(),
  underservedByCell: new Map(),
  catchmentByCell: new Map(),
  cityStationAllocation: new Map(),
  stationCityAllocations: new Map(),
  realInfra: {
    success: false,
    stationsLoaded: false,
    tracksLoaded: false,
    stationsUrl: null,
    edgesUrl: null
  },
  simNodeMode: "cities",
};

if (typeof window !== "undefined") {
  window.state = state;
}
