/* eslint-disable no-undef, no-unused-vars, no-empty */
// ======================
// Clear the dynamics flow overlay and reset particles
function dynFlow_clear() {
  try { layers.flowOverlay.clearLayers(); } catch(_) {}
  if (state._dynFlow) state._dynFlow.particles = [];
  if (state._dynFlow && state._dynFlow.rafId) cancelAnimationFrame(state._dynFlow.rafId);
  if (state._dynFlow) state._dynFlow.rafId = null;
}
// Simulation
// ======================
window.simulateYear = simulateYear;
// ...existing code...

function simulateDay(dayNum, opts) {
  opts = opts || {};
  const bulk = !!opts.bulk;
  // Advance simulation by one day
  // Convert annual values to daily
  state.budget += (state.annualBudget / 365);

  // Economy: uses tracks + lines properties (freq/cap/speed)
  if (typeof window.computeEconomy === "function") {
    window.computeEconomy(state, map);
  } else {
    console.warn("computeEconomy not loaded");
  }

  // Station retail rent (added on top of economy.js results)
  const rent = computeRetailRentEURPerYear() / 365;
  state.revenue = (Number(state.revenue || 0) + rent);

  const _preserve = {
  clock: state.clock,
  service: state.service,
  calendar: state.calendar,
  luti: state.luti,
  construction: state.construction,
  lastOperatingCostDay: state.lastOperatingCostDay,
  _dynFlow: state._dynFlow,
  _lastFlows: state._lastFlows,
  _uiLastFullUpdateTs: state._uiLastFullUpdateTs,
};

      // ✅ Make sure "out" is actually declared here
  const seed = Number(state.simSeed ?? state.meta?.seed ?? 1);
  const scenarioId = state.meta?.scenarioId ?? state.scenarioMeta?.id ?? "default";
  const out = window.simCoreStep(state, { seed, scenarioId, tickLabel: `day:${dayNum}` });

state = out.state;

// Re-attach runtime/UI-only parts that simCoreStep doesn't carry over
state.clock ||= _preserve.clock || { tMin: 8*60, running: true, speed: 60, lastTs: null, rafId: 0 };
state.service ||= _preserve.service || { day: 0, prevTMin: null, runs: [], layer: null, pending: new Map() };
state.service.pending ||= (_preserve.service && _preserve.service.pending) ? _preserve.service.pending : new Map();
state.calendar ||= _preserve.calendar || { year: 2025, month: 1, day: 1, daysPerMonth: 30, dayOfWeek: 1 };
state.luti ||= _preserve.luti || { beta: 0.045, accessJobs: new Map() };
// Keep LUTI internals as Maps (simCoreStep cloning may strip Map methods from nested objects)
if (!state.luti.accessJobs || typeof state.luti.accessJobs.clear !== "function" || typeof state.luti.accessJobs.get !== "function") {
  const preservedJobs = _preserve.luti && _preserve.luti.accessJobs;
  state.luti.accessJobs = (preservedJobs && typeof preservedJobs.clear === "function" && typeof preservedJobs.get === "function")
    ? preservedJobs
    : new Map();
}
state.construction ||= _preserve.construction || { queue: [], active: [], history: [] };
if (typeof state.lastOperatingCostDay === "undefined") state.lastOperatingCostDay = _preserve.lastOperatingCostDay || 0;
if (typeof state._dynFlow === "undefined") state._dynFlow = _preserve._dynFlow;
if (typeof state._lastFlows === "undefined") state._lastFlows = _preserve._lastFlows;
state._uiLastFullUpdateTs ||= _preserve._uiLastFullUpdateTs || 0;

// IMPORTANT: other files read window.state
window.state = state;



   // optionally show validation warnings somewhere (console for now)
   if (!bulk && out.issues && out.issues.length) console.warn("Sim validation issues:", out.issues);

  if (!Array.isArray(state.simReportRows)) state.simReportRows = [];
  if (out.tickRow) state.simReportRows.push(out.tickRow);

  // Rolling stock maintenance (fleet) — scaled by speed class so fast trains cost more
  let fleetMaint = 0;
  for (const l of state.lines.values()){
    if (!l) continue;
    // keep derived fields up to date
    try { line_recalcDerived(l); } catch(_) {}
    try { if (typeof ui_lineRecalcTrainsFromDepartures === "function") ui_lineRecalcTrainsFromDepartures(l); } catch(_) {}
    fleetMaint += line_trainMaintenanceCostEURPerYear(l) / 365;
  }
  state.costs = Number(state.costs || 0) + fleetMaint;
  state.fleetMaintenance = fleetMaint;
  state.profit = (Number(state.revenue || 0) - Number(state.costs || 0));

   if (!bulk) {
     let flows = state._flows || null;
     if (!flows) {
       try {
         flows = (typeof window.computeFlows === "function") ? window.computeFlows(state, map) : null;
       } catch (err) {
         console.warn("Dynamics computeFlows failed:", err);
         flows = null;
       }
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
         goodsDemand: Number(flows.goodsDemand || 0),
         goodsByRail: Number(flows.goodsByRail || 0),
         goodsByOther: Number(flows.goodsByOther || 0),
         passengerTrips: Number(flows.passengerTrips || 0),
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
   }
}

 function simulateYear(){
   try {
     if (window.__bulkSim && window.__bulkSim.running) {
       window.__bulkSim.cancelRequested = true;
       showToast("Cancelling year simulation…", "error");
       return;
     }

     const daysInYear = Number(state.calendar?.daysPerMonth || 30) * 12;
     const startDay = (Number(state.year || 0) * daysInYear) + 1;
     const chunkDays = 5;

     window.__bulkSim = {
       running: true,
       cancelRequested: false,
       i: 0,
       daysInYear,
       startDay,
     };

     try { if (typeof window.clock_stop === "function") window.clock_stop(); } catch(_) {}

     const runChunk = () => {
       try {
         if (!window.__bulkSim || !window.__bulkSim.running) return;
         if (window.__bulkSim.cancelRequested) {
           window.__bulkSim.running = false;
           showToast("Year simulation cancelled.", "error");
           try { if (typeof window.clock_start === "function") window.clock_start(); } catch(_) {}
           return;
         }

         const end = Math.min(window.__bulkSim.i + chunkDays, window.__bulkSim.daysInYear);
         for (; window.__bulkSim.i < end; window.__bulkSim.i++) {
           simulateDay(window.__bulkSim.startDay + window.__bulkSim.i, { bulk: true });

           if (typeof calendar_advanceDay === "function") {
             calendar_advanceDay();
           } else if (state.calendar) {
             state.calendar.day = Number(state.calendar.day || 1) + 1;
             if (state.calendar.day > Number(state.calendar.daysPerMonth || 30)) {
               state.calendar.day = 1;
               state.calendar.month = Number(state.calendar.month || 1) + 1;
               if (state.calendar.month > 12) {
                 state.calendar.month = 1;
                 state.calendar.year = Number(state.calendar.year || 0) + 1;
               }
             }
           }

           if (state.service) {
             state.service.day = Number(state.service.day || 0) + 1;
           }
         }

         if (window.__bulkSim.i < window.__bulkSim.daysInYear) {
           if ((window.__bulkSim.i % 30) === 0) {
             showToast(`Simulating… ${window.__bulkSim.i}/${window.__bulkSim.daysInYear} days`, "success");
           }
           setTimeout(runChunk, 0);
           return;
         }

         // finalize
         if (state.calendar && Number.isFinite(state.calendar.year)) {
           state.year = Number(state.calendar.year);
         } else {
           state.year = Number(state.year || 0) + 1;
         }

         window.__bulkSim.running = false;

         showToast(
           `Year ${state.year} simulated (${daysInYear} days). Profit: ${formatCurrency(state.profit)}`,
           state.profit >= 0 ? "success" : "error"
         );

         // one expensive UI update at the end
         try { computeStationPressure(); } catch(_) {}
         try { dynFlow_render(); } catch(_) {}
         try { updateUI(); } catch(_) {}
         try { if (typeof window.clock_start === "function") window.clock_start(); } catch(_) {}
       } catch (e) {
         console.error(e);
         if (window.__bulkSim) window.__bulkSim.running = false;
         showToast("Simulation crashed", "error");
         if (typeof ui_captureError === "function") ui_captureError(e, { source: "simulateYear" });
         const panel = document.getElementById("controlPanel");
         panel.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-top:10px;border-color:#fecaca;color:#991b1b;">${String(e)}</div>`);
         try { if (typeof window.clock_start === "function") window.clock_start(); } catch(_) {}
       }
     };

     setTimeout(runChunk, 0);
   } catch (e) {
     console.error(e);
     showToast("Simulation crashed", "error");
     if (typeof ui_captureError === "function") ui_captureError(e, { source: "simulateYear" });
     const panel = document.getElementById("controlPanel");
     panel.insertAdjacentHTML("beforeend", `<div class="hint" style="margin-top:10px;border-color:#fecaca;color:#991b1b;">${String(e)}</div>`);
   }
 }

function dynFlow_distanceMeters(a, b){
  if (map && typeof map.distance === "function") {
    return map.distance(a, b);
  }
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const lat1 = toRad(Number(a[0] || 0));
  const lon1 = toRad(Number(a[1] || 0));
  const lat2 = toRad(Number(b[0] || 0));
  const lon2 = toRad(Number(b[1] || 0));
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function dynFlow_buildCumDistances(latlngs){
  const cum = [0];
  let total = 0;
  for (let i = 1; i < latlngs.length; i++){
    const a = latlngs[i - 1];
    const b = latlngs[i];
    const d = dynFlow_distanceMeters(a, b);
    total += Number.isFinite(d) ? d : 0;
    cum.push(total);
  }
  return { cum, total };
}

function dynFlow_pointAt(latlngs, cum, total, dist){
  if (!latlngs || latlngs.length < 2 || !cum || total <= 0) return latlngs?.[0] || [0, 0];
  const d = Math.max(0, Math.min(total, dist));
  let i = 1;
  while (i < cum.length && cum[i] < d) i++;
  if (i >= cum.length) return latlngs[latlngs.length - 1];
  const prev = cum[i - 1];
  const seg = Math.max(1e-6, cum[i] - prev);
  const t = (d - prev) / seg;
  const a = latlngs[i - 1];
  const b = latlngs[i];
  const lat = Number(a[0]) + (Number(b[0]) - Number(a[0])) * t;
  const lon = Number(a[1]) + (Number(b[1]) - Number(a[1])) * t;
  return [lat, lon];
}

function dynFlow_render(){
  const dyn = state.dynamics || {};
  if (!dyn.enabled || !dyn.showOverlay) {
    dynFlow_clear();
    return;
}

state._dynFlow ||= { particles: [], rafId: 0 };
dynFlow_clear();

const mode = dyn.mode || "both";
const MAX_PARTICLES = 180;
let created = 0;

  for (const line of state.lines.values()){
    if (created >= MAX_PARTICLES) break;
    if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;
    const lineType = line.type || "passenger";
    if (state.primaryTab === "production" && lineType !== "cargo" && lineType !== "mixed") continue;

  // Mode filter by line type
    const isGoods = (lineType === "cargo");
    const isPax = (lineType === "passenger");
    const isMixed = (lineType === "mixed");

  const showThis =
    (mode === "both") ||
    (mode === "goods" && (isGoods || isMixed)) ||
    (mode === "passengers" && (isPax || isMixed));

  if (!showThis) continue;

  const adj = (typeof renderGraph_buildTrackAdj === "function") ? renderGraph_buildTrackAdj() : null;
  if (!adj || !adj.size) continue;

  const latlngs = [];
  const pushPath = (pathIds) => {
    if (!Array.isArray(pathIds) || pathIds.length < 2) return false;
    const pts = [];
    for (const id of pathIds){
      const n = state.nodes.get(id);
      if (n) pts.push([Number(n.lat), Number(n.lon)]);
    }
    if (pts.length < 2) return false;
    if (!latlngs.length) latlngs.push(...pts);
    else latlngs.push(...pts.slice(1));
    return true;
  };

    let ok = true;
    let usedDirectPath = false;
    if (Array.isArray(line.pathNodes) && line.pathNodes.length >= 2) {
      let stopIdx = 0;
      ok = true;
      for (const stop of line.stops) {
        const stopStr = String(stop);
        let found = -1;
        for (let i = stopIdx; i < line.pathNodes.length; i++) {
          if (String(line.pathNodes[i]) === stopStr) { found = i; break; }
        }
        if (found < 0) { ok = false; break; }
        stopIdx = found + 1;
      }
      for (let i = 1; i < line.pathNodes.length; i++) {
        const aRaw = line.pathNodes[i - 1];
        const bRaw = line.pathNodes[i];
        const bStr = String(bRaw);
        const nbrs = adj.get(aRaw) || adj.get(String(aRaw));
        if (!nbrs || !nbrs.some(e => String(e.to) === bStr)) { ok = false; break; }
      }
      if (ok && pushPath(line.pathNodes)) usedDirectPath = true;
    }

    if (!usedDirectPath) {
      ok = true;
      for (let i = 1; i < line.stops.length; i++){
        const a = line.stops[i - 1];
        const b = line.stops[i];
        if (!renderGraph_shortestPath) { ok = false; break; }
        const path = renderGraph_shortestPath(adj, a, b);
        if (!pushPath(path)) { ok = false; break; }
      }
      if (!ok || latlngs.length < 2) continue;

      if (line.circular && line.stops.length >= 3) {
        const a = line.stops[line.stops.length - 1];
        const b = line.stops[0];
        const path = renderGraph_shortestPath(adj, a, b);
        pushPath(path);
      }
    }
    if (!ok || latlngs.length < 2) continue;

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

  // Bigger dots; cargo visually heavier, scale by capacity
  const baseRadius =
    line.type === "cargo" ? 6.6 :
    line.type === "mixed" ? 6.0 :
    5.4;
  const cap = Math.max(0, Number(line.vehicleCapacity || 0));
  const capScale = Math.max(0.75, Math.min(1.5, Math.sqrt((cap || 1) / 160)));
  const radius = (line.id === state.activeLine ? 1.1 : 1.0) * baseRadius * capScale;

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

state._dynFlow ||= { particles: [], rafId: 0 };
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

const SIM_LINE_DAY_END_MIN = 24 * 60;
const SIM_LINE_NIGHT_END_MIN = 8 * 60;

function line_isDepartureAllowed(depMin, line, windowKey){
  const dayStart = clamp(Number(line.serviceStartMin ?? 330), 0, 1439);
  const isDay = depMin >= dayStart && depMin < SIM_LINE_DAY_END_MIN;
  const isNight = !!line.nightService && depMin >= 0 && depMin < SIM_LINE_NIGHT_END_MIN;

  if (windowKey === "day") return isDay;
  if (windowKey === "night") return isNight;
  return isDay || isNight;
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

  const windowKey = ev?.currentTarget?.dataset?.window || "any";

  // Find the time input near the clicked button (no fragile id reliance)
  const panel = ev?.currentTarget?.closest?.(".timetablePanel") || document;
  const row = ev?.currentTarget?.closest?.(".depRow");
  const inp = (row && row.querySelector('input[type="time"]')) || panel.querySelector('input[type="time"]');
  const depMin = hhmmToMin(inp?.value);

  if (depMin == null) { showToast("Pick a valid time (HH:MM)", "warning"); return; }

  if (!line_isDepartureAllowed(depMin, line, windowKey)){
    const dayStart = clamp(Number(line.serviceStartMin ?? 330), 0, 1439);
    const msg = windowKey === "night"
      ? (line.nightService ? "Night departures must be between 00:00 and 08:00." : "Enable night service to add night departures.")
      : ("Day departures must be between " + minToHHMM(dayStart) + " and 00:00.");
    showToast(msg, "warning");
    return;
  }

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

function ui_lineRemoveStop(nodeId){
  const line = state.activeLine ? state.lines.get(state.activeLine) : null;
  if (!line) return;
  line.stops = (line.stops || []).filter(id => String(id) !== String(nodeId));
  renderLines();
  updateUI();

  if (line.stops.length < 2){
    showToast("Line needs at least 2 stops to run.", "warning");
  }
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
const dayStartMin = clamp(Number(line.serviceStartMin ?? 330), 0, 1439);
const dayDeps = deps.filter(d =>
  d >= dayStartMin &&
  d < SIM_LINE_DAY_END_MIN &&
  (!line.nightService || d >= SIM_LINE_NIGHT_END_MIN)
);
const nightDeps = line.nightService ? deps.filter(d => d >= 0 && d < SIM_LINE_NIGHT_END_MIN) : [];

const rt = ui_lineRuntimeMin(line);
const rtLabel = (rt > 0.2) ? `${Math.round(rt)} min` : "—";

return `
  <div style="height:10px"></div>
  <div class="timetablePanel" style="padding:10px;border-radius:12px;background:#f8fafc;border:1px solid rgba(15,23,42,0.08);">
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

    <div style="color:#64748b;font-weight:850;font-size:12px;margin-bottom:6px;">
      Day departures: ${minToHHMM(dayStartMin)} to 00:00. Night departures (if enabled): 00:00 to 08:00.
    </div>

    <div class="depRow" style="display:flex;gap:8px;align-items:center;">
      <input name="depTimeDay" class="field" type="time" value="${minToHHMM(dayStartMin)}" style="flex:1;">
      <button type="button" class="btn" data-window="day" onclick="ui_lineAddDeparture(event)">Add day departure</button>
    </div>
    <div style="height:6px"></div>
    <div class="depRow" style="display:flex;gap:8px;align-items:center;">
      <input name="depTimeNight" class="field" type="time" value="01:00" style="flex:1;" ${line.nightService ? "" : "disabled"}>
      <button type="button" class="btn" data-window="night" onclick="ui_lineAddDeparture(event)" ${line.nightService ? "" : "disabled"}>Add night departure</button>
    </div>
<div style="height:10px"></div>
    <div style="height:8px"></div>
    ${dayDeps.length ? `
      <div class="list" style="max-height:200px;overflow:auto;">
        ${dayDeps.map(d => `
          <div class="item" style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div style="font-weight:950;color:#0f172a;">
              ${minToHHMM(d)} → ${ui_lineArrivalLabel(d, line)}
            </div>
            <button class="btn danger" onclick="ui_lineRemoveDeparture(${Number(d)})">Remove</button>
          </div>
        `).join("")}
      </div>
    ` : `<div style="padding:10px;color:#64748b;font-weight:900;">No day departures set yet.</div>`}

    <div style="height:10px"></div>
    <div style="font-weight:900;color:#334155;margin-bottom:6px;">Night departures</div>
    ${line.nightService ? (nightDeps.length ? `
      <div class="list" style="max-height:160px;overflow:auto;">
        ${nightDeps.map(d => `
          <div class="item" style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
            <div style="font-weight:950;color:#0f172a;">
              ${minToHHMM(d)} → ${ui_lineArrivalLabel(d, line)}
            </div>
            <button class="btn danger" onclick="ui_lineRemoveDeparture(${Number(d)})">Remove</button>
          </div>
        `).join("")}
      </div>
    ` : `<div style="padding:10px;color:#64748b;font-weight:900;">No night departures set yet.</div>`)
    : `<div style="padding:10px;color:#64748b;font-weight:900;">Enable night service to add night departures.</div>`}
  </div>
`;
}

Object.assign(window, {
ui_lineAddDeparture,
ui_lineRemoveDeparture,
ui_lineSetTrains,
ui_lineDiagram_stopClick,
ui_lineRemoveStop,
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
  if (typeof setLineBuildMode === "function") {
    setLineBuildMode(!state.lineBuildMode);
  } else {
    state.lineBuildMode = !state.lineBuildMode;
    updateUI();
    showToast(state.lineBuildMode ? "Line building ON" : "Line building OFF", "info");
  }
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

function setActiveLineName(v){
const line = state.activeLine ? state.lines.get(state.activeLine) : null;
if (!line) {
  showToast("Select a line first", "warning");
  return;
}
const name = String(v ?? "").trim();
if (!name) {
  showToast("Line name cannot be empty", "warning");
  updateUI();
  return;
}
line.name = name;
renderLines();
updateUI();
showToast("Line name updated", "success");
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

function setActiveLineNumber(v){
const line = state.lines.get(state.activeLine);
if (!line) return;
const raw = String(v ?? "").trim();
if (!raw) {
  line.number = null;
  updateUI();
  return;
}
const n = Math.round(Number(raw));
if (!Number.isFinite(n) || n <= 0) {
  showToast("Line number must be a positive integer", "warning");
  return;
}
line.number = n;
updateUI();
}




function deleteActiveLine(){
  const id = state.activeLine;
  if (!id) return;
  const line = state.lines.get(id);
  if (!line) return;
  if (line.retiring) {
    showToast("Line already scheduled for removal", "info");
    return;
  }
  if (!confirm("Schedule active line for removal?")) return;

  line.retiring = true;
  line.retireStartDay = Number(state.service?.day || 0);
  line.retireDays = Number(CONFIG.LINE_RETIRE_DAYS || 7);

  renderLines();
  updateUI();
  showToast(`Line will be removed in ${line.retireDays} days`, "warning");
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
