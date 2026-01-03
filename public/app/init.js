// ======================
// Init
// ======================
async function boot(){
  initMap();

  const cities = await loadJSON("./cities_es.json");
  state.cities = Array.isArray(cities) ? cities : (Array.isArray(cities?.cities) ? cities.cities : cities);

  buildClusters(state.cities);
  renderClusterMarkers();
  ensureDefaultTestLine();

  syncMarkerVisibility();
  updateClusterBar();
  updateUI();
  clock_start();
  luti_computeAccessibility();
  showToast(`Loaded cities: ${fmtNum(state.cities.length)} • clusters: ${fmtNum(state.clusters.size)}`, "success");
}

// expose globals for inline onclick
window.switchTab = switchTab;
window.simulateYear = simulateYear;
window.setTrackBuildMode = setTrackBuildMode;
window.setTrackLanes = setTrackLanes;
window.createNewLine = createNewLine;
window.selectLine = selectLine;
window.setActiveLineColor = setActiveLineColor;
window.setActiveLineCarriages = setActiveLineCarriages;
window.setActiveLineSpeedClass = setActiveLineSpeedClass;
window.toggleCircularActive = toggleCircularActive;
window.toggleLineBuildMode = toggleLineBuildMode;
window.deleteActiveLine = deleteActiveLine;
window.clearAllTracks = clearAllTracks;
window.upgradeStation = upgradeStation;
window.opt_autoBuildNetwork = opt_autoBuildNetwork;
window.opt_boostFrequencies = opt_boostFrequencies;
window.undo_applyLast = undo_applyLast;
window.ui_centerOnSelected = ui_centerOnSelected;
window.ui_startLineAtSelected = ui_startLineAtSelected;
window.ui_toggleAddStops = ui_toggleAddStops;
window.ui_centerOnNodeId = ui_centerOnNodeId;



function setDynamicsEnabled(on){
state.dynamics.enabled = !!on;
updateUI();
showToast(state.dynamics.enabled ? "Dynamics enabled" : "Dynamics disabled", "info");
dynFlow_render();
}

function setDynamicsOverlay(on){
state.dynamics.showOverlay = !!on;
updateUI();
showToast(state.dynamics.showOverlay ? "Overlay ON" : "Overlay OFF", "info");
dynFlow_render();
}

function setDynamicsMode(mode){
state.dynamics.mode = mode;
updateUI();
showToast(`Mode: ${mode}`, "info");
dynFlow_render();
}

window.setDynamicsEnabled = setDynamicsEnabled;
window.setDynamicsOverlay = setDynamicsOverlay;
window.setDynamicsMode = setDynamicsMode;


boot().catch(err => {
  console.error(err);
  showToast("Failed to load data files", "error");
  document.getElementById("controlPanel").innerHTML = `
    <div class="section">
      <h3 class="title">Load error</h3>
      <div class="hint">
        ${String(err)}<br><br>
        Make sure these files sit next to <code>index.html</code>:<br>
        • <b>cities_es.json</b><br>
        • <b>economy.js</b><br><br>
        Run a local server, e.g. <code>python -m http.server 8000</code>
      </div>
    </div>
  `;
});

function saveGame(){
const data = {
  year: state.year,
  budget: state.budget,
  revenue: state.revenue,
  costs: state.costs,
  profit: state.profit,
  activeClusterId: state.activeClusterId,

  // tracks + lines are Maps, convert to arrays
  tracks: Array.from(state.tracks.values()).map(t => ({
    id: t.id, from: t.from, to: t.to, lanes: t.lanes
  })),
  lines: Array.from(state.lines.values()).map(l => ({
    id: l.id, name: l.name, type: l.type, color: l.color,
    stops: l.stops, circular: l.circular
  }))
};

localStorage.setItem("railSimSave", JSON.stringify(data));
showToast("Saved!", "success");
}

function loadGame(){
const raw = localStorage.getItem("railSimSave");
if (!raw) { showToast("No save found", "warning"); return; }

const data = JSON.parse(raw);

state.year = data.year ?? state.year;
state.budget = data.budget ?? state.budget;
state.revenue = data.revenue ?? 0;
state.costs = data.costs ?? 0;
state.profit = data.profit ?? 0;
state.activeClusterId = data.activeClusterId ?? null;

// clear visuals + state
layers.tracks.clearLayers();
layers.lines.clearLayers();
state.tracks.clear();
state.lines.clear();

// rebuild tracks (visual + state)
for (const t of (data.tracks || [])) addTrack(t.from, t.to, t.lanes || 1);

// rebuild lines
for (const l of (data.lines || [])) {
  state.lines.set(l.id, {
    id: l.id, name: l.name, type: l.type, color: l.color,
    stops: Array.isArray(l.stops) ? l.stops : [],
    circular: !!l.circular,
    cursorStopId: null
  });
}

// set active line if any
const firstLine = Array.from(state.lines.keys())[0] || null;
state.activeLine = firstLine;

// restore cluster view if needed
if (state.activeClusterId) {
  const cl = state.clusters.get(state.activeClusterId);
  if (cl) map.fitBounds(cl.bounds.pad(0.25), { maxZoom: 11 });
} else {
  map.setView(CONFIG.SPAIN_VIEW.center, CONFIG.SPAIN_VIEW.zoom);
}

trainVis_clearAll();
renderLines();
syncMarkerVisibility();
updateClusterBar();
updateUI();
showToast("Loaded!", "success");
}

Object.assign(window, {
ui_lineDiagram_stopClick,
});

// expose to onclick buttons
window.saveGame = saveGame;
window.loadGame = loadGame;
