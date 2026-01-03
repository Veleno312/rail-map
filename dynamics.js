// public/dynamics.js
// Pure (no DOM, no Leaflet). Safe defaults everywhere.

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad((b.lat || 0) - (a.lat || 0));
  const dLon = toRad((b.lon || 0) - (a.lon || 0));
  const lat1 = toRad(a.lat || 0);
  const lat2 = toRad(b.lat || 0);

  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

export function buildTrackGraph(state) {
  const graph = new Map(); // nodeId -> [{to, km, lanes}]
  const tracks = state?.tracks;

  if (!tracks || typeof tracks.values !== "function") return graph;

  for (const t of tracks.values()) {
    if (!t || !t.from || !t.to) continue;

    const A = state?.nodes?.get?.(t.from);
    const B = state?.nodes?.get?.(t.to);
    if (!A || !B) continue;

    const km = haversineKm(A, B);
    const lanes = Math.max(1, Number(t.lanes || 1));

    if (!graph.has(t.from)) graph.set(t.from, []);
    if (!graph.has(t.to)) graph.set(t.to, []);

    graph.get(t.from).push({ to: t.to, km, lanes });
    graph.get(t.to).push({ to: t.from, km, lanes });
  }

  return graph;
}

export function shortestPathBetweenNodes(graph, fromId, toId) {
  // Dijkstra (km weight). Returns { path: [nodeIds], distanceKm }
  if (!graph?.has?.(fromId) || !graph?.has?.(toId)) {
    return { path: null, distanceKm: Infinity };
  }
  if (fromId === toId) return { path: [fromId], distanceKm: 0 };

  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  dist.set(fromId, 0);

  while (true) {
    // pick smallest unvisited
    let u = null;
    let best = Infinity;
    for (const [id, d] of dist.entries()) {
      if (visited.has(id)) continue;
      if (d < best) { best = d; u = id; }
    }
    if (u === null) break;         // disconnected
    if (u === toId) break;         // reached
    visited.add(u);

    const edges = graph.get(u) || [];
    for (const e of edges) {
      const nd = best + (e.km || 0);
      if (!dist.has(e.to) || nd < dist.get(e.to)) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
      }
    }
  }

  const dEnd = dist.get(toId);
  if (!Number.isFinite(dEnd)) return { path: null, distanceKm: Infinity };

  // rebuild path
  const path = [];
  let cur = toId;
  while (cur != null) {
    path.push(cur);
    cur = prev.get(cur) || (cur === fromId ? null : null);
    if (path[path.length - 1] === fromId) break;
  }
  path.reverse();

  if (path[0] !== fromId) return { path: null, distanceKm: Infinity };
  return { path, distanceKm: dEnd };
}

export function computeFlows(state /*, map */) {
  const dyn = state?.dynamics || {};
  const enabled = !!dyn.enabled;

  const result = {
    deliveredGoodsEUR: 0,
    deliveredPassengersEUR: 0,
    lostDemandEUR: 0,
    congestionPenaltyEUR: 0,

    goodsDelivered: 0,
    goodsUnmet: 0,
    passengerTrips: 0,
    passengerUnmet: 0,
    demandMetPct: 0,

    flows: []
  };

  if (!enabled) return result;

  const graph = buildTrackGraph(state);
  const nodes = state?.nodes;

  // -------------------------
  // Safe helpers (scoped here so no global name conflicts)
  // -------------------------
  const edgeKey = (a, b) => (String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`);

  const getEdgeLanes = (g, a, b) => {
    try {
      const edges = g?.get?.(a);
      if (!edges) return 1;
      for (const e of edges) {
        if (e && e.to === b) return Math.max(1, Number(e.lanes || 1));
      }
    } catch (_) {}
    return 1;
  };

  // Capacity per lane per year (toy constants for now; tweak later)
  const GOODS_UNITS_PER_LANE_PER_YEAR = 8000;  // “goods units” / lane / year
  const PAX_TRIPS_PER_LANE_PER_YEAR  = 25000;  // trips / lane / year

  // Demand value constants (placeholders)
  const GOODS_EUR_PER_UNIT = 1; // € per "goods unit"
  const PAX_EUR_PER_TRIP = 2;   // € per passenger trip

// Use both cities and clusters so overlay works while zoomed out.
const demandNodes = [];
if (nodes?.values) {
  for (const n of nodes.values()) {
    if (!n) continue;
    if (n.kind === "city" || n.kind === "cluster") demandNodes.push(n);
  }
}
if (demandNodes.length < 2) return result;

// Sort by "population-like" weight
const nodePop = (n) => {
  if (n.kind === "city") return Number(n.population || 0);
  // clusters use sumPop in your state
  return Number(n.sumPop || n.population || 0);
};

// Prefer nodes that are actually in the built track graph,
// otherwise the top-25-by-pop can miss the player's network => zero flows.
const connectedIds = new Set();
if (graph && typeof graph.keys === "function") {
  for (const id of graph.keys()) connectedIds.add(String(id));
}

const connectedDemandNodes = demandNodes.filter(n => connectedIds.has(String(n.id)));

// If the player has a small network, focus on it.
// If not, fall back to the global population list.
const pool = (connectedDemandNodes.length >= 2) ? connectedDemandNodes : demandNodes;

const top = pool
  .slice()
  .sort((a, b) => nodePop(b) - nodePop(a))
  .slice(0, 25);


  // If no tracks: everything unmet (stable)
  if (!graph || graph.size === 0) {
    let goodsDemand = 0;
    let paxDemand = 0;
    for (const n of top) {
      goodsDemand += Math.max(0, Number(n.production || 0)) * 0.002;
      paxDemand += Math.max(0, Number(n.population || 0)) * 0.01;
    }
    result.goodsUnmet = goodsDemand;
    result.passengerUnmet = paxDemand;
    result.lostDemandEUR = goodsDemand * GOODS_EUR_PER_UNIT + paxDemand * PAX_EUR_PER_TRIP;
    result.demandMetPct = 0;
    return result;
  }

  // -------------------------
  // 1) Annual service capacity from lines
  // -------------------------
  const lines = state?.lines;
  let paxCapacityYear = 0;
  let goodsCapacityYear = 0;

  if (lines && typeof lines.values === "function") {
    for (const ln of lines.values()) {
      if (!ln) continue;
      const freq = Math.max(0, Number(ln.frequencyPerDay || 0));
      const cap = Math.max(0, Number(ln.vehicleCapacity || 0));
      const annual = freq * 365 * cap;

      if (ln.type === "cargo") {
        goodsCapacityYear += annual;
      } else if (ln.type === "passenger") {
        paxCapacityYear += annual;
      } else if (ln.type === "mixed") {
        paxCapacityYear += annual * 0.6;
        goodsCapacityYear += annual * 0.4;
      } else {
        paxCapacityYear += annual;
      }
    }
  }

  // -------------------------
  // 2) Build OD pairs + compute demand, check routing
  // -------------------------
  const pairs = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < Math.min(top.length, i + 5); j++) {
      pairs.push([top[i], top[j]]);
    }
  }

  let totalDemandEUR = 0;

  let goodsDemandWithPath = 0;
  let paxDemandWithPath = 0;

  const deliverablePairs = []; // {fromId,toId, goodsUnits, paxTrips, goodsEUR, paxEUR, path, distanceKm}

  for (const [A, B] of pairs) {
    const fromId = A.id;
    const toId = B.id;
    if (!fromId || !toId) continue;

    const prodA = Math.max(0, Number(A.production || 0));
    const needsB = Math.max(0, Number(B.needs || 0));
    // Cities use population; clusters use sumPop
const popA = Math.max(0, Number(A.population ?? A.sumPop ?? 0));
const popB = Math.max(0, Number(B.population ?? B.sumPop ?? 0));


    // Toy demand
    // Goods demand uses production/needs if present, otherwise a population-based proxy
const baseGoods = (prodA * 0.001) + (needsB * 0.001);
const proxyGoods = (baseGoods > 0) ? 0 : ((popA + popB) * 0.00001);
const goodsUnits = baseGoods + proxyGoods;

    const paxTrips = ((popA + popB) * 0.00002);

    const goodsEUR = goodsUnits * GOODS_EUR_PER_UNIT;
    const paxEUR = paxTrips * PAX_EUR_PER_TRIP;

    if (goodsEUR <= 0 && paxEUR <= 0) continue;
    totalDemandEUR += goodsEUR + paxEUR;

    const pathRes = shortestPathBetweenNodes(graph, fromId, toId);
    const hasPath = !!(
      pathRes &&
      pathRes.path &&
      pathRes.path.length >= 2 &&
      Number.isFinite(pathRes.distanceKm)
    );

    if (!hasPath) {
      result.goodsUnmet += goodsUnits;
      result.passengerUnmet += paxTrips;
      result.lostDemandEUR += goodsEUR + paxEUR;
      continue;
    }

    goodsDemandWithPath += goodsUnits;
    paxDemandWithPath += paxTrips;

    deliverablePairs.push({
      fromId,
      toId,
      goodsUnits,
      paxTrips,
      goodsEUR,
      paxEUR,
      path: pathRes.path,
      distanceKm: pathRes.distanceKm
    });
  }

  // -------------------------
  // 3) Apply service capacity limits (coarse)
  // -------------------------
  const goodsDelivered = Math.min(goodsDemandWithPath, Math.max(0, goodsCapacityYear));
  const paxDelivered = Math.min(paxDemandWithPath, Math.max(0, paxCapacityYear));

  const goodsScale = goodsDemandWithPath > 0 ? (goodsDelivered / goodsDemandWithPath) : 0;
  const paxScale = paxDemandWithPath > 0 ? (paxDelivered / paxDemandWithPath) : 0;

  // Allocate delivered proportionally across deliverable pairs
  for (const p of deliverablePairs) {
    const gDel = p.goodsUnits * goodsScale;
    const pDel = p.paxTrips * paxScale;

    // Delivered
    result.goodsDelivered += gDel;
    result.passengerTrips += pDel;
    result.deliveredGoodsEUR += (gDel * GOODS_EUR_PER_UNIT);
    result.deliveredPassengersEUR += (pDel * PAX_EUR_PER_TRIP);

    // Unmet due to capacity
    const gUn = p.goodsUnits - gDel;
    const pUn = p.paxTrips - pDel;

    if (gUn > 0) {
      result.goodsUnmet += gUn;
      result.lostDemandEUR += gUn * GOODS_EUR_PER_UNIT;
    }
    if (pUn > 0) {
      result.passengerUnmet += pUn;
      result.lostDemandEUR += pUn * PAX_EUR_PER_TRIP;
    }

    // Store pair flow (pre-congestion)
    result.flows.push({
      type: "both",
      fromId: p.fromId,
      toId: p.toId,
      goodsUnitsDelivered: gDel,
      paxTripsDelivered: pDel,
      path: p.path,
      distanceKm: p.distanceKm
    });
  }

  // -------------------------
  // 4) Track-lane congestion: load edges and reduce delivered if overloaded
  // -------------------------
  const edgeGoodsLoad = new Map(); // key -> goods units / year on edge
  const edgePaxLoad = new Map();   // key -> pax trips / year on edge
  const edgeLanes = new Map();     // key -> lanes

  // Load edges from delivered flows
  for (const f of result.flows) {
    const path = f?.path;
    if (!path || path.length < 2) continue;

    const g = Math.max(0, Number(f.goodsUnitsDelivered || 0));
    const p = Math.max(0, Number(f.paxTripsDelivered || 0));
    if (g === 0 && p === 0) continue;

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const k = edgeKey(a, b);

      // lanes: from graph adjacency
      if (!edgeLanes.has(k)) {
        edgeLanes.set(k, getEdgeLanes(graph, a, b));
      }

      edgeGoodsLoad.set(k, (edgeGoodsLoad.get(k) || 0) + g);
      edgePaxLoad.set(k, (edgePaxLoad.get(k) || 0) + p);
    }
  }

  // Find worst overload ratio across edges
  let maxOverload = 0;

  for (const [k, lanes] of edgeLanes.entries()) {
    const L = Math.max(1, Number(lanes || 1));

    const gLoad = edgeGoodsLoad.get(k) || 0;
    const pLoad = edgePaxLoad.get(k) || 0;

    const gCap = L * GOODS_UNITS_PER_LANE_PER_YEAR;
    const pCap = L * PAX_TRIPS_PER_LANE_PER_YEAR;

    const gRatio = gCap > 0 ? (gLoad / gCap) : (gLoad > 0 ? 999 : 0);
    const pRatio = pCap > 0 ? (pLoad / pCap) : (pLoad > 0 ? 999 : 0);

    const ratio = Math.max(gRatio, pRatio);
    if (ratio > 1) {
      const over = ratio - 1;
      if (over > maxOverload) maxOverload = over;
    }
  }

  // If overloaded: scale down delivered amounts (simple global factor)
  if (maxOverload > 0) {
    // global congestion scale: more overload => less delivered
    // clamps nicely and never goes negative
    const congestionScale = 1 / (1 + maxOverload);

    const beforeGoodsEUR = result.deliveredGoodsEUR;
    const beforePaxEUR = result.deliveredPassengersEUR;

    // scale delivered
    result.goodsDelivered *= congestionScale;
    result.passengerTrips *= congestionScale;
    result.deliveredGoodsEUR *= congestionScale;
    result.deliveredPassengersEUR *= congestionScale;

    // convert the reduced part into lost demand
    const lostGoodsEUR = Math.max(0, beforeGoodsEUR - result.deliveredGoodsEUR);
    const lostPaxEUR = Math.max(0, beforePaxEUR - result.deliveredPassengersEUR);
    result.lostDemandEUR += lostGoodsEUR + lostPaxEUR;

    // also increment unmet “quantities” for UI (approximate)
    result.goodsUnmet += lostGoodsEUR / GOODS_EUR_PER_UNIT;
    result.passengerUnmet += lostPaxEUR / PAX_EUR_PER_TRIP;

    // penalty € (separate from “lost demand”)
    result.congestionPenaltyEUR += 0.05 * maxOverload * (result.deliveredGoodsEUR + result.deliveredPassengersEUR);

    // Optional: scale flow records too (keeps future overlay consistent)
    for (const f of result.flows) {
      f.goodsUnitsDelivered = Number(f.goodsUnitsDelivered || 0) * congestionScale;
      f.paxTripsDelivered = Number(f.paxTripsDelivered || 0) * congestionScale;
    }
  }

  // -------------------------
  // 5) Demand met %
  // -------------------------
  const deliveredEUR = result.deliveredGoodsEUR + result.deliveredPassengersEUR;
  result.demandMetPct = totalDemandEUR > 0 ? (deliveredEUR / totalDemandEUR) * 100 : 0;

  return result;

// Make available to index.html without Vite import (public/ limitation)
if (typeof window !== "undefined") {
  window.computeFlows = computeFlows;
  window.buildTrackGraph = buildTrackGraph;
  window.shortestPathBetweenNodes = shortestPathBetweenNodes;
}

}