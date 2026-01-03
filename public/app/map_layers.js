// ======================
// Map + Layers
// ======================
let map;
const layers = {
clusters: L.layerGroup(),
cities: L.layerGroup(),
tracks: L.layerGroup(),
stationOverlay: L.layerGroup(), // NEW: busy station rings
trackLabels: L.layerGroup(),
lines: L.layerGroup(),
trains: L.layerGroup(),
flowOverlay: L.layerGroup(), // <-- NEW: animated trains live here
};

function initMap(){
  map = L.map("map").setView(CONFIG.SPAIN_VIEW.center, CONFIG.SPAIN_VIEW.zoom);
map.createPane("stationPane");
map.getPane("stationPane").style.zIndex = 650; // above markers, below UI
map.on("zoomend", () => {
if (state.activeTab === "network") {
  if (state.viewMode === "clusters") {
    renderStationBusyness(Array.from(state.clusters.keys()));
  } else {
    renderStationBusyness(Array.from(state.visibleCityIds || []));
  }
}
});


  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
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


  map.on("zoomend moveend", () => {
    syncMarkerVisibility();
    if (state.activeClusterId && map.getZoom() <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) {
      leaveCluster(true);
    }
  });
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
function buildClusters(cities){
  state.clusters.clear();

  const usable = cities
    .filter(c => Number(c?.lat) && Number(c?.lon) && Number(c?.population) >= 5000)
    .map(c => ({
      id: String(c.id),
      name: c.name,
      lat: Number(c.lat),
      lon: Number(c.lon),
      population: Number(c.population) || 0
    }));

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
  const n = state.nodes.get(String(id));
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





function renderClusterMarkers(){
  layers.clusters.clearLayers();

  for (const cl of state.clusters.values()) {
    const marker = L.marker([cl.lat, cl.lon], {
      icon: makeClusterDotIcon(cl),
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

  }      renderStationBusyness(Array.from(state.clusters.keys()));

}

function renderCityMarkers(cityIds){
  layers.cities.clearLayers();

  for (const id of cityIds) {
    const n = state.nodes.get(id);
    if (!n || n.kind !== "city") continue;

    // Cities stay normal small dots (for realism and performance)
    const pop = n.population || 0;
    const r = Math.max(3, Math.min(9, Math.log10(Math.max(1,pop)) * 2.1));
    const fill =
      pop >= 500000 ? "#ef4444" :
      pop >= 100000 ? "#f59e0b" : "#10b981";

    const m = L.circleMarker([n.lat, n.lon], {
      radius: r,
      color: "#0f172a",
      weight: 1,
      fillColor: fill,
      fillOpacity: 0.78
    });

    m.on("click", () => selectNode(n.id));
m.on("dblclick", (e) => {
L.DomEvent.stop(e);
ui_centerOnNodeId(n.id);
});
    m.addTo(layers.cities);
m.on("mouseover", () => showNodeHover(id, m.getLatLng().lat, m.getLatLng().lng));
m.on("mouseout", hideNodeHover);


  }

renderStationBusyness(cityIds);
}

function syncMarkerVisibility(){
  const z = map.getZoom();

  if (z <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) {
    layers.clusters.addTo(map);
    layers.cities.clearLayers();
    return;
  }

  layers.clusters.removeFrom(map);

  if (state.activeClusterId && state.clusters.has(state.activeClusterId)) {
    const cl = state.clusters.get(state.activeClusterId);
    renderCityMarkers(cl.cityIds);
    return;
  }

  const b = map.getBounds();
  const visible = [];
  for (const n of state.nodes.values()) {
    if (n.kind !== "city") continue;
    if (b.contains([n.lat, n.lon])) visible.push(n.id);
    if (visible.length >= 1800) break;
  }
  renderCityMarkers(visible);
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

  map.setView(CONFIG.SPAIN_VIEW.center, CONFIG.SPAIN_VIEW.zoom);

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
