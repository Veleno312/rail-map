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

/* global showToast */

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
    let exports = Number(n.production);
    if (!Number.isFinite(exports) || exports <= 0) exports = Number(n.productionBase || 0);
    if (!Number.isFinite(exports)) exports = 0;

    let needs = Number(n.needs);
    if (!Number.isFinite(needs) || needs <= 0) {
      const baseNeeds = Number(n.needsBase || 0);
      needs = baseNeeds > 0 ? baseNeeds : (Number(n.population || 0) * NEED_EUR_PER_PERSON);
    }

    n.exports = exports;
    n.needs = needs;
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

function econHash01(str){
  let h = 2166136261;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000000) / 1000000;
}

function econClamp(x, a, b){
  return Math.max(a, Math.min(b, x));
}

function economy_pickSector(key){
  const list = ["Logistics", "Manufacturing", "Energy", "Agri", "Materials", "Tech", "Services"];
  const idx = Math.floor(econHash01(String(key)) * list.length);
  return list[Math.max(0, Math.min(list.length - 1, idx))];
}

const ECON_PUBLIC_CAP_MIN = 200_000_000;

function economy_makeCompanyFromNode(state, node, countryId){
  const prod = Math.max(0, Number(node.production || 0));
  const needs = Math.max(0, Number(node.needs || 0));
  const pop = Math.max(0, Number(node.population || 0));
  const base = Math.max(50_000_000, (prod + needs) * 0.6 + pop * 400);
  const scale = 0.8 + 0.4 * econHash01(`${node.id}|scale`);
  const marketCap = base * scale;
  const priceSeed = econHash01(`${node.id}|price`);
  const sharePrice = 5 + 95 * priceSeed;
  const sharesOutstanding = Math.max(1_000_000, Math.round(marketCap / sharePrice));
  const sector = economy_pickSector(node.id);
  const dividendYield = 0.01 + 0.04 * econHash01(`${node.id}|div`);
  return {
    id: `CO-${countryId}-${node.id}`,
    name: `${node.name || node.id} ${sector}`,
    scope: "cluster",
    refId: node.id,
    sector,
    baseCap: marketCap,
    marketCap,
    sharePrice,
    sharesOutstanding,
    playerShares: 0,
    dividendYield
  };
}

export function economy_initInvestments(state){
  if (!state) return;
  if (!state.economy) state.economy = {};
  if (Array.isArray(state.economy.companies) && state.economy.companies.length) return;

  const companies = [];
  const countryId = state.countryId || "ES";
  const nodes = (state.nodes instanceof Map)
    ? Array.from(state.nodes.values()).filter(n => n && n.kind === "cluster")
    : [];

  nodes.sort((a,b) => Number(b.population || 0) - Number(a.population || 0));
  const top = nodes.slice(0, 10);

  const totalProd = top.reduce((s, n) => s + Math.max(0, Number(n.production || 0)), 0);
  const totalPop = top.reduce((s, n) => s + Math.max(0, Number(n.population || 0)), 0);
  const baseCountry = Math.max(100_000_000, totalProd * 0.4 + totalPop * 600);
  const countryPrice = 10 + 120 * econHash01(`${countryId}|price`);
  const countryShares = Math.max(5_000_000, Math.round(baseCountry / countryPrice));

  companies.push({
    id: `CO-${countryId}-NATIONAL`,
    name: `${countryId} National Logistics`,
    scope: "country",
    refId: countryId,
    sector: "Logistics",
    baseCap: baseCountry,
    marketCap: baseCountry,
    sharePrice: baseCountry / countryShares,
    sharesOutstanding: countryShares,
    playerShares: 0,
    dividendYield: 0.018 + 0.02 * econHash01(`${countryId}|div`)
  });

  for (const n of top){
    companies.push(economy_makeCompanyFromNode(state, n, countryId));
  }

  state.economy.companies = companies;
  state.economy.lastDividends = 0;
}

export function economy_buyShares(companyId, shares){
  const state = globalThis.state;
  if (!state || !companyId) return;
  economy_initInvestments(state);
  const qty = Math.max(0, Math.round(Number(shares || 0)));
  if (qty <= 0) return;
  const co = (state.economy?.companies || []).find(c => c.id === companyId);
  if (!co) return;
  if (Number(co.marketCap || 0) < ECON_PUBLIC_CAP_MIN) {
    if (typeof showToast === "function") showToast("Company is not public yet", "warning");
    return;
  }
  const cost = qty * Number(co.sharePrice || 0);
  if (Number(state.budget || 0) < cost) {
    if (typeof showToast === "function") showToast("Not enough budget to buy shares", "warning");
    return;
  }
  state.budget = Number(state.budget || 0) - cost;
  co.playerShares = Math.max(0, Number(co.playerShares || 0) + qty);
  if (typeof showToast === "function") showToast(`Bought ${qty} shares`, "success");
}

export function economy_sellShares(companyId, shares){
  const state = globalThis.state;
  if (!state || !companyId) return;
  economy_initInvestments(state);
  const qty = Math.max(0, Math.round(Number(shares || 0)));
  if (qty <= 0) return;
  const co = (state.economy?.companies || []).find(c => c.id === companyId);
  if (!co) return;
  const owned = Math.max(0, Number(co.playerShares || 0));
  const sellQty = Math.min(owned, qty);
  if (sellQty <= 0) return;
  const proceeds = sellQty * Number(co.sharePrice || 0);
  co.playerShares = Math.max(0, owned - sellQty);
  state.budget = Number(state.budget || 0) + proceeds;
  if (typeof showToast === "function") showToast(`Sold ${sellQty} shares`, "success");
}

export function economy_monthTick(state){
  if (!state) return;
  economy_initInvestments(state);
  const monthIndex = Number(state.calendar?.year || 0) * 12 + Number(state.calendar?.month || 0);
  if (state.economy?.lastInvestMonth === monthIndex) return;
  state.economy.lastInvestMonth = monthIndex;

  const demandMet = Number(state.flowSummary?.demandMetPct || 50);
  const demandScore = econClamp((demandMet - 50) / 100, -0.2, 0.2);
  const baseGrowth = 0.002;

  let totalDiv = 0;
  const boostByNode = new Map();

  for (const co of (state.economy.companies || [])) {
    const noise = (econHash01(`${co.id}|${monthIndex}`) - 0.5) * 0.02;
    const growth = baseGrowth + demandScore * 0.02 + noise;
    co.sharePrice = Math.max(0.5, Number(co.sharePrice || 1) * (1 + growth));
    co.marketCap = co.sharePrice * Number(co.sharesOutstanding || 0);

    const div = Number(co.playerShares || 0) * co.sharePrice * (Number(co.dividendYield || 0) / 12);
    totalDiv += div;

    if (co.scope === "cluster" && co.refId && co.baseCap) {
      const bump = econClamp((co.marketCap / co.baseCap) - 1, 0, 0.5);
      if (bump > 0) {
        const prev = boostByNode.get(co.refId) || 0;
        boostByNode.set(co.refId, econClamp(prev + bump * 0.3, 0, 0.5));
      }
    }
  }

  for (const [nodeId, boost] of boostByNode.entries()) {
    const n = state.nodes?.get?.(nodeId);
    if (!n) continue;
    const baseNeeds = Number(n.needsBase ?? n.needs ?? 0);
    n.needs = Math.max(0, baseNeeds * (1 + boost));
  }

  if (totalDiv > 0) {
    state.budget = Number(state.budget || 0) + totalDiv;
    state.revenue = Number(state.revenue || 0) + totalDiv;
  }
  state.economy.lastDividends = totalDiv;
}

// Make available to index.html without Vite import (public/ limitation)
if (typeof window !== "undefined") {
  window.computeEconomy = computeEconomy;
  window.economy_initInvestments = economy_initInvestments;
  window.economy_buyShares = economy_buyShares;
  window.economy_sellShares = economy_sellShares;
  window.economy_monthTick = economy_monthTick;
}
