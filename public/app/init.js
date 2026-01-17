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

function ensureCellsAndDemand(){
  if (typeof loadComarcasGeoJSON === "function" && (!state.cells || state.cells.size === 0)) {
    loadComarcasGeoJSON("./comarcas.geojson")
      .then(geo => {
        if (geo) {
          state.cellsGeoJSON = geo;
        }
        if (geo && typeof buildCellsFromGeoJSON === "function") {
          state.cells = buildCellsFromGeoJSON(geo, { cities: state.cities });
        }
      })
      .then(() => {
        if (typeof recomputeDemandModel === "function") recomputeDemandModel();
      })
      .catch((err) => {
        console.warn("Demand foundation initialization failed", err);
        if (typeof recomputeDemandModel === "function") recomputeDemandModel();
      });
    return;
  }
  if (typeof recomputeDemandModel === "function") recomputeDemandModel();
}

function removeNonStationTracks(){
  if (!state.tracks || !state.stations) return;
  for (const [trackId, track] of Array.from(state.tracks.entries())){
    if (!track) continue;
    if (!state.stations.has(track.from) || !state.stations.has(track.to)) {
      try { track_removeVisual?.(track); } catch (_) {}
      state.tracks.delete(trackId);
    }
  }
  if (typeof updateRailLinksFromTracks === "function") updateRailLinksFromTracks();
}

function bumpStationStamp(){
  state.stationStamp = (Number(state.stationStamp) || 0) + 1;
}

function bumpTrackStamp(){
  state.trackStamp = (Number(state.trackStamp) || 0) + 1;
}

function updateRailLinksFromTracks(){
  if (!state || !state.tracks || !state.railLinks) return;
  if (state.realInfra?.success) return;
  state.railLinks.clear();
  const nodes = state.nodes || new Map();
  for (const track of state.tracks.values()){
    if (!track) continue;
    if (track.status && track.status !== "built") continue;
    const fromNode = nodes.get(track.from);
    const toNode = nodes.get(track.to);
    if (!fromNode || !toNode) continue;
    const baseDistance = Number(track.distance_km ?? track.distanceKm ?? track.cost?.distanceKm ?? 0);
    const computed = distanceKmBetween(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);
    const distance = Number(baseDistance) || (Number.isFinite(computed) ? computed : 0);
    const maxSpeed = Math.max(1, Number(track.maxSpeedKmh ?? track.max_speed_kmh ?? track.cost?.estimatedMaxSpeed ?? 120));
    state.railLinks.set(track.id, {
      id: track.id,
      a: track.from,
      b: track.to,
      distance_km: distance,
      max_speed_kmh: maxSpeed,
      lanes: Math.max(1, Number(track.lanes || 1)),
      source: "constructed"
    });
  }
  if (typeof bumpTrackStamp === "function") bumpTrackStamp();
}

function populateNodesWithStations(){
  if (!state.nodes) state.nodes = new Map();

  const manageRailNodes = !(state.realInfra?.success);
  if (manageRailNodes && state.railNodes && typeof state.railNodes.clear === "function") {
    state.railNodes.clear();
  }

  // Remove any existing station entries so we can rebuild fresh
  const stationNodeIds = [];
  for (const [nodeId, node] of state.nodes.entries()) {
    if (node?.kind === "station") {
      stationNodeIds.push(nodeId);
    }
  }
  for (const id of stationNodeIds) {
    state.nodes.delete(id);
  }

  if (!state.stations || typeof state.stations.values !== "function") return;

  for (const station of state.stations.values()){
    const lat = Number(station.lat);
    const lon = Number(station.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    state.nodes.set(station.id, {
      id: station.id,
      name: station.name || station.id,
      lat,
      lon,
      kind: "station",
      population: Number(station.population || 0),
      rail_node_id: station.rail_node_id || null,
      isCustom: station.source === "custom"
    });
    if (manageRailNodes && state.railNodes && typeof state.railNodes.set === "function") {
      state.railNodes.set(station.id, { id: station.id, lat, lon });
    }
  }

  if (typeof assignStationPopulationFromCities === "function") {
    try { assignStationPopulationFromCities(); } catch (_) {}
  }
  if (typeof removeNonStationTracks === "function") {
    try { removeNonStationTracks(); } catch (_) {}
  }
  if (typeof updateRailLinksFromTracks === "function") {
    try { updateRailLinksFromTracks(); } catch (_) {}
  }
  if (typeof bumpStationStamp === "function") {
    try { bumpStationStamp(); } catch (_) {}
  }
}

function applyRealInfrastructureData(payload){
  if (!payload || payload.source !== "REAL" || !state.stations || !state.tracks) return false;

  const stations = Array.isArray(payload.stations) ? payload.stations : [];
  const railNodes = Array.isArray(payload.railNodes) ? payload.railNodes : [];
  const railLinks = Array.isArray(payload.railLinks) ? payload.railLinks : [];

  if (!stations.length || !railLinks.length) return false;

  const stationCount = payload.stationCount ?? stations.length;
  const linkCount = payload.trackCount ?? railLinks.length;

  if (state.stations && typeof state.stations.clear === "function") state.stations.clear();
  if (state.tracks && typeof state.tracks.clear === "function") state.tracks.clear();
  if (state.railNodes && typeof state.railNodes.clear === "function") state.railNodes.clear();
  if (state.railLinks && typeof state.railLinks.clear === "function") state.railLinks.clear();

  for (const station of stations){
    const id = String(station.id || "").trim();
    if (!id) continue;
    state.stations.set(id, {
      ...station,
      id,
      lat: Number(station.lat),
      lon: Number(station.lon),
      active: station.active !== false,
      source: station.source || "public"
    });
  }

  for (const node of railNodes){
    const id = String(node.id || "").trim();
    if (!id) continue;
    state.railNodes.set(id, {
      id,
      lat: Number(node.lat),
      lon: Number(node.lon)
    });
  }

  for (const link of railLinks){
    const id = String(link.id || "").trim();
    if (!id) continue;
    const from = String(link.a || "");
    const to = String(link.b || "");
    if (!from || !to) continue;
    const lanes = Math.max(1, Number(link.lanes || 1));
    const distance = Number(link.distance_km ?? link.distanceKm ?? 0);
    const maxSpeed = Math.max(1, Number(link.max_speed_kmh ?? link.maxSpeedKmh ?? 120));
    const buildCost = Number(link.build_cost ?? link.cost?.constructionCost ?? 0);
    const maintenanceCost = Number(link.maintenance_cost ?? link.cost?.maintenanceCost ?? 0);
    const demolishCost = Number(link.demolish_cost ?? Math.round(buildCost * 0.35));
    const tunnels = Number(link.tunnels_km ?? link.tunnelKm ?? 0);
    const track = {
      id,
      from,
      to,
      lanes,
      distance_km: distance,
      distanceKm: distance,
      max_speed_kmh: maxSpeed,
      maxSpeedKmh: maxSpeed,
      build_cost: buildCost,
      maintenance_cost: maintenanceCost,
      demolish_cost: demolishCost,
      tunnels_km: tunnels,
      electrified: link.electrified ?? false,
      gauge: link.gauge || "standard",
      capacity: Number(link.capacity ?? 0),
      structureType: link.structureType || "surface",
      structureMult: Number(link.structureMult ?? 1),
      cost: link.cost || null,
      status: "built",
      progress: 1,
      source: String(link.source || "public")
    };
    state.tracks.set(id, track);
    state.railLinks.set(id, { ...link, id });
  }

  if (typeof applyCustomStations === "function") applyCustomStations();
  if (typeof reapplyDisabledStations === "function") reapplyDisabledStations();

  populateNodesWithStations();

  if (state.mapLayers) state.mapLayers.showRealInfra = true;

  state.simNodeMode = "stations";
  state.realInfra = {
    success: true,
    stationsLoaded: state.stations.size > 0,
    tracksLoaded: state.tracks.size > 0,
    stationCount,
    trackCount: linkCount,
    stationsUrl: payload.config?.stationsUrl || null,
    edgesUrl: payload.config?.railLinksUrl || null
  };

  if (typeof migrateLineStopsToStations === "function") migrateLineStopsToStations(state.lines);
  if (typeof bumpTrackStamp === "function") bumpTrackStamp();
  return true;
}

function applyFallbackStations(){
  if (state.stations && typeof state.stations.clear === "function") {
    state.stations.clear();
  }
  if (state.tracks && typeof state.tracks.clear === "function") {
    state.tracks.clear();
  }
  if (state.railNodes && typeof state.railNodes.clear === "function") {
    state.railNodes.clear();
  }
  if (state.railLinks && typeof state.railLinks.clear === "function") {
    state.railLinks.clear();
  }

  if (typeof buildStationsFromCities === "function") {
    buildStationsFromCities(state.cities || [], { target: state.stations });
  }
  if (typeof applyCustomStations === "function") applyCustomStations();
  if (typeof reapplyDisabledStations === "function") reapplyDisabledStations();
  if (typeof migrateLineStopsToStations === "function") {
    migrateLineStopsToStations(state.lines);
  }

  if (typeof ensureFallbackTracks === "function") {
    try { ensureFallbackTracks(); } catch (_) {}
  }

  state.simNodeMode = "cities";
  state.realInfra = {
    success: false,
    stationsLoaded: false,
    tracksLoaded: false,
    stationCount: 0,
    trackCount: 0,
    stationsUrl: null,
    edgesUrl: null
  };
}

function ensureStarterStations(){
  if (!state.stations) state.stations = new Map();
  if (state.stations.size > 0) return;
  if (typeof buildStationsFromCities === "function") {
    buildStationsFromCities(state.cities || [], { target: state.stations });
  }
  if (typeof applyCustomStations === "function") applyCustomStations();
  if (typeof reapplyDisabledStations === "function") reapplyDisabledStations();
  if (state.stations.size === 0 && Array.isArray(state.cities)) {
    for (const city of state.cities) {
      if (!city) continue;
      const pop = Number(city.population ?? city.pop ?? 0);
      if (!Number.isFinite(pop)) continue;
      const stationId = stationIdFromCity(city);
      if (!stationId) continue;
      state.stations.set(stationId, {
        id: stationId,
        name: city.name || city.city || stationId,
        lat: Number(city.lat),
        lon: Number(city.lon),
        population: pop,
        active: true,
        source: "generated"
      });
    }
  }
}

function refreshStationFoundation(){
  const finalize = () => ensureCellsAndDemand();

  if (typeof loadRealInfrastructure === "function") {
    loadRealInfrastructure(state.countryId || "ES")
      .then(payload => {
        const applied = applyRealInfrastructureData(payload);
        if (!applied) applyFallbackStations();
      })
      .catch((err) => {
        console.warn("Real infrastructure load failed", err);
        applyFallbackStations();
      })
      .finally(finalize);
    return;
  }

  applyFallbackStations();
  finalize();
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
  if (typeof updateRailLinksFromTracks === "function") updateRailLinksFromTracks();
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
    distance_km: Number(t.distance_km ?? 0),
    max_speed_kmh: Number(t.max_speed_kmh ?? 0),
    build_cost: Number(t.build_cost ?? 0),
    maintenance_cost: Number(t.maintenance_cost ?? 0),
    demolish_cost: Number(t.demolish_cost ?? 0),
    tunnels_km: Number(t.tunnels_km ?? 0),
    electrified: !!t.electrified,
    gauge: t.gauge || "",
    capacity: Number(t.capacity ?? 0),
    source: t.source || null,
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
    osmRailImported: !!state.osmRailImported,
    viewMode: state.viewMode,
    mapLayers: state.mapLayers,
    simConfig: state.simConfig,
    customStations: Array.from(state.customStations?.values?.() || []),
    disabledStations: Array.from(state.disabledStations || [])
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
  state.viewMode = snapshot.viewMode || state.viewMode;
  state.mapLayers = snapshot.mapLayers || state.mapLayers;
  state.simConfig = snapshot.simConfig || state.simConfig;
  state.customStations = new Map();
  if (Array.isArray(snapshot.customStations)) {
    for (const station of snapshot.customStations) {
      if (!station || !station.id) continue;
      state.customStations.set(String(station.id), { ...station, id: String(station.id) });
    }
  }
  state.disabledStations = new Set(
    Array.isArray(snapshot.disabledStations)
      ? snapshot.disabledStations.map(id => String(id || ""))
      : []
  );
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
  refreshStationFoundation();

  resetNetworkState();

  const cons = snapshot.construction || {};
  if (!state.construction) state.construction = { queue: [], active: [], history: [] };
  state.construction.queue = Array.isArray(cons.queue) ? cons.queue.slice() : [];
  state.construction.active = Array.isArray(cons.active) ? cons.active.slice() : [];
  state.construction.history = Array.isArray(cons.history) ? cons.history.slice() : [];

  for (const t of (snapshot.tracks || [])) {
    if (!state.nodes.has(t.from) || !state.nodes.has(t.to)) continue;
    const metadata = {
      distance_km: t.distance_km,
      max_speed_kmh: t.max_speed_kmh,
      build_cost: t.build_cost,
      maintenance_cost: t.maintenance_cost,
      demolish_cost: t.demolish_cost,
      tunnels_km: t.tunnels_km,
      electrified: t.electrified,
      gauge: t.gauge,
      capacity: t.capacity,
      structureType: t.structureType,
      structureMult: t.structureMult
    };
    addTrack(t.from, t.to, t.lanes || 1, {
      silent: true,
      status: t.status || "built",
      metadata,
      cost: t.cost || null
    });
    const trackId = `TK-${edgeKey(t.from, t.to)}`;
    const tr = state.tracks.get(trackId);
    if (tr) {
      tr.progress = Number(t.progress || tr.progress || 0);
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

  if (typeof migrateLineStopsToStations === "function") {
    migrateLineStopsToStations(state.lines);
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
    refreshStationFoundation();

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
  if (typeof loadPopPoints === "function") {
    loadPopPoints().catch(err => console.warn("Failed to load pop points", err));
  }

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
  refreshStationFoundation();
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
  console.log("builder ready", {
    tracks: state.tracks?.size || 0,
    lines: state.lines?.size || 0,
    simNodeMode: state.simNodeMode
  });
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
if (typeof construction_resolveIssue === "function") {
  window.construction_resolveIssue = construction_resolveIssue;
}

function ensureFallbackTracks(){
  if (!state.stations || !state.tracks) return;
  if (state.tracks.size) return;
  const stations = Array.from(state.stations.values())
    .filter(st => st && st.id && Number.isFinite(Number(st.lat)) && Number.isFinite(Number(st.lon)));
  if (stations.length < 2) return;
  const candidatePairs = [
    [0, 1],
    [0, Math.min(2, stations.length - 1)],
    [1, Math.min(3, stations.length - 1)]
  ];
  for (const [aIndex, bIndex] of candidatePairs){
    if (aIndex >= stations.length || bIndex >= stations.length) continue;
    const from = stations[aIndex].id;
    const to = stations[bIndex].id;
    const key = edgeKey(from, to);
    const trackId = `TK-${key}`;
    if (state.tracks.has(trackId)) continue;
    if (typeof addTrack === "function") {
      addTrack(from, to, 1, { silent: true, status: "built", metadata: {}, cost: {} });
    }
  }
}
if (typeof construction_cancelQueued === "function") {
  window.construction_cancelQueued = construction_cancelQueued;
}
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

function setMapLayerOption(key, on){
  if (!state.mapLayers) state.mapLayers = {};
  state.mapLayers[key] = !!on;
  if (typeof renderDemandOverlays === "function") {
    try { renderDemandOverlays(); } catch (_) {}
  }
  if (typeof render_overlay === "function") {
    try { render_overlay(); } catch (_) {}
  }
  if (key === "showCountryBorders" && typeof renderWorldCountryBorders === "function") {
    try { renderWorldCountryBorders(); } catch (_) {}
  }
  if (typeof syncMarkerVisibility === "function") {
    try { syncMarkerVisibility(); } catch (_) {}
  }
  updateUI();
}

window.setMapLayerOption = setMapLayerOption;

function selectDemandCell(cellId){
  if (!cellId || !state.cells?.has(cellId)) {
    state.selectedCellId = null;
  } else {
    state.selectedCellId = cellId;
  }
  if (typeof renderDemandOverlays === "function") {
    try { renderDemandOverlays(); } catch (_) {}
  }
  updateUI();
}

window.selectDemandCell = selectDemandCell;

function ui_centerOnCell(cellId){
  const cell = state.cells?.get(cellId);
  if (!cell) return;
  selectDemandCell(cellId);
  if (map && Number.isFinite(cell.centroidLat) && Number.isFinite(cell.centroidLon)) {
    const zoom = Math.max(7, Math.min(12, map.getZoom()));
    map.setView([cell.centroidLat, cell.centroidLon], zoom);
  }
}

window.ui_centerOnCell = ui_centerOnCell;

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

if (typeof migrateLineStopsToStations === "function") {
  migrateLineStopsToStations(state.lines);
}

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
