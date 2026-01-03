// economy.js
// Lightweight but more "realistic" economy with flows over the built track network.
//
// Inputs expected on `state`:
// - state.nodes: Map(id -> { id, name, lat, lon, population?, production? })
// - state.tracks: Map(trackId -> { from, to, lanes, cost?:{maintenanceCost?,distanceKm?} })
// - state.lines: Map(...)  (optional; we don't require it for flow calc)
//
// Output written onto `state`:
// - state.revenue, state.costs, state.profit (numbers)
// - node.exports, node.needs, node.net, node.connected (debug/tooltip-ready)
//
// Design notes (simple + fast):
// - Exports proxy: node.production (EUR/year). If missing, 0.
// - Needs proxy: node.population * NEED_EUR_PER_PERSON (EUR/year).
// - Flows happen only within connected components of the track graph.
// - For each component, exports distribute to needs proportionally.
// - Revenue is earned per EUR*km moved (a proxy for passenger+freight monetization).
// - Costs are maintenance + operating cost proportional to flow distance.
// - Track capacity: per-lane capacity limits how much flow can traverse the network.
//   (We do a simple global cap per component, not a full multi-commodity flow.)

export function computeEconomy(state, map) {
  const NEED_EUR_PER_PERSON = 1200;   // proxy: "consumption/inputs" per resident-year
  const REV_PER_EUR_KM = 0.00006;     // tune: revenue per EUR moved per km
  const OP_COST_PER_EUR_KM = 0.00003; // tune: ops cost per EUR moved per km

  const CAPACITY_EUR_PER_LANE_YEAR = 30e9; // lane capacity proxy per year (EUR flow)
  const MIN_COMPONENT_SIZE = 2;

  // --- helpers ---
  const nodes = state.nodes instanceof Map ? state.nodes : new Map();
  const tracks = state.tracks instanceof Map ? state.tracks : new Map();

  function nodeById(id) { return nodes.get(id); }

  // Build adjacency with edge distance (meters) and lanes
  const adj = new Map(); // id -> [{to, meters, lanes}]
  function addEdge(a, b, meters, lanes) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, meters, lanes });
  }

  let maintenanceTotal = 0;
  for (const t of tracks.values()) {
    const A = nodeById(t.from);
    const B = nodeById(t.to);
    if (!A || !B) continue;

    const meters = (map && map.distance) ? map.distance([A.lat, A.lon], [B.lat, B.lon]) : 0;
    const lanes = Number(t.lanes || 1);

    addEdge(A.id, B.id, meters, lanes);
    addEdge(B.id, A.id, meters, lanes);

    maintenanceTotal += Number(t.cost?.maintenanceCost || 0);
  }

  // Reset node stats
  for (const n of nodes.values()) {
    n.exports = Number(n.production || 0);
    n.needs = Number(n.population || 0) * NEED_EUR_PER_PERSON;
    n.net = n.exports - n.needs;
    n.connected = false;
  }

  // Connected components via BFS on adj
  const comps = [];
  const seen = new Set();
  for (const id of nodes.keys()) {
    if (seen.has(id)) continue;
    if (!adj.has(id)) continue;

    const q = [id];
    seen.add(id);
    const comp = [];
    while (q.length) {
      const cur = q.shift();
      comp.push(cur);
      for (const e of (adj.get(cur) || [])) {
        if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
      }
    }
    if (comp.length >= MIN_COMPONENT_SIZE) comps.push(comp);
  }

  // Dijkstra per component (we do multi-source distances lazily)
  function dijkstra(start, allowedSet) {
    const dist = new Map();
    const pq = [{ id: start, d: 0 }];
    dist.set(start, 0);

    while (pq.length) {
      pq.sort((a,b) => a.d - b.d);
      const { id, d } = pq.shift();
      if (d !== dist.get(id)) continue;
      for (const e of (adj.get(id) || [])) {
        if (!allowedSet.has(e.to)) continue;
        const nd = d + e.meters;
        if (!dist.has(e.to) || nd < dist.get(e.to)) {
          dist.set(e.to, nd);
          pq.push({ id: e.to, d: nd });
        }
      }
    }
    return dist;
  }

  let revenue = 0;
  let opCosts = 0;

  for (const comp of comps) {
    const S = new Set(comp);

    // mark connected
    for (const id of comp) {
      const n = nodeById(id);
      if (n) n.connected = true;
    }

    // component totals
    let totalExports = 0;
    let totalNeeds = 0;
    let totalLanes = 0;

    // rough capacity = sum(lanes)*capPerLane (double-count edges; that's OK as a proxy)
    for (const id of comp) {
      const n = nodeById(id);
      if (!n) continue;
      totalExports += Math.max(0, Number(n.exports || 0));
      totalNeeds += Math.max(0, Number(n.needs || 0));
      for (const e of (adj.get(id) || [])) totalLanes += Number(e.lanes || 1);
    }

    const cap = (totalLanes * CAPACITY_EUR_PER_LANE_YEAR) / 2; // /2 for undirected double-count
    if (totalExports <= 0 || totalNeeds <= 0 || cap <= 0) continue;

    // Scale flow by the limiting factor (exports vs needs) AND capacity
    const maxTrade = Math.min(totalExports, totalNeeds, cap);

    // Split exporters and importers
    const exporters = [];
    const importers = [];
    for (const id of comp) {
      const n = nodeById(id);
      if (!n) continue;
      const ex = Math.max(0, Number(n.exports || 0));
      const ne = Math.max(0, Number(n.needs || 0));
      if (ex > 0) exporters.push({ id, ex });
      if (ne > 0) importers.push({ id, ne });
    }

    // Precompute importer weights
    const needSum = importers.reduce((s,x)=>s+x.ne,0) || 1;

    // For each exporter, send flow proportionally to all importers using shortest path distances
    // (O(E * (V log V + V)) per component; OK for this scale)
    for (const ex of exporters) {
      const nEx = nodeById(ex.id);
      if (!nEx) continue;

      const share = ex.ex / totalExports;
      const flowOut = maxTrade * share; // EUR/year leaving exporter

      const dist = dijkstra(ex.id, S);

      for (const im of importers) {
        const w = im.ne / needSum;
        const flow = flowOut * w; // EUR/year from exporter -> importer
        const meters = dist.get(im.id);
        if (!meters || !Number.isFinite(meters)) continue;

        const km = meters / 1000;

        revenue += flow * km * REV_PER_EUR_KM;
        opCosts += flow * km * OP_COST_PER_EUR_KM;
      }
    }
  }

  state.revenue = revenue;
  state.costs = maintenanceTotal + opCosts;
  state.profit = state.revenue - state.costs;
// keep budget effect outside if you want; your index.html already adds annualBudget and uses profit
  return state;
}

// Make available to index.html without Vite import (public/ limitation)
if (typeof window !== "undefined") {
  window.computeEconomy = computeEconomy;
}

