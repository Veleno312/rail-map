/* eslint-disable no-undef, no-unused-vars, no-empty */
// ======================
// Init
// ======================
function getSavedCountryId(){
  try {
    const stored = localStorage.getItem("railSimCountry");
    if (stored) return stored;
  } catch (_) {}

  try {
    const raw = localStorage.getItem("railSimSave");
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.countryId) return data.countryId;
    }
  } catch (_) {}
  return null;
}

async function tryLoadJson(url){
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function loadDataOverrides(){
  if (state.dataOverridesLoaded) return state.dataOverrides || null;
  const ds = window.datasetVersion || "0.0.0";
  const candidates = [
    "./data/overrides.json",
    `./data/raw/${ds}/overrides.json`,
    `./data/raw/${ds}/app_overrides.json`
  ];
  let data = null;
  for (const url of candidates){
    const res = await tryLoadJson(url);
    if (res && typeof res === "object") {
      data = res;
      state.dataOverridesSource = url;
      break;
    }
  }
  state.dataOverrides = data;
  state.dataOverridesLoaded = true;
  return data;
}

function resolveOverride(spec, overrides, key){
  const cid = spec && spec.id ? String(spec.id) : null;
  const scoped = (overrides && cid && overrides.countries && overrides.countries[cid])
    ? overrides.countries[cid]
    : null;
  const raw = (scoped && scoped[key]) || (overrides && overrides[key]) || null;
  if (!raw) return null;
  return normalizeOverrideUrl(overrides, raw);
}

function normalizeOverrideUrl(overrides, value){
  if (!overrides || !overrides.dataRoot) return value;
  const v = String(value);
  if (/^(https?:)?\/\//i.test(v) || v.startsWith("./") || v.startsWith("/")) return v;
  const root = String(overrides.dataRoot || "").replace(/\/+$/, "");
  const tail = v.replace(/^\.?\//, "");
  return root ? `${root}/${tail}` : v;
}

function getOverrideValue(overrides, key){
  if (!overrides || !overrides[key]) return null;
  return normalizeOverrideUrl(overrides, overrides[key]);
}

async function loadWorldBorder(overrides){
  const url = getOverrideValue(overrides, "worldBorderUrl");
  if (!url) return;
  const geo = await tryLoadJson(url);
  if (geo) state.worldBorder = geo;
}

function applyCountryView(spec, cities){
  if (!map) return;
  if (spec && spec.view && Array.isArray(spec.view.center) && Number.isFinite(spec.view.zoom)) {
    state.countryView = { center: spec.view.center, zoom: spec.view.zoom };
    map.setView(spec.view.center, spec.view.zoom);
    return;
  }

  const coords = Array.isArray(cities)
    ? cities.filter(c => Number(c?.lat) && Number(c?.lon)).map(c => [Number(c.lat), Number(c.lon)])
    : [];

  if (coords.length >= 2 && typeof L !== "undefined") {
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds.pad(0.15));
    const center = map.getCenter();
    state.countryView = { center: [center.lat, center.lng], zoom: map.getZoom() };
  } else {
    state.countryView = CONFIG.SPAIN_VIEW;
    map.setView(CONFIG.SPAIN_VIEW.center, CONFIG.SPAIN_VIEW.zoom);
  }
}

function resetNetworkState(){
  try {
    layers.tracks?.clearLayers?.();
    layers.trackLabels?.clearLayers?.();
    layers.lines?.clearLayers?.();
    layers.trains?.clearLayers?.();
    layers.flowOverlay?.clearLayers?.();
  } catch (_) {}

  if (state.tracks && typeof state.tracks.clear === "function") state.tracks.clear();
  if (state.lines && typeof state.lines.clear === "function") state.lines.clear();

  if (state.construction) {
    state.construction.queue = [];
    state.construction.active = [];
    state.construction.history = [];
  }

  state.activeLine = null;
  state.pendingTrackNode = null;
  state.selectedNode = null;
  state.selectedNodeId = null;

  if (state.service) {
    state.service.runs = [];
    state.service.pending = new Map();
  }

  state.osmRailImported = false;
  state.osmRailImportLast = null;
  state.osmRailImportError = null;

  if (typeof trainVis_clearAll === "function") trainVis_clearAll();
}

function exportStateSnapshot(){
  const tracks = Array.from(state.tracks?.values?.() || []).map(t => ({
    id: t.id,
    from: t.from,
    to: t.to,
    lanes: t.lanes,
    status: t.status || "built",
    progress: Number(t.progress || 0),
    structureType: t.structureType || "surface",
    structureMult: Number(t.structureMult || 1),
    cost: t.cost || null
  }));

  const lines = Array.from(state.lines?.values?.() || []).map(l => ({
    id: l.id,
    name: l.name,
    type: l.type,
    color: l.color,
    stops: Array.isArray(l.stops) ? l.stops.slice() : [],
    circular: !!l.circular,
    retiring: !!l.retiring,
    retireStartDay: Number(l.retireStartDay || 0),
    retireDays: Number(l.retireDays || 0),
    departures: Array.isArray(l.departures) ? l.departures.slice() : [],
    carriages: l.carriages ?? null,
    speedClass: l.speedClass ?? null,
    frequencyPerDay: l.frequencyPerDay ?? null,
    vehicleCapacity: l.vehicleCapacity ?? null,
    nightService: !!l.nightService
  }));

  return {
    countryId: state.countryId || "ES",
    countryView: state.countryView || null,
    cities: Array.isArray(state.cities) ? JSON.parse(JSON.stringify(state.cities)) : [],
    spainBorder: state.spainBorder || null,
    countryBorder: state.countryBorder || null,
    year: state.year,
    budget: state.budget,
    annualBudget: state.annualBudget,
    revenue: state.revenue,
    costs: state.costs,
    profit: state.profit,
    activeClusterId: state.activeClusterId,
    activeTab: state.activeTab,
    primaryTab: state.primaryTab,
    activeLine: state.activeLine,
    trackBuildMode: state.trackBuildMode,
    lineBuildMode: state.lineBuildMode,
    trackBuildAction: state.trackBuildAction,
    pendingTrackLanes: state.pendingTrackLanes,
    construction: {
      queue: Array.isArray(state.construction?.queue) ? state.construction.queue.slice() : [],
      active: Array.isArray(state.construction?.active) ? state.construction.active.slice() : [],
      history: Array.isArray(state.construction?.history) ? state.construction.history.slice() : []
    },
    tracks,
    lines,
    productionMacro: state.production?.macro || null,
    productionUrl: state.production?.url || null,
    osmRailImportLast: state.osmRailImportLast || null,
    osmRailImported: !!state.osmRailImported
  };
}

function applyStateSnapshot(snapshot){
  if (!snapshot) return;
  state.countryId = snapshot.countryId || state.countryId || "ES";
  state.countryView = snapshot.countryView || null;
  state.cities = Array.isArray(snapshot.cities) ? snapshot.cities : [];
  state.spainBorder = snapshot.spainBorder || null;
  state.countryBorder = snapshot.countryBorder || snapshot.spainBorder || null;

  state.year = snapshot.year ?? state.year;
  state.budget = snapshot.budget ?? state.budget;
  state.annualBudget = snapshot.annualBudget ?? state.annualBudget;
  state.revenue = snapshot.revenue ?? state.revenue;
  state.costs = snapshot.costs ?? state.costs;
  state.profit = snapshot.profit ?? state.profit;
  state.activeClusterId = snapshot.activeClusterId ?? null;
  state.activeTab = snapshot.activeTab ?? state.activeTab;
  state.primaryTab = snapshot.primaryTab ?? state.primaryTab;
  state.activeLine = snapshot.activeLine ?? null;
  state.trackBuildMode = !!snapshot.trackBuildMode;
  state.lineBuildMode = !!snapshot.lineBuildMode;
  state.trackBuildAction = snapshot.trackBuildAction || state.trackBuildAction;
  state.pendingTrackLanes = snapshot.pendingTrackLanes || state.pendingTrackLanes;

  if (snapshot.productionMacro) {
    state.production = {
      macro: snapshot.productionMacro,
      loaded: true,
      url: snapshot.productionUrl || state.production?.url || ""
    };
  }

  buildClusters(state.cities || []);
  renderClusterMarkers();

  resetNetworkState();

  const cons = snapshot.construction || {};
  if (!state.construction) state.construction = { queue: [], active: [], history: [] };
  state.construction.queue = Array.isArray(cons.queue) ? cons.queue.slice() : [];
  state.construction.active = Array.isArray(cons.active) ? cons.active.slice() : [];
  state.construction.history = Array.isArray(cons.history) ? cons.history.slice() : [];

  for (const t of (snapshot.tracks || [])) {
    if (!state.nodes.has(t.from) || !state.nodes.has(t.to)) continue;
    addTrack(t.from, t.to, t.lanes || 1, { silent: true, status: t.status || "built" });
    const trackId = `TK-${edgeKey(t.from, t.to)}`;
    const tr = state.tracks.get(trackId);
    if (tr) {
      tr.status = t.status || tr.status;
      tr.progress = Number(t.progress || tr.progress || 0);
      tr.structureType = t.structureType || tr.structureType;
      tr.structureMult = Number(t.structureMult || tr.structureMult || 1);
      tr.cost = t.cost || tr.cost;
      try { track_applyStyle?.(tr); } catch (_) {}
    }
  }

  for (const l of (snapshot.lines || [])) {
    state.lines.set(l.id, {
      id: l.id,
      name: l.name,
      type: l.type,
      color: l.color,
      stops: Array.isArray(l.stops) ? l.stops : [],
      circular: !!l.circular,
      retiring: !!l.retiring,
      retireStartDay: Number(l.retireStartDay || 0),
      retireDays: Number(l.retireDays || 0),
      departures: Array.isArray(l.departures) ? l.departures : [],
      carriages: l.carriages ?? null,
      speedClass: l.speedClass ?? null,
      frequencyPerDay: l.frequencyPerDay ?? null,
      vehicleCapacity: l.vehicleCapacity ?? null,
      nightService: !!l.nightService,
      cursorStopId: null
    });
  }

  if (!state.activeLine) {
    const firstLine = Array.from(state.lines.keys())[0] || null;
    state.activeLine = firstLine;
  }

  if (state.activeClusterId) {
    const cl = state.clusters.get(state.activeClusterId);
    if (cl) map.fitBounds(cl.bounds.pad(0.25), { maxZoom: 11 });
  } else if (state.countryView) {
    map.setView(state.countryView.center, state.countryView.zoom);
  }

  if (typeof production_buildNodeStats === "function") production_buildNodeStats();

  renderLines();
  syncMarkerVisibility();
  updateClusterBar();
  updateUI();
}

async function loadCountry(countryId, opts = {}){
  if (typeof getCountrySpec !== "function") return false;
  const spec = getCountrySpec(countryId);
  if (!spec) {
    showToast("Unknown country", "warning");
    return false;
  }
  if (spec.id === state.countryId) {
    showToast("Already in this country", "info");
    return true;
  }

  const snapshot = exportStateSnapshot();
  const prevUnlocks = state.unlocks;

  try {
    if (typeof showLoading === "function") showLoading(`Loading ${spec.name}...`);
    if (typeof setLoadingStatus === "function") setLoadingStatus("Loading cities...");

    const overrides = await loadDataOverrides();
    await loadWorldBorder(overrides);
    const citiesUrl = resolveOverride(spec, overrides, "citiesUrl") || spec.citiesUrl;
    let cities;
    try {
      cities = await loadJSON(citiesUrl);
    } catch (e) {
      if (citiesUrl !== spec.citiesUrl) {
        cities = await loadJSON(spec.citiesUrl);
      } else {
        throw e;
      }
    }
    const baseCities = Array.isArray(cities) ? cities : (Array.isArray(cities?.cities) ? cities.cities : cities);

    let customPlaces = [];
    if (spec.id === "ES") {
      try {
        const custom = await loadJSON("./custom_places.json");
        customPlaces = Array.isArray(custom) ? custom : (Array.isArray(custom?.cities) ? custom.cities : []);
      } catch (_) {}
    }

    state.cities = Array.isArray(customPlaces) && customPlaces.length
      ? baseCities.concat(customPlaces)
      : baseCities;

    if (typeof setLoadingStatus === "function") setLoadingStatus("Building clusters...");
    buildClusters(state.cities);
    renderClusterMarkers();

    let border = null;
    const borderUrl = resolveOverride(spec, overrides, "borderUrl") || spec.borderUrl;
    if (borderUrl) {
      try {
        border = await loadJSON(borderUrl);
      } catch (_) {
        if (borderUrl !== spec.borderUrl && spec.borderUrl) {
          try { border = await loadJSON(spec.borderUrl); } catch (_) { border = null; }
        } else {
          border = null;
        }
      }
    }
    state.spainBorder = border;
    state.countryBorder = border;
    if (typeof renderCountryBorder === "function") renderCountryBorder();

    resetNetworkState();

    if (typeof setLoadingStatus === "function") setLoadingStatus("Loading production data...");
    const productionUrl = resolveOverride(spec, overrides, "productionUrl") || spec.productionUrl;
    if (typeof production_init === "function") await production_init({ url: productionUrl, force: true });
    if (productionUrl && !(state.production && state.production.loaded)) {
      throw new Error("Production data not loaded");
    }

    applyCountryView(spec, state.cities);

    const tracksUrl = resolveOverride(spec, overrides, "tracksUrl") || spec.tracksUrl;
    const tracksFallbackUrl = resolveOverride(spec, overrides, "tracksFallbackUrl") || spec.tracksFallbackUrl;
    if (typeof importOsmRailTracks === "function" && tracksUrl) {
      if (typeof setLoadingStatus === "function") setLoadingStatus("Importing tracks...");
      const fallback = tracksFallbackUrl || tracksUrl;
      await importOsmRailTracks({
        allowOverpass: false,
        force: true,
        resetTracks: true,
        url: tracksUrl,
        fallbackUrl: fallback,
        osmFallback: fallback
      });
    }

    if (state.tracks && state.tracks.size === 0) {
      throw new Error("No tracks loaded");
    }

    state.countryId = spec.id;
    state.unlocks = prevUnlocks || state.unlocks;
    if (typeof unlock_initState === "function") unlock_initState();
    if (state.unlocks) {
      state.unlocks.currentCountry = spec.id;
      if (!state.unlocks.unlockedCountries.includes(spec.id)) {
        state.unlocks.unlockedCountries.push(spec.id);
      }
    }

    try { localStorage.setItem("railSimCountry", spec.id); } catch (_) {}

    syncMarkerVisibility();
    updateClusterBar();
    try { if (typeof luti_computeAccessibility === "function") luti_computeAccessibility(); } catch (_) {}
    updateUI();
    renderLines();
    if (state.tracks && state.tracks.size > 0) clock_start();
    if (typeof hideLoading === "function") hideLoading();
    showToast(`Now simulating ${spec.name}`, "success");
    return true;
  } catch (e) {
    console.warn("Country load failed:", e);
    applyStateSnapshot(snapshot);
    state.unlocks = prevUnlocks || state.unlocks;
    if (typeof hideLoading === "function") hideLoading();
    showToast("Country load failed - keeping current simulation", "warning");
    return false;
  }
}

async function boot(){
  if (typeof showLoading === "function") showLoading("Starting up...");
  console.log("boot start");
  initMap();

  const savedCountryId = getSavedCountryId();
  let spec = (typeof getCountrySpec === "function")
    ? (getCountrySpec(savedCountryId || state.countryId || "ES") || getCountrySpec("ES"))
    : null;
  if (spec) {
    state.countryId = spec.id;
    if (state.unlocks) state.unlocks.currentCountry = spec.id;
  }
  if (typeof unlock_initState === "function") unlock_initState();
  if (spec && state.unlocks && !state.unlocks.unlockedCountries.includes(spec.id)) {
    state.unlocks.unlockedCountries.push(spec.id);
  }
  try { if (state.countryId) localStorage.setItem("railSimCountry", state.countryId); } catch (_) {}

  if (typeof setLoadingStatus === "function") setLoadingStatus("Loading cities...");
  const overrides = await loadDataOverrides();
  await loadWorldBorder(overrides);
  let cities;
  try {
    const citiesUrl = resolveOverride(spec, overrides, "citiesUrl") || spec?.citiesUrl || "./cities_es.json";
    try {
      cities = await loadJSON(citiesUrl);
    } catch (e) {
      if (citiesUrl !== (spec?.citiesUrl || "./cities_es.json")) {
        cities = await loadJSON(spec?.citiesUrl || "./cities_es.json");
      } else {
        throw e;
      }
    }
  } catch (e) {
    if (spec && spec.id !== "ES") {
      console.warn("Country load failed, falling back to Spain:", e);
      spec = (typeof getCountrySpec === "function") ? (getCountrySpec("ES") || spec) : spec;
      state.countryId = spec?.id || "ES";
      const fallbackCitiesUrl = resolveOverride(spec, overrides, "citiesUrl") || spec?.citiesUrl || "./cities_es.json";
      cities = await loadJSON(fallbackCitiesUrl);
    } else {
      throw e;
    }
  }
  let customPlaces = [];
  if (!spec || spec.id === "ES") {
    try {
      const custom = await loadJSON("./custom_places.json");
      customPlaces = Array.isArray(custom) ? custom : (Array.isArray(custom?.cities) ? custom.cities : []);
    } catch (_) {}
  }

  const baseCities = Array.isArray(cities) ? cities : (Array.isArray(cities?.cities) ? cities.cities : cities);
  state.cities = Array.isArray(customPlaces) && customPlaces.length
    ? baseCities.concat(customPlaces)
    : baseCities;

  try {
    const borderUrl = resolveOverride(spec, overrides, "borderUrl") || spec?.borderUrl || "./data/spain_border.geojson";
    const border = await loadJSON(borderUrl);
    state.spainBorder = border;
    state.countryBorder = border;
    if (typeof renderCountryBorder === "function") renderCountryBorder();
  } catch (_) {
    state.spainBorder = null;
    state.countryBorder = null;
  }

  if (typeof setLoadingStatus === "function") setLoadingStatus("Building clusters...");
  buildClusters(state.cities);
  renderClusterMarkers();
  applyCountryView(spec, state.cities);

  let loadedFromSave = false;
  try {
    if (localStorage.getItem("railSimSave")) {
      loadGame();
      loadedFromSave = true;
    }
  } catch (_) {}

  try {
    if (typeof setLoadingStatus === "function") setLoadingStatus("Loading production data...");
    const productionUrl = resolveOverride(spec, overrides, "productionUrl") || spec?.productionUrl;
    if (typeof production_init === "function") await production_init({ url: productionUrl, force: true });
  } catch (e) {
    console.warn("Production init failed:", e);
  }

  try {
    const trackCount = state.tracks ? state.tracks.size : 0;
    const countryKey = String(spec?.id || state.countryId || "ES");
    const reimportKey = `osmRailReimportV6_${countryKey}`;
    const shouldForce = !localStorage.getItem(reimportKey);
    const shouldImport = shouldForce || trackCount === 0 || (!state.osmRailImported && trackCount <= 5);
    if (shouldImport && typeof importOsmRailTracks === "function") {
      if (typeof setLoadingStatus === "function") setLoadingStatus("Importing OSM rail...");
      const importOpts = { allowOverpass: false, force: shouldForce, resetTracks: shouldForce };
      const tracksUrl = resolveOverride(spec, overrides, "tracksUrl") || spec?.tracksUrl;
      const tracksFallbackUrl = resolveOverride(spec, overrides, "tracksFallbackUrl") || spec?.tracksFallbackUrl;
      if (tracksUrl) importOpts.url = tracksUrl;
      const fallback = tracksFallbackUrl || tracksUrl;
      if (fallback) {
        importOpts.fallbackUrl = fallback;
        importOpts.osmFallback = fallback;
      }
      await importOsmRailTracks(importOpts);
      if (shouldForce) localStorage.setItem(reimportKey, "1");
    }
  } catch (e) {
    console.warn("OSM import failed:", e);
  }
  if (state.tracks && state.tracks.size === 0) {
    const err = state.osmRailImportError || "OSM import failed - no tracks loaded";
    if (typeof setLoadingStatus === "function") setLoadingStatus(err);
  } else {
    if (typeof setLoadingStatus === "function") setLoadingStatus("Finalizing simulation...");
  }
  const bootStatus = {
    nodes: state.nodes?.size || 0,
    tracks: state.tracks?.size || 0,
    osmRailImportLast: state.osmRailImportLast || null
  };
  console.log("Boot status:", bootStatus);
  showToast(`Boot: nodes ${bootStatus.nodes} - tracks ${bootStatus.tracks}`, "info");

  syncMarkerVisibility();
  updateClusterBar();
  updateUI();
  state.simSeed = Number(state.simSeed ?? 1);
  if (!state.meta && typeof window.makeRunMeta === "function") {
    state.meta = window.makeRunMeta({ seed: state.simSeed, scenarioId: state.scenarioMeta?.id ?? "default" });
  }
  if (state.tracks && state.tracks.size > 0) {
    clock_start();
    if (typeof hideLoading === "function") hideLoading();
  } else {
    if (!state.clock) state.clock = { tMin: 8*60, running: false, speed: 60, lastTs: null, rafId: 0 };
    state.clock.running = false;
    showToast("Clock paused: waiting for tracks import", "warning");
  }
  luti_computeAccessibility();
  showToast(`Loaded cities: ${fmtNum(state.cities.length)} - clusters: ${fmtNum(state.clusters.size)}`, "success");
}

// expose globals for inline onclick
window.switchTab = switchTab;
window.simulateYear = simulateYear;
window.setTrackBuildMode = setTrackBuildMode;
window.setTrackBuildAction = setTrackBuildAction;
window.ui_toggleTrackPlanning = ui_toggleTrackPlanning;
window.ui_toggleClockDisplay = ui_toggleClockDisplay;
window.setClockSpeed = setClockSpeed;
window.setClockSpeedFromSlider = setClockSpeedFromSlider;
window.construction_resolveIssue = construction_resolveIssue;
window.construction_cancelQueued = construction_cancelQueued;
window.setTrackLanes = setTrackLanes;
window.createNewLine = createNewLine;
window.selectLine = selectLine;
window.setActiveLineColor = setActiveLineColor;
window.setActiveLineCarriages = setActiveLineCarriages;
window.setActiveLineSpeedClass = setActiveLineSpeedClass;
window.setActiveLineNumber = setActiveLineNumber;
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
window.rebuildNodesFromCities = rebuildNodesFromCities;
window.loadCountry = loadCountry;



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

function showLoading(msg){
  const el = document.getElementById("loadingOverlay");
  const status = document.getElementById("loadingStatus");
  document.body.classList.add("loading");
  if (el) el.style.display = "flex";
  if (status && msg) status.textContent = msg;
}

function setLoadingStatus(msg){
  const status = document.getElementById("loadingStatus");
  if (status && msg) status.textContent = msg;
}

function hideLoading(){
  const el = document.getElementById("loadingOverlay");
  document.body.classList.remove("loading");
  if (el) el.style.display = "none";
}

Object.assign(window, { showLoading, setLoadingStatus, hideLoading });

window.addEventListener("error", (event) => {
  if (typeof ui_captureError !== "function") return;
  const err = event?.error || event?.message || "Unknown error";
  ui_captureError(err, { source: "window.error" });
});

window.addEventListener("unhandledrejection", (event) => {
  if (typeof ui_captureError !== "function") return;
  const err = event?.reason || "Unhandled promise rejection";
  ui_captureError(err, { source: "unhandledrejection" });
});


boot().catch(err => {
  console.error(err);
  showToast("Failed to load data files", "error");
  if (typeof ui_captureError === "function") ui_captureError(err, { source: "boot" });
  document.getElementById("controlPanel").innerHTML = `
    <div class="section">
      <h3 class="title">Load error</h3>
      <div class="hint">
        ${String(err)}<br><br>
        Make sure these files sit next to <code>index.html</code>:<br>
        â€¢ <b>cities_es.json</b><br>
        â€¢ <b>economy.js</b><br><br>
        Run a local server, e.g. <code>python -m http.server 8000</code>
      </div>
    </div>
  `;
});

function saveGame(opts = {}){
const seed = Number(state.simSeed ?? state.meta?.seed ?? 1);
const scenarioId = state.meta?.scenarioId ?? state.scenarioMeta?.id ?? "default";
const meta = (state.meta || (window.makeRunMeta ? window.makeRunMeta({ seed, scenarioId }) : null));
const data = {
  schemaVersion: meta?.schemaVersion || window.schemaVersion || "0.0.0",
  datasetVersion: meta?.datasetVersion || window.datasetVersion || "0.0.0",
  modelVersion: meta?.modelVersion || window.modelVersion || "0.0.0",
  meta,
  countryId: state.countryId || "ES",
  countryView: state.countryView || null,
  unlocks: state.unlocks || null,
  simSeed: seed,
  scenarioId,
  year: state.year,
  budget: state.budget,
  revenue: state.revenue,
  costs: state.costs,
  profit: state.profit,
  activeClusterId: state.activeClusterId,

  // tracks + lines are Maps, convert to arrays
  tracks: Array.from(state.tracks.values()).map(t => ({
    id: t.id,
    from: t.from,
    to: t.to,
    lanes: t.lanes,
    status: t.status || "built",
    progress: Number(t.progress || 0),
    structureType: t.structureType || "surface",
    structureMult: Number(t.structureMult || 1),
    cost: t.cost || null
  })),
  construction: {
    queue: state.construction?.queue || [],
    active: state.construction?.active || []
  },
  lines: Array.from(state.lines.values()).map(l => ({
    id: l.id, name: l.name, type: l.type, color: l.color,
    stops: l.stops, circular: l.circular,
    retiring: !!l.retiring,
    retireStartDay: Number(l.retireStartDay || 0),
    retireDays: Number(l.retireDays || 0)
  })),
  osmRailImportLast: state.osmRailImportLast || null
};

localStorage.setItem("railSimSave", JSON.stringify(data));
if (!opts.silent) showToast("Saved!", "success");
}

function loadGame(){
const raw = localStorage.getItem("railSimSave");
if (!raw) { showToast("No save found", "warning"); return; }

const data = JSON.parse(raw);
const savedDatasetVersion = data.datasetVersion || data.meta?.datasetVersion;
const currentDatasetVersion = window.datasetVersion || state.meta?.datasetVersion;
if (savedDatasetVersion && currentDatasetVersion && savedDatasetVersion !== currentDatasetVersion) {
  showToast(`Save uses dataset ${savedDatasetVersion} while current dataset is ${currentDatasetVersion}`, "warning");
}

state.simSeed = data.simSeed ?? state.simSeed ?? 1;
state.meta = data.meta || (window.makeRunMeta ? window.makeRunMeta({ seed: state.simSeed, scenarioId: data.scenarioId ?? "default" }) : null);
state.schemaVersion = data.schemaVersion ?? state.schemaVersion;
if (data.datasetVersion) window.datasetVersion = data.datasetVersion;
if (data.modelVersion) window.modelVersion = data.modelVersion;
if (data.schemaVersion) window.schemaVersion = data.schemaVersion;
state.countryId = data.countryId ?? state.countryId;
state.countryView = data.countryView ?? state.countryView;
state.unlocks = data.unlocks ?? state.unlocks;
if (typeof unlock_initState === "function") unlock_initState();
try { if (state.countryId) localStorage.setItem("railSimCountry", state.countryId); } catch (_) {}

state.year = data.year ?? state.year;
state.budget = data.budget ?? state.budget;
state.revenue = data.revenue ?? 0;
state.costs = data.costs ?? 0;
state.profit = data.profit ?? 0;
state.activeClusterId = data.activeClusterId ?? null;
state.osmRailImportLast = data.osmRailImportLast || null;

// clear visuals + state
layers.tracks.clearLayers();
layers.lines.clearLayers();
state.tracks.clear();
state.lines.clear();

// rebuild tracks (visual + state)
for (const t of (data.tracks || [])) {
  const status = t.status || "built";
  addTrack(t.from, t.to, t.lanes || 1, { silent: true, status });
  const key = edgeKey(t.from, t.to);
  const trackId = `TK-${key}`;
  const tr = state.tracks.get(trackId);
  if (tr) {
    tr.status = status;
    tr.progress = Number(t.progress || 0);
    tr.structureType = t.structureType || "surface";
    tr.structureMult = Number(t.structureMult || 1);
    tr.cost = t.cost || tr.cost;
    track_applyStyle(tr);
  }
}

// rebuild lines
for (const l of (data.lines || [])) {
  state.lines.set(l.id, {
    id: l.id, name: l.name, type: l.type, color: l.color,
    stops: Array.isArray(l.stops) ? l.stops : [],
    circular: !!l.circular,
    retiring: !!l.retiring,
    retireStartDay: Number(l.retireStartDay || 0),
    retireDays: Number(l.retireDays || 0),
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
  const view = state.countryView || CONFIG.SPAIN_VIEW;
  map.setView(view.center, view.zoom);
}

trainVis_clearAll();
renderLines();
syncMarkerVisibility();
updateClusterBar();
updateUI();
const migrationNotes = runStateMigrationNotes();
if (migrationNotes.length) {
  trainVis_clearAll();
  renderLines();
  syncMarkerVisibility();
  updateClusterBar();
  updateUI();
}
const toastMessage = migrationNotes.length
  ? `Loaded (migrated: ${migrationNotes.join("; ")})`
  : "Loaded!";
const toastType = migrationNotes.length ? "info" : "success";
showToast(toastMessage, toastType);
}

function runStateMigrationNotes(){
  if (typeof window.simCoreMigrate !== "function") return [];
  const migrated = window.simCoreMigrate(state, state.schemaVersion);
  if (!migrated) return [];
  const notes = Array.isArray(migrated.notes) ? migrated.notes.filter(Boolean) : [];
  if (migrated.state && migrated.state !== state) {
    state = migrated.state;
    window.state = state;
  }
  if (notes.length) {
    console.info("[save/load] applied migration notes:", notes);
  }
  return notes;
}

Object.assign(window, {
ui_lineDiagram_stopClick,
});

function exportSimReportJson(){
  const seed = Number(state.simSeed ?? state.meta?.seed ?? 1);
  const scenarioId = state.meta?.scenarioId ?? state.scenarioMeta?.id ?? "default";
  const meta = state.meta || (window.makeRunMeta ? window.makeRunMeta({ seed, scenarioId }) : null);
  const rows = Array.isArray(state.simReportRows) ? state.simReportRows : [];
  if (!window.simCoreMakeReport) {
    showToast("Report exporter not available", "warning");
    return;
  }
  const report = window.simCoreMakeReport(meta, rows);
  if (typeof downloadJSON === "function") {
    downloadJSON(report, "sim_report.json");
  } else {
    console.warn("downloadJSON not available");
  }
}

function exportSimReportCsv(){
  const rows = Array.isArray(state.simReportRows) ? state.simReportRows : [];
  if (!window.simCoreToCsv) {
    showToast("CSV exporter not available", "warning");
    return;
  }
  const csv = window.simCoreToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sim_report.csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.body.removeChild(a);
}

// expose to onclick buttons
window.saveGame = saveGame;
window.loadGame = loadGame;
window.exportSimReportJson = exportSimReportJson;
window.exportSimReportCsv = exportSimReportCsv;
