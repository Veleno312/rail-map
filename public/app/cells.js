const CELL_DEFAULT_POP = 5000;
const POP_KEYS = ["population", "pop", "pob", "total_population", "habitantes", "pop_total"];

function detectPopulation(props){
  if (!props) return null;
  for (const key of POP_KEYS){
    for (const candidate of [key, key.toUpperCase(), key.toLowerCase()]){
      if (props[candidate] != null){
        const value = Number(props[candidate]);
        if (Number.isFinite(value)) return value;
      }
    }
  }
  return null;
}

function pointInPolygon(point, polygon){
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++){
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi + 0.000000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function geometryContainsPoint(geometry, point){
  if (!geometry || !Array.isArray(geometry.coordinates)) return false;
  if (geometry.type === "Polygon"){
    return pointInPolygon(point, geometry.coordinates[0]);
  }
  if (geometry.type === "MultiPolygon"){
    return geometry.coordinates.some(poly => pointInPolygon(point, poly[0]));
  }
  return false;
}

function centroidFromCoordinates(coords){
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const pair of coords){
    if (!Array.isArray(pair) || pair.length < 2) continue;
    sumX += pair[0];
    sumY += pair[1];
    count += 1;
  }
  if (count === 0) return null;
  return [sumY / count, sumX / count];
}

function computeCentroid(geometry){
  if (!geometry) return null;
  const coords = geometry.type === "Polygon"
    ? geometry.coordinates[0]
    : Array.isArray(geometry.coordinates[0])
      ? geometry.coordinates[0][0]
      : [];
  return centroidFromCoordinates(coords);
}

function sumPopulationFromCities(geometry, cities){
  if (!geometry || !Array.isArray(cities)) return 0;
  let total = 0;
  for (const city of cities){
    const lat = Number(city.lat);
    const lon = Number(city.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (geometryContainsPoint(geometry, [lon, lat])){
      total += Number(city.population ?? city.pop ?? city.pob ?? 0);
    }
  }
  return total;
}

async function loadComarcasGeoJSON(url){
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildCellsFromGeoJSON(geojson, options = {}){
  const cells = new Map();
  if (!geojson || !Array.isArray(geojson.features)) return cells;
  const cities = Array.isArray(options.cities) ? options.cities : [];

  for (const feature of geojson.features){
    if (!feature || !feature.geometry) continue;
    const props = feature.properties || {};
    const pop = detectPopulation(props) ?? sumPopulationFromCities(feature.geometry, cities) ?? CELL_DEFAULT_POP;
    const centroid = computeCentroid(feature.geometry) || [];
    const name = props.comarca_name || props.name || props.comarca || props.id || `Cell-${cells.size + 1}`;
    const cellId = String(props.comarca_id || props.id || name).toUpperCase();
    const geometry = feature.geometry || null;
    cells.set(cellId, {
      id: cellId,
      name,
      centroidLat: centroid[0] ?? 0,
      centroidLon: centroid[1] ?? 0,
      pop: Math.max(0, pop),
      jobs: Number(props.jobs || props.employment || 0),
      industryShares: props.industryShares || {},
      growth: Number(props.growth || 0),
      geometry,
      properties: props
    });
  }

  return cells;
}

window.loadComarcasGeoJSON = loadComarcasGeoJSON;
window.buildCellsFromGeoJSON = buildCellsFromGeoJSON;
