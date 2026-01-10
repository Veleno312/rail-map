/* eslint-disable no-undef, no-unused-vars, no-empty */
// Ensure global state and clock are always initialized, but do NOT overwrite existing state
if (typeof window.state === 'undefined') {
  window.state = {};
}
// Only initialize missing sub-properties
window.state.clock ||= { tMin: 8*60, running: true, speed: 60, lastTs: null, rafId: 0 };
window.state.service ||= {
  day: 0,
  prevTMin: null,
  runs: [],
  layer: null,
};
window.state.calendar ||= {
  year: 2025,
  month: 1,
  day: 1,
  daysPerMonth: 30,
  dayOfWeek: 1,
};
window.state.luti ||= {
  beta: 0.045,
  accessJobs: new Map()
};
window.state.lastOperatingCostDay ||= 0;
window.state.service.pending ||= new Map();
// ======================
// Scheduled service runs (per-line)
// ======================
state.service ||= {
day: 0,            // increments when clock wraps past midnight
prevTMin: null,    // previous clock minute-of-day
runs: [],          // active runs
layer: null,       // Leaflet layer group for run markers
};

if (!state.calendar){
state.calendar = {
  year: 2025,
  month: 1,
  day: 1,
  daysPerMonth: 30,
  dayOfWeek: 1,
};}
if (!state.luti){
state.luti= {
beta: 0.045,          // sensitivity to travel time (tunable)
accessJobs: new Map() // nodeId -> score
};}

state.lastOperatingCostDay = 0;

state.service.pending ||= new Map(); 
// lineId -> array of scheduled absolute minutes waiting to depart

window.state = state;

function service_init(){
if (!state.service.layer) state.service.layer = L.layerGroup().addTo(map);
}

function service_lineVisible(line){
  const type = line?.type || "passenger";
  if (state.primaryTab === "production") return type === "cargo" || type === "mixed";
  return type === "passenger" || type === "mixed";
}

function service_applyVisibility(marker, visible){
  if (!marker) return;
  const op = visible ? 1 : 0;
  try {
    if (visible) {
      if (state.service?.layer && typeof state.service.layer.hasLayer === "function") {
        if (!state.service.layer.hasLayer(marker)) marker.addTo(state.service.layer);
      }
    } else {
      try { state.service?.layer?.removeLayer?.(marker); } catch(_) {}
    }
    if (typeof marker.setStyle === "function") {
      marker.setStyle({ opacity: op, fillOpacity: op });
    }
  } catch(_) {}
}

function service_refreshRunVisibility(){
  if (!state.service?.runs) return;
  for (const r of state.service.runs){
    const line = state.lines?.get?.(r.lineId);
    service_applyVisibility(r.marker, service_lineVisible(line));
  }
}
window.service_refreshRunVisibility = service_refreshRunVisibility;

function luti_monthlyPopulationUpdate(){
if (!state.luti || !state.luti.accessJobs) return;
state.luti.lastMonth = state.luti.lastMonth || {};
state.luti.lastMonth.popDeltaById = {};
const access = state.luti.accessJobs;
const nodes = Array.from(state.nodes.values());

// compute average accessibility (population-weighted)
let wsum = 0, psum = 0;
for (const n of nodes){
  const a = access.get(n.id) || 0;
  const p = Math.max(0, Number(n.population || 0));
  wsum += a * p;
  psum += p;
}
if (psum <= 0) return;

const avgAccess = wsum / psum;

// parameters (very conservative)
const MAX_RATE = 0.005; // ±0.5% per month

let totalDelta = 0;

for (const n of nodes){
  const a = access.get(n.id) || 0;
  const p = Math.max(0, Number(n.population || 0));
  if (p <= 0) continue;

  // relative accessibility advantage
  const rel = (a - avgAccess) / Math.max(avgAccess, 1);

  // bounded growth rate
  const rate = Math.max(-MAX_RATE, Math.min(MAX_RATE, rel * 0.01));

  const delta = p * rate;
  state.luti.lastMonth.popDeltaById[n.id] = delta;
  n.population = p + delta;
  totalDelta += delta;
}

state.luti.lastMonth.totalPopDelta = totalDelta;
state.luti.lastMonth.monthLabel = calendar_label ? calendar_label() : "";

console.log(`[LUTI] monthly pop update: Δ${Math.round(totalDelta)}`);
}

// detect if target minute "x" was crossed between prev -> cur (handles wrap)
function crossedMinute(prev, cur, x){
if (prev == null) return false;
prev = Number(prev); cur = Number(cur); x = Number(x);
if (prev <= cur) return x > prev && x <= cur;
// wrapped midnight: prev..1440 and 0..cur
return (x > prev && x < 1440) || (x >= 0 && x <= cur);
}

function line_trackPathPoints(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 2) return null;
if (typeof renderGraph_buildTrackAdj !== "function" || typeof renderGraph_shortestPath !== "function") return null;
const adj = renderGraph_buildTrackAdj();
  if (!adj || !adj.size) return null;
  
  const latlngs = [];
  const pushPath = (pathIds) => {
  if (!Array.isArray(pathIds) || pathIds.length < 2) return false;
    const pts = [];
  for (const id of pathIds){
      const n = state.nodes.get(id);
      if (n) pts.push({ lat: Number(n.lat), lon: Number(n.lon) });
    }
    if (pts.length < 2) return false;
    if (!latlngs.length) latlngs.push(...pts);
    else latlngs.push(...pts.slice(1));
    return true;
  };
  
  if (Array.isArray(line.pathNodes) && line.pathNodes.length >= 2) {
    let stopIdx = 0;
    let okPath = true;
    for (const stop of line.stops) {
      const stopStr = String(stop);
      let found = -1;
      for (let i = stopIdx; i < line.pathNodes.length; i++) {
        if (String(line.pathNodes[i]) === stopStr) { found = i; break; }
      }
      if (found < 0) { okPath = false; break; }
      stopIdx = found + 1;
    }
    for (let i = 1; i < line.pathNodes.length; i++) {
      const aRaw = line.pathNodes[i - 1];
      const bRaw = line.pathNodes[i];
      const bStr = String(bRaw);
      const nbrs = adj.get(aRaw) || adj.get(String(aRaw));
      if (!nbrs || !nbrs.some(e => String(e.to) === bStr)) { okPath = false; break; }
    }
    if (okPath && pushPath(line.pathNodes)) return latlngs;
  }
  
  for (let i = 1; i < line.stops.length; i++){
  const a = line.stops[i - 1];
  const b = line.stops[i];
  const path = renderGraph_shortestPath(adj, a, b);
  if (!pushPath(path)) return null;
  }
  
  return latlngs;
  }

function service_lineRuntimeMin(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 2) return 0;

const pts = line_trackPathPoints(line);
if (!pts || pts.length < 2) return 0;

let meters = 0;
for (let i = 0; i < pts.length - 1; i++){
  const a = pts[i], b = pts[i+1];
  meters += map.distance([a.lat, a.lon], [b.lat, b.lon]);
}

const km = meters / 1000;
const speed = Math.max(10, Number(line.speedKmh || 120));
const travelMin = (km / speed) * 60;

const dwellMin = Math.max(0, Number(line.dwellSec || 0)) / 60;
const dwellTotal = Math.max(0, line.stops.length - 1) * dwellMin;

return travelMin + dwellTotal;
}

function service_makeMarker(color){
return L.circleMarker([0,0], {
  radius: 5,
  weight: 2,
  color: "#0f172a",
  fillColor: color || "#38bdf8",
  fillOpacity: 1
}).addTo(state.service.layer);
}

function invertHexColor(hex){
  const s = String(hex || "").trim();
  if (!s.startsWith("#")) return "#0f172a";
  let v = s.slice(1);
  if (v.length === 3) v = v.split("").map(ch => ch + ch).join("");
  if (v.length !== 6) return "#0f172a";
  const r = 255 - parseInt(v.slice(0,2), 16);
  const g = 255 - parseInt(v.slice(2,4), 16);
  const b = 255 - parseInt(v.slice(4,6), 16);
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function service_spawnRun(line, depMin){
// Only run if all track segments are built
if (typeof line_isTrackReady === "function" && !line_isTrackReady(line)) return;
// trains = max simultaneous runs for that line
const cap = clamp(Number(line.trains || 0), 0, 50);
if (cap <= 0) return;

const activeSameLine = state.service.runs.filter(r => r.lineId === line.id);
if (activeSameLine.length >= cap) return;

const runtime = service_lineRuntimeMin(line);
if (runtime <= 0.05) return;

// Build a track-following path using the built tracks
const points = line_trackPathPoints(line);
if (!points || points.length < 2) return;

const marker = service_makeMarker(line.color);
service_applyVisibility(marker, service_lineVisible(line));

// This run is parameterized by start minute-of-day (depMin) and duration (runtime)
state.service.runs.push({
  id: `RUN-${line.id}-${state.service.day}-${depMin}`,
  lineId: line.id,
  depMin: Number(depMin),
  absStart: (state.service.day*1440 + Number(depMin)),
  runtimeMin: runtime,
  dir: 1,
  points,
  marker
});
}

function service_updateRuns(curTMin){
// remove finished + move active
const keep = [];
for (const r of state.service.runs){
  const line = state.lines.get(r.lineId);
  if (!line) { r.marker.remove(); continue; }

  // minutes since departure, handling wrap by using "day"
  // We treat departures as happening in the current service.day.
  // If current time is "before" depMin due to wrap, it's next day and run is finished.
  const absNow = state.service.day*1440 + Number(curTMin);
  let dt = absNow - Number(r.absStart ?? (state.service.day*1440 + Number(r.depMin)));
  if (dt < 0) dt = 0;

  const cycleMin = Number(r.runtimeMin) * 2;
  if (dt >= cycleMin){
    r.marker.remove();
    continue;
  }

  let res;
  let distM = 0;
  let totalM = 1;
  if (dt <= Number(r.runtimeMin)) {
    r.dir = 1;
    res = service_runDistanceAtElapsed(line, r.points, dt);
    distM = res.distM;
    totalM = Number(res.totalM || 0) || 1;
  } else {
    const backT = dt - Number(r.runtimeMin);
    r.dir = -1;
    res = service_runDistanceAtElapsed(line, r.points, backT);
    totalM = Number(res.totalM || 0) || 1;
    distM = totalM - res.distM;
  }

  if (res.done && dt <= Number(r.runtimeMin)) {
    // if forward path can't compute, drop this run
    r.marker.remove();
    continue;
  }

  const ll = service_latLngAtDistance(r.points, distM);
  if (ll) r.marker.setLatLng(ll);

  r.progress = Math.max(0, Math.min(1, distM / totalM));

  const base = line.color || "#38bdf8";
  const fill = (r.dir === -1) ? invertHexColor(base) : base;
  try { r.marker.setStyle({ fillColor: fill }); } catch (_) {}

  if (ll) r.marker.setLatLng(ll);
  keep.push(r);
}
state.service.runs = keep;
}

function haversineMeters(lat1, lon1, lat2, lon2){
return map.distance([lat1, lon1], [lat2, lon2]);
}

// Interpolate along polyline points by progress fraction (0..1)
function service_latLngAtProgress(points, frac){
if (!points || points.length < 2) return null;
frac = Math.max(0, Math.min(1, Number(frac)));

// compute segment lengths in meters
let segLens = [];
let total = 0;
for (let i=0;i<points.length-1;i++){
  const a = points[i], b = points[i+1];
  const d = haversineMeters(a.lat, a.lon, b.lat, b.lon); // you already have haversineMeters()
  segLens.push(d);
  total += d;
}
if (total <= 0) return [points[0].lat, points[0].lon];

let target = frac * total;
for (let i=0;i<segLens.length;i++){
  const d = segLens[i];
  if (target <= d || i === segLens.length-1){
    const a = points[i], b = points[i+1];
    const t = d <= 0 ? 0 : target / d;
    const lat = a.lat + (b.lat - a.lat) * t;
    const lon = a.lon + (b.lon - a.lon) * t;
    return [lat, lon];
  }
  target -= d;
}
return [points.at(-1).lat, points.at(-1).lon];
}

// ======================
// Simulation clock (minutes of day)
// ======================
state.clock ||= { tMin: 8*60, running: true, speed: 60, lastTs: null, rafId: 0 };
let _lastAnimTs = null;

// ======================
// Clock loop (runs even if no trains exist)
// ======================
function clock_tick(ts){
  state.clock ||= { tMin: 8*60, running: true, speed: 60, lastTs: null, rafId: 0 };
// Always keep the RAF loop alive
if (state.clock.lastTs == null) state.clock.lastTs = ts;

const dtSec = (ts - state.clock.lastTs) / 1000;
state.clock.lastTs = ts;

if (state.clock.running){
  const spd = Number(state.clock.speed || 60); // sim minutes per real second
  state.clock.tMin = (Number(state.clock.tMin || 0) + dtSec * spd) % 1440;
service_init();

const cur = Number(state.clock.tMin || 0);

// detect day wrap
if (state.service.prevTMin != null && cur < state.service.prevTMin){
state.service.day += 1;
calendar_advanceDay();
}

// operating cost drain (proportional to simulated time elapsed)
// charge: opDay €/day * (deltaSimMinutes / 1440)
const opDay = network_operatingCostEURPerDay();
state.lastOperatingCostDay = opDay;

const prev = state.service.prevTMin;
if (prev != null){
// minutes advanced since last tick (handle midnight wrap)
const deltaMin = (cur >= prev) ? (cur - prev) : ((1440 - prev) + cur);

// cost for this tick
const cost = (opDay * (deltaMin / 1440));

// apply
state.budget -= cost;

// optional: keep a running counter for UI/debug
state._opCostAcc = (state._opCostAcc || 0) + cost;
}


// spawn runs for any departures crossed since last tick
for (const line of state.lines.values()){
if (!line || !Array.isArray(line.departures)) continue;
for (const dep of line.departures){
  if (crossedMinute(state.service.prevTMin, cur, dep)){
    service_spawnRun(line, dep);
  }
}
}

// move + retire runs
service_updateRuns(cur);
ui_renderLineDiagram();

// Only update the tiny clock label every frame (cheap)
uiClock_updateInline();

// (Optional) If you want the “Active trains” number to refresh sometimes,
// do a throttled UI refresh (once per second max)
state._uiLastFullUpdateTs ||= 0;
if ((ts - state._uiLastFullUpdateTs) > 1000) {
state._uiLastFullUpdateTs = ts;
}
ui_updateActiveTrainsCount();

state.service.prevTMin = cur;
}

state.clock.rafId = requestAnimationFrame(clock_tick);
}

function clock_start(){
  state.clock ||= { tMin: 8*60, running: true, speed: 60, lastTs: null, rafId: 0 };
  let modesCleared = false;
  if (state.trackBuildMode || state.lineBuildMode) {
    state.trackBuildMode = false;
    state.lineBuildMode = false;
    state.pendingTrackNode = null;
    modesCleared = true;
  }
  state.clock.running = true;
  if (!state.clock.rafId) {
    state.clock.lastTs = null;
    state.clock.rafId = requestAnimationFrame(clock_tick);
  }
  uiClock_updateInline();
  if (modesCleared) {
    if (typeof updateUI === "function") updateUI();
    if (typeof showToast === "function") showToast("Exited build modes to resume time", "info");
  }
}

function clock_stop(){
  state.clock ||= { tMin: 8*60, running: true, speed: 60, lastTs: null, rafId: 0 };
state.clock.running = false;
uiClock_updateInline();
}
