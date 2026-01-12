/* eslint-disable no-undef, no-unused-vars, no-empty */

const DEFAULT_PAX_FACTOR = 0.35;
const DEFAULT_FREIGHT_FACTOR = 0.08;

function stationServiceQuality(stationId, config){
  const weight = Number(config?.serviceQualityWeight ?? 0.25);
  let serviceSum = 0;
  for (const line of state.lines.values()){
    if (!line || !Array.isArray(line.stops)) continue;
    if (!line.stops.includes(stationId)) continue;
    const freq = Number(line.frequencyPerDay ?? (Array.isArray(line.departures) ? line.departures.length : 0));
    serviceSum += Math.max(0, freq);
  }
  return 1 + weight * Math.log1p(serviceSum);
}

function computeStationCapacity(){
  const capacityMap = new Map();
  for (const line of state.lines.values()){
    if (!line || !Array.isArray(line.stops)) continue;
    const cap = Math.max(1, Number(line_dailyCapacity ? line_dailyCapacity(line) : 0));
    for (const stop of line.stops){
      const stationId = String(stop || "");
      capacityMap.set(stationId, (capacityMap.get(stationId) || 0) + cap);
    }
  }
  return capacityMap;
}

function getCandidateStations(cell, stations, config){
  const list = [];
  for (const station of stations){
    if (!station || !station.active) continue;
    const distanceKm = haversineKm(cell.centroidLat, cell.centroidLon, station.lat, station.lon);
    list.push({ station, distanceKm });
  }
  list.sort((a, b) => a.distanceKm - b.distanceKm);
  const within = list.filter(entry => entry.distanceKm <= (config.maxAccessKm ?? 60));
  const selected = within.length ? within : list.slice(0, config.candidateStationsK ?? 12);
  return selected.slice(0, config.candidateStationsK ?? 12);
}

function scoreAllocations(cell, candidates, config, penaltyMap){
  const accessSpeed = Math.max(1, Number(config.accessSpeedKmh ?? 50));
  const gravity = Number(config.gravityAlpha ?? 2.2);
  const scores = [];
  let bestAccess = Infinity;
  for (const entry of candidates){
    const stationId = entry.station.id;
    const accessMin = (entry.distanceKm / accessSpeed) * 60;
    const serviceQuality = stationServiceQuality(stationId, config);
    const penalty = Number(penaltyMap?.get(stationId) ?? 1);
    const value = Math.exp(-gravity * (accessMin / 60)) * serviceQuality * Math.max(0.0001, penalty);
    scores.push({ stationId, accessMin, score: value });
    if (accessMin < bestAccess) bestAccess = accessMin;
  }
  return { scores, bestAccess: Number.isFinite(bestAccess) ? bestAccess : 0 };
}

function normalizeAllocations(scores, paxDemand, freightDemand){
  const totalScore = scores.reduce((sum, row) => sum + Math.max(0, row.score || 0), 0);
  return scores.map(row => {
    const share = totalScore ? Math.max(0, row.score) / totalScore : 0;
    return {
      stationId: row.stationId,
      share,
      pax: share * paxDemand,
      freight: share * freightDemand,
      score: row.score,
      accessMin: row.accessMin
    };
  });
}

function computeUnderserved(cell, bestAccessMin, config){
  const pop = Math.max(0, Number(cell.pop || 0));
  const gravity = Number(config.gravityAlpha ?? 2.2);
  const servedness = Math.exp(-gravity * (bestAccessMin / 60));
  return pop * (1 - Math.min(1, servedness));
}

function recomputeDemandModel(options = {}){
  const cells = state.cells;
  if (!cells || cells.size === 0) return;
  const stations = Array.from(state.stations.values()).filter(s => s.active);
  if (!stations.length) return;
  const config = state.simConfig || {};
  const candidateK = Number(config.candidateStationsK || 12);
  const paxFactor = Number(config.paxFactor ?? DEFAULT_PAX_FACTOR);
  const freightFactor = Number(config.freightFactor ?? DEFAULT_FREIGHT_FACTOR);

  const capacityMap = computeStationCapacity();

  const firstPassPenalties = new Map();
  const firstLoads = new Map();

  for (const cell of cells.values()){
    if (!cell) continue;
    const candidates = getCandidateStations(cell, stations, config);
    if (!candidates.length) continue;
    const { scores } = scoreAllocations(cell, candidates, config, firstPassPenalties);
    const pop = Math.max(0, Number(cell.pop || 0));
    const paxDemand = pop * paxFactor;
    const freightDemand = pop * freightFactor;
    const allocations = normalizeAllocations(scores, paxDemand, freightDemand);
    for (const alloc of allocations){
      firstLoads.set(alloc.stationId, (firstLoads.get(alloc.stationId) || 0) + alloc.pax);
    }
  }

  const congestionGamma = Number(config.congestionGamma ?? 2.0);
  const stationPenalties = new Map();
  for (const [stationId, load] of firstLoads.entries()){
    const capacity = Math.max(1, capacityMap.get(stationId) || 1);
    const loadRatio = load / capacity;
    const penalty = 1 / (1 + Math.pow(loadRatio, congestionGamma));
    stationPenalties.set(stationId, penalty);
  }

  const finalAllocations = new Map();
  const finalLoads = new Map();
  const underservedMap = new Map();
  const catchments = new Map();

  for (const cell of cells.values()){
    if (!cell) continue;
    const candidates = getCandidateStations(cell, stations, config);
    if (!candidates.length) continue;
    const { scores, bestAccess } = scoreAllocations(cell, candidates, config, stationPenalties);
    const pop = Math.max(0, Number(cell.pop || 0));
    const paxDemand = pop * paxFactor;
    const freightDemand = pop * freightFactor;
    const allocations = normalizeAllocations(scores, paxDemand, freightDemand);
    const bestEntry = allocations.reduce((best, entry) => entry.share > (best?.share || 0) ? entry : best, null);
    if (bestEntry) {
      catchments.set(cell.id, bestEntry.stationId);
    }
    for (const alloc of allocations){
      finalLoads.set(alloc.stationId, (finalLoads.get(alloc.stationId) || 0) + alloc.pax);
    }
    finalAllocations.set(cell.id, allocations);
    underservedMap.set(cell.id, computeUnderserved(cell, bestAccess, config));
  }

  state.cellToStationAllocation = finalAllocations;
  state.underservedByCell = underservedMap;
  state.catchmentByCell = catchments;

  state.stationLoad.clear();
  for (const [stationId, load] of finalLoads.entries()){
    const capacity = Math.max(1, capacityMap.get(stationId) || 1);
    const loadRatio = load / capacity;
    const congestionPenalty = 1 / (1 + Math.pow(loadRatio, congestionGamma));
    state.stationLoad.set(stationId, {
      pax: load,
      capacity,
      loadRatio,
      congestionPenalty
    });
  }

  if (typeof updateUI === "function") {
    try { updateUI(); } catch (_) {}
  }
  if (typeof renderDemandOverlays === "function") {
    try { renderDemandOverlays(); } catch (_) {}
  }
}

window.recomputeDemandModel = recomputeDemandModel;
