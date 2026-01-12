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

  layers.clusters.addTo(map);
  layers.cities.addTo(map);
  layers.tracks.addTo(map);
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





function overlayNodeIds(){
  if (!map) return [];
  const mode = state.viewMode || "stations";
  if (mode === "stations" && state.stations && state.stations.size) {
    return Array.from(state.stations.keys());
  }
  if (mode === "clusters") {
    return Array.from(state.clusters.keys());
  }
  if (map.getZoom() <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) {
    return Array.from(state.clusters.keys());
  }
  if (Array.isArray(state.visibleCityIds) && state.visibleCityIds.length) {
    return state.visibleCityIds;
  }
  if (mode === "cities") {
    const fallback = [];
    for (const node of state.nodes.values()){
      if (node.kind === "city") {
        fallback.push(node.id);
        if (fallback.length >= 1500) break;
      }
    }
    if (fallback.length) return fallback;
  }
  return Array.from(state.nodes.values())
    .filter(node => node.kind === "city")
    .slice(0, 1500)
    .map(node => node.id);
}

function render_network(){
  if (!map) return;
  try { syncMarkerVisibility(); } catch (_) {}
  try { renderLines(); } catch (_) {}
  try { renderCountryBorder(); } catch (_) {}
}

function render_overlay(){
  if (!map) return;
  const nodeIds = overlayNodeIds();
  try { renderStationBusyness(nodeIds); } catch (_) {}
  try { if (typeof dynFlow_render === "function") dynFlow_render(); } catch (_) {}
  try { renderDemandOverlays(); } catch (_) {}
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
  L.geoJSON({ type: "FeatureCollection", features }, {
    style: (feature) => {
      const ratio = Number(feature?.properties?.ratio || 0);
      return {
        fillColor: heatColor(ratio),
        fillOpacity: 0.45,
        color: "#0f172a",
        opacity: 0.5,
        weight: 0.5
      };
    },
    interactive: false
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
  layers.cities.clearLayers();

  for (const id of cityIds) {
    const n = state.nodes.get(id);
    if (!n || n.kind !== "city") continue;

    let m;
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

  if (z <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) {
    layers.clusters.addTo(map);
    layers.cities.clearLayers();
    track_updateVisibility?.();
    return;
  }

  layers.clusters.removeFrom(map);

  const b = map.getBounds();
  const visible = [];
  for (const n of state.nodes.values()) {
    if (n.kind !== "city") continue;
    if (b.contains([n.lat, n.lon])) visible.push(n.id);
    if (visible.length >= 1500) break;
  }
  state.visibleCityIds = visible;
  renderCityMarkers(visible);
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
