/* global state, haversineKm */

const POP_POINT_GRID_SCALE = 0.05;
const POP_RADII_KM = [2, 5, 10, 20];

let popPoints = [];
let popGrid = new Map();

function bucketKey(lat, lon){
  const gx = Math.floor(lat / POP_POINT_GRID_SCALE);
  const gy = Math.floor(lon / POP_POINT_GRID_SCALE);
  return `${gx}|${gy}`;
}

function buildPopGrid(){
  popGrid.clear();
  for (const point of popPoints){
    if (!point) continue;
    const key = bucketKey(point.lat, point.lon);
    const list = popGrid.get(key) || [];
    list.push(point);
    popGrid.set(key, list);
  }
}

function queryNearbyPoints(lat, lon, radiusKm){
  if (!popPoints.length) return [];
  const degRadius = radiusKm / 111;
  const delta = Math.ceil(degRadius / POP_POINT_GRID_SCALE) || 1;
  const gx = Math.floor(lat / POP_POINT_GRID_SCALE);
  const gy = Math.floor(lon / POP_POINT_GRID_SCALE);
  const result = [];
  for (let dx = -delta; dx <= delta; dx++){
    for (let dy = -delta; dy <= delta; dy++){
      const bucket = popGrid.get(`${gx + dx}|${gy + dy}`);
      if (!bucket) continue;
      for (const point of bucket){
        if (!point) continue;
        const d = haversineKm(lat, lon, point.lat, point.lon);
        if (d <= radiusKm) {
          result.push(point);
        }
      }
    }
  }
  return result;
}

function stationPlacementPopSummary(lat, lon){
  const totals = {};
  for (const radius of POP_RADII_KM){
    const points = queryNearbyPoints(lat, lon, radius);
    const sum = points.reduce((acc, p) => acc + Math.max(0, Number(p.pop_est || 0)), 0);
    totals[radius] = sum;
  }
  const nearest = findNearestStation(lat, lon);
  return {
    lat,
    lon,
    totals,
    nearest
  };
}

function findNearestStation(lat, lon, maxKm = 30){
  if (!state?.stations?.size) return null;
  let best = null;
  let bestDist = Infinity;
  for (const station of state.stations.values()){
    if (!station || !station.active) continue;
    const d = haversineKm(lat, lon, Number(station.lat), Number(station.lon));
    if (d > maxKm) continue;
    if (d < bestDist){
      bestDist = d;
      best = station;
    }
  }
  if (!best) return null;
  return { station: best, distanceKm: bestDist };
}

async function loadPopPoints(){
  const url = "/data/es/pop_points_es.json";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    popPoints = data.filter(item => item && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)));
    buildPopGrid();
    console.info(`[pop_points] loaded ${popPoints.length} entries`);
  } catch (err) {
    console.warn("Failed to load pop points:", err);
  }
}

window.loadPopPoints = loadPopPoints;
window.stationPlacementPopSummary = stationPlacementPopSummary;
