// ======================
// Simulation
// ======================
function simulateYear(){
  try {
    state.year++;
    state.budget += state.annualBudget;

    // Economy: uses tracks + lines properties (freq/cap/speed)
    if (typeof window.computeEconomy === "function") {
window.computeEconomy(state, map);
} else {
console.warn("computeEconomy not loaded");
}

// Station retail rent (added on top of economy.js results)
const rent = computeRetailRentEURPerYear();
state.revenue = (Number(state.revenue || 0) + rent);

  const out = window.simCoreStep(state, {
    seed: state.seed ?? 1,
    scenarioId: state.scenarioId ?? "main",
    tickLabel: `Y${(state.year ?? 0) + 1}`,
  });

  state = out.state;

  // optionally show validation warnings somewhere (console for now)
  if (out.issues.length) console.warn("Sim validation issues:", out.issues);

// Rolling stock maintenance (fleet) — scaled by speed class so fast trains cost more
let fleetMaint = 0;
for (const l of state.lines.values()){
if (!l) continue;
// keep derived fields up to date
try { line_recalcDerived(l); } catch(_) {}
try { if (typeof ui_lineRecalcTrainsFromDepartures === "function") ui_lineRecalcTrainsFromDepartures(l); } catch(_) {}
fleetMaint += line_trainMaintenanceCostEURPerYear(l);
}
state.costs = Number(state.costs || 0) + fleetMaint;
state.fleetMaintenance = fleetMaint;
state.profit = (Number(state.revenue || 0) - Number(state.costs || 0));


let flows = null;
try {
flows = (typeof window.computeFlows === "function") ? window.computeFlows(state, map) : null;
} catch (err) {
console.warn("Dynamics computeFlows failed:", err);
flows = null;
}

// Only overwrite last flows if the new result looks usable
const newList = Array.isArray(flows?.flows) ? flows.flows : null;
if (newList && newList.length > 0) {
state._lastFlows = flows;
} else {
// Keep previous flows so overlay doesn't disappear
if (!state._lastFlows) state._lastFlows = flows; // first run
}

// Only update summary/economy if we have a flows object
if (flows) {
state.flowSummary = {
  ...(state.flowSummary || {}),
  goodsDelivered: Number(flows.goodsDelivered || 0),
  goodsUnmet: Number(flows.goodsUnmet || 0),
  passengerUnmet: Number(flows.passengerUnmet || 0),
  demandMetPct: Number(flows.demandMetPct || 0),

  deliveredGoodsEUR: Number(flows.deliveredGoodsEUR || 0),
  deliveredPassengersEUR: Number(flows.deliveredPassengersEUR || 0),
  lostDemandEUR: Number(flows.lostDemandEUR || 0),
  congestionPenaltyEUR: Number(flows.congestionPenaltyEUR || 0),
};

const addRev =
  Number(flows.deliveredGoodsEUR || 0) + Number(flows.deliveredPassengersEUR || 0);
const addCost = Number(flows.congestionPenaltyEUR || 0);

state.revenue = Number(state.revenue || 0) + addRev;
state.costs = Number(state.costs || 0) + addCost;
state.profit = state.revenue - state.costs;
}

// Always attempt to render overlay (uses state._lastFlows)
dynFlow_render();





    showToast(
      `Year ${state.year} simulated. Profit: ${formatCurrency(state.profit)} • Rent: ${formatCurrency(rent)}`,
      state.profit >= 0 ? "success" : "error"
    );
    computeStationPressure();
    updateUI();
  } catch (e) {
    console.error(e);
    showToast("Simulation crashed", "error");
    // If user can't open DevTools, show error text in panel footer:
    const panel = document.getElementById("controlPanel");
    panel.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-top:10px;border-color:#fecaca;color:#991b1b;">${String(e)}</div>`);
  }
}

// ======================
// Dynamics overlay: moving trains (Leaflet markers animated)
// ======================

state._dynFlow = {
rafId: null,
particles: [], // { marker, latlngs, cum, total, t0, speed, type }
};

function dynFlow_clear(){
try { layers.flowOverlay.clearLayers(); } catch(_) {}
state._dynFlow.particles = [];
if (state._dynFlow.rafId) cancelAnimationFrame(state._dynFlow.rafId);
state._dynFlow.rafId = null;
}

function dynFlow_buildCumDistances(latlngs){
const cum = [0];
let total = 0;
for (let i=1;i<latlngs.length;i++){
  const a = latlngs[i-1], b = latlngs[i];
  const d = map.distance(a, b) || 0;
  total += d;
  cum.push(total);
}
return { cum, total };
}

function dynFlow_pointAt(latlngs, cum, total, dist){
if (!latlngs || latlngs.length < 2 || total <= 0) return latlngs?.[0] || [0,0];

// wrap
let x = dist % total;
if (x < 0) x += total;

// find segment
let i = 1;
while (i < cum.length && cum[i] < x) i++;
if (i >= cum.length) return latlngs[latlngs.length - 1];

const d0 = cum[i-1], d1 = cum[i];
const t = (d1 - d0) > 0 ? ((x - d0) / (d1 - d0)) : 0;

const A = latlngs[i-1], B = latlngs[i];
const lat = A[0] + (B[0] - A[0]) * t;
const lon = A[1] + (B[1] - A[1]) * t;
return [lat, lon];
}

function dynFlow_render(){
const dyn = state.dynamics || {};
if (!dyn.enabled || !dyn.showOverlay) {
  dynFlow_clear();
  return;
}

dynFlow_clear();

const mode = dyn.mode || "both";
const MAX_PARTICLES = 180;
let created = 0;

for (const line of state.lines.values()){
  if (created >= MAX_PARTICLES) break;
  if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;

  // Mode filter by line type
  const isGoods = (line.type === "cargo");
  const isPax = (line.type === "passenger");
  const isMixed = (line.type === "mixed");

  const showThis =
    (mode === "both") ||
    (mode === "goods" && (isGoods || isMixed)) ||
    (mode === "passengers" && (isPax || isMixed));

  if (!showThis) continue;

  // Build latlngs from stops (this guarantees trains never run on tracks without a line)
  const latlngs = [];
  for (const id of line.stops){
    const n = state.nodes.get(id);
    if (n) latlngs.push([n.lat, n.lon]);
  }
  if (latlngs.length < 2) continue;

  // Circular lines loop; non-circular go out-and-back (handled in tick)
  if (line.circular && latlngs.length >= 3) latlngs.push(latlngs[0]);

  const { cum, total } = dynFlow_buildCumDistances(latlngs);
  if (total <= 0) continue;

  // Speed from line speedKmh
  const speedKmh = Math.max(20, Number(line.speedKmh || 120));
  const speed = (speedKmh * 1000) / 3600; // m/s

  // Frequency -> headway
  const freq = Math.max(0, Number(line.frequencyPerDay || 0));
  if (freq <= 0) continue;

  // Visual number of trains shown for this line (1..10)
  const trainCount = Math.max(1, Math.min(10, Math.round(freq)));

  const headwaySec = 86400 / freq; // timetable spacing (seconds/day)

  // Bigger dots
  const radius = (line.id === state.activeLine) ? 6.2 : 5.4;

  // Line color
  const color = line.color || "#2b6cff";

  // Create trains with staggered departures (timetable)
  const now = performance.now();
  for (let k=0; k<trainCount && created<MAX_PARTICLES; k++){
    const departOffsetSec = k * headwaySec; // seconds after "midnight"
    const marker = L.circleMarker(latlngs[0], {
      radius,
      color,
      weight: 0,
      fillColor: color,
      fillOpacity: 0.92,
      interactive: false
    }).addTo(layers.flowOverlay);

    state._dynFlow.particles.push({
      marker,
      latlngs,
      cum,
      total,
      speed,                 // m/s
      departOffsetSec,       // timetable offset
      isCircular: !!line.circular,
      lineId: line.id
    });

    created++;
  }
}

dynFlow_tick(); // start animation loop
}

// REPLACE your existing dynFlow_tick() function with this version
function dynFlow_tick(){
const dyn = state.dynamics || {};
if (!dyn.enabled || !dyn.showOverlay) {
  dynFlow_clear();
  return;
}

// One-time init: try to compute station pressure so dwell has data
if (!state._dynFlow._didPressureInit) {
  state._dynFlow._didPressureInit = true;
  try { computeStationPressure(); } catch(_) {}
}

const nowMs = performance.now();
const clockSec = (nowMs / 1000) % 86400; // "time of day" loop

const EPS_STOP_M = 70; // how close (meters) counts as "at station"
const parts = state._dynFlow.particles || [];

for (const p of parts){
  if (!p || !p.marker || !p.latlngs || p.latlngs.length < 2 || !p.cum || p.total <= 0) continue;

  const line = state.lines.get(p.lineId);
  if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;

  const freq = Math.max(0, Number(line.frequencyPerDay || 0));
  if (freq <= 0) continue;

  // Not departed yet today -> wait at first station
  if (clockSec < Number(p.departOffsetSec || 0)) {
    p.marker.setLatLng(p.latlngs[0]);
    continue;
  }

  // If dwelling at a stop, stay there
  if (p._dwellUntilMs && nowMs < p._dwellUntilMs && p._dwellLatLng) {
    p.marker.setLatLng(p._dwellLatLng);
    continue;
  }

  const speed = Math.max(5, Number(p.speed || 20)); // m/s
  const travelSec = clockSec - Number(p.departOffsetSec || 0);
  const travelM = speed * Math.max(0, travelSec);

  let dist = 0;         // 0..total (folded if out-and-back)
  let dir = "fwd";      // fwd | bwd | loop
  let cycle = 0;

  if (p.isCircular) {
    cycle = Math.floor(travelM / p.total);
    dist = travelM % p.total;
    dir = "loop";
  } else {
    const period = 2 * p.total;
    cycle = Math.floor(travelM / period);
    const raw = travelM % period;
    if (raw <= p.total) {
      dist = raw;
      dir = "fwd";
    } else {
      dist = period - raw;
      dir = "bwd";
    }
  }

  // Move train
  const pos = dynFlow_pointAt(p.latlngs, p.cum, p.total, dist);
  p.marker.setLatLng(pos);

  // Detect "arrival" at a stop (near a vertex / stop)
  let stopIdx = -1;
  for (let i = 0; i < p.cum.length; i++){
    if (Math.abs(dist - p.cum[i]) <= EPS_STOP_M) { stopIdx = i; break; }
  }
  if (stopIdx < 0) continue;

  // Map stopIdx -> nodeId
  // If circular and we duplicated the first point at the end, map last index to stop 0.
  let nodeId = null;
  if (p.isCircular && stopIdx === (p.cum.length - 1)) {
    nodeId = line.stops[0];
  } else {
    nodeId = line.stops[stopIdx] || null;
  }

  // Prevent re-triggering dwell every frame at the same stop
  const key = `${cycle}:${dir}:${stopIdx}:${nodeId || "?"}`;
  if (p._lastArriveKey === key) continue;
  p._lastArriveKey = key;

  // Pressure -> longer dwell
  let pressurePct = 0;
  try {
    const info = state.stationPressure?.get?.(nodeId);
    pressurePct = Number(info?.pressurePct || 0);
  } catch(_) {}
  const pressure01 = clamp(pressurePct / 100, 0, 1);

  const isCargo = (line.type === "cargo");
  const base = isCargo ? 0.55 : 1.10;            // seconds
  const extra = isCargo ? (1.2 * pressure01) : (3.0 * pressure01);
  const endBonus = (stopIdx === 0 || stopIdx === p.cum.length - 1) ? 0.35 : 0;

  const dwellSec = base + extra + endBonus;

  p._dwellUntilMs = nowMs + dwellSec * 1000;
  p._dwellLatLng = p.latlngs[stopIdx]; // snap exactly to station point
}

state._dynFlow.rafId = requestAnimationFrame(dynFlow_tick);
}

// ======================
// Timetable (per-line departures + train count) — incremental realism step
// ======================
function ui_lineEnsure(line){
if (!line) return;
if (!Number.isFinite(Number(line.trains))) line.trains = 1;
if (!Array.isArray(line.departures)) line.departures = [];
}


function makeEvenDepartures(count, startMin=6*60, endMin=22*60){
count = Math.max(0, Math.round(Number(count || 0)));
if (count <= 0) return [];
if (count === 1) return [Math.round(startMin)];
const step = (endMin - startMin) / (count - 1);
const out = [];
for (let i=0;i<count;i++){
  out.push(Math.round(startMin + i*step));
}
// unique + sorted + clamp
const set = new Set(out.map(v => clamp(Math.round(v), 0, 1439)));
return Array.from(set).sort((a,b)=>a-b);
}

function hhmmToMin(hhmm){
if (!hhmm || typeof hhmm !== "string") return null;
const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
if (!m) return null;
const h = clamp(Number(m[1]), 0, 23);
const mm = clamp(Number(m[2]), 0, 59);
return h*60 + mm;
}


function ui_lineArrivalLabel(depMin, line){
const rt = ui_lineRuntimeMin(line);
const arr = (Number(depMin) + rt) % 1440;
return minToHHMM(arr);
}

function ui_lineSetTrains(delta){
showToast("Trains are auto from the timetable now. Add/remove departures.", "info");
}


function ui_lineAddDeparture(ev){
// Stop any form submit / page refresh behavior
ev?.preventDefault?.();
ev?.stopPropagation?.();

const line = state.lines.get(state.activeLine);
if (!line) return;
ui_lineEnsure(line);

// Find the time input near the clicked button (no fragile id reliance)
const panel = ev?.currentTarget?.closest?.(".timetablePanel") || document;
const inp = panel.querySelector('input[type="time"]');
const depMin = hhmmToMin(inp?.value);

if (depMin == null) { showToast("Pick a valid time (HH:MM)", "warning"); return; }

// unique + sorted
const set = new Set((line.departures || []).map(Number));
set.add(depMin);
line.departures = Array.from(set).sort((a,b)=>a-b);

// Keep economy compatible for now
line.frequencyPerDay = 0;

// If you have auto-trains-from-timetable enabled:
if (typeof ui_lineRecalcTrainsFromDepartures === "function"){
  ui_lineRecalcTrainsFromDepartures(line);
}

if (depMin < line.serviceStartMin || depMin > line.serviceEndMin){
showToast("Departure outside service hours", "warning");
}


updateUI();
}


function ui_lineRemoveDeparture(depMin){
const line = state.lines.get(state.activeLine);
if (!line) return;
ui_lineEnsure(line);

line.departures = (line.departures || []).filter(x => Number(x) !== Number(depMin));
line.frequencyPerDay = 0;
ui_lineRecalcTrainsFromDepartures(line);
updateUI();
}

function ui_updateActiveTrainsCount(){
const el = document.getElementById("activeTrainsCount");
if (!el) return;
const line = state.activeLine ? state.lines.get(state.activeLine) : null;
if (!line) return;

const scheduled = (state.service?.runs || []).filter(r => r.lineId === line.id).length;

// Dynamics overlay dots (if you have them enabled)
const overlay = (state._dynFlow?.particles || []).filter(p => p.lineId === line.id).length;

el.textContent = overlay > 0 ? `${scheduled} (sched) • ${overlay} (overlay)` : String(scheduled);
}

function ui_lineSchedulePanelHtml(){
const line = state.activeLine ? state.lines.get(state.activeLine) : null;
if (!line) return "";
 
ui_lineEnsure(line);
 ui_lineRecalcTrainsFromDepartures(line);

const active = service_activeTrainsOnLine(line.id);
const required = Number(line.trains || 0);

const deps = (line.departures || []).slice().sort((a,b)=>a-b);

const rt = ui_lineRuntimeMin(line);
const rtLabel = (rt > 0.2) ? `${Math.round(rt)} min` : "—";

return `
  <div style="height:10px"></div>
  <div style="padding:10px;border-radius:12px;background:#f8fafc;border:1px solid rgba(15,23,42,0.08);">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:6px;">Timetable (incremental)</div>

<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
<div style="font-weight:900;color:#334155;">Trains (running now)</div>
<div style="margin-left:auto;font-weight:1000;">
  Active: <span id="activeTrainsCount">${active}</span>
  &nbsp;•&nbsp; Total: ${required}
</div>
</div>


    <div style="color:#64748b;font-weight:850;font-size:12px;margin-bottom:8px;">
      Runtime (end-to-end): <b>${rtLabel}</b>. Departures below schedule trains (timetable-driven).
    </div>

    <div style="display:flex;gap:8px;align-items:center;">
      <input name="depTime" name="depTime" class="field" type="time" value="08:00" style="flex:1;">
      <button type="button" class="btn" onclick="ui_lineAddDeparture(event)">Add</button>
    </div>
<div style="height:10px"></div>
<div id="lineDiagram"></div>
    <div style="height:8px"></div>
    ${deps.length ? `
      <div class="list" style="max-height:200px;overflow:auto;">
        ${deps.map(d => `
          <div class="item" style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div style="font-weight:950;color:#0f172a;">
              ${minToHHMM(d)} → ${ui_lineArrivalLabel(d, line)}
            </div>
            <button class="btn danger" onclick="ui_lineRemoveDeparture(${Number(d)})">Remove</button>
          </div>
        `).join("")}
      </div>
    ` : `<div style="padding:10px;color:#64748b;font-weight:900;">No departures set yet.</div>`}
  </div>
`;
}

Object.assign(window, {
ui_lineAddDeparture,
ui_lineRemoveDeparture,
ui_lineSetTrains,
ui_lineDiagram_stopClick,
});




function toggleCircularActive(){
  const line = state.lines.get(state.activeLine);
  if (!line) return;
  line.circular = !line.circular;
  renderLines();
  updateUI();
  showToast(line.circular ? "Line set to circular" : "Line set to non-circular", "success");
}

function toggleLineBuildMode(){
  state.lineBuildMode = !state.lineBuildMode;
  updateUI();
  showToast(state.lineBuildMode ? "Line building ON" : "Line building OFF", "info");
}

function setActiveLineColor(hex){
const id = state.activeLine;
const line = id ? state.lines.get(id) : null;
if (!line) {
  showToast("Select a line first", "warning");
  return;
}

if (typeof hex !== "string" || !/^#([0-9a-fA-F]{6})$/.test(hex)) {
  showToast("Invalid color", "warning");
  return;
}

line.color = hex;

renderLines();
syncMarkerVisibility(); // refresh rings/markers if they use line colors
updateUI();
showToast("Line color updated", "success");
}

function setActiveLineCarriages(v){
const line = state.lines.get(state.activeLine);
if (!line) return;
line.carriages = clamp(Math.round(Number(v||1)), 1, 50);
line_recalcDerived(line);
try { if (typeof ui_lineRecalcTrainsFromDepartures === "function") ui_lineRecalcTrainsFromDepartures(line); } catch(_) {}
updateUI();
}

function setActiveLineSpeedClass(cls){
const line = state.lines.get(state.activeLine);
if (!line) return;
line.speedClass = String(cls || "medium");
line_recalcDerived(line);
try { if (typeof ui_lineRecalcTrainsFromDepartures === "function") ui_lineRecalcTrainsFromDepartures(line); } catch(_) {}
updateUI();
}




function deleteActiveLine(){
  const id = state.activeLine;
  if (!id) return;
  if (!confirm("Delete active line?")) return;
  state.lines.delete(id);
  state.activeLine = null;
  renderLines();
  updateUI();
  showToast("Line deleted", "warning");
}

function clearAllTracks(){
  layers.tracks.clearLayers();
  layers.trackLabels.clearLayers();
  state.tracks.clear();
  state.pendingTrackNode = null;
  renderLines();
  updateUI();
  showToast("Cleared all tracks", "warning");
}
