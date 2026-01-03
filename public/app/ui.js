// ======================
// Mode bar + hotkeys
// ======================
let uiHotkeysInstalled = false;

function uiMode_compute(){
// Track build mode has priority
if (state.trackBuildMode) {
  const start = state.pendingTrackNode ? state.pendingTrackNode.name : "—";
  return {
    label: "BUILD TRACK",
    pill: "T",
    detail: `Chain start: ${start}`,
    cursor: "crosshair"
  };
}

// Line build mode (only if a line is selected)
if (state.activeLine && state.lineBuildMode) {
  const ln = state.lines?.get?.(state.activeLine);
  return {
    label: "BUILD LINE",
    pill: "L",
    detail: `Active: ${ln?.name || state.activeLine}`,
    cursor: "copy"
  };
}

// Line selected, but building off
if (state.activeLine && !state.lineBuildMode) {
  const ln = state.lines?.get?.(state.activeLine);
  return {
    label: "INSPECT (line selected)",
    pill: "I",
    detail: `Active: ${ln?.name || state.activeLine} • add stops OFF`,
    cursor: ""
  };
}

// Default
return {
  label: "INSPECT",
  pill: "I",
  detail: "Click nodes to inspect/select",
  cursor: ""
};
}

function uiMode_render(){
const el = document.getElementById("modeBar");
if (!el) return;

const m = uiMode_compute();

el.innerHTML = `
  <div class="row">
    <div class="mode">${m.label}</div>
    <span class="pill">${m.pill}</span>
  </div>
  <div class="detail">${m.detail}</div>
  <div class="keys" id="simClock">${uiClock_label()}</div>
`;

// Cursor feedback on the map
try {
  if (map && map.getContainer) map.getContainer().style.cursor = m.cursor || "";
} catch(_) {}
}

// Small inline clock that lives where the hotkey hint used to be (upper-right).
function uiClock_label(){
const t = minToHHMM(Number(state.clock?.tMin || 0));
const run = state.clock?.running ? "▶" : "⏸";
const spd = Math.round(Number(state.clock?.speed || 60));
return `${run} ${calendar_label()} ${t}  •  x${spd}`;
}

function uiClock_updateInline(){
const el = document.getElementById("simClock");
if (!el) return;
el.textContent = uiClock_label();
}


function uiSetInspectMode(){
state.trackBuildMode = false;
state.pendingTrackNode = null;
state.lineBuildMode = false;
state.activeLine = null;

try { renderLines?.(); } catch(_) {}
updateUI();
showToast("Inspect mode", "info");
}

function uiCancelBuildModes(){
const wasAnything =
  !!state.pendingTrackNode || !!state.trackBuildMode || !!state.lineBuildMode;

state.pendingTrackNode = null;
state.trackBuildMode = false;
state.lineBuildMode = false;

try { renderLines?.(); } catch(_) {}
updateUI();

if (wasAnything) showToast("Cancelled build modes", "info");
}

function uiHotkeys_install(){
if (uiHotkeysInstalled) return;
uiHotkeysInstalled = true;

window.addEventListener("keydown", (e) => {
  // allow Esc always, but otherwise ignore if typing
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  const typing = (tag === "input" || tag === "textarea" || tag === "select");

  const key = (e.key || "").toLowerCase();

  // Esc cancels even while typing
  if (key === "escape") {
    e.preventDefault();
    uiCancelBuildModes();
    return;
  }

  if (typing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (key === "i") {
    e.preventDefault();
    uiSetInspectMode();
    return;
  }

  if (key === "t") {
    e.preventDefault();
    // entering track mode should disable line building to prevent surprises
    state.lineBuildMode = false;

    // Prefer existing helper if present
    if (typeof setTrackBuildMode === "function") {
      setTrackBuildMode(!state.trackBuildMode);
    } else {
      state.trackBuildMode = !state.trackBuildMode;
      state.pendingTrackNode = null;
      updateUI();
    }
    return;
  }

  if (key === "l") {
    e.preventDefault();
    // toggles line building, but only if a line is selected
    if (!state.activeLine) {
      showToast("Select a line first", "warning");
      return;
    }
    // turning on line mode should turn off track mode
    state.trackBuildMode = false;
    state.pendingTrackNode = null;

    if (typeof toggleLineBuildMode === "function") toggleLineBuildMode();
    else {
      state.lineBuildMode = !state.lineBuildMode;
      updateUI();
    }
    return;
  }

  if (key === "u") {
    e.preventDefault();
    if (typeof undo_applyLast === "function") undo_applyLast();
    else showToast("Undo not available", "warning");
    return;
  }
}, { passive: false });
}

// Alias for accidental wrong casing (prevents ReferenceError)
function uihotkeys_install(){ return uiHotkeys_install(); }

function ui_lineRuntimeMin(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 2) return 0;

const pts = line.stops.map(id => state.nodes.get(id)).filter(Boolean);
if (pts.length < 2) return 0;

// distance in meters
let meters = 0;
for (let i = 0; i < pts.length - 1; i++){
  const a = pts[i], b = pts[i+1];
  meters += map.distance([a.lat, a.lon], [b.lat, b.lon]);
}

const km = meters / 1000;
const speed = Math.max(10, Number(line.speedKmh || 120));

// ✅ define travelMin
const travelMin = (km / speed) * 60;

// dwell time per segment (between stops)
const dwellMin = Math.max(0, Number(line.dwellSec || 0)) / 60;
const dwellTotal = Math.max(0, pts.length - 1) * dwellMin;

return travelMin + dwellTotal;
}

function ui_lineRecalcTrainsFromDepartures(line){
ui_lineEnsure(line);

const deps = (line.departures || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
const rt = ui_lineRuntimeMin(line);
if (deps.length === 0 || rt <= 0.05) { line.trains = 0; return; }

const events = [];
for (const d of deps){
  events.push([d, +1], [d + rt, -1]);
  events.push([d + 1440, +1], [d + 1440 + rt, -1]); // wrap-safe
}
events.sort((a,b)=>(a[0]-b[0]) || (a[1]-b[1]));

let cur=0, max=0;
for (const e of events){ cur += e[1]; if (cur>max) max=cur; }
line.trains = clamp(Math.ceil(max), 0, 50);
}

// ======================
// Schematic line diagram (Barcelona-style, simple)
// ======================
function ui_lineDiagramHtml(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 2) {
  return `<div style="padding:10px;color:#64748b;font-weight:900;">Add at least 2 stops to see the line diagram.</div>`;
}

const stops = line.stops.map(id => state.nodes.get(id)).filter(Boolean);
const n = stops.length;
if (n < 2) return `<div style="padding:10px;color:#64748b;font-weight:900;">Stops missing node data.</div>`;

const runs = (state.service?.runs || []).filter(r => r.lineId === line.id);
const height = 96;

// Stop dots + labels
const stopEls = stops.map((s, i) => {
  const x = (i/(n-1))*100;
  const name = (s.name || s.id || "").toString();
  return `
    <div style="position:absolute;left:${x}%;top:46px;transform:translate(-50%,-50%);cursor:pointer;" onclick="ui_lineDiagram_stopClick(\'${s.id}\')">
      <div style="width:10px;height:10px;border-radius:999px;background:#fff;border:2px solid #0f172a;"></div>
      <div style="margin-top:6px;max-width:90px;text-align:center;font-size:11px;font-weight:900;color:#334155;line-height:1.1;">
        ${escapeHtml(name)}
      </div>
    </div>
  `;
}).join("");

// Train dots (stack vertically a bit if multiple)
const trainEls = runs.map((r, idx) => {
  const p = Math.max(0, Math.min(1, Number(r.progress ?? 0)));
  const x = p * 100;
  const y = 22 + (idx % 3) * 10; // small stacking
  return `
    <div title="Train" style="
      position:absolute;left:${x}%;top:${y}px;transform:translate(-50%,-50%);
      width:10px;height:10px;border-radius:999px;
      background:${line.color || "#38bdf8"};
      border:2px solid #0f172a;
      box-shadow:0 1px 0 rgba(0,0,0,0.06);
    "></div>
  `;
}).join("");

return `
  <div style="position:relative;height:${height}px;border-radius:12px;border:1px solid rgba(15,23,42,0.10);background:#ffffff;overflow:hidden;">
    <div style="position:absolute;left:10px;right:10px;top:46px;height:4px;border-radius:999px;background:${line.color || "#38bdf8"};"></div>
    ${trainEls}
    ${stopEls}
  </div>
`;
}

function ui_renderLineDiagram(){
const host = document.getElementById("lineDiagram");
if (!host) return;
const line = state.activeLine ? state.lines.get(state.activeLine) : null;
if (!line) { host.innerHTML = ""; return; }
host.innerHTML = ui_lineDiagramHtml(line);
}

// tiny HTML escape for stop labels
function escapeHtml(s){
return String(s)
  .replaceAll("&","&amp;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;")
  .replaceAll('"',"&quot;")
  .replaceAll("'","&#039;");
}

function line_stopFractions(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 2) return [];
const pts = line.stops.map(id => state.nodes.get(id)).filter(Boolean);
if (pts.length < 2) return [];

const seg = [];
let total = 0;
for (let i=0;i<pts.length-1;i++){
  const a = pts[i], b = pts[i+1];
  const d = map.distance([a.lat, a.lon], [b.lat, b.lon]);
  seg.push(d);
  total += d;
}
if (total <= 0) return pts.map((_,i)=> (pts.length===1?0:i/(pts.length-1)));

const frac = [0];
let acc = 0;
for (let i=0;i<seg.length;i++){
  acc += seg[i];
  frac.push(acc/total);
}
return frac;
}

function fmtAbsTime(absMin){
const day = Math.floor(absMin / 1440);
const t = ((absMin % 1440) + 1440) % 1440;
const hhmm = minToHHMM(t);
const baseDay = Number(state.service?.day || 0);
const dRel = day - baseDay;
return dRel === 0 ? hhmm : `${hhmm} (+${dRel}d)`;
}

function ui_nextArrivalsForStop(line, stopIndex, k=3){
const curTMin = Number(state.clock?.tMin || 0);
const absNow = Number(state.service?.day || 0)*1440 + curTMin;

const runtime = ui_lineRuntimeMin(line);
if (runtime <= 0.05) return [];

const fracs = line_stopFractions(line);
const f = Number(fracs[stopIndex] ?? (stopIndex/(Math.max(1,(line.stops.length-1)))));

const out = [];

// Active runs
for (const r of (state.service?.runs || [])){
  if (r.lineId !== line.id) continue;
  const absStart = Number(r.absStart ?? (Number(state.service?.day||0)*1440 + Number(r.depMin||0)));
  const arrAbs = absStart + Number(r.runtimeMin || runtime) * f;
  if (arrAbs >= absNow - 0.01) out.push(arrAbs);
}

// Future scheduled departures (today or tomorrow)
for (const dep of (line.departures || [])){
  const depMin = Number(dep);
  if (!Number.isFinite(depMin)) continue;
  const depAbs = (depMin >= curTMin)
    ? (Number(state.service?.day || 0)*1440 + depMin)
    : ((Number(state.service?.day || 0)+1)*1440 + depMin);

  const arrAbs = depAbs + runtime * f;
  if (arrAbs >= absNow - 0.01) out.push(arrAbs);
}

out.sort((a,b)=>a-b);

// Unique-ish (within 0.25 min)
const uniq = [];
for (const t of out){
  if (!uniq.length || Math.abs(t - uniq[uniq.length-1]) > 0.25) uniq.push(t);
  if (uniq.length >= k) break;
}
return uniq;
}

function ui_lineDiagram_stopClick(nodeId){
const line = state.activeLine ? state.lines.get(state.activeLine) : null;
const node = state.nodes.get(nodeId);
if (!line || !node) return;

// Center map
const z = Math.max(map.getZoom(), 9);
map.setView([node.lat, node.lon], z, { animate: true });

// Find stop index
const stopIndex = line.stops.findIndex(x => String(x) === String(nodeId));
const arrivals = stopIndex >= 0 ? ui_nextArrivalsForStop(line, stopIndex, 3) : [];

const html = `
  <div style="min-width:200px">
    <div style="font-weight:1000;color:#0f172a;">${escapeHtml(node.name || nodeId)}</div>
    <div style="font-weight:900;color:#334155;font-size:12px;line-height:1.4;margin-top:4px;">
      Line: <b>${escapeHtml(line.name || line.id)}</b><br/>
      Next arrivals: ${
        arrivals.length
          ? arrivals.map(t => `<b>${fmtAbsTime(t)}</b>`).join(", ")
          : "<span style='color:#64748b'>none scheduled</span>"
      }
    </div>
  </div>
`;

L.popup({ closeButton: true, autoClose: true, closeOnClick: true })
  .setLatLng([node.lat, node.lon])
  .setContent(html)
  .openOn(map);
}

Object.assign(window, { ui_lineDiagram_stopClick });

// ======================
// UI actions
// ======================
function switchTab(tab){
  state.activeTab = tab;
  if (tab !== "tracks") {
    state.trackBuildMode 

function ui_switchLinePanel(which){
  state.activeLinePanel = which;
  updateUI();
}
// expose for inline onclick in module context
window.ui_switchLinePanel = ui_switchLinePanel;

    state.pendingTrackNode = null;
  }
  updateUI();
}

function setTrackBuildMode(on){
  state.trackBuildMode = !!on;
  state.pendingTrackNode = null;
  updateUI();
  showToast(on ? "Track mode ON: click nodes to chain-build" : "Track mode OFF", on ? "success" : "warning");
}

function setTrackLanes(n){
  state.pendingTrackLanes = clamp(Number(n)||1, 1, 8);
  updateUI();
}

function createNewLine(){
const name = document.getElementById("lineName")?.value?.trim() || "New Line";
const type = document.getElementById("lineType")?.value || "passenger";
const circular = !!document.getElementById("lineCircular")?.checked;

// Read optional inputs
const carsRaw = document.getElementById("lineCars")?.value;
const clsRaw  = document.getElementById("lineSpeedClass")?.value;

const cars = Number(carsRaw);

// override defaults if user set (NEW MODEL)
const ln = state.lines.get(state.activeLine);
if (ln) {
  ln.carriages = clamp(Number(document.getElementById("lineCarriages")?.value || ln.carriages || 6), 1, 50);
  ln.speedClass = String(document.getElementById("lineSpeedClass")?.value || ln.speedClass || "medium");
  try { line_recalcDerived(ln); } catch(_) {}
  try { if (typeof ui_lineRecalcTrainsFromDepartures === "function") ui_lineRecalcTrainsFromDepartures(ln); } catch(_) {}
}

const overrides = {};
if (Number.isFinite(cars)) overrides.carriages = cars;
if (typeof clsRaw === "string" && clsRaw) overrides.speedClass = clsRaw;

addLine(name, type, circular, overrides);


// Optional: clear fields for convenience (safe)
const lnEl = document.getElementById("lineName");
if (lnEl) lnEl.value = "";
}

function selectLine(id){
if (!id) {
  state.activeLine = null;
  renderLines();
  updateUI();
  showToast("No line selected (inspect mode)", "info");
  return;
}

state.activeLine = id;
renderLines();
updateUI();
}

// ======================
// Undo (last action)
// ======================
function undo_pushAction(action){
if (!state.undo) state.undo = { stack: [], max: 60 };
const st = state.undo.stack;
st.push(action);
const max = state.undo.max || 60;
if (st.length > max) st.shift();
}

function undo_removeTrackById(trackId){
const t = state.tracks.get(trackId);
if (!t) return null;

if (t._layer) layers.tracks.removeLayer(t._layer);

// label may live in tracks OR trackLabels depending on your current code
if (t._label) {
  layers.trackLabels.removeLayer(t._label);
  layers.tracks.removeLayer(t._label);
}

state.tracks.delete(trackId);
return t;
}

// restore a previous track visually WITHOUT charging budget
function undo_drawTrackVisual(fromId, toId, lanes){
const a = state.nodes.get(fromId);
const b = state.nodes.get(toId);
if (!a || !b) return null;

const key = edgeKey(fromId, toId);
const trackId = `TK-${key}`;

const cost = calculateTrackCost(a, b, lanes);

const line = L.polyline([[a.lat,a.lon],[b.lat,b.lon]], {
  color: "#000",
  weight: 2 + lanes * 1.5,
  opacity: 0.95,
  lineCap: "round"
}).addTo(layers.tracks);

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
});

// prefer trackLabels layer if present
if (layers.trackLabels && typeof layers.trackLabels.addLayer === "function") label.addTo(layers.trackLabels);
else label.addTo(layers.tracks);

line.on("click", () => {
  if (confirm("Delete this track segment?")) {
    undo_removeTrackById(trackId);
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

return trackId;
}

function undo_applyLast(){
const st = state.undo?.stack;
if (!st || !st.length) {
  showToast("Nothing to undo", "info");
  return;
}

const action = st.pop();

if (action.type === "track_add") {
  undo_removeTrackById(action.trackId);

  // If we overwrote a previous track, restore it
  if (action.prev && action.prev.from && action.prev.to) {
    undo_drawTrackVisual(action.prev.from, action.prev.to, action.prev.lanes || 1);
  }

  // Refund only what THIS build cost
  state.budget += Math.max(0, Number(action.refund || 0));

  state.pendingTrackNode = null;

  renderLines();
  updateUI();
  showToast("Undid track build", "success");
  return;
}

if (action.type === "line_stops") {
  const line = state.lines.get(action.lineId);
  if (line && Array.isArray(action.beforeStops)) {
    line.stops = action.beforeStops.slice();
  }

  renderLines();
  updateUI();
  showToast("Undid stop add", "success");
  return;
}

showToast("Nothing to undo", "info");
}

// ======================
// Optimizer (beta) - applies changes, not just suggestions
// ======================
function opt_scopeNodeIds(){
// If inside a cluster: optimize over cities in that cluster
if (state.activeClusterId && state.clusters && state.clusters.has(state.activeClusterId)) {
  const cl = state.clusters.get(state.activeClusterId);
  if (cl && cl.cityIds && typeof cl.cityIds.forEach === "function") return Array.from(cl.cityIds);
}
// Otherwise optimize over cluster hubs
if (state.clusters && typeof state.clusters.keys === "function") return Array.from(state.clusters.keys());
return [];
}

function opt_nodePop(id){
const n = state.nodes?.get(id);
return Math.max(0, Number(n?.population || 0));
}

function opt_distKm(aId, bId){
if (!map || !map.distance) return Infinity;
const a = state.nodes?.get(aId);
const b = state.nodes?.get(bId);
if (!a || !b) return Infinity;
const d = map.distance([Number(a.lat), Number(a.lon)], [Number(b.lat), Number(b.lon)]);
return Number.isFinite(d) ? d / 1000 : Infinity;
}

function opt_colorByIndex(i){
const palette = ["#2b6cff","#10b981","#f59e0b","#ef4444","#a855f7","#06b6d4","#84cc16","#f97316"];
return palette[i % palette.length];
}

function opt_bearingDeg(fromId, toId){
const a = state.nodes?.get(fromId);
const b = state.nodes?.get(toId);
if (!a || !b) return 0;

const lat1 = Number(a.lat) * Math.PI / 180;
const lon1 = Number(a.lon) * Math.PI / 180;
const lat2 = Number(b.lat) * Math.PI / 180;
const lon2 = Number(b.lon) * Math.PI / 180;

const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
const brng = Math.atan2(y, x) * 180 / Math.PI;

return (brng + 360) % 360;
}


function opt_buildLinesForScope(nodeIds){
// Keep it safe: cap extreme sizes
const ids = nodeIds
  .filter(id => state.nodes?.has(id))
  .sort((a,b)=> opt_nodePop(b)-opt_nodePop(a));

if (ids.length < 2) return [];

const MAXN = 120;
const useIds = ids.length > MAXN ? ids.slice(0, MAXN) : ids.slice();

// How many lines to create
const n = useIds.length;
const numLines = clamp(Math.round(Math.sqrt(n)), 2, 12);

const hubs = useIds.slice(0, numLines);
const groups = new Map();
for (const h of hubs) groups.set(h, []);

// Assign each node to nearest hub
for (const id of useIds) {
  let bestHub = hubs[0];
  let bestD = Infinity;
  for (const h of hubs) {
    const d = opt_distKm(id, h);
    if (d < bestD) { bestD = d; bestHub = h; }
  }
  groups.get(bestHub).push(id);
}

// Build route per hub via nearest-neighbor ordering
const lines = [];
let idx = 0;

for (const [hub, members] of groups.entries()) {
  // ensure hub first
  const set = new Set(members);
  set.add(hub);
  const pool = Array.from(set);

  if (pool.length < 2) continue;

  const remaining = pool.filter(x => x !== hub);

  // Order stops by angle around the hub (much less “snake-y”)
  remaining.sort((a, b) => {
    const aa = opt_bearingDeg(hub, a);
    const bb = opt_bearingDeg(hub, b);
    if (aa !== bb) return aa - bb;
    return opt_distKm(hub, a) - opt_distKm(hub, b);
  });

  const route = [hub, ...remaining];


  // Set sensible service params based on group population
  let popSum = 0;
  for (const rid of route) popSum += opt_nodePop(rid);

  const freq = clamp(Math.round(popSum / 3_000_000) + 2, 2, 24);
  const cap = 350; // passenger default (safe)
  const spd = 160;

  const line = {
    id: `L-AUTO-${Date.now().toString(36)}-${idx}`,
    name: `Auto Line ${idx + 1}`,
    type: "passenger",
    color: opt_colorByIndex(idx),
    stops: route,
    circular: false,
    frequencyPerDay: 0,
    carriages: 6,
    speedClass: 'fast',
    departures: [],
    trains: 0
  };
  line.departures = autoGenerateDepartures(line, freq);
  lines.push(line);

  idx++;
}

return lines;
}

function opt_autoBuildNetwork(mode){
const scopeIds = opt_scopeNodeIds();
if (!scopeIds.length) { showToast("No nodes in scope to optimize", "warning"); return; }

if (mode === "replace") {
  const ok = confirm("Replace ALL current lines with an auto-built network?");
  if (!ok) return;
}

const newLines = opt_buildLinesForScope(scopeIds);
if (!newLines.length) { showToast("Optimizer could not build lines (need 2+ nodes)", "warning"); return; }

if (mode === "replace") {
  state.lines.clear();
  state.activeLine = null;
}

for (const l of newLines) {
  // Ensure new-style line model fields are derived/consistent
  if (!Array.isArray(l.departures)) l.departures = [];
  if (!Number.isFinite(Number(l.frequencyPerDay))) l.frequencyPerDay = 0;
  if (!l.speedClass) l.speedClass = (l.type === 'cargo') ? 'medium' : 'fast';
  if (!Number.isFinite(Number(l.carriages))) l.carriages = 6;
  line_recalcDerived(l);
  // trains required comes from departures + runtime
  if (typeof ui_lineRecalcTrainsFromDepartures === 'function') ui_lineRecalcTrainsFromDepartures(l);
  state.lines.set(l.id, l);
}

state.activeLine = newLines[0]?.id || state.activeLine;

renderLines();
dynFlow_render?.(); // if present, refresh moving dots
updateUI();
showToast(`Optimizer applied: ${newLines.length} lines (${mode})`, "success");
}

function opt_boostFrequencies(){
let changed = 0;
for (const l of state.lines.values()){
  if (!l) continue;
  if (!Array.isArray(l.departures)) l.departures = [];
  const curN = l.departures.length;
  const targetN = clamp(Math.ceil(curN * 1.2), 0, 200);
  if (targetN === curN) continue;
  l.departures = makeEvenDepartures(targetN);
  l.frequencyPerDay = 0;
  try { line_recalcDerived(l); } catch(_) {}
  try { if (typeof ui_lineRecalcTrainsFromDepartures === "function") ui_lineRecalcTrainsFromDepartures(l); } catch(_) {}
  changed++;
}
renderLines();
dynFlow_render?.();
updateUI();
showToast(changed ? `Boosted timetables on ${changed} lines` : "No timetables to boost", changed ? "success" : "info");
}


function kv(k, v){ return `<span class="k">${k}:</span> <span class="v">${v}</span>`; }

function renderDynamicsTab(){
const s = state.flowSummary || {};
const dyn = state.dynamics || {};

return `

  <div class="section">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Overlay</div>

    <label style="display:flex;gap:10px;align-items:center;font-weight:900;color:#334155;">
      <input type="checkbox" ${dyn.enabled ? "checked" : ""} onchange="setDynamicsEnabled(this.checked)">
      Enable dynamics
    </label>

    <label style="display:flex;gap:10px;align-items:center;font-weight:900;color:#334155;margin-top:8px;">
      <input type="checkbox" ${dyn.showOverlay ? "checked" : ""} onchange="setDynamicsOverlay(this.checked)">
      Show flow overlay
    </label>

    <div style="margin-top:10px;">
      <div class="k">Mode</div>
      <select class="field" onchange="setDynamicsMode(this.value)">
        <option value="goods" ${dyn.mode==="goods"?"selected":""}>Goods</option>
        <option value="passengers" ${dyn.mode==="passengers"?"selected":""}>Passengers</option>
        <option value="both" ${dyn.mode==="both"?"selected":""}>Both</option>
      </select>
    </div>

    <button class="btn warning" onclick="simulateYear()">Simulate Next Year</button>
  </div>

  <div class="section">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Network Effect (yearly)</div>

    <div style="margin-top:10px; line-height:1.7;">
      ${kv("Demand met", `${Number(s.demandMetPct||0).toFixed(1)}%`)}
      <br>${kv("Goods delivered", fmtNum(s.goodsDelivered||0))}
      <br>${kv("Goods unmet", fmtNum(s.goodsUnmet||0))}
      <br>${kv("Passenger unmet", fmtNum(s.passengerUnmet||0))}
    </div>
  </div>

  <div class="section">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Economy Impact (yearly)</div>

    <div style="margin-top:10px; line-height:1.7;">
      ${kv("Delivered goods €", formatCurrency(s.deliveredGoodsEUR || 0))}
      <br>${kv("Delivered passengers €", formatCurrency(s.deliveredPassengersEUR || 0))}
      <br>${kv("Lost demand €", formatCurrency(s.lostDemandEUR || 0))}
      <br>${kv("Congestion penalty €", formatCurrency(s.congestionPenaltyEUR || 0))}
    </div>
  </div>


  <div class="section">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Biggest Export & Biggest Need</div>

    <div style="margin-top:10px; line-height:1.7;">
      ${kv("Top export", `${s.topExportName || "—"} (${formatCurrency(s.topExportValue||0)})`)}
      <br>${kv("Top need", `${s.topNeedName || "—"} (${formatCurrency(s.topNeedValue||0)})`)}
    </div>

    <div class="hint" style="margin-top:10px;">
      When we add real “goods types”, this becomes a per-good export/need list.
    </div>
  </div>

  <div class="section">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Bottleneck</div>

    <div style="margin-top:10px; line-height:1.7;">
      ${kv("Top bottleneck", `${s.topBottleneck || "—"}`)}
      <br>${kv("Utilization / flow", fmtNum(s.topBottleneckValue||0))}
    </div>
  </div>

<div class="section">
<div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">LUTI Report</div>
<div id="lutiReport"></div>
<div class="hint" style="margin-top:10px;">
  This report summarizes accessibility (and later: monthly population & jobs relocation).
</div>
</div>

<div class="section">
<div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Research controls</div>
<div class="row" style="gap:8px;flex-wrap:wrap;">
  <button class="btn secondary" onclick="ui_runMonths(6)">Run 6 months</button>
  <button class="btn secondary" onclick="ui_runMonths(24)">Run 24 months</button>
  <button class="btn secondary" onclick="exportResultsArtifact()">Export Results</button>
</div>
<div class="hint" style="margin-top:8px;">
  Runs the monthly LUTI update repeatedly (fast) and lets you export an output artifact for papers.
</div>
</div>


`;
}

function ui_fixFieldNames(){
// Only inside the control panel (where your UI is constantly re-rendered)
const root = document.getElementById("controlPanel") || document;

let i = 0;
root.querySelectorAll("input, select, textarea").forEach(el => {
  if (el.type === "hidden") return;
  if (!el.id && !el.name) el.name = `field_${i++}`;
});
}

function ui_renderLutiReport(){
const host = document.getElementById("lutiReport");
if (!host) return;

const access = state?.luti?.accessJobs;
const beta = Number(state?.luti?.beta ?? 0.045);

if (!(access instanceof Map) || access.size === 0){
  host.innerHTML = `
    <div style="font-weight:900;color:#64748b;font-size:12px;line-height:1.4;">
      No accessibility data yet. (It will appear after the first LUTI compute pass.)
    </div>
  `;
  return;
}

const arr = Array.from(access.entries()).map(([id, v]) => ({ id:String(id), v:Number(v||0) }));
arr.sort((a,b)=>b.v-a.v);

const top = arr.slice(0, 6);
const n = arr.length;
const avg = arr.reduce((s,x)=>s+x.v,0) / Math.max(1,n);

host.innerHTML = `
  <div style="font-weight:900;color:#334155;font-size:12px;line-height:1.5;">
    Zones scored: <b>${n}</b><br/>
    β (travel-time sensitivity): <b>${beta}</b><br/>
    Avg access (proxy): <b>${Math.round(avg)}</b>
  </div>
  <div style="margin-top:10px;font-size:12px;color:#64748b;font-weight:900;">
    Top accessibility:
    ${top.map(x => {
      const z = state.nodes?.get?.(x.id);
      const name = z?.name || x.id;
      return `<div>• ${escapeHtml(name)} — <b>${Math.round(x.v)}</b></div>`;
    }).join("")}
  </div>
  <div style="margin-top:10px;font-size:12px;color:#64748b;font-weight:900;">
    Next: monthly relocation (Δpop/Δjobs) will be shown here.
  </div>
`;
}
window.ui_renderLutiReport = ui_renderLutiReport;





function updateUI(){
  const selNode = state.selectedNodeId ? state.nodes.get(state.selectedNodeId) : null;
  const selName = selNode ? (selNode.name || selNode.id) : "—";
  const selIsValid = !!selNode;
  const opDay = network_operatingCostEURPerDay();
  const panel = document.getElementById("controlPanel");
  const linesArr = Array.from(state.lines.values());
  const linesList = linesArr.map(l => `
  <div class="item ${l.id===state.activeLine ? "active" : ""}" onclick="selectLine('${l.id}')">
  <div style="font-weight:1000;color:#0f172a">${l.name}${l.circular ? " ⟳" : ""}</div>
  <div style="font-size:12px;font-weight:900;color:#64748b"> 
  ${l.stops.length} stops • ${l.type} 
  <div class="row" style="margin-top:10px;">
  <button class="btn secondary" onclick="saveGame()">Save</button>
  <button class="btn secondary" onclick="loadGame()">Load</button>
  </div>

      </div>
    </div>
  `).join("");
  const lineOptions = [
`<option value="" ${!state.activeLine ? "selected" : ""}>(No line selected — Inspect)</option>`,
...linesArr.map(l => `<option value="${l.id}" ${l.id===state.activeLine ? "selected" : ""}>${l.name} • ${l.type}</option>`)
].join("");

const scenHashBadge =
state.scenarioHash ? ` <span class="badge">hash:${state.scenarioHash.slice(0,8)}</span>` : "";
const activeLineObj = state.activeLine ? state.lines.get(state.activeLine) : null;
const activeLineColor = (activeLineObj && activeLineObj.color) ? activeLineObj.color : "#2b6cff";
const scenTitle =
(state.scenarioMeta && state.scenarioMeta.title)
  ? ` • <span class="badge">${state.scenarioMeta.title}</span>`
  : "";
  const activeCluster = state.activeClusterId ? state.clusters.get(state.activeClusterId) : null;

  const econ = state.economy || {};
  const exporterName = econ.biggestExporter?.id ? (state.nodes.get(econ.biggestExporter.id)?.name || econ.biggestExporter.id) : "—";
  const importerName = econ.biggestImporter?.id ? (state.nodes.get(econ.biggestImporter.id)?.name || econ.biggestImporter.id) : "—";

  // --- Score (0..100): UI-only, robust defaults ---
  const ssum = state.flowSummary || {};
  const _lines = (state.lines instanceof Map) ? Array.from(state.lines.values()) : [];
  const _tracks = (state.tracks instanceof Map) ? Array.from(state.tracks.values()) : [];
  const _nodes = (state.nodes instanceof Map) ? state.nodes : new Map();

  // service capacity proxy (cap/day)
  let _capPerDay = 0;
  for (const l of _lines) {
    const f = Math.max(0, Number(l.frequencyPerDay || 0));
    const c = Math.max(0, Number(l.vehicleCapacity || 0));
    _capPerDay += f * c;
  }

  // network size proxy (track km)
  let _trackKm = 0;
  if (map && map.distance && _tracks.length) {
    for (const t of _tracks) {
      const a = _nodes.get(t.from);
      const b = _nodes.get(t.to);
      if (!a || !b) continue;

      const d = map.distance(
        [Number(a.lat), Number(a.lon)],
        [Number(b.lat), Number(b.lon)]
      );
      if (Number.isFinite(d)) _trackKm += d / 1000;
    }
  }

  const _demandMet = clamp(Number(ssum.demandMetPct || 0), 0, 100);

  const _deliveredEUR = Math.max(
    0,
    Number(ssum.deliveredGoodsEUR || 0) + Number(ssum.deliveredPassengersEUR || 0)
  );
  const _congEUR = Math.max(0, Number(ssum.congestionPenaltyEUR || 0));
  const _penRate = _deliveredEUR > 0 ? clamp(_congEUR / _deliveredEUR, 0, 1) : 0;
  const _reliability = Math.round(100 * (1 - _penRate));

  // profit score (smooth, handles negatives)
  const _profit = Number(state.profit || 0);
  const _profitScore = Math.round(50 + 50 * Math.tanh(_profit / 200000000)); // ±€200M scale

  // service score (log-scaled so it doesn't explode)
  const _serviceScore = Math.round(clamp(
    12 * Math.log10(1 + (_capPerDay / 1000)) +
    18 * Math.log10(1 + (_trackKm / 50)),
    0, 100
  ));

  const _totalScore = Math.round(clamp(
    0.30 * _profitScore +
    0.30 * _demandMet +
    0.25 * _serviceScore +
    0.15 * _reliability,
    0, 100
  ));

  const _scoreColor = _totalScore >= 70 ? "#10b981" : (_totalScore >= 45 ? "#f59e0b" : "#ef4444");

  const scorePanelHtml = `
    <div class="hint" style="margin-top:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-weight:1000;color:#0f172a;">Score</div>
        <div style="font-weight:1000;color:${_scoreColor};font-size:18px;">${_totalScore}/100</div>
      </div>

      <div style="height:8px;"></div>
      <div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
        <div style="height:10px;width:${_totalScore}%;background:${_scoreColor};"></div>
      </div>

      <div style="margin-top:10px;line-height:1.7;">
        ${kv("Profit score", fmtNum(_profitScore))}
        <br>${kv("Demand met", `${_demandMet.toFixed(1)}%`)}
        <br>${kv("Service score", fmtNum(_serviceScore))}
        <br>${kv("Reliability", `${fmtNum(_reliability)}%`)}
      </div>

      <div style="margin-top:8px;color:#64748b;font-weight:850;font-size:12px;">
        Score = weighted mix of profit, demand met, service capacity×network size, and congestion reliability.
      </div>
    </div>
  `;


  // --- Line effectiveness ranking (capacity-km/day) ---
  const lineEffect = [];
  for (const l of linesArr) {
    const stops = Array.isArray(l.stops) ? l.stops : [];
    if (stops.length < 2) continue;

    const freq = Math.max(0, Number(l.frequencyPerDay || 0));
    const defaultCap = (l.type === "cargo") ? 1200 : (l.type === "mixed") ? 700 : 350;
    const vehCap = Math.max(0, Number(l.vehicleCapacity || defaultCap));

    let km = 0;
    if (map && state.nodes) {
      for (let i = 1; i < stops.length; i++) {
        const a = state.nodes.get(stops[i - 1]);
        const b = state.nodes.get(stops[i]);
        if (!a || !b) continue;

        const d = map.distance(
          [Number(a.lat), Number(a.lon)],
          [Number(b.lat), Number(b.lon)]
        );
        if (Number.isFinite(d)) km += d / 1000;
      }

      // if circular, close the loop for length estimation
      if (l.circular && stops.length >= 3) {
        const a = state.nodes.get(stops[stops.length - 1]);
        const b = state.nodes.get(stops[0]);
        if (a && b) {
          const d = map.distance(
            [Number(a.lat), Number(a.lon)],
            [Number(b.lat), Number(b.lon)]
          );
          if (Number.isFinite(d)) km += d / 1000;
        }
      }
    }

    const capKmPerDay = km * freq * vehCap;

    lineEffect.push({
      id: l.id,
      name: l.name || l.id,
      type: l.type || "passenger",
      color: l.color || "#2b6cff",
      km,
      freq,
      vehCap,
      capKmPerDay
    });
  }

  lineEffect.sort((a, b) => (b.capKmPerDay || 0) - (a.capKmPerDay || 0));
  const topLines = lineEffect.slice(0, 8);

  const lineRankingHtml = topLines.length ? topLines.map(r => `
    <div class="item" onclick="selectLine('${r.id}')">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span style="width:12px;height:12px;border-radius:4px;flex:0 0 12px;background:${r.color};border:1px solid rgba(0,0,0,0.2);"></span>
          <div style="font-weight:1000;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.name}</div>
          <span class="badge">${r.type}</span>
        </div>
        <div style="font-weight:1000;color:#0f172a;white-space:nowrap;">${fmtNum(Math.round((r.capKmPerDay || 0) / 1000))}k</div>
      </div>
      <div style="margin-top:4px;font-size:12px;font-weight:900;color:#64748b;">
        ${(Number.isFinite(r.km) ? r.km : 0).toFixed(1)} km • ${fmtNum(Math.round(r.freq || 0))}/day • cap ${fmtNum(Math.round(r.vehCap || 0))}
      </div>
    </div>
  `).join("") : `
    <div style="padding:12px;color:#64748b;font-weight:1000;">
      Create a line with 2+ stops to see rankings.
    </div>
  `;


  // --- Network KPIs (UI-only; safe defaults) ---
  const tracksCount = state.tracks?.size || 0;
  const nodesCount = state.nodes?.size || 0;
  const linesCount = linesArr.length;

  let totalTrainsPerDay = 0;
  let totalCapacityPerDay = 0;
  let totalStops = 0;

  const stationMoves = new Map(); // nodeId -> trains/day (sum of frequencies)
  for (const l of linesArr) {
    const f = Math.max(0, Number(l.frequencyPerDay || 0));
    totalTrainsPerDay += f;
    totalCapacityPerDay += f * Math.max(0, Number(l.vehicleCapacity || 0));
    totalStops += Array.isArray(l.stops) ? l.stops.length : 0;

    if (Array.isArray(l.stops)) {
      for (const sid of l.stops) {
        stationMoves.set(sid, (stationMoves.get(sid) || 0) + f);
      }
    }
  }

  const avgStopsPerLine = linesCount ? (totalStops / linesCount) : 0;

  let busiestStationId = null;
  let busiestMoves = 0;
  for (const [sid, mv] of stationMoves.entries()) {
    if (mv > busiestMoves) { busiestMoves = mv; busiestStationId = sid; }
  }
  const busiestStationName = busiestStationId && state.nodes?.get(busiestStationId)
    ? (state.nodes.get(busiestStationId).name || busiestStationId)
    : "—";

  let trackKm = 0;
  if (map && state.tracks && typeof state.tracks.values === "function") {
    for (const t of state.tracks.values()) {
      const a = state.nodes?.get(t.from);
      const b = state.nodes?.get(t.to);
      if (!a || !b) continue;

      const d = map.distance(
        [Number(a.lat), Number(a.lon)],
        [Number(b.lat), Number(b.lon)]
      );
      if (Number.isFinite(d)) trackKm += d / 1000;
    }
  }


  panel.innerHTML = `
    <div class="section">
      <h3 class="title">Railway Network Simulator</h3>
      <p class="sub">
Year: <b>${state.year}</b> • Budget: <b>${formatCurrency(state.budget)}</b> • Op/day: <b>${formatCurrency(opDay)}</b>
${activeCluster ? `<span class="badge">In: ${activeCluster.hubName}</span>` : `<span class="badge">Spain</span>`}
${scenTitle}
</p>




    <div class="tabs">
<div class="tab ${state.activeTab==="network"?"active":""}" onclick="switchTab('network')">Network</div>
<div class="tab ${state.activeTab==="tracks"?"active":""}" onclick="switchTab('tracks')">Tracks</div>
<div class="tab ${state.activeTab==="economy"?"active":""}" onclick="switchTab('economy')">Economy</div>
<div class="tab ${state.activeTab==="dynamics"?"active":""}" onclick="switchTab('dynamics')">Dynamics</div>
</div>
    </div>
    ${state.activeTab==="network" ? `
      <div class="section">
        <div class="hint">
          <b>Clusters are dots:</b> left-click selects, right-click zooms in.<br>
          <b>Smart lines:</b> stops are auto-ordered to reduce criss-cross, and tracks are auto-built between stops.
        </div>

        <button class="btn success" onclick="simulateYear()">Simulate Next Year</button>
<button class="btn secondary" onclick="exportScenario()">Export Scenario</button>
<button class="btn secondary" onclick="undo_applyLast()">Undo last action</button>
<button class="btn secondary" onclick="exportResultsArtifact()">Export Results</button>
<button class="btn secondary" onclick="ui_pickResultsImport()">Import Results</button>
<input type="file" id="resultsImportFile" name="resultsImportFile" accept="application/json" style="display:none" onchange="ui_importResultsFile(this.files && this.files[0])">

      </div>

      <div class="section">
        <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Create Line</div>
        <input name="lineName" class="field" placeholder="Line name" />
        <div style="height:8px"></div>
        <select id="lineType" class="field">
          <option value="passenger">Passenger</option>
          <option value="cargo">Cargo</option>
          <option value="mixed">Mixed</option>
        </select>

        <div style="height:8px"></div>
        <div class="row">
          <input name="lineCars" name="lineCars" class="field" type="number" min="1" max="50" step="1" placeholder="Carriages (e.g. 6)">
          <select name="lineSpeedClass" name="lineSpeedClass" class="field">
            <option value="small">Small (60 km/h)</option>
            <option value="medium">Medium (90 km/h)</option>
            <option value="fast" selected>Fast (120 km/h)</option>
            <option value="high">High speed (200 km/h)</option>
            <option value="bullet">Bullet (300 km/h)</option>
          </select>
        </div>

<div class="row">
<input name="lineCarriages" class="field" type="number" min="1" max="50" step="1" placeholder="Carriages (e.g. 6)" value="6">
<select name="lineSpeedClass" class="field">
  <option value="small">small</option>
  <option value="medium" selected>medium</option>
  <option value="fast">fast</option>
  <option value="high">high</option>
  <option value="bullet">bullet</option>
</select>
</div>

<div style="height:8px"></div>
<div class="hint">
Timetable controls departures. (No more “trips/day” here.)
</div>


        <div style="height:8px"></div>
        <label style="display:flex;gap:10px;align-items:center;font-weight:900;color:#334155;">
          <input name="lineCircular" type="checkbox" />
          Circular line
        </label>

        <button class="btn" onclick="createNewLine()">Create Line</button>
      </div>

<button class="btn secondary" onclick="toggleLineBuildMode()">
${state.lineBuildMode ? "Add Stops: ON" : "Add Stops: OFF"}
</button>

${state.selectedNode ? (() => {
const st = getStation(state.selectedNode.id);
const cP = stationUpgradeCost("platforms", st);
const cA = stationUpgradeCost("amenities", st);
const cR = stationUpgradeCost("retail", st);
 const p = state.stationPressure.get(String(state.selectedNode.id)) || { demand: 0, supply: 0, pressurePct: 0 };


return `
  <div class="section">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Station: ${state.selectedNode.name}</div>
    <div class="hint" style="line-height:1.7;">
      ${kv("Level", fmtNum(st.level))}
      <br>${kv("Platforms", fmtNum(st.platforms))}
      <br>${kv("Amenities", fmtNum(st.amenities))}
      <br>${kv("Retail", fmtNum(st.retail))}
    </div>

<div class="hint" style="margin-top:8px; line-height:1.7;">
${kv(
  "Pressure",
  `<b style="color:${
    p.pressurePct >= 70 ? "#ef4444" :
    p.pressurePct >= 35 ? "#f59e0b" :
                          "#10b981"
  }">${p.pressurePct}%</b>`
)}
<br>${kv("Demand / day", fmtNum(Math.round(p.demand || 0)))}
<br>${kv("Supply / day", fmtNum(Math.round(p.supply || 0)))}
</div>


    <div class="row" style="margin-top:10px;">
      <button class="btn secondary" onclick="upgradeStation('platforms')">+ Platform (${formatCurrency(cP)})</button>
      <button class="btn secondary" onclick="upgradeStation('amenities')">+ Amenities (${formatCurrency(cA)})</button>
    </div>
    <button class="btn secondary" onclick="upgradeStation('retail')">+ Retail (${formatCurrency(cR)})</button>

    <div class="hint" style="margin-top:10px;">
      Platforms will later increase how many trains can be handled without “delay”.
      Amenities reduce crowd pressure.
      Retail generates yearly rent revenue.
    </div>
  </div>
`;
})() : ""}

      <div class="section">
        <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Quick actions</div>

        <div class="hint">
          <div>${kv("Selected", selIsValid ? selName : "—")}</div>
        </div>

        <div class="row" style="margin-top:10px;">
          <button class="btn secondary" onclick="ui_centerOnSelected()" ${selIsValid ? "" : "disabled"}>Center</button>
          <button class="btn secondary" onclick="ui_startLineAtSelected()" ${selIsValid ? "" : "disabled"}>Start line here</button>
        </div>

        <div class="row" style="margin-top:10px;">
          <button class="btn secondary" onclick="ui_toggleAddStops()" ${state.activeLine ? "" : "disabled"}>${state.lineBuildMode ? "Stop adding stops" : "Add stops to active line"}</button>
          <button class="btn secondary" onclick="selectLine('')">No line selected</button>
        </div>
      </div>


<div class="section">
<div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Lines</div>

<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
<div style="font-weight:1000;color:#0f172a;">Active line</div>
${activeLineObj ? `
  <button class="btn secondary" style="width:auto;padding:8px 10px;margin-top:0;"
    onclick="selectLine('')">No line selected</button>
` : `
  <span class="badge">No line selected</span>
`}
</div>


  <div style="height:8px"></div>

  <select class="field" onchange="selectLine(this.value)">
    ${lineOptions}
  </select>

<div style="height:10px"></div>

<div class="lineInspectorGrid">
<div class="liField">
  <div class="liLabel">Color</div>
  <input
    type="color"
    value="${activeLineColor}"
    ${activeLineObj ? "" : "disabled"}
    onchange="setActiveLineColor(this.value)"
    style="width:100%;height:38px;border:2px solid #e2e8f0;border-radius:10px;background:transparent;padding:4px;cursor:pointer;"
  />
</div>

<div class="liField">
  <div class="liLabel">Carriages</div>
  <input class="field" type="number" name="carriages" min="1" max="50" step="1"
    value="${activeLineObj ? (activeLineObj.carriages || 1) : 1}"
    ${activeLineObj ? "" : "disabled"}
    onchange="setActiveLineCarriages(this.value)"
  />
</div>

<div class="liField">
  <div class="liLabel">Speed</div>
  <select class="field" name="speedClass"
    ${activeLineObj ? "" : "disabled"}
    onchange="setActiveLineSpeedClass(this.value)">
    ${["small","medium","fast","high","bullet"].map(k =>
      `<option value="${k}" ${(activeLineObj && activeLineObj.speedClass===k) ? "selected" : ""}>${k}</option>`
    ).join("")}
  </select>
</div>
</div>

<div class="row" style="margin-top:10px;">
<div style="font-weight:900;color:#334155;">Dwell / stop (sec)</div>
<input class="field" name="dwellSec" type="number" min="0" step="5"
  value="${Number(activeLineObj?.dwellSec ?? 60)}"
  ${activeLineObj ? "" : "disabled"}
  onchange="ui_lineSetDwellSec(this.value)">
</div>

<div style="margin-top:8px;color:#64748b;font-weight:850;font-size:12px;line-height:1.35;">
${activeLineObj ? (() => {
  try { line_recalcDerived(activeLineObj); } catch(_) {}
  const pax = Number(activeLineObj.capacityPax || 0);
  const cargo = Number(activeLineObj.capacityCargo || 0);
  const kmh = Number(activeLineObj.speedKmh || 0);
  const maint = line_trainMaintenanceCostEURPerYear(activeLineObj);
  const lineCostDay = line_operatingCostEURPerDay(activeLineObj);
  const capTxt = (activeLineObj.type==="cargo") ? `Capacity: <b>${fmtNum(cargo)}</b> cargo units` :
                 (activeLineObj.type==="mixed") ? `Capacity: <b>${fmtNum(pax)}</b> pax + <b>${fmtNum(cargo)}</b> cargo` :
                 `Capacity: <b>${fmtNum(pax)}</b> pax`;
  return `${capTxt} • Speed: <b>${Math.round(kmh)}</b> km/h • Fleet maintenance: <b>${formatCurrency(maint)}</b>/year • Line Cost (day): <b>${kv("Op cost/day", formatCurrency(lineCostDay))}</b>
` ;
})() : "Select a line to edit carriages and speed."}
</div>

${activeLineObj ? (() => {
const m = line_calcDerivedMetrics(activeLineObj);

const fmt = (x, suf="") => (x==null || !isFinite(x)) ? "—" : `${(x>=100 ? Math.round(x) : x.toFixed(1))}${suf}`;

return `
  <div class="section" style="margin-top:10px;">
    <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Derived metrics</div>
    <div style="line-height:1.7;">
      ${kv("Planned departures", fmtNum(m.plannedDepartures))}
      <br>${kv("Avg headway", `${fmt(m.headwayMin, " min")}`)}
      <br>${kv("Service window", `${fmt(m.serviceWindowMin, " min")}`)}
      <br>${kv("One-way travel", `${fmt(m.oneWayMin, " min")}`)}
      <br>${kv("Round trip", `${fmt(m.roundTripMin, " min")}`)}
      <br>${kv("Required trains", m.requiredTrains==null ? "—" : fmtNum(m.requiredTrains))}
    </div>
  </div>
`;
})() : ""}



  <div style="margin-top:8px;color:#64748b;font-weight:850;font-size:12px;">
    Tip: choose “No line selected” to click nodes without adding stops.
  </div>
</div>

<div class="list">${linesList || `<div style="padding:14px;color:#64748b;font-weight:1000;">No lines yet</div>`}</div>

<div class="row" style="margin-top:10px;">
  <button class="btn secondary" onclick="toggleCircularActive()">Toggle circular</button>
  <button class="btn danger" onclick="deleteActiveLine()">Delete line</button>
</div>
${ui_lineSchedulePanelHtml()}
</div>

<div class="row" style="margin-top:10px;">
<div style="font-weight:900;color:#334155;">Operating hours</div>
<div style="display:flex;gap:8px;">
<input class="field" type="time"
value="${minToHHMM(activeLineObj?.serviceStartMin ?? 330)}"
${activeLineObj ? "" : "disabled"}
onchange="ui_lineSetServiceStart(this.value)">
<span style="font-weight:900;">→</span>
<input class="field" type="time"
value="${minToHHMM(activeLineObj?.serviceEndMin ?? 1380)}"
${activeLineObj ? "" : "disabled"}
onchange="ui_lineSetServiceEnd(this.value)">
</div>
</div>

<div class="row" style="margin-top:6px;">
<label style="display:flex;gap:8px;align-items:center;">
  <input type="checkbox"
${activeLineObj?.nightService ? "checked" : ""}
${activeLineObj ? "" : "disabled"}
onchange="ui_lineToggleNight(this.checked)">
  <span style="font-weight:900;color:#334155;">Night service</span>
</label>
</div>

${activeLineObj?.nightService ? `
<div class="row" style="margin-top:6px;">
<div style="font-weight:900;color:#334155;">Night headway (min)</div>
<input class="field" type="number" min="15" step="5"
  value="${activeLineObj.nightHeadwayMin}"
  onchange="ui_lineSetNightHeadway(this.value)">
</div>
` : ""}

<div class="section">
<div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Scenario</div>

<input name="scenarioFile" class="field" type="file" accept="application/json" />
<div style="height:8px"></div>
<button class="btn secondary" onclick="ui_importScenario()">Import scenario JSON</button>
</div>



    ` : ""}

    ${state.activeTab==="tracks" ? `
      <div class="section">
        <div class="hint">
          Track mode chain-builds: A→B, then B→C automatically.<br>
          Tracks are drawn in <b>black</b>. Lane count is shown as a <b>white number</b>.
        </div>

        <button class="btn ${state.trackBuildMode ? "warning" : "success"}"
          onclick="setTrackBuildMode(${!state.trackBuildMode})">
          ${state.trackBuildMode ? "Track Mode: ON" : "Track Mode: OFF"}
        </button>

        <div style="margin-top:10px;">
          <div class="k">Lanes</div>
          <select class="field" onchange="setTrackLanes(this.value)">
            <option value="1" ${state.pendingTrackLanes===1?"selected":""}>1 lane</option>
            <option value="2" ${state.pendingTrackLanes===2?"selected":""}>2 lanes</option>
            <option value="3" ${state.pendingTrackLanes===3?"selected":""}>3 lanes</option>
            <option value="4" ${state.pendingTrackLanes===4?"selected":""}>4 lanes</option>
            <option value="5" ${state.pendingTrackLanes===5?"selected":""}>5 lanes</option>
            <option value="6" ${state.pendingTrackLanes===6?"selected":""}>6 lanes</option>
          </select>
        </div>

        <div class="hint" style="margin-top:10px;">
          Current start node: <b>${state.pendingTrackNode ? state.pendingTrackNode.name : "—"}</b>
        </div>
<button class="btn secondary" onclick="undo_applyLast()">Undo last action</button>

        <button class="btn danger" onclick="clearAllTracks()">Clear ALL tracks</button>
      </div>
    ` : ""}

    ${state.activeTab==="economy" ? `
      <div class="section">
        <div class="hint">
          Economy now uses <b>flows</b> (passenger-km & ton-km) limited by <b>service capacity</b> (freq × vehicle capacity) and <b>track capacity</b> (lanes).
        </div>
<div style="margin-top:10px;" class="hint">
<div style="font-weight:1000;color:#0f172a;margin-bottom:6px;">Network KPIs</div>
<div>${kv("Stations loaded", fmtNum(nodesCount))}</div>
<div>${kv("Tracks built", fmtNum(tracksCount))}</div>
<div>${kv("Track length", fmtNum(Number(trackKm.toFixed(1))) + " km")}</div>
<div>${kv("Lines", fmtNum(linesCount))}</div>
<div>${kv("Trains/day", fmtNum(Math.round(totalTrainsPerDay)))}</div>
<div>${kv("Capacity/day", fmtNum(Math.round(totalCapacityPerDay)))}</div>
<div>${kv("Avg stops/line", fmtNum(Number(avgStopsPerLine.toFixed(1))))}</div>
<div>${kv("Busiest station", busiestStationName==="—" ? "—" : (busiestStationName + " (" + fmtNum(Math.round(busiestMoves)) + "/day)"))}</div>
</div>

        <div style="margin-top:10px;">
          <div>${kv("Annual revenue", formatCurrency(state.revenue))}</div>
          <div>${kv("Annual costs", formatCurrency(state.costs))}</div>
          <div>${kv("Annual profit", `<span style="color:${state.profit>=0?"#10b981":"#ef4444"}">${formatCurrency(state.profit)}</span>`)}</div>
        </div>

${scorePanelHtml}

        <div style="margin-top:10px;" class="hint">
          <div>${kv("Passenger-km moved", fmtNum(Math.round(econ.paxKmMoved || 0)))}</div>
          <div>${kv("Cargo ton-km moved", fmtNum(Math.round(econ.tonKmMoved || 0)))}</div>
          <div>${kv("Biggest exporter", `${exporterName} (${formatCurrency(econ.biggestExporter?.exports || 0)})`)}</div>
          <div>${kv("Biggest needs", `${importerName} (${formatCurrency(econ.biggestImporter?.imports || 0)})`)}</div>
        </div>

        <div style="margin-top:12px;">
          <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Most effective lines</div>
          <div class="list" style="max-height:240px;">${lineRankingHtml}</div>
          <div style="margin-top:8px;color:#64748b;font-weight:850;font-size:12px;">
            Effectiveness = route km × trains/day × vehicle capacity (capacity-km/day). Click a line to select it.
          </div>
        </div>

        <div style="margin-top:12px;" class="section">
          <div style="font-weight:1000;color:#0f172a;margin-bottom:8px;">Optimizer (beta)</div>

          <div class="hint">
            Builds a network automatically over the current scope:
            <b>clusters</b> when zoomed out, or <b>cities</b> when inside a cluster.
            <br>“Replace” will overwrite your current lines.
          </div>

          <div class="row" style="margin-top:10px;">
            <button class="btn secondary" onclick="opt_autoBuildNetwork('add')">Auto-build (Add)</button>
            <button class="btn danger" onclick="opt_autoBuildNetwork('replace')">Auto-build (Replace)</button>
          </div>

          <button class="btn secondary" onclick="opt_boostFrequencies()">Boost frequencies (+20%)</button>
        </div>



        <button class="btn warning" onclick="simulateYear()">Simulate Next Year</button>
      </div>


    ` : ""}
${state.activeTab==="dynamics" ? renderDynamicsTab() : ""}
  `;

  // Post-render fixes: prevent Chrome autofill warnings and keep small widgets in sync
  try { ui_fixFieldNames(); } catch(_) {}
  try { ui_updateActiveTrainsCount(); } catch(_) {}
  try { ui_renderLineDiagram(); } catch(_) {}
  try { uiMode_render(); } catch(_) {}
  try { ui_renderLineLegend(); } catch(_) {}
  try { if (state.activeTab === "dynamics") ui_renderLutiReport(); } catch(_) {}
}

window.updateUI = updateUI;

function ensureDefaultTestLine(){
// If there are already lines (or a save was loaded), do nothing.
if (state.lines.size > 0) return;

// Use clusters (works zoomed out) – pick a few big ones
const clusters = Array.from(state.clusters.values())
  .slice()
  .sort((a,b) => (Number(b.population||0) - Number(a.population||0)))
  .slice(0, 6);

if (clusters.length < 2) return;

// Order them west->east to make a nicer looking first line
clusters.sort((a,b) => (Number(a.lon||0) - Number(b.lon||0)));

const id = addLine("Test Line", "passenger", false, {
  frequencyPerDay: 6,
  vehicleCapacity: 220,
  speedKmh: 180
});

const line = state.lines.get(id);
if (!line) return;

line.stops = clusters.slice(0, 4).map(c => String(c.id));

state.activeLine = id;
renderLines();
updateUI();
ui_renderLineLegend();
uiMode_render();
uihotkeys_install();

}

let hoverTip = null;

function hoverTipEnsure(){
if (hoverTip) return hoverTip;
hoverTip = L.tooltip({
  permanent: false,
  direction: "top",
  opacity: 0.95,
  offset: [0, -10],
  className: "node-hover-tip"
});
return hoverTip;
}

function getNodeLineCount(nodeId){
let c = 0;
for (const l of state.lines.values()){
  if (Array.isArray(l.stops) && l.stops.includes(nodeId)) c++;
}
return c;
}

function getNodeTrackStats(nodeId){
let edges = 0;
let lanes = 0;
for (const t of state.tracks.values()){
  if (t.from === nodeId || t.to === nodeId) {
    edges++;
    lanes += Math.max(0, Number(t.lanes || 0));
  }
}
return { edges, lanes };
}

function showNodeHover(nodeId, lat, lon){
const n = state.nodes.get(nodeId);
if (!n || !map) return;

const pop = Math.max(0, Number(n.population || 0));
const lc = getNodeLineCount(nodeId);
const ts = getNodeTrackStats(nodeId);

let html = `
  <div style="font-weight:1000;color:#0f172a;">${n.name || nodeId}</div>
  <div style="font-weight:900;color:#334155;font-size:12px;line-height:1.4;">
    Pop: ${fmtNum(pop)}<br/>
    Tracks: ${fmtNum(ts.edges)} (lanes ${fmtNum(ts.lanes)})<br/>
    Lines: ${fmtNum(lc)}
  </div>
`;

const tip = hoverTipEnsure();
tip.setLatLng([lat, lon]);
tip.addTo(map);

const acc = (state.luti && state.luti.accessJobs && state.luti.accessJobs.get(nodeId)) || 0;
const tops = luti_topContributors(nodeId, 5);

html += `
<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(15,23,42,0.08);">
  <div style="font-weight:1000;color:#0f172a;">Accessibility</div>
  <div style="font-weight:900;color:#334155;font-size:12px;line-height:1.4;">
    Jobs access (proxy): <b>${fmtNum(acc)}</b><br/>
    β: ${(state.luti && state.luti.beta) || 0.045}
  </div>
  <div style="margin-top:6px;font-size:12px;color:#64748b;font-weight:900;">
    Top contributors:
    ${tops.map(t => `
      <div>• ${escapeHtml(t.name)} — ${fmtNum(t.jobsProxy)} / ${Math.round(t.t)}m</div>
    `).join("")}
  </div>
</div>
`;

tip.setContent(html);
}

function hideNodeHover(){
if (!hoverTip || !map) return;
try { map.removeLayer(hoverTip); } catch(_) {}
}
