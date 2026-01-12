/* global state */
const STATION_PREFIX = "ST-";
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

function buildStationsFromCities(cities, options = {}){
  const threshold = Number(options.populationThreshold ?? DEFAULT_STATION_POP);
  const target = (options.target instanceof Map) ? options.target : new Map();

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
    target.set(stationId, {
      ...existing,
      id: stationId,
      cityId: String(city.id || ""),
      name: city.name || city.city || `City ${city.id || ""}`,
      lat,
      lon,
      population: Math.max(0, Number.isFinite(pop) ? pop : 0),
      active: true,
      source: "city"
    });
  }
  return target;
}

function findCityById(cityId){
  if (!Array.isArray(state.cities)) return null;
  const cid = String(cityId || "").toUpperCase();
  return state.cities.find(c => String(c?.id || "").toUpperCase() === cid) || null;
}

function createStationFromCity(cityId){
  const city = findCityById(cityId);
  if (!city) return null;
  const stationId = stationIdFromCity(city);
  if (!stationId) return null;
  const lat = Number(city.lat);
  const lon = Number(city.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const station = {
    id: stationId,
    cityId: String(city.id || ""),
    name: city.name || city.city || `City ${city.id || ""}`,
    lat,
    lon,
    population: Math.max(0, Number(city.population ?? city.pop ?? city.pob ?? 0)),
    active: true,
    source: "city"
  };
  state.stations.set(stationId, station);
  return station;
}

function toggleStation(stationId){
  const id = String(stationId || "");
  const station = state.stations.get(id);
  if (!station) return null;
  station.active = !station.active;
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

window.buildStationsFromCities = buildStationsFromCities;
window.createStationFromCity = createStationFromCity;
window.toggleStation = toggleStation;
window.ensureStationForNode = ensureStationForNode;
window.migrateLineStopsToStations = migrateLineStopsToStations;
