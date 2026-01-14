/* global state */
const STATION_PREFIX = "ST-";
const DEFAULT_STATION_COVERAGE_KM = 10;
const toRad = Math.PI / 180;
function stationDistanceKm(lat1, lon1, lat2, lon2){
  const phi1 = Number(lat1) * toRad;
  const phi2 = Number(lat2) * toRad;
  const dPhi = (Number(lat2) - Number(lat1)) * toRad;
  const dLambda = (Number(lon2) - Number(lon1)) * toRad;
  const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function cityKeyFromCity(city){
  if (!city) return null;
  const primary = city.id ?? city.city ?? city.name;
  if (primary) return String(primary).trim();
  const lat = Number(city.lat);
  const lon = Number(city.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `${lat.toFixed(5)}_${lon.toFixed(5)}`;
  return null;
}

function ensureCityStationAllocationMap(){
  if (!state.cityStationAllocation || typeof state.cityStationAllocation.clear !== "function") {
    state.cityStationAllocation = new Map();
  }
  return state.cityStationAllocation;
}

function ensureStationCityAllocationsMap(){
  if (!state.stationCityAllocations || typeof state.stationCityAllocations.clear !== "function") {
    state.stationCityAllocations = new Map();
  }
  return state.stationCityAllocations;
}
const DEFAULT_STATION_POP = 20_000;

function stationIdFromCity(city){
  if (!city) return null;
  const key = city.id ?? city.city ?? city.name ?? `${city.lat}_${city.lon}`;
  const safe = String(key || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!safe) return null;
  return `${STATION_PREFIX}${safe}`;
}

function buildStationsFromCities(cities, options = {}) {
  const threshold = Number(options.populationThreshold ?? DEFAULT_STATION_POP);
  const target = (options.target instanceof Map) ? options.target : new Map();
  const coverageKm = Number(options.coverageKm ?? DEFAULT_STATION_COVERAGE_KM);

  if (!Array.isArray(cities)) return target;

  for (const city of cities){
    if (!city) continue;
    const pop = Number(city.population ?? city.pop ?? city.pob ?? 0);
    if (Number.isFinite(pop) && pop > 0 && pop < threshold) continue;
    const lat = Number(city.lat);
    const lon = Number(city.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const stationId = stationIdFromCity(city);
    if (!stationId) continue;
    const existing = target.get(stationId) || {};
    const active = typeof existing.active === "boolean" ? existing.active : true;
    const stationCoverage = Number(existing.coverageKm ?? coverageKm);
    target.set(stationId, {
      ...existing,
      id: stationId,
      cityId: String(city.id || ""),
      name: city.name || city.city || `City ${city.id || ""}`,
      lat,
      lon,
      population: Math.max(0, Number.isFinite(pop) ? pop : 0),
      active,
      source: existing.source || "city",
      coverageKm: stationCoverage,
      coveredPopulation: existing.coveredPopulation || 0,
      coveredCities: existing.coveredCities || 0
    });
  }
  return target;
}

function findCityById(cityId){
  if (!Array.isArray(state.cities)) return null;
  const cid = String(cityId || "").toUpperCase();
  return state.cities.find(c => String(c?.id || "").toUpperCase() === cid) || null;
}

function createStationFromCity(cityId, options = {}){
  const city = findCityById(cityId);
  if (!city) return null;
  const stationId = stationIdFromCity(city);
  if (!stationId) return null;
  const lat = Number(city.lat);
  const lon = Number(city.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const population = Math.max(0, Number(city.population ?? city.pop ?? city.pob ?? 0));
  const base = {
    id: stationId,
    cityId: String(city.id || ""),
    name: city.name || city.city || `City ${city.id || ""}`,
    lat,
    lon,
    population,
    active: true,
    source: options.saveAsCustom ? "custom" : "city",
    coverageKm: Number(options.coverageKm ?? DEFAULT_STATION_COVERAGE_KM),
    coveredPopulation: 0,
    coveredCities: 0
  };

  if (options.saveAsCustom && typeof registerCustomStation === "function") {
    const custom = registerCustomStation(base);
    if (custom) return custom;
  }

  state.stations.set(stationId, base);
  return base;
}

function toggleStation(stationId){
  const id = String(stationId || "");
  const station = state.stations.get(id);
  if (!station) return null;
  station.active = !station.active;
  const disabled = ensureDisabledStationsSet();
  if (!station.active) {
    disabled.add(id);
  } else {
    disabled.delete(id);
  }
  return station.active;
}

function ensureStationForNode(nodeId){
  if (!nodeId) return null;
  const strId = String(nodeId);
  if (state.stations.has(strId)) return strId;
  const node = state.nodes.get(strId);
  if (!node) return null;
  const stationId = stationIdFromCity(node) || strId;
  if (!stationId) return null;
  if (!state.stations.has(stationId)) {
    state.stations.set(stationId, {
      id: stationId,
      cityId: strId,
      name: node.name || `Node ${strId}`,
      lat: Number(node.lat),
      lon: Number(node.lon),
      population: Math.max(0, Number(node.population || 0)),
      active: true,
      source: "node"
    });
  }
  return stationId;
}

function getStationIdByCityId(cityId){
  const target = String(cityId || "");
  if (!target) return null;
  for (const station of state.stations.values()){
    if (String(station.cityId || "").toUpperCase() === target.toUpperCase()) return station.id;
  }
  return null;
}

function nodeToStationId(nodeId, { createIfMissing = false } = {}){
  const cityId = String(nodeId || "").trim();
  if (!cityId) return null;
  const existing = getStationIdByCityId(cityId);
  if (existing) return existing;
  if (!createIfMissing) return null;
  const station = createStationFromCity(cityId);
  return station ? station.id : null;
}

function convertNodesToStationIds(nodes = [], options = {}){
  const seen = new Set();
  const result = [];
  for (const nodeId of nodes){
    const stationId = nodeToStationId(nodeId, options);
    if (!stationId) continue;
    if (seen.has(stationId)) continue;
    seen.add(stationId);
    result.push(stationId);
  }
  return result;
}

function migrateLineStopsToStations(lines){
  if (!lines || typeof lines.forEach !== "function") return;
  for (const line of lines.values()){
    if (!line || !Array.isArray(line.stops)) continue;
    const updated = [];
    for (const stopId of line.stops){
      const stationId = ensureStationForNode(stopId);
      if (stationId) updated.push(stationId);
    }
    line.stops = updated;
  }
}

function ensureCustomStationsMap(){
  if (!state.customStations || typeof state.customStations.set !== "function") {
    state.customStations = new Map();
  }
  return state.customStations;
}

function ensureDisabledStationsSet(){
  if (!state.disabledStations || typeof state.disabledStations.add !== "function") {
    state.disabledStations = new Set();
  }
  return state.disabledStations;
}

function registerCustomStation(def){
  if (!def || typeof def !== "object") return null;
  const lat = Number(def.lat);
  const lon = Number(def.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const id = String(def.id || def.stationId || "").trim() || `st_custom_${Date.now().toString(36)}-${Math.floor(Math.random()*1000)}`;
  const name = String(def.name || def.label || id).trim() || id;
  const coverageKm = Number(def.coverageKm ?? DEFAULT_STATION_COVERAGE_KM);
  const station = {
    id,
    name,
    lat,
    lon,
    population: Math.max(0, Number(def.population || def.pop || 0)),
    active: def.active !== false,
    source: def.source || "custom",
    rail_node_id: def.rail_node_id || def.railNodeId || null,
    coverageKm,
    coveredPopulation: 0,
    coveredCities: 0
  };
  const custom = ensureCustomStationsMap();
  custom.set(id, station);
  state.stations.set(id, station);
  if (!station.active) ensureDisabledStationsSet().add(id);
  return station;
}

function applyCustomStations(){
  const custom = ensureCustomStationsMap();
  if (!custom || typeof custom.values !== "function") return;
  for (const station of custom.values()){
    if (!station || !station.id) continue;
    state.stations.set(station.id, station);
  }
}

function reapplyDisabledStations(){
  const disabled = ensureDisabledStationsSet();
  if (!disabled || typeof disabled.values !== "function") return;
  for (const id of disabled.values()){
    const station = state.stations.get(String(id));
    if (station) station.active = false;
  }
}

function assignStationPopulationFromCities(){
  if (!state.stations || !state.nodes) return;
  const cities = Array.from(state.nodes.values()).filter(n => n?.kind === "city");
  if (!cities.length) return;
  const defaultCoverage = Number(window.STATION_COVERAGE_KM ?? DEFAULT_STATION_COVERAGE_KM);

  const cityAlloc = ensureCityStationAllocationMap();
  const stationAlloc = ensureStationCityAllocationsMap();
  cityAlloc.clear();
  stationAlloc.clear();

  const stationList = Array.from(state.stations.values()).filter(Boolean);
  stationList.forEach(station => {
    station.coveredPopulation = 0;
    station.coveredCities = 0;
    station.devTracks = 0;
  });

  const trackConnections = new Map();
  if (state.tracks && typeof state.tracks.values === "function") {
    for (const track of state.tracks.values()){
      if (!track) continue;
      trackConnections.set(track.from, (trackConnections.get(track.from) || 0) + 1);
      trackConnections.set(track.to, (trackConnections.get(track.to) || 0) + 1);
    }
  }

  for (const station of stationList){
    station.devTracks = trackConnections.get(station.id) || 0;
  }

  for (const city of cities){
    const cityLat = Number(city.lat);
    const cityLon = Number(city.lon);
    if (!Number.isFinite(cityLat) || !Number.isFinite(cityLon)) continue;
    const cityPop = Math.max(0, Number(city.population ?? city.pop ?? city.pob ?? 0));
    if (!Number.isFinite(cityPop) || cityPop <= 0) continue;
    const cityKey = cityKeyFromCity(city);
    if (!cityKey) continue;
    const cityName = city.name || city.city || cityKey;
    const covering = [];
    const weights = [];
    for (const station of stationList){
      const coverageKm = Math.max(0, Number(station.coverageKm ?? defaultCoverage));
      if (!coverageKm) continue;
      const dist = stationDistanceKm(station.lat, station.lon, cityLat, cityLon);
      if (!Number.isFinite(dist) || dist > coverageKm) continue;
      const devFactor = 1 + Math.min(6, station.devTracks || 0);
      const distanceWeight = Math.max(0.1, coverageKm - dist);
      covering.push({ station, dist, coverageKm });
      weights.push(distanceWeight * devFactor);
    }
    if (!covering.length) continue;
    const totalWeight = weights.reduce((sum, w) => sum + (Math.max(0, w || 0)), 0) || 1;
    covering.forEach((entry, idx) => {
      const share = cityPop * ((weights[idx] || 0) / totalWeight);
      const station = entry.station;
      station.coveredPopulation = (station.coveredPopulation || 0) + share;
      const cityNodeId = String(city.id || cityKey);
      const stationEntry = {
        stationId: station.id,
        stationName: station.name,
        cityId: cityKey,
        cityName,
        cityNodeId,
        share,
        sharePct: cityPop ? (share / cityPop) : 0,
        distanceKm: Number.isFinite(entry.dist) ? entry.dist : 0,
        coverageKm: entry.coverageKm
      };
      const byCity = cityAlloc.get(cityKey) || [];
      byCity.push(stationEntry);
      cityAlloc.set(cityKey, byCity);
      const byStation = stationAlloc.get(station.id) || [];
      byStation.push(stationEntry);
      stationAlloc.set(station.id, byStation);
    });
  }

  for (const entries of cityAlloc.values()){
    entries.sort((a,b) => (Number(b.share || 0) - Number(a.share || 0)));
  }
  for (const [stationId, entries] of stationAlloc.entries()){
    entries.sort((a,b) => (Number(b.share || 0) - Number(a.share || 0)));
    const station = state.stations.get(stationId);
    if (station) {
      station.coveredCities = entries.length;
    }
  }

  for (const station of stationList){
    station.population = Math.max(Number(station.population || 0), Math.round(station.coveredPopulation || 0));
  }
}

window.buildStationsFromCities = buildStationsFromCities;
window.createStationFromCity = createStationFromCity;
window.toggleStation = toggleStation;
window.ensureStationForNode = ensureStationForNode;
window.migrateLineStopsToStations = migrateLineStopsToStations;
window.nodeToStationId = nodeToStationId;
window.convertNodesToStationIds = convertNodesToStationIds;
window.getStationIdByCityId = getStationIdByCityId;
window.registerCustomStation = registerCustomStation;
window.applyCustomStations = applyCustomStations;
window.reapplyDisabledStations = reapplyDisabledStations;
window.assignStationPopulationFromCities = assignStationPopulationFromCities;
window.cityKeyFromCity = cityKeyFromCity;
window.STATION_COVERAGE_KM = DEFAULT_STATION_COVERAGE_KM;
