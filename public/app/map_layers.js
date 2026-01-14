/* eslint-disable no-undef, no-unused-vars, no-empty */
// ======================
// Map + Layers
// ======================
let map;
let baseTileLayer = null;
const layers = {
  clusters: L.layerGroup(),
  cities: L.layerGroup(),
  tracks: L.layerGroup(),
  railInfra: L.layerGroup(),
  stationMarkers: L.layerGroup(),
  stationOverlay: L.layerGroup(), // NEW: busy station rings
  trackLabels: L.layerGroup(),
  lines: L.layerGroup(),
  trains: L.layerGroup(),
  flowOverlay: L.layerGroup(), // <-- NEW: animated trains live here
  comarcaBorders: L.layerGroup(),
  demandHeat: L.layerGroup(),
  catchments: L.layerGroup(),
  underserved: L.layerGroup(),
  borders: L.layerGroup(),
};

function computeStationLineCounts(){
  const counts = new Map();
  if (!state || !state.lines) return counts;
  for (const line of state.lines.values()){
    if (!line || !Array.isArray(line.stops)) continue;
    for (const stop of line.stops){
      const id = String(stop || "").trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

window.computeStationLineCounts = computeStationLineCounts;

const DEMAND_DEBOUNCE_MS = Number(window.DEMAND_DEBOUNCE_MS ?? 500);
let overlayRenderQueued = false;
let demandRecomputeTimer = null;

function perfLog(label, start){
  if (!state?.debug?.perf || typeof start !== "number") return;
  const delta = Math.max(0, performance.now() - start);
  console.info(`[perf] ${label}: ${delta.toFixed(1)}ms`);
}

function runScheduledDemandRecompute({ force = false, source = "auto" } = {}){
  if (!state?.dirty?.demand && !force) return;
  if (demandRecomputeTimer) {
    clearTimeout(demandRecomputeTimer);
    demandRecomputeTimer = null;
  }
  const start = state.debug?.perf ? performance.now() : null;
  if (state.dirty) state.dirty.demand = false;
  if (typeof recomputeDemandModel === "function") {
    try {
      recomputeDemandModel();
    } catch (err) {
      console.warn("Demand recompute failed", err);
    }
  }
  if (start) perfLog(`recomputeDemandModel (${source})`, start);
}

function scheduleDemandRecompute(){
  if (!state) return;
  state.dirty = state.dirty || {};
  state.dirty.demand = true;
  if (demandRecomputeTimer) clearTimeout(demandRecomputeTimer);
  demandRecomputeTimer = setTimeout(() => {
    demandRecomputeTimer = null;
    runScheduledDemandRecompute({ source: "debounce" });
  }, Math.max(0, DEMAND_DEBOUNCE_MS));
  if (typeof resetStationDistanceCache === "function") {
    try { resetStationDistanceCache(); } catch (_) {}
  }
}

function markDemandDirty(){
  scheduleDemandRecompute();
}

function markNetworkDirty(){
  if (!state) return;
  state.dirty = state.dirty || {};
  state.dirty.network = true;
  if (typeof invalidateRoutingCache === "function") {
    try { invalidateRoutingCache(); } catch (_) {}
  }
  if (typeof resetStationDistanceCache === "function") {
    try { resetStationDistanceCache(); } catch (_) {}
  }
  scheduleDemandRecompute();
}

function applyPendingChanges({ showToastMsg = true } = {}){
  const pending = Boolean(state?.dirty?.demand || state?.dirty?.network);
  runScheduledDemandRecompute({ force: true, source: "commit" });
  if (state.dirty) state.dirty.network = false;
  if (pending && showToastMsg && typeof showToast === "function") {
    showToast("Pending changes applied", "success");
  }
}

window.markDemandDirty = markDemandDirty;
window.markNetworkDirty = markNetworkDirty;
window.runScheduledDemandRecompute = runScheduledDemandRecompute;
window.applyPendingChanges = applyPendingChanges;

function initMap(){
  map = L.map("map").setView(CONFIG.SPAIN_VIEW.center, CONFIG.SPAIN_VIEW.zoom);
map.createPane("stationPane");
map.getPane("stationPane").style.zIndex = 650; // above markers, below UI
map.createPane("borderPane");
map.getPane("borderPane").style.zIndex = 260; // above tiles, below tracks
map.on("zoomend", () => {
  if (state.activeTab === "network") render_overlay();
});


  baseTileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  layers.tracks.addTo(map);
  layers.railInfra.addTo(map);
  layers.stationMarkers.addTo(map);
  layers.stationOverlay.addTo(map); // NEW
  layers.trackLabels.addTo(map);
  layers.lines.addTo(map);
layers.trains.addTo(map);
layers.flowOverlay.addTo(map);
  layers.comarcaBorders.addTo(map);
  layers.demandHeat.addTo(map);
  layers.catchments.addTo(map);
  layers.underserved.addTo(map);
  layers.borders.addTo(map);


  map.on("zoomend moveend", () => {
    syncMarkerVisibility();
    if (state.activeClusterId && map.getZoom() <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) {
      leaveCluster(true);
    }
  });

  map.on("click", (event) => {
    if (!state.stationPlacementMode) return;
    if (typeof registerCustomStation !== "function") return;
    const lat = event.latlng.lat;
    const lon = event.latlng.lng;
    const draft = state.stationPlacementDraft || {};
    const summary = (typeof stationPlacementPopSummary === "function")
      ? stationPlacementPopSummary(lat, lon)
      : null;
    showStationPlacementPreview(summary, () => {
      const station = registerCustomStation({
        name: draft.name || `Custom Station ${Date.now().toString(36)}`,
        lat,
        lon,
        population: Number(draft.population || 0),
        source: "custom"
      });
      state.stationPlacementMode = false;
      state.stationPlacementDraft = null;
      hideStationPlacementPreview();
      finalizeStationPlacement(station);
    }, () => {
      hideStationPlacementPreview();
    });
  });

  map_applyTheme(state.mapTheme || "default");
  renderCountryBorder();
}

function map_applyTheme(theme){
  if (!map) return;
  state.mapTheme = theme || "default";
  const body = document.body;
  if (body) body.classList.toggle("metro-theme", state.mapTheme === "metro");

  if (baseTileLayer) {
    const has = map.hasLayer(baseTileLayer);
    if (state.mapTheme === "metro" && has) {
      map.removeLayer(baseTileLayer);
    } else if (state.mapTheme !== "metro" && !has) {
      baseTileLayer.addTo(map);
    }
  }

  try { render_network(); } catch (_) {}
  try { render_overlay(); } catch (_) {}
}

window.map_applyTheme = map_applyTheme;

function renderCountryBorder(){
  if (!map || !layers.borders) return;
  layers.borders.clearLayers();
  if (state.mapTheme !== "metro") return;
  const geo = (state.worldView && state.worldBorder)
    ? state.worldBorder
    : (state.countryBorder || state.spainBorder);
  if (!geo) return;

  L.geoJSON(geo, {
    pane: "borderPane",
    interactive: false,
    style: {
      color: "#f8fafc",
      weight: 1.4,
      opacity: 0.9,
      fillOpacity: 0
    }
  }).addTo(layers.borders);
}

window.renderCountryBorder = renderCountryBorder;

let stationPreviewEl = null;

function ensureStationPlacementPreviewElement(){
  if (stationPreviewEl) return stationPreviewEl;
  stationPreviewEl = document.createElement("div");
  stationPreviewEl.id = "stationPlacementPreview";
  Object.assign(stationPreviewEl.style, {
    position: "fixed",
    bottom: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(15,23,42,0.95)",
    color: "#fff",
    padding: "18px",
    borderRadius: "14px",
    boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
    zIndex: "1400",
    fontFamily: "system-ui, sans-serif",
    width: "360px",
    display: "none",
    lineHeight: "1.5"
  });
  document.body.appendChild(stationPreviewEl);
  return stationPreviewEl;
}

function hideStationPlacementPreview(){
  if (!stationPreviewEl) return;
  stationPreviewEl.style.display = "none";
}

function stationSummaryHtml(summary){
  if (!summary) return "<div class=\"hint\">Live population preview unavailable.</div>";
  const radii = Object.keys(summary.totals || {});
  const lines = radii.map(radius => {
    const value = summary.totals[radius] || 0;
    return `<div style="display:flex;justify-content:space-between;font-size:13px;">${radius} km: <b>${fmtNum(Math.round(value))}</b></div>`;
  }).join("");
  const nearest = summary.nearest;
  const nearestHtml = nearest
    ? `<div style="margin-top:6px;font-size:12px;">Nearest station: ${escapeHtml(nearest.station?.name || nearest.station?.id || "unknown")} (${nearest.distanceKm.toFixed(1)} km)</div>`
    : "";
  return `
    <div style="font-weight:900;font-size:15px;margin-bottom:6px;">Population reach</div>
    ${lines}
    ${nearestHtml}
  `;
}

function showStationPlacementPreview(summary, onConfirm, onCancel){
  const el = ensureStationPlacementPreviewElement();
  el.innerHTML = `
    ${stationSummaryHtml(summary)}
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
      <button class="btn secondary" style="padding:6px 14px;font-size:13px;" data-action="cancel">Cancel</button>
      <button class="btn" style="padding:6px 14px;font-size:13px;" data-action="confirm">Place station</button>
    </div>
  `;
  const confirmBtn = el.querySelector("[data-action=confirm]");
  const cancelBtn = el.querySelector("[data-action=cancel]");
  confirmBtn.onclick = () => {
    hideStationPlacementPreview();
    if (typeof onConfirm === "function") onConfirm();
  };
  cancelBtn.onclick = () => {
    hideStationPlacementPreview();
    if (typeof onCancel === "function") onCancel();
  };
  el.style.display = "block";
}

function finalizeStationPlacement(station){
  if (station) {
    if (typeof populateNodesWithStations === "function") populateNodesWithStations();
    if (typeof markDemandDirty === "function") markDemandDirty();
    if (typeof showToast === "function") showToast(`Placed ${station.name}`, "success");
  } else if (typeof showToast === "function") {
    showToast("Station placement failed", "warning");
  }
  if (typeof updateUI === "function") updateUI();
}

// ======================
// Production proxy
// ======================
function estimateCityProductionEUR(city){
  const pop = Number(city.population || 0);
  const t = hash01(String(city.id || city.name || "x"));
  const perPerson = CONFIG.PROD_EUR_PER_PERSON_MIN +
    (CONFIG.PROD_EUR_PER_PERSON_MAX - CONFIG.PROD_EUR_PER_PERSON_MIN) * t;
  return Math.round(pop * perPerson);
}

// ======================
// Clustering (greedy by population)
// ======================
function buildClusters(cities, minPop = 30000){
  state.clusters.clear();

  const allCities = cities
    .filter(c => Number(c?.lat) && Number(c?.lon))
    .map(c => ({
      id: String(c.id),
      name: c.name,
      lat: Number(c.lat),
      lon: Number(c.lon),
      population: Number(c.population) || 0
    }));

  const primary = allCities.filter(c => c.population >= minPop);

  // Ensure coverage by selecting the biggest city per sparse grid cell
  const cellSize = 0.09; // degrees (~10km)
  const bestByCell = new Map();
  for (const c of allCities) {
    const gx = Math.floor((c.lon + 180) / cellSize);
    const gy = Math.floor((c.lat + 90) / cellSize);
    const key = `${gx},${gy}`;
    const cur = bestByCell.get(key);
    if (!cur || c.population > cur.population) bestByCell.set(key, c);
  }

  const primaryIds = new Set(primary.map(c => c.id));
  const coverage = [];
  for (const c of bestByCell.values()) {
    if (!primaryIds.has(c.id)) coverage.push(c);
  }

  const usable = primary.concat(coverage);

  usable.sort((a,b) => (b.population||0) - (a.population||0));

  const assigned = new Set();
  const radiusM = CONFIG.CLUSTER_RADIUS_KM * 1000;

  const cityProd = new Map();
  for (const c of usable) cityProd.set(c.id, estimateCityProductionEUR(c));

  for (const hub of usable) {
    if (assigned.has(hub.id)) continue;

    const clusterId = `CL-${hub.id}`;
    const cityIds = new Set([hub.id]);
    assigned.add(hub.id);

    const bounds = L.latLngBounds([[hub.lat, hub.lon],[hub.lat, hub.lon]]);
    let popSum = hub.population || 0;

    let totalProduction = cityProd.get(hub.id) || 0;
    let biggestProduction = cityProd.get(hub.id) || 0;

    for (const c of usable) {
      if (assigned.has(c.id)) continue;
      const d = map.distance([hub.lat, hub.lon], [c.lat, c.lon]);
      if (d <= radiusM) {
        assigned.add(c.id);
        cityIds.add(c.id);
        popSum += c.population || 0;
        bounds.extend([c.lat, c.lon]);

        const p = cityProd.get(c.id) || 0;
        totalProduction += p;
        if (p > biggestProduction) biggestProduction = p;
      }
    }

    state.clusters.set(clusterId, {
      id: clusterId,
      hubCityId: hub.id,
      hubName: hub.name,
      lat: hub.lat,
      lon: hub.lon,
      population: popSum,
      cityIds,
      bounds,
      totalProduction,
      biggestProduction
    });
  }

  // Build nodes (clusters + cities)
  state.nodes.clear();

  for (const cl of state.clusters.values()) {
    state.nodes.set(cl.id, {
      id: cl.id,
      name: cl.hubName,
      lat: cl.lat,
      lon: cl.lon,
      kind: "cluster",
      population: cl.population,
      production: cl.totalProduction,
      biggestProduction: cl.biggestProduction,
      hubCityId: cl.hubCityId
    });
  }

  for (const c of usable) {
    let clusterId = null;
    for (const cl of state.clusters.values()) {
      if (cl.cityIds.has(c.id)) { clusterId = cl.id; break; }
    }

    state.nodes.set(c.id, {
      id: c.id,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      kind: "city",
      population: c.population,
      production: cityProd.get(c.id) || 0,
      clusterId
    });
  }

  try { render_overlay(); } catch (_) {}
}

function rebuildNodesFromCities(minPop = 30000, { preserveTracks = true } = {}){
  const oldTracks = preserveTracks && state.tracks
    ? Array.from(state.tracks.values()).map(t => ({
      from: t.from,
      to: t.to,
      lanes: t.lanes,
      status: t.status || "built",
      progress: Number(t.progress || 0),
      structureType: t.structureType || "surface",
      structureMult: Number(t.structureMult || 1),
      cost: t.cost || null
    }))
    : [];

  buildClusters(state.cities || [], minPop);

  if (preserveTracks) {
    try {
      layers.tracks?.clearLayers?.();
      layers.trackLabels?.clearLayers?.();
    } catch (_) {}
    if (state.tracks) state.tracks.clear();

    for (const t of oldTracks){
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
  }

  // prune line stops that no longer exist
  for (const line of state.lines.values()){
    if (!line || !Array.isArray(line.stops)) continue;
    line.stops = line.stops.filter(id => state.nodes.has(id));
  }

  renderClusterMarkers();
  syncMarkerVisibility();
  renderLines();
  updateUI();
}

// ======================
// Rendering: clusters + cities
// ======================
function makeClusterDotIcon(cluster) {
  const active = state.selectedNode?.id === cluster.id;
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div class="cluster-dot ${active ? "active" : ""}"></div>`
  });
}

function production_makeNodeIcon(nodeId, size = 18){
  if (typeof production_primaryItem !== "function") return null;
  const item = production_primaryItem(nodeId);
  if (!item) return null;
  const iconHtml = item.iconSvg
    ? `<img src="${item.iconSvg}" style="width:${size}px;height:${size}px;image-rendering:pixelated;">`
    : `<div style="width:${size}px;height:${size}px;border-radius:4px;background:${item.color};color:#fff;font-weight:900;font-size:${Math.max(9, size - 8)}px;display:flex;align-items:center;justify-content:center;">${item.icon || ""}</div>`;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: iconHtml
  });
}

// ======================
// Station busyness overlay (service-based, visual-only)
// ======================

function computeStationIntensity(){
// intensity per nodeId based on services that stop there
const m = new Map();

for (const line of state.lines.values()){
  if (!line || !Array.isArray(line.stops) || line.stops.length < 1) continue;

  const freq = Math.max(0, Number(line.frequencyPerDay || 0));
  const cap = Math.max(0, Number(line.vehicleCapacity || 0));

  // Type weight: passengers feel “busy”, cargo less visually busy
  const typeW =
    line.type === "passenger" ? 1.0 :
    line.type === "mixed" ? 0.75 :
    line.type === "cargo" ? 0.45 : 0.8;

  const score = freq * cap * typeW; // “people-throughput-like”

  for (const id of line.stops){
    const key = String(id);
    m.set(key, (m.get(key) || 0) + score);
  }
}

return m;
}

function stationPressureColor01(p01){
// p01 is 0..1 (0 = calm/green, 1 = overloaded/red)
const t = clamp(Number(p01) || 0, 0, 1);
const hue = 120 * (1 - t); // 120=green -> 0=red
return `hsl(${hue}, 85%, 45%)`;
}

function renderStationBusyness(nodeIds){
  if (state.primaryTab === "production") {
    layers.stationOverlay.clearLayers();
    return;
  }
  layers.stationOverlay.clearLayers();

const intensity = computeStationIntensity();
if (!intensity || intensity.size === 0) return;

// Find max in this view so scaling feels good locally
let max = 0;
for (const id of nodeIds){
  const v = intensity.get(String(id)) || 0;
  if (v > max) max = v;
}
if (max <= 0) return;

for (const id of nodeIds){
  const nodeId = String(id || "");
  let n = state.nodes.get(nodeId);
  if (!n) {
    const station = state.stations.get(nodeId);
    if (station && Number.isFinite(station.lat) && Number.isFinite(station.lon)) {
      n = {
        id: station.id,
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        kind: "station"
      };
    }
  }
  if (!n) continue;

  const v = intensity.get(String(id)) || 0;
  if (v <= 0) continue;

  // Normalize (log scale so big hubs don’t dominate too hard)
  const t = Math.log10(1 + v) / Math.log10(1 + max); // 0..1

  // Ring radius: bigger for busier stations
  const r = 8 + t * 18;

  // --- Pressure model (safe + simple) ---
  // capacity grows with platforms; amenities reduce effective pressure
  const st = getStation(String(id));
  const platforms = Math.max(1, Number(st?.platforms || 1));
  const amenities = Math.max(0, Number(st?.amenities || 0));

  const capacity = platforms * 5000 * (1 + amenities * 0.35);
  const rawPressure = capacity > 0 ? (v / capacity) : 0;

  // Convert to 0..1 where 1 means "overloaded"
  const p01 = clamp(rawPressure, 0, 1);

  // Color by pressure (green -> red)
  const col = stationPressureColor01(p01);

  const marker = L.circleMarker([n.lat, n.lon], {
    radius: r,
    pane: "stationPane",
    color: col,
    weight: 1.5,
    opacity: 0.35 + t * 0.65,
    fillColor: col,
    fillOpacity: 0.08 + p01 * 0.08,
    interactive: false,
    className: "station-busy"
  }).addTo(layers.stationOverlay);

    marker.bringToFront();

    const el = marker.getElement();
    if (el) {
    // pulse strength: slightly stronger if pressure is higher
    const pulse = clamp(0.35 + t * 0.45 + p01 * 0.35, 0.15, 1.25);
    el.style.setProperty("--pulse-strength", pulse.toFixed(2));
  }
}
}





function renderRealInfrastructureOverlay(){
  layers.railInfra.clearLayers();
  if (!map || !state.mapLayers?.showRealInfra) return;
  if (!state.railLinks || !state.railNodes) return;
  const zoom = map.getZoom();
  if (zoom < 5) return;
  const sampleStep = zoom < 6 ? 5 : zoom < 7 ? 3 : 1;
  const style = {
    color: "#22d3ee",
    weight: zoom >= 9 ? 2.6 : 1.8,
    opacity: zoom >= 7 ? 0.6 : 0.35,
    interactive: false,
    pane: "stationPane"
  };

  const nodes = state.railNodes;
  const stations = state.stations || new Map();
  const resolveCoord = (id) => {
    const node = nodes.get(String(id));
    if (node && Number.isFinite(Number(node?.lat)) && Number.isFinite(Number(node?.lon))) {
      return [Number(node.lat), Number(node.lon)];
    }
    const station = stations.get(String(id));
    if (station && Number.isFinite(Number(station?.lat)) && Number.isFinite(Number(station?.lon))) {
      return [Number(station.lat), Number(station.lon)];
    }
    return null;
  };

  let idx = 0;
  for (const link of state.railLinks.values()){
    idx++;
    if (sampleStep > 1 && (idx % sampleStep) !== 0) continue;
    if (!link || !link.a || !link.b) continue;
    const from = resolveCoord(link.a);
    const to = resolveCoord(link.b);
    if (!from || !to) continue;
    L.polyline([from, to], style).addTo(layers.railInfra);
  }
}

const MAP_STATION_MARKER_STYLE = {
  pane: "stationPane",
  interactive: true
};

function renderStationMarkers(){
  layers.stationMarkers.clearLayers();
  if (!map || !state.mapLayers?.showStations) return;
  if (!state.stations || !state.stations.size) return;

  const lineCounts = (typeof computeStationLineCounts === "function")
    ? computeStationLineCounts()
    : new Map();
  const highlightUnused = !!state.mapLayers?.highlightUnusedStations;

  for (const station of state.stations.values()){
    if (!station) continue;
    const lat = Number(station.lat);
    const lon = Number(station.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const linesServed = lineCounts.get(station.id) || 0;
    const isUnused = highlightUnused && linesServed === 0;
    const activeColor = station.active ? "#0f172a" : "#475569";
    const highlightColor = isUnused ? "#f97316" : activeColor;

    const coverageKm = Math.max(0, Number(station.coverageKm ?? (window.STATION_COVERAGE_KM ?? 10)));
    if (coverageKm > 0) {
      const circle = L.circle([lat, lon], {
        radius: coverageKm * 1000,
        color: station.active ? (isUnused ? "#fbbf24" : "#38bdf8") : "#94a3b8",
        fillColor: station.active ? (isUnused ? "#fbbf24" : "#38bdf8") : "#94a3b8",
        fillOpacity: station.active ? 0.08 : 0.04,
        weight: 1.2,
        interactive: false,
        pane: "stationPane"
      });
      circle.addTo(layers.stationMarkers);
    }

    const tooltipHtml = `
      <div style="font-weight:900;">${escapeHtml(station.name || station.id)}</div>
      <div style="font-size:11px;">Serves ${fmtNum(Math.round(station.coveredPopulation || 0))} people · ${coverageKm.toFixed(1)} km radius</div>
      <div style="font-size:11px;">Covering ${fmtNum(Number(station.coveredCities || 0))} cities</div>
      <div style="font-size:11px;">${linesServed ? `${fmtNum(linesServed)} line${linesServed === 1 ? "" : "s"} serve this station` : "Unused (no lines)"}${isUnused ? " · highlighted" : ""}</div>
    `;

    const marker = L.circleMarker([lat, lon], {
      radius: 6,
      weight: 2,
      color: highlightUnused && isUnused ? "#f97316" : highlightColor,
      fillColor: highlightUnused && isUnused ? "#fdba74" : (station.active ? "#38bdf8" : "#94a3b8"),
      fillOpacity: 0.95,
      ...MAP_STATION_MARKER_STYLE
    });
    marker.on("click", () => {
      if (typeof selectNode === "function") selectNode(station.id);
    });
    marker.on("dblclick", (e) => {
      L.DomEvent.stop(e);
      if (typeof ui_centerOnNodeId === "function") ui_centerOnNodeId(station.id);
    });
    marker.on("mouseover", () => showNodeHover?.(station.id, lat, lon));
    marker.on("mouseout", hideNodeHover);
    marker.addTo(layers.stationMarkers);
  }
}

function overlayNodeIds(){
  if (!map) return [];
  if (state.stations && state.stations.size) return Array.from(state.stations.keys());
  return [];
}

function render_network(){
  if (!map) return;
  try { syncMarkerVisibility(); } catch (_) {}
  try { renderLines(); } catch (_) {}
  try { renderCountryBorder(); } catch (_) {}
}

function render_overlay(){
  if (!map) return;
  if (overlayRenderQueued) return;
  overlayRenderQueued = true;
  requestAnimationFrame(() => {
    overlayRenderQueued = false;
    if (!map) return;
    const start = state.debug?.perf ? performance.now() : null;
    const nodeIds = overlayNodeIds();
    try { renderStationBusyness(nodeIds); } catch (_) {}
    try { renderRealInfrastructureOverlay(); } catch (_) {}
    try { if (typeof dynFlow_render === "function") dynFlow_render(); } catch (_) {}
    try { renderDemandOverlays(); } catch (_) {}
    if (start) perfLog("render_overlay", start);
  });
}

function heatColor(ratio){
  const clamped = clamp(Number(ratio) || 0, 0, 1);
  const hue = 200 - clamped * 180;
  const light = 70 - clamped * 25;
  return `hsl(${hue}, 78%, ${light}%)`;
}

function underservedColor(ratio){
  const clamped = clamp(Number(ratio) || 0, 0, 1);
  const hue = 120 - clamped * 120;
  const light = 72 - clamped * 32;
  return `hsl(${hue}, 82%, ${light}%)`;
}

function catchmentColor(seed){
  const hash = hash01(seed || "");
  const hue = Math.round((hash || 0) * 360);
  return `hsl(${hue}, 68%, 55%)`;
}

function renderComarcaBorders(){
  layers.comarcaBorders.clearLayers();
  if (!map || !state.mapLayers?.showComarcaBorders) return;
  if (!state.cells || state.cells.size === 0) return;
  const features = [];
  for (const cell of state.cells.values()){
    if (!cell?.geometry) continue;
    features.push({
      type: "Feature",
      geometry: cell.geometry,
      properties: { id: cell.id, name: cell.name }
    });
  }
  if (!features.length) return;
  L.geoJSON({ type: "FeatureCollection", features }, {
    style: {
      color: "#94a3b8",
      weight: 1.2,
      opacity: 0.8,
      fillOpacity: 0,
      dashArray: "4,6"
    },
    interactive: false
  }).addTo(layers.comarcaBorders);
}

function renderDemandHeatOverlay(){
  layers.demandHeat.clearLayers();
  if (!map || !state.mapLayers?.showDemandHeat) return;
  if (!state.cells || state.cells.size === 0) return;
  let maxPop = 1;
  for (const cell of state.cells.values()){
    if (!cell) continue;
    maxPop = Math.max(maxPop, Number(cell.pop || 0));
  }
  const features = [];
  for (const cell of state.cells.values()){
    if (!cell?.geometry) continue;
    features.push({
      type: "Feature",
      geometry: cell.geometry,
      properties: {
        id: cell.id,
        name: cell.name,
        ratio: maxPop ? (Number(cell.pop || 0) / maxPop) : 0
      }
    });
  }
  if (!features.length) return;
  const getHeatStyle = (feature) => {
    const ratio = Number(feature?.properties?.ratio || 0);
    const isActive = feature?.properties?.id === state.selectedCellId;
    return {
      fillColor: heatColor(ratio),
      fillOpacity: isActive ? 0.7 : 0.45,
      color: "#0f172a",
      opacity: isActive ? 0.9 : 0.55,
      weight: isActive ? 2 : 0.5
    };
  };
  L.geoJSON({ type: "FeatureCollection", features }, {
    style: getHeatStyle,
    interactive: true,
    onEachFeature: (feature, layer) => {
      const cellId = feature?.properties?.id;
      if (!cellId) return;
      layer.on("click", (event) => {
        event?.originalEvent?.stopPropagation?.();
        if (typeof selectDemandCell === "function") selectDemandCell(cellId);
      });
      layer.on("mouseover", () => {
        layer.setStyle({ weight: 1.8, opacity: 0.85 });
      });
      layer.on("mouseout", () => {
        layer.setStyle(getHeatStyle(feature));
      });
    },
    pane: "overlayPane"
  }).addTo(layers.demandHeat);
}

function renderUnderservedOverlay(){
  layers.underserved.clearLayers();
  if (!map || !state.mapLayers?.showUnderserved) return;
  if (!state.cells || state.cells.size === 0) return;
  if (!state.underservedByCell || state.underservedByCell.size === 0) return;
  let max = 1;
  for (const value of state.underservedByCell.values()){
    max = Math.max(max, Number(value || 0));
  }
  const features = [];
  for (const cell of state.cells.values()){
    if (!cell?.geometry) continue;
    const underst = Number(state.underservedByCell.get(cell.id) || 0);
    const ratio = cell.pop ? (underst / (cell.pop || 1)) : 0;
    features.push({
      type: "Feature",
      geometry: cell.geometry,
      properties: {
        id: cell.id,
        name: cell.name,
        ratio: clamp(ratio, 0, 1),
        value: underst
      }
    });
  }
  if (!features.length) return;
  L.geoJSON({ type: "FeatureCollection", features }, {
    style: (feature) => {
      const ratio = Number(feature?.properties?.ratio || 0);
      return {
        fillColor: underservedColor(ratio),
        fillOpacity: 0.55,
        color: "#0f172a",
        opacity: 0.45,
        weight: 0.6
      };
    },
    interactive: false
  }).addTo(layers.underserved);
}

function renderCatchmentsOverlay(){
  layers.catchments.clearLayers();
  if (!map || !state.mapLayers?.showCatchments) return;
  if (!state.catchmentByCell || state.catchmentByCell.size === 0) return;
  for (const [cellId, stationId] of state.catchmentByCell.entries()){
    const cell = state.cells?.get(cellId);
    const station = state.stations?.get(String(stationId));
    if (!cell || !station) continue;
    if (!Number.isFinite(cell.centroidLat) || !Number.isFinite(cell.centroidLon)) continue;
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    const color = catchmentColor(stationId);
    L.polyline([
      [cell.centroidLat, cell.centroidLon],
      [station.lat, station.lon]
    ], {
      color,
      weight: 1.8,
      opacity: 0.85,
      interactive: false
    }).addTo(layers.catchments);
    L.circleMarker([cell.centroidLat, cell.centroidLon], {
      radius: 3,
      color: "#fff",
      weight: 1,
      fillColor: color,
      fillOpacity: 0.85,
      interactive: false
    }).addTo(layers.catchments);
  }
}

function renderDemandOverlays(){
  if (!map) return;
  renderComarcaBorders();
  renderDemandHeatOverlay();
  renderUnderservedOverlay();
  renderCatchmentsOverlay();
}

function renderClusterMarkers(){
  if (!state.mapLayers?.showClusters) {
    layers.clusters.clearLayers();
    return;
  }
  layers.clusters.clearLayers();

  for (const cl of state.clusters.values()) {
    const prodIcon = (state.primaryTab === "production") ? production_makeNodeIcon(cl.id, 18) : null;
    const marker = L.marker([cl.lat, cl.lon], {
      icon: prodIcon || makeClusterDotIcon(cl),
      keyboard: false
    });


    // Left click: select node (for lines/tracks)
    marker.on("click", () => selectNode(cl.id));
marker.on("dblclick", (e) => {
L.DomEvent.stop(e);
ui_centerOnNodeId(cl.id);
});


    // Right click: zoom into cluster
    marker.on("contextmenu", (e) => {
      L.DomEvent.preventDefault(e);
      enterCluster(cl.id);
    });

marker.on("mouseover", () => showNodeHover(cl.id, marker.getLatLng().lat, marker.getLatLng().lng));
marker.on("mouseout", hideNodeHover);

    marker.addTo(layers.clusters);

  }

  try { render_overlay(); } catch (_) {}
}

function renderCityMarkers(cityIds){
  if (!state.mapLayers?.showCities) {
    layers.cities.clearLayers();
    return;
  }
  layers.cities.clearLayers();

  for (const id of cityIds) {
    const n = state.nodes.get(id);
    if (!n || n.kind !== "city") continue;

    let m;
    const cityPop = Math.max(0, Number(n.population || n.pop || n.pob || 0));
    const tooltipHtml = `
      <div style="font-weight:900;">${escapeHtml(n.name || n.id)}</div>
      <div style="font-size:11px;">Population ${fmtNum(Math.round(cityPop))}</div>
    `;
    if (state.primaryTab === "production") {
      const icon = production_makeNodeIcon(n.id, 14);
      if (icon) {
        m = L.marker([n.lat, n.lon], { icon, keyboard: false });
      } else {
        m = L.circleMarker([n.lat, n.lon], {
          radius: 4,
          color: "#0f172a",
          weight: 1,
          fillColor: "#94a3b8",
          fillOpacity: 0.78
        });
      }
    } else {
      // Cities stay normal small dots (for realism and performance)
      const pop = n.population || 0;
      const r = Math.max(3, Math.min(9, Math.log10(Math.max(1,pop)) * 2.1));
      const fill =
        pop >= 500000 ? "#ef4444" :
        pop >= 100000 ? "#f59e0b" : "#10b981";

      m = L.circleMarker([n.lat, n.lon], {
        radius: r,
        color: "#0f172a",
        weight: 1,
        fillColor: fill,
        fillOpacity: 0.78
      });
    }

    m.on("click", () => selectNode(n.id));
m.on("dblclick", (e) => {
L.DomEvent.stop(e);
ui_centerOnNodeId(n.id);
});
    m.addTo(layers.cities);
m.on("mouseover", () => showNodeHover(id, m.getLatLng().lat, m.getLatLng().lng));
m.on("mouseout", hideNodeHover);


  }

  try { render_overlay(); } catch (_) {}
}

function nearestClusterToView(){
  if (!map || !state.clusters || state.clusters.size === 0) return null;
  const center = map.getCenter();
  let best = null;
  for (const cl of state.clusters.values()) {
    const d = map.distance([cl.lat, cl.lon], [center.lat, center.lng]);
    if (!best || d < best.d) best = { id: cl.id, d };
  }
  return best ? state.clusters.get(best.id) : null;
}

function syncMarkerVisibility(){
  const z = map.getZoom();
  const showClusters = !!state.mapLayers?.showClusters;
  const showCities = !!state.mapLayers?.showCities;

  if (showClusters && z <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) {
    if (!map.hasLayer(layers.clusters)) layers.clusters.addTo(map);
    renderClusterMarkers();
  } else {
    layers.clusters.clearLayers();
    if (map.hasLayer(layers.clusters)) map.removeLayer(layers.clusters);
  }

  if (showCities) {
    if (!map.hasLayer(layers.cities)) layers.cities.addTo(map);
    const b = map.getBounds();
    const visible = [];
    for (const n of state.nodes.values()) {
      if (n.kind !== "city") continue;
      if (b.contains([n.lat, n.lon])) visible.push(n.id);
      if (visible.length >= 1500) break;
    }
    state.visibleCityIds = visible;
    renderCityMarkers(visible);
  } else {
    layers.cities.clearLayers();
    if (map.hasLayer(layers.cities)) map.removeLayer(layers.cities);
  }

  if (state.mapLayers?.showStations) {
    if (!map.hasLayer(layers.stationMarkers)) layers.stationMarkers.addTo(map);
    renderStationMarkers();
  } else {
    layers.stationMarkers.clearLayers();
    if (map.hasLayer(layers.stationMarkers)) map.removeLayer(layers.stationMarkers);
  }

  track_updateVisibility?.();
}

// ======================
// Cluster enter/leave UX
// ======================
function enterCluster(clusterId){
  const cl = state.clusters.get(clusterId);
  if (!cl) return;

  state.activeClusterId = clusterId;
  map.fitBounds(cl.bounds.pad(0.25), { maxZoom: 11 });

  updateClusterBar();
  syncMarkerVisibility();
  updateUI();
  showToast(`Entered cluster: ${cl.hubName}`, "success");
  renderClusterMarkers();
}

function leaveCluster(silent=false){
  state.activeClusterId = null;
  updateClusterBar();

  const view = state.worldView ? CONFIG.WORLD_VIEW : (state.countryView || CONFIG.SPAIN_VIEW);
  map.setView(view.center, view.zoom);

  syncMarkerVisibility();
  updateUI();
  if (!silent) showToast("Left cluster view", "info");
  renderClusterMarkers();
}

function updateClusterBar(){
  const bar = document.getElementById("clusterBar");
  if (!state.activeClusterId) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }
  const cl = state.clusters.get(state.activeClusterId);
  if (!cl) { bar.style.display="none"; bar.innerHTML=""; return; }

  bar.style.display = "block";
  bar.innerHTML = `
    <div class="rowTop">
      <div>
        <div class="name">Zoomed in: ${cl.hubName}</div>
        <div style="font-size:12px;color:#64748b;font-weight:900;">
          Cities: ${fmtNum(cl.cityIds.size)} • Pop: ${fmtNum(cl.population)}
        </div>
      </div>
      <button class="btnTiny" id="leaveClusterBtn">Leave</button>
    </div>
    <div style="margin-top:8px;" class="hint">
      <b>Global:</b> connect to the cluster hub. <b>Zoomed:</b> target real cities.
    </div>
  `;
  document.getElementById("leaveClusterBtn").onclick = () => leaveCluster(false);
}

window.render_network = render_network;
window.render_overlay = render_overlay;
window.renderDemandOverlays = renderDemandOverlays;
window.renderComarcaBorders = renderComarcaBorders;
window.renderDemandHeatOverlay = renderDemandHeatOverlay;
window.renderUnderservedOverlay = renderUnderservedOverlay;
window.renderCatchmentsOverlay = renderCatchmentsOverlay;
