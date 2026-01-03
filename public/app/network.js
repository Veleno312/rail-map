// ======================
// Tracks (black line + white lane number label)
// ======================
function calculateTrackCost(a, b, lanes=1){
  const km = (map.distance([a.lat,a.lon],[b.lat,b.lon]) / 1000) || 0;
  const constructionCost = km * CONFIG.TRACK_COST_PER_KM * lanes;
  const maintenanceCost = km * CONFIG.TRACK_MAINTENANCE_PER_KM * lanes;
  return { distanceKm: km, terrainDifficulty: 1.0, constructionCost, maintenanceCost, lanes };
}

function addTrack(fromId, toId, lanes=1, {silent=false} = {}){
  const a = state.nodes.get(fromId);
  const b = state.nodes.get(toId);
  if (!a || !b) return null;

  const key = edgeKey(fromId, toId);
  const trackId = `TK-${key}`;

  const prevTrack = state.tracks.has(trackId)
    ? { from: fromId, to: toId, lanes: Number(state.tracks.get(trackId)?.lanes || 1) }
    : null;

  // remove existing visual if overwriting
  if (state.tracks.has(trackId)) {
    const old = state.tracks.get(trackId);
if (old?._label) layers.trackLabels.removeLayer(old._label);
    state.tracks.delete(trackId);
  }

  const cost = calculateTrackCost(a, b, lanes);

  // allow budget to go negative (gameplay choice) but warn
  state.budget -= cost.constructionCost;

  const line = L.polyline([[a.lat,a.lon],[b.lat,b.lon]], {
color: "#000",              // black tracks
weight: 2 + lanes * 1.5,    // thickness reflects lanes a bit
opacity: 0.95,
lineCap: "round"
}).addTo(layers.tracks);

  // Lane label at the midpoint
const midLat = (a.lat + b.lat) / 2;
const midLon = (a.lon + b.lon) / 2;

const label = L.marker([midLat, midLon], {
icon: L.divIcon({
  className: "",
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  html: `<div class="track-lane-label">${lanes}</div>`
}),
interactive: false,
keyboard: false
}).addTo(layers.trackLabels);



  line.on("click", () => {
    if (confirm("Delete this track segment?")) {
      layers.tracks.removeLayer(line);
      layers.trackLabels.removeLayer(label);
      state.tracks.delete(trackId);
      updateUI();
      renderLines();
      showToast("Track deleted", "warning");
    }
  });

state.tracks.set(trackId, {
id: trackId,
from: fromId,
to: toId,
lanes,
cost,
built: true,
_layer: line,
_label: label
});

  if (!silent) {
    undo_pushAction({
      type: "track_add",
      trackId,
      refund: cost.constructionCost || 0,
      prev: prevTrack
    });
  }
  if (!silent) {
    showToast(`Built track: ${a.name} → ${b.name}`, "success");
    updateUI();
    renderLines();
  }
  return trackId;
}

// Track build mode now CHAINS:
// click A, click B => builds A→B, keeps B as next start.
function handleTrackBuildClick(node){
  if (!state.pendingTrackNode) {
    state.pendingTrackNode = node;
    showToast(`Track: start = ${node.name}`, "info");
    updateUI();
    return;
  }

  const a = state.pendingTrackNode;
  const b = node;

  if (a.id === b.id) {
    showToast("Pick a different node", "warning");
    updateUI();
    return;
  }

  addTrack(a.id, b.id, state.pendingTrackLanes || 1);
  state.pendingTrackNode = b;
  showToast(`Track: next start = ${b.name}`, "info");
  updateUI();

}

// ======================
// Lines (smart ordering + auto-track creation)
// ======================

// ======================
// Line defaults (carriages + speed classes)
// ======================
const TRAIN_SPEED_CLASSES = {
small: 60,
medium: 90,
fast: 120,
high: 200,
bullet: 300,
};

// Average capacity per carriage (editable later)
const CARRIAGE_CAPACITY = {
passenger_pax: 80,
cargo_units: 250,
mixed_pax: 40,   // half-and-half: passenger carriage capacity
mixed_cargo: 125 // half-and-half: cargo carriage capacity
};

function lineDefaults(type){
const dwellSecByType = {
  passenger: 45,
  cargo: 90,
  mixed: 60,
};
if (type === "cargo")   return { frequencyPerDay: 0, carriages: 12, speedClass: "medium", dwellSec: dwellSecByType[type] ?? 60, color: "#ef4444", serviceStartMin: 330, // 05:30
serviceEndMin: 1410,  // 23:30
nightService: false,
nightHeadwayMin: 60,
};
if (type === "mixed")   return { frequencyPerDay: 0, carriages: 8,  speedClass: "fast", dwellSec: dwellSecByType[type] ?? 60,   color: "#6b7280", serviceStartMin: 330, // 05:30
serviceEndMin: 1410,  // 23:30
nightService: false,
nightHeadwayMin: 60,
};
return { frequencyPerDay: 0, carriages: 6, speedClass: "fast", dwellSec: dwellSecByType[type] ?? 60, color: "#2b6cff", serviceStartMin: 330, // 05:30
serviceEndMin: 1410,  // 23:30
nightService: false,
nightHeadwayMin: 60,
};
}

function addLine(name, type="passenger", circular=false, overrides=null){
const id = `LN-${Date.now()}`;
const d = lineDefaults(type);

const ln = {
  id,
  name,
  type,
  color: d.color,
  stops: [],
  circular: !!circular,

  // Trips/day is no longer used (timetable drives service). Keep for compatibility.
  frequencyPerDay: 0,

  // Player chooses carriages; capacity is derived.
  carriages: d.carriages,
  speedClass: d.speedClass,
  speedKmh: TRAIN_SPEED_CLASSES[d.speedClass] || 120,

  // Derived (filled by line_recalcDerived)
  vehicleCapacity: 0,
  capacityPax: 0,
  capacityCargo: 0,

  // Timetable + service
  trains: 0,
  departures: [], // minutes since midnight (sorted)
};

// Apply safe overrides
if (overrides && typeof overrides === "object") {
  if (Number.isFinite(overrides.carriages)) ln.carriages = clamp(Math.round(overrides.carriages), 1, 50);
  if (typeof overrides.speedClass === "string" && TRAIN_SPEED_CLASSES[overrides.speedClass]) ln.speedClass = overrides.speedClass;
  // Allow custom speedKmh only if explicitly provided (advanced)
  if (Number.isFinite(overrides.speedKmh)) ln.speedKmh = Math.max(10, overrides.speedKmh);
}

line_recalcDerived(ln);

state.lines.set(id, ln);
state.activeLine = id;

renderLines();
updateUI();
showToast(`Created line: ${name}`, "success");
return id;
}

function line_recalcDerived(line){
if (!line) return;
// speed
const cls = line.speedClass;
if (TRAIN_SPEED_CLASSES[cls]) line.speedKmh = TRAIN_SPEED_CLASSES[cls];

const cars = clamp(Math.round(Number(line.carriages || 0)), 1, 50);
line.carriages = cars;

// capacity
let pax=0, cargo=0;
if (line.type === "cargo"){
  cargo = cars * CARRIAGE_CAPACITY.cargo_units;
} else if (line.type === "mixed"){
  const paxCars = Math.ceil(cars/2);
  const cargoCars = Math.floor(cars/2);
  pax = paxCars * CARRIAGE_CAPACITY.mixed_pax;
  cargo = cargoCars * CARRIAGE_CAPACITY.mixed_cargo;
} else {
  pax = cars * CARRIAGE_CAPACITY.passenger_pax;
}
line.capacityPax = pax;
line.capacityCargo = cargo;

// legacy single-number capacity for existing economy code
line.vehicleCapacity = (line.type === "cargo") ? cargo : pax;
}

function line_trainMaintenanceCostEURPerYear(line){
if (!line) return 0;
const trains = Math.max(0, Math.round(Number(line.trains || 0)));
const cars = Math.max(1, Math.round(Number(line.carriages || 1)));
const base = Number(CONFIG.TRAIN_MAINT_PER_CARRIAGE_PER_YEAR || 0);

const cls = String(line.speedClass || "medium");
const mult =
  cls === "small" ? Number(CONFIG.TRAIN_MAINT_MULT_SMALL) :
  cls === "medium" ? Number(CONFIG.TRAIN_MAINT_MULT_MEDIUM) :
  cls === "fast" ? Number(CONFIG.TRAIN_MAINT_MULT_FAST) :
  cls === "high" ? Number(CONFIG.TRAIN_MAINT_MULT_HIGH) :
  cls === "bullet" ? Number(CONFIG.TRAIN_MAINT_MULT_BULLET) :
  1.0;

return trains * cars * base * mult;
}



function pathLength(ids){
  let sum = 0;
  for (let i=0;i<ids.length-1;i++){
    const A = state.nodes.get(ids[i]);
    const B = state.nodes.get(ids[i+1]);
    if (!A || !B) continue;
    sum += map.distance([A.lat,A.lon],[B.lat,B.lon]);
  }
  return sum;
}

// 2-opt improvement to reduce criss-cross and shorten

// ======================
// Smart line geometry helpers (NO criss-cross, minimize detours)
// ======================

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

// Pressure model (v1):
// - Demand is based on population (cities) or sumPop (clusters).
// - Supply is based on sum of (frequencyPerDay * vehicleCapacity) for lines that stop there.
// - Platforms cap how much frequency can be “handled” at the station.
// - Amenities increase effective handling a bit (comfort/circulation).
function computeStationPressure(){
const DEMAND_PER_PERSON_PER_DAY = 0.04;   // tune later
const MAX_TRAINS_PER_PLATFORM_PER_DAY = 10; // tune later

// nodeId -> { demand, supply }
const agg = new Map();

// 1) Demand per node from population
for (const n of state.nodes.values()){
  if (!n) continue;
  const id = String(n.id);
  const pop = Math.max(0, Number(n.population ?? n.sumPop ?? 0));
  if (pop <= 0) continue;

  const demand = pop * DEMAND_PER_PERSON_PER_DAY;
  agg.set(id, { demand, supply: 0 });
}

// 2) Supply per node from lines that stop there
for (const line of state.lines.values()){
  if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;

  const freq = Math.max(0, Number(line.frequencyPerDay || 0));
  const cap  = Math.max(0, Number(line.vehicleCapacity || 0));
  if (freq <= 0 || cap <= 0) continue;

  for (const rawId of line.stops){
    const id = String(rawId);

    // Ensure node exists in agg even if demand was 0
    if (!agg.has(id)) agg.set(id, { demand: 0, supply: 0 });

    const st = (typeof getStation === "function") ? getStation(id) : null;
    const platforms = Math.max(1, Number(st?.platforms || 1));
    const amenities = Math.max(0, Number(st?.amenities || 0));

    // Platforms cap usable frequency at the station (handled trains/day)
    const stationFreqCap = platforms * MAX_TRAINS_PER_PLATFORM_PER_DAY;
    const effectiveFreq = Math.min(freq, stationFreqCap);

    // Amenities increase effective handling slightly (comfort/circulation)
    const comfortMult = 1 + Math.min(0.6, amenities * 0.08);

    agg.get(id).supply += effectiveFreq * cap * comfortMult;
  }
}

// 3) Convert to pressure%
state.stationPressure.clear();

let worst = { id: null, pressurePct: 0 };
for (const [id, v] of agg.entries()){
  const demand = Math.max(0, Number(v.demand || 0));
  const supply = Math.max(0, Number(v.supply || 0));

  // If no demand, no pressure (but still store)
  let pressurePct = 0;
  if (demand > 0) {
    const shortfall = clamp01((demand - supply) / demand); // 0..1
    pressurePct = Math.round(shortfall * 100);
  }

  state.stationPressure.set(id, { demand, supply, pressurePct });

  if (pressurePct > worst.pressurePct) worst = { id, pressurePct };
}

return worst; // can be used for a toast/debug later
}

function segLen(aId, bId){
const A = state.nodes.get(aId), B = state.nodes.get(bId);
if (!A || !B) return 0;
return map.distance([A.lat, A.lon], [B.lat, B.lon]);
}

// Proper segment intersection test (in screen space for stability)
function segmentsIntersect(aId,bId,cId,dId){
const A = state.nodes.get(aId), B = state.nodes.get(bId);
const C = state.nodes.get(cId), D = state.nodes.get(dId);
if (!A||!B||!C||!D) return false;

const a = map.latLngToLayerPoint([A.lat,A.lon]);
const b = map.latLngToLayerPoint([B.lat,B.lon]);
const c = map.latLngToLayerPoint([C.lat,C.lon]);
const d = map.latLngToLayerPoint([D.lat,D.lon]);

function ccw(p1,p2,p3){
  return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
}

// share endpoints => ignore
const shared =
  (aId===cId)||(aId===dId)||(bId===cId)||(bId===dId);
if (shared) return false;

return (ccw(a,c,d) !== ccw(b,c,d)) && (ccw(a,b,c) !== ccw(a,b,d));
}

function countCrossings(stops){
let x = 0;
for (let i=0;i<stops.length-1;i++){
  for (let j=i+2;j<stops.length-1;j++){
    // skip adjacent and skip first-last adjacency
    if (i===0 && j===stops.length-2) continue;
    if (segmentsIntersect(stops[i],stops[i+1],stops[j],stops[j+1])) x++;
  }
}
return x;
}

// Score = total length + huge penalty for crossings
function lineScore(stops){
let len = 0;
for (let i=0;i<stops.length-1;i++) len += segLen(stops[i], stops[i+1]);
const crossings = countCrossings(stops);
return len + crossings * 1e12; // crossings are basically forbidden
}

// 2-opt improvement to remove crossings + shorten route
function improveLineOrder(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 4) return;

let improved = true;
let guard = 0;

while (improved && guard < 80){
  improved = false;
  guard++;

  for (let i=0;i<line.stops.length-3;i++){
    for (let k=i+2;k<line.stops.length-1;k++){
      // don't break adjacency
      if (i===0 && k===line.stops.length-2) continue;

      const A = line.stops[i],     B = line.stops[i+1];
      const C = line.stops[k],     D = line.stops[k+1];

      const before = segLen(A,B) + segLen(C,D);
      const after  = segLen(A,C) + segLen(B,D);

      // If swapping reduces length OR fixes an intersection, do it
      const hadX = segmentsIntersect(A,B,C,D);
      if (after + 1e-6 < before || hadX) {
        // reverse the segment between B..C
        const middle = line.stops.slice(i+1, k+1).reverse();
        line.stops.splice(i+1, k - i, ...middle);
        improved = true;
      }
    }
  }
}
}

// ======================
// FIXED: Smart add stop (prepend/append/insert + 2-opt cleanup)
// ======================
function addStopSmart(line, nodeId){
if (!line || !Array.isArray(line.stops)) return;
if (line.stops.includes(nodeId)) return;

// 0-1 stops: just append
if (line.stops.length < 2) {
  line.stops.push(nodeId);
  return;
}

let best = null;
let bestScore = Infinity;

// Candidate A: prepend
{
  const cand = [nodeId, ...line.stops];
  const s = lineScore(cand);
  if (s < bestScore) { bestScore = s; best = cand; }
}

// Candidate B: append
{
  const cand = [...line.stops, nodeId];
  const s = lineScore(cand);
  if (s < bestScore) { bestScore = s; best = cand; }
}

// Candidate C: insert between every pair
for (let i = 0; i < line.stops.length - 1; i++) {
  const cand = line.stops.slice();
  cand.splice(i + 1, 0, nodeId);

  const s = lineScore(cand);
  if (s < bestScore) { bestScore = s; best = cand; }
}

line.stops = best || [...line.stops, nodeId];
improveLineOrder(line);
}

function autoLanesForLineType(type){
  if (type === "cargo") return CONFIG.AUTO_TRACK_LANES_CARGO;
  if (type === "mixed") return CONFIG.AUTO_TRACK_LANES_MIXED;
  return CONFIG.AUTO_TRACK_LANES_PASSENGER;
}

// ======================
// Line rendering along built tracks (shortest path)
// ======================

function renderGraph_buildTrackAdj(){
const adj = new Map();
if (!map || !state.tracks || !state.nodes) return adj;

for (const t of state.tracks.values()){
  const aId = t.from, bId = t.to;
  const a = state.nodes.get(aId);
  const b = state.nodes.get(bId);
  if (!a || !b) continue;

  const w = map.distance([Number(a.lat), Number(a.lon)], [Number(b.lat), Number(b.lon)]);
  if (!Number.isFinite(w) || w <= 0) continue;

  if (!adj.has(aId)) adj.set(aId, []);
  if (!adj.has(bId)) adj.set(bId, []);
  adj.get(aId).push({ to: bId, w });
  adj.get(bId).push({ to: aId, w });
}
return adj;
}

function renderGraph_shortestPath(adj, startId, goalId){
if (!startId || !goalId) return null;
if (startId === goalId) return [startId];
if (!adj || !adj.size) return null;

const dist = new Map();
const prev = new Map();
const visited = new Set();

dist.set(startId, 0);
const pq = [{ id: startId, d: 0 }]; // tiny graphs: simple array PQ is fine

while (pq.length) {
  pq.sort((a,b) => a.d - b.d);
  const cur = pq.shift();
  if (!cur) break;

  const u = cur.id;
  if (visited.has(u)) continue;
  visited.add(u);

  if (u === goalId) break;

  const nbrs = adj.get(u);
  if (!nbrs) continue;

  for (const e of nbrs) {
    const nd = cur.d + e.w;
    const best = dist.has(e.to) ? dist.get(e.to) : Infinity;
    if (nd < best) {
      dist.set(e.to, nd);
      prev.set(e.to, u);
      pq.push({ id: e.to, d: nd });
    }
  }
}

if (!dist.has(goalId)) return null;

// Reconstruct
const path = [];
let cur = goalId;
while (cur != null) {
  path.push(cur);
  if (cur === startId) break;
  cur = prev.get(cur);
}
path.reverse();
return path[0] === startId ? path : null;
}

function ensureLineTracks(line, adj){
// Only auto-build a direct segment if there is NO existing route on tracks.
if (!line || !Array.isArray(line.stops) || line.stops.length < 2) return;

const lanes = autoLanesForLineType(line.type);

const pairs = [];
for (let i=0;i<line.stops.length-1;i++) pairs.push([line.stops[i], line.stops[i+1]]);
if (line.circular && line.stops.length >= 3) pairs.push([line.stops[line.stops.length-1], line.stops[0]]);

for (const [a,b] of pairs){
  // If there's already a route along tracks, DON'T create a shortcut.
  const route = renderGraph_shortestPath(adj, a, b);
  if (route && route.length >= 2) continue;

  // No route: fall back to creating a direct track segment (keeps old behavior)
  const key = edgeKey(a,b);
  const id = `TK-${key}`;
  if (!state.tracks.has(id)) addTrack(a, b, lanes, { silent:true });
}
}

function renderLines(){
layers.lines.clearLayers();

// Build adjacency from currently-built tracks
const adj = renderGraph_buildTrackAdj();

for (const line of state.lines.values()){
  if (!Array.isArray(line.stops) || line.stops.length < 2) continue;

  // Ensure connectivity but don't create shortcuts if a route already exists
  ensureLineTracks(line, adj);

  // Build polyline points by routing along tracks between consecutive stops
  const latlngs = [];

  const pushPath = (pathIds) => {
    if (!Array.isArray(pathIds) || pathIds.length < 2) return false;
    const pts = [];
    for (const id of pathIds){
      const n = state.nodes.get(id);
      if (n) pts.push([Number(n.lat), Number(n.lon)]);
    }
    if (pts.length < 2) return false;

    // concat, avoiding duplicate point at joins
    if (!latlngs.length) latlngs.push(...pts);
    else latlngs.push(...pts.slice(1));
    return true;
  };

  for (let i=1; i<line.stops.length; i++){
    const a = line.stops[i-1];
    const b = line.stops[i];
    const path = renderGraph_shortestPath(adj, a, b);

    if (!pushPath(path)) {
      // fallback: direct segment if something is missing
      const A = state.nodes.get(a), B = state.nodes.get(b);
      if (A && B) {
        if (!latlngs.length) latlngs.push([A.lat, A.lon]);
        latlngs.push([B.lat, B.lon]);
      }
    }
  }

  if (line.circular && line.stops.length >= 3) {
    const a = line.stops[line.stops.length - 1];
    const b = line.stops[0];
    const path = renderGraph_shortestPath(adj, a, b);
    if (!pushPath(path)) {
      const A = state.nodes.get(a), B = state.nodes.get(b);
      if (A && B) latlngs.push([B.lat, B.lon]);
    }
  }
trainVis_rebuildFromLines();


  if (latlngs.length < 2) continue;

  L.polyline(latlngs, {
    color: line.color,
    weight: line.id === state.activeLine ? 5 : 3.5,
    opacity: line.id === state.activeLine ? 0.90 : 0.62,
    dashArray: line.type === "cargo" ? "10,10" : null
  }).addTo(layers.lines)
    .bindTooltip(`${line.name} (${line.type}) • cap ${line.vehicleCapacity}${line.type==="cargo"?"t":" pax"}${line.circular ? " ⟳" : ""}`);
}
}

// ======================
// Train dots (visual only): move along LINES, inherit line color
// ======================
const trainVis = {
trains: [],
rafId: 0,
lastTs: 0,
timeScale: 120,  // speeds up movement so you can see it
dotRadius: 7,    // bigger dots
};

function trainVis_stop(){
if (trainVis.rafId) cancelAnimationFrame(trainVis.rafId);
trainVis.rafId = 0;
trainVis.lastTs = 0;
}

function trainVis_clear(){
try { layers.trains.clearLayers(); } catch(_) {}
trainVis.trains.length = 0;
}

function trainVis_latLngAt(t, km){
const cum = t.cumKm;
const pts = t.pts;
if (!cum || !pts || pts.length < 2) return null;

// clamp
if (km <= 0) return pts[0];
if (km >= t.lenKm) return pts[pts.length - 1];

// find segment (linear scan; routes are short)
let i = 0;
while (i < cum.length - 1 && cum[i + 1] < km) i++;

const a = pts[i];
const b = pts[i + 1];
const segLen = (cum[i + 1] - cum[i]) || 1e-9;
const f = (km - cum[i]) / segLen;

return L.latLng(
  a.lat + (b.lat - a.lat) * f,
  a.lng + (b.lng - a.lng) * f
);
}

function trainVis_tick(ts){
// dt for train motion smoothing (visual)
const dt = Math.min(0.08, Math.max(0.0, (ts - (trainVis.lastTs || ts)) / 1000));
trainVis.lastTs = ts;

// (Clock + scheduled runs are driven by clock_tick now.)

// move train dots
for (const t of trainVis.trains) {
  const speedKmh = Math.max(10, Number(t.speedKmh || 120));
  const kmPerSec = (speedKmh / 3600) * trainVis.timeScale;

  t.posKm += kmPerSec * dt * t.dir;

  if (t.circular) {
    const Lk = t.lenKm || 1;
    t.posKm = ((t.posKm % Lk) + Lk) % Lk;
  } else {
    if (t.posKm > t.lenKm) {
      t.posKm = t.lenKm - (t.posKm - t.lenKm);
      t.dir = -1;
    }
    if (t.posKm < 0) {
      t.posKm = -t.posKm;
      t.dir = 1;
    }
  }

  const ll = trainVis_latLngAt(t, t.posKm);
  if (ll) t.marker.setLatLng(ll);
}

// refresh the inline clock label (upper-right)
uiClock_updateInline();

// schedule next frame
trainVis.rafId = requestAnimationFrame(trainVis_tick);
}

function trainVis_start(){
return;
}

function trainVis_clearAll(){
if (!trainVis?.trains) return;
for (const t of trainVis.trains){
  try { t.marker?.remove(); } catch(e){}
}
trainVis.trains = [];
if (trainVis.rafId) cancelAnimationFrame(trainVis.rafId);
trainVis.rafId = 0;
}


function trainVis_rebuildFromLines(){
return;
}

// ======================
// Node selection logic
// ======================
function selectNode(nodeId){
  const node = state.nodes.get(nodeId);
  if (!node) return;

  state.selectedNode = node;
  state.selectedNodeId = node.id;

// Refresh cluster active styling if relevant
  if (map.getZoom() <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) renderClusterMarkers();

  // Line build mode
if (state.activeLine && state.lines.has(state.activeLine) && state.lineBuildMode) {
const line = state.lines.get(state.activeLine);
const beforeStops = Array.isArray(line.stops) ? line.stops.slice() : [];

addStopSmart(line, nodeId);

// Only push undo if something actually changed
if (Array.isArray(line.stops) && line.stops.length !== beforeStops.length) {
  undo_pushAction({
    type: "line_stops",
    lineId: line.id,
    beforeStops
  });
}

showToast(`Added stop: ${node.name}`, "success");
renderLines();
updateUI();
return;
}

// Track build mode
  if (state.activeTab === "tracks" && state.trackBuildMode) {
    handleTrackBuildClick(node);
    return;
  }

  map.setView([node.lat, node.lon], Math.max(map.getZoom(), 8));
}
