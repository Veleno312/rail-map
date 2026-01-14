const DEFAULT_TRACK_SPEED_KMH = 120;

function toNumberSafe(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const toRad = Math.PI / 180;
  const latRad1 = Number(lat1) * toRad;
  const latRad2 = Number(lat2) * toRad;
  const deltaLat = (Number(lat2) - Number(lat1)) * toRad;
  const deltaLon = (Number(lon2) - Number(lon1)) * toRad;
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(latRad1) * Math.cos(latRad2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildAdjacencyFromTracks(stations, tracks){
  const adjacency = new Map();

  if (!stations || !tracks) return adjacency;

  const addEdge = (from, edge) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(edge);
  };

  for (const track of tracks.values()){
    const from = String(track.from);
    const to = String(track.to);
    const frm = stations.get(from);
    const toNode = stations.get(to);
    if (!frm || !toNode) continue;

    const lat1 = Number(frm.lat);
    const lon1 = Number(frm.lon);
    const lat2 = Number(toNode.lat);
    const lon2 = Number(toNode.lon);

    let distanceKm = toNumberSafe(track.km ?? track.distanceKm ?? track.lengthKm);
    if (!distanceKm && Number.isFinite(lat1) && Number.isFinite(lat2)) {
      distanceKm = haversineKm(lat1, lon1, lat2, lon2);
    }

    const speed = Math.max(1, Number(track.maxSpeedKmh ?? track.speedKmh ?? DEFAULT_TRACK_SPEED_KMH));
    const timeMin = (distanceKm / Math.max(0.1, speed)) * 60;

    const edge = {
      to,
      timeMin,
      distanceKm,
      speedKmh: speed,
      track
    };

    addEdge(from, edge);
    addEdge(to, { ...edge, to: from, track });
  }

  return adjacency;
}

function defaultEdgeTime(edge){
  return toNumberSafe(edge?.timeMin);
}

function dijkstraTravelTime(from, to, adjacency, edgeTimeFn = defaultEdgeTime){
  if (!adjacency || !from || !to) return null;
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  dist.set(from, 0);

  while (true){
    let current = null;
    let best = Infinity;
    for (const [node, value] of dist){
      if (visited.has(node)) continue;
      if (value < best){
        best = value;
        current = node;
      }
    }
    if (current === null) break;
    if (current === to) break;
    visited.add(current);
    const neighbors = adjacency.get(current) || [];
    for (const edge of neighbors){
      const candidate = edgeTimeFn(edge, current);
      if (!Number.isFinite(candidate)) continue;
      const alt = dist.get(current) + candidate;
      const prevDist = dist.get(edge.to);
      if (prevDist === undefined || alt < prevDist){
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    }
  }

  if (!dist.has(to)) return null;

  const path = [];
  let cursor = to;
  while (cursor && cursor !== from && prev.has(cursor)){
    path.unshift(cursor);
    cursor = prev.get(cursor);
  }
  if (cursor) path.unshift(from);

  return { timeMin: dist.get(to), path };
}

function multiSourceDijkstra(sources, adjacency, edgeTimeFn = defaultEdgeTime){
  const result = new Map();
  const dist = new Map();
  const visited = new Set();

  if (!Array.isArray(sources) || sources.length === 0) return result;
  for (const src of sources){
    if (src) dist.set(src, 0);
  }

  while (true){
    let current = null;
    let best = Infinity;
    for (const [node, value] of dist){
      if (visited.has(node)) continue;
      if (value < best){
        best = value;
        current = node;
      }
    }
    if (current === null) break;
    visited.add(current);
    result.set(current, dist.get(current));
    const neighbors = adjacency.get(current) || [];
    for (const edge of neighbors){
      const candidate = edgeTimeFn(edge, current);
      if (!Number.isFinite(candidate)) continue;
      const alt = dist.get(current) + candidate;
      const prevDist = dist.get(edge.to);
      if (prevDist === undefined || alt < prevDist){
        dist.set(edge.to, alt);
      }
    }
  }

  return result;
}

window.haversineKm = haversineKm;
window.buildAdjacencyFromTracks = buildAdjacencyFromTracks;
window.dijkstraTravelTime = dijkstraTravelTime;
window.multiSourceDijkstra = multiSourceDijkstra;
