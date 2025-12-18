// economy.js (v3) — capacity + frequency + congestion + exports/needs (defensive)
export function computeEconomy(state, map) {
  const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function hash01(str) {
    let h = 2166136261;
    const s = String(str ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000000) / 1000000;
  }

  function distM(a, b) {
    try {
      if (map && typeof map.distance === "function") {
        return map.distance([a.lat, a.lon], [b.lat, b.lon]);
      }
    } catch (_) {}
    // fallback haversine
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLon / 2);
    const h = s1 * s1 + Math.cos(la1) * Math.cos(la2) * s2 * s2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  if (!state?.nodes || typeof state.nodes.values !== "function") {
    state.revenue = 0; state.costs = 0; state.profit = 0;
    return;
  }

  // ---------- sector exports/needs (for tooltips + demand proxy) ----------
  const SECTORS = ["Agriculture", "Mining", "Manufacturing", "Services", "Tourism", "Energy"];
  const CONSUMPTION_PER_PERSON = 3200;
  const CONSUMPTION_POP_ELASTICITY = 0.08;

  function sectorWeights(node) {
    const base = SECTORS.map((_, i) => hash01(`${node.id}:${i}`));
    let sum = base.reduce((a, b) => a + b, 0) || 1;
    let w = base.map((x) => x / sum);

    if (node.kind === "city") {
      w[3] *= 1.25; w[4] *= 1.20; w[0] *= 0.85; w[1] *= 0.85;
    } else {
      w[2] *= 1.10; w[0] *= 1.10;
    }
    sum = w.reduce((a, b) => a + b, 0) || 1;
    return w.map((x) => x / sum);
  }

  function productionTotal(node) {
    const p = num(node.production, NaN);
    if (Number.isFinite(p) && p >= 0) return p;
    const pop = num(node.population, 0);
    const per = 1100 + 900 * hash01(`prod:${node.id}`);
    return Math.round(pop * per);
  }

  function consumptionTotal(node) {
    const pop = num(node.population, 0);
    const scale = Math.pow(Math.max(1, pop) / 50000, CONSUMPTION_POP_ELASTICITY);
    return Math.round(pop * CONSUMPTION_PER_PERSON * scale);
  }

  const nodesArr = [];
  for (const n of state.nodes.values()) if (n?.id) nodesArr.push(n);

  for (const n of nodesArr) {
    const w = sectorWeights(n);
    const P = productionTotal(n);
    const C = consumptionTotal(n);

    const pSec = w.map((wi) => Math.round(P * wi));

    const needBias = [...w];
    needBias[2] *= 1.10; needBias[3] *= 1.20; needBias[5] *= 1.10;
    const nbSum = needBias.reduce((a, b) => a + b, 0) || 1;
    const nb = needBias.map((x) => x / nbSum);
    const nSec = nb.map((wi) => Math.round(C * wi));

    const sSec = pSec.map((x, i) => x - nSec[i]);

    let bestExp = { idx: 0, val: -Infinity };
    let bestNeed = { idx: 0, val: -Infinity };
    for (let i = 0; i < SECTORS.length; i++) {
      if (sSec[i] > bestExp.val) bestExp = { idx: i, val: sSec[i] };
      if (-sSec[i] > bestNeed.val) bestNeed = { idx: i, val: -sSec[i] };
    }

    n.econ = n.econ || {};
    n.econ.productionTotal = P;
    n.econ.consumptionTotal = C;
    n.econ.biggestExport = SECTORS[bestExp.idx];
    n.econ.biggestExportValue = Math.max(0, Math.round(bestExp.val));
    n.econ.biggestNeed = SECTORS[bestNeed.idx];
    n.econ.biggestNeedValue = Math.max(0, Math.round(bestNeed.val));
  }

  // ---------- build track graph for routing + congestion ----------
  const trackAdj = new Map(); // nodeId -> [{to, distM, trackId}]
  function addAdj(a, b, d, trackId) {
    if (!trackAdj.has(a)) trackAdj.set(a, []);
    trackAdj.get(a).push({ to: b, distM: d, trackId });
  }

  if (state.tracks && typeof state.tracks.values === "function") {
    for (const t of state.tracks.values()) {
      if (!t?.from || !t?.to) continue;
      const A = state.nodes.get(t.from);
      const B = state.nodes.get(t.to);
      if (!A || !B) continue;
      const d = distM(A, B);
      addAdj(String(t.from), String(t.to), d, t.id);
      addAdj(String(t.to), String(t.from), d, t.id);
    }
  }

  function shortestPathOnTracks(start, goal) {
    // Dijkstra on existing tracks
    const s = String(start), g = String(goal);
    if (s === g) return { path: [s], dist: 0, trackIds: [] };
    const dist = new Map();
    const prev = new Map();
    const prevTrack = new Map();
    const pq = [{ id: s, d: 0 }];
    dist.set(s, 0);

    while (pq.length) {
      pq.sort((a, b) => a.d - b.d);
      const cur = pq.shift();
      if (!cur) break;
      if (cur.id === g) break;
      if (cur.d !== dist.get(cur.id)) continue;

      for (const e of (trackAdj.get(cur.id) || [])) {
        const nd = cur.d + e.distM;
        if (!dist.has(e.to) || nd < dist.get(e.to)) {
          dist.set(e.to, nd);
          prev.set(e.to, cur.id);
          prevTrack.set(e.to, e.trackId);
          pq.push({ id: e.to, d: nd });
        }
      }
    }

    if (!dist.has(g)) return null;

    const path = [];
    const trackIds = [];
    let x = g;
    while (x !== undefined) {
      path.push(x);
      const pt = prevTrack.get(x);
      if (pt) trackIds.push(pt);
      x = prev.get(x);
    }
    path.reverse();
    trackIds.reverse();
    return { path, dist: dist.get(g), trackIds };
  }

  // ---------- capacity + frequency model ----------
  // Track capacity = lanes * MAX_TRAINS_PER_DAY_PER_LANE (both directions combined, simplified)
  const MAX_TRAINS_PER_DAY_PER_LANE = 45;

  // Per train capacity in "€ value moved" (proxy)
  const CAP_EUR_PER_TRAIN = {
    passenger: { pass: 250_000, cargo: 0 },
    cargo:     { pass: 0,       cargo: 1_200_000 },
    mixed:     { pass: 150_000, cargo: 700_000 },
  };

  // Revenue margins on transported value
  const MARGIN = { pass: 0.018, cargo: 0.035 };

  // Demand scales (tune later)
  const PASS_ALPHA = 1.12;
  const CARGO_ALPHA = 1.20;
  const PASS_SCALE = 250;      // scales pop-pair into € value/year
  const CARGO_SCALE = 5_000_000; // scales production-pair into € value/year

  function demandPassenger(A, B, d) {
    const popA = num(A.population, 0);
    const popB = num(B.population, 0);
    const denom = Math.pow(Math.max(1, d), PASS_ALPHA);
    return (Math.sqrt(popA * popB) / denom) * PASS_SCALE * 1_000_000; // €/year proxy
  }

  function demandCargo(A, B, d) {
    const PA = num(A.econ?.productionTotal, num(A.production, 0));
    const PB = num(B.econ?.productionTotal, num(B.production, 0));
    const denom = Math.pow(Math.max(1, d), CARGO_ALPHA);
    return (Math.sqrt(Math.max(1, PA) * Math.max(1, PB)) / denom) * CARGO_SCALE; // €/year proxy
  }

  // Track usage (frequency) accumulation
  const trackUsedTrainsPerDay = new Map(); // trackId -> trains/day usage

  // Per-line stats for debugging/UI (optional)
  state.lineStats = state.lineStats || {};

  // First pass: compute which tracks each line uses, and accumulate frequency onto tracks
  for (const line of (state.lines?.values?.() || [])) {
    if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;

    const freq = clamp(num(line.frequency, 10), 0, 200);
    const usedTrackIds = new Set();
    let totalTrackDistM = 0;

    for (let i = 0; i < line.stops.length - 1; i++) {
      const aId = String(line.stops[i]);
      const bId = String(line.stops[i + 1]);
      const res = shortestPathOnTracks(aId, bId);
      if (!res) continue;

      totalTrackDistM += num(res.dist, 0);
      for (const tid of res.trackIds) usedTrackIds.add(tid);
    }

    // circular closure
    if (line.circular && line.stops.length >= 3) {
      const aId = String(line.stops[line.stops.length - 1]);
      const bId = String(line.stops[0]);
      const res = shortestPathOnTracks(aId, bId);
      if (res) {
        totalTrackDistM += num(res.dist, 0);
        for (const tid of res.trackIds) usedTrackIds.add(tid);
      }
    }

    // apply frequency usage to each used track
    for (const tid of usedTrackIds) {
      trackUsedTrainsPerDay.set(tid, num(trackUsedTrainsPerDay.get(tid), 0) + freq);
    }

    state.lineStats[line.id] = {
      freq,
      usedTrackIds,
      totalTrackKmPerYear: (totalTrackDistM / 1000) * freq * 365,
    };
  }

  // Track congestion factors
  const trackCongestion = new Map(); // trackId -> factor <= 1
  if (state.tracks && typeof state.tracks.values === "function") {
    for (const t of state.tracks.values()) {
      const lanes = clamp(num(t.lanes, 1), 1, 8);
      const cap = lanes * MAX_TRAINS_PER_DAY_PER_LANE;
      const used = num(trackUsedTrainsPerDay.get(t.id), 0);
      const f = used <= 0 ? 1 : clamp(cap / used, 0, 1);
      trackCongestion.set(t.id, f);
    }
  }

  function lineCongestionFactor(line) {
    const st = state.lineStats?.[line.id];
    if (!st?.usedTrackIds?.size) return 1;
    let minF = 1;
    for (const tid of st.usedTrackIds) {
      const f = num(trackCongestion.get(tid), 1);
      if (f < minF) minF = f;
    }
    return clamp(minF, 0, 1);
  }

  // Second pass: compute line-demand, cap by line capacity, apply congestion
  let totalRevenue = 0;
  let opCost = 0;

  // operating cost €/train-km (proxy)
  const COST_PER_TRAIN_KM = { passenger: 22, cargo: 30, mixed: 26 };

  for (const line of (state.lines?.values?.() || [])) {
    if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;

    const freq = clamp(num(line.frequency, 10), 0, 200);
    const type = String(line.type || "passenger");
    const caps = CAP_EUR_PER_TRAIN[type] || CAP_EUR_PER_TRAIN.passenger;
    const cong = lineCongestionFactor(line);

    // demand along adjacent stop pairs (using track distance if possible)
    let demandPass = 0;
    let demandCargoV = 0;
    let distTotalM = 0;

    for (let i = 0; i < line.stops.length - 1; i++) {
      const A = state.nodes.get(String(line.stops[i]));
      const B = state.nodes.get(String(line.stops[i + 1]));
      if (!A || !B) continue;

      const res = shortestPathOnTracks(A.id, B.id);
      const d = res ? num(res.dist, distM(A, B)) : distM(A, B);
      distTotalM += d;

      demandPass += demandPassenger(A, B, d);
      demandCargoV += demandCargo(A, B, d);
    }

    if (line.circular && line.stops.length >= 3) {
      const A = state.nodes.get(String(line.stops[line.stops.length - 1]));
      const B = state.nodes.get(String(line.stops[0]));
      if (A && B) {
        const res = shortestPathOnTracks(A.id, B.id);
        const d = res ? num(res.dist, distM(A, B)) : distM(A, B);
        distTotalM += d;

        demandPass += demandPassenger(A, B, d);
        demandCargoV += demandCargo(A, B, d);
      }
    }

    // yearly line capacity
    const capPass = freq * 365 * num(caps.pass, 0);
    const capCargo = freq * 365 * num(caps.cargo, 0);

    // transported value = min(demand, capacity) * congestion
    const movedPass = Math.min(demandPass, capPass) * cong;
    const movedCargo = Math.min(demandCargoV, capCargo) * cong;

    const rev = movedPass * MARGIN.pass + movedCargo * MARGIN.cargo;
    totalRevenue += rev;

    // operating costs scale with train-km
    const trainKmPerYear = (distTotalM / 1000) * freq * 365;
    opCost += trainKmPerYear * num(COST_PER_TRAIN_KM[type], 24);

    // store per-line stats
    state.lineStats[line.id] = {
      ...(state.lineStats[line.id] || {}),
      congestion: cong,
      demandPass,
      demandCargo: demandCargoV,
      movedPass,
      movedCargo,
      revenue: rev,
      trainKmPerYear,
      capPass,
      capCargo,
    };
  }

  // maintenance from tracks
  let maintenance = 0;
  if (state.tracks && typeof state.tracks.values === "function") {
    for (const t of state.tracks.values()) maintenance += num(t.cost?.maintenanceCost, 0);
  }

  const overhead = (state.lines?.size || 0) * 1_250_000 + (state.tracks?.size || 0) * 240_000;

  state.revenue = totalRevenue;
  state.costs = maintenance + overhead + opCost;
  state.profit = state.revenue - state.costs;
}