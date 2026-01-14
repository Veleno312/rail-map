/* eslint-disable no-undef, no-unused-vars, no-empty */
// ======================
// Tracks (black line + white lane number label)
// ======================
const TRACK_PROFILE_SAMPLES = 25;
const MAX_GRADE_PERCENT = 2.5;

function perfLogNetwork(label, start){
  if (!state?.debug?.perf || typeof start !== "number") return;
  const delta = Math.max(0, performance.now() - start);
  console.info(`[perf] ${label}: ${delta.toFixed(1)}ms`);
}

function getElevation(lat, lon){
  if (typeof window.demElevationProvider === "function") {
    return Number(window.demElevationProvider(lat, lon)) || 0;
  }
  const key = `${lat.toFixed(5)}|${lon.toFixed(5)}`;
  const noise = hash01(key) || 0;
  const base = Math.sin(lat * Math.PI / 180) * 40 + Math.cos(lon * Math.PI / 90) * 25;
  return base + noise * 30;
}

window.getElevation = getElevation;

function distanceKmBetween(lat1, lon1, lat2, lon2){
  if (typeof map !== "undefined" && map) {
    return map.distance([lat1, lon1], [lat2, lon2]) / 1000;
  }
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function sampleTrackProfile(a, b, samples = TRACK_PROFILE_SAMPLES){
  if (!a || !b) return [];
  const pts = [];
  for (let i = 0; i <= samples; i++){
    const t = samples ? (i / samples) : 0;
    const lat = Number(a.lat) + (Number(b.lat) - Number(a.lat)) * t;
    const lon = Number(a.lon) + (Number(b.lon) - Number(a.lon)) * t;
    const elevation = getElevation(lat, lon);
    pts.push({ lat, lon, elev: elevation });
  }
  return pts;
}

function analyzeTrackProfile(points){
  if (!Array.isArray(points) || points.length < 2) {
    return { distanceKm: 0, maxGrade: 0, avgGrade: 0, tunnelKm: 0 };
  }
  let totalDist = 0;
  let totalGrade = 0;
  let maxGrade = 0;
  let tunnelKm = 0;
  let segments = 0;
  for (let i = 1; i < points.length; i++){
    const prev = points[i - 1];
    const next = points[i];
    const dist = distanceKmBetween(prev.lat, prev.lon, next.lat, next.lon);
    totalDist += dist;
    const delta = Math.abs(next.elev - prev.elev);
    const grade = dist > 0 ? (delta / (dist * 1000)) * 100 : 0;
    totalGrade += grade;
    maxGrade = Math.max(maxGrade, grade);
    if (grade > MAX_GRADE_PERCENT) tunnelKm += dist;
    segments++;
  }
  const avgGrade = segments ? (totalGrade / segments) : 0;
  return { distanceKm: totalDist, maxGrade, avgGrade, tunnelKm };
}
function calculateTrackCost(a, b, lanes=1){
  const km = (map.distance([a.lat,a.lon],[b.lat,b.lon]) / 1000) || 0;
  const constructionCost = km * CONFIG.TRACK_COST_PER_KM * lanes;
  const maintenanceCost = km * CONFIG.TRACK_MAINTENANCE_PER_KM * lanes;
  return { distanceKm: km, terrainDifficulty: 1.0, constructionCost, maintenanceCost, lanes };
}

function track_structureForSegment(fromId, toId){
  const a = state.nodes.get(fromId);
  const b = state.nodes.get(toId);
  if (!a || !b || !map) return { type: "surface", mult: 1.0 };

  const km = (map.distance([a.lat, a.lon], [b.lat, b.lon]) / 1000) || 0;
  const key = edgeKey(fromId, toId);
  const h = hash01(key);

  let type = "surface";
  let mult = 1.0;

  if (typeof segmentsIntersect === "function") {
    for (const t of state.tracks.values()){
      if (!t || t.status !== "built") continue;
      if (t.from === fromId || t.to === fromId || t.from === toId || t.to === toId) continue;
      if (segmentsIntersect(fromId, toId, t.from, t.to)) {
        type = "overpass";
        mult = CONFIG.TRACK_BUILD_COST_MULT_OVERPASS;
        return { type, mult };
      }
    }
  }

  if (km > 120 && h < 0.45) {
    type = "tunnel";
    mult = CONFIG.TRACK_BUILD_COST_MULT_TUNNEL;
  } else if (km > 60 && h < 0.35) {
    type = "bridge";
    mult = CONFIG.TRACK_BUILD_COST_MULT_BRIDGE;
  }

  return { type, mult };
}

let adjacencyCache = null;
const routeCache = new Map();

function invalidateRoutingCache(){
  adjacencyCache = null;
  routeCache.clear();
}

function routeCacheKey(a, b){
  if (!a || !b) return null;
  const [left, right] = [String(a), String(b)].sort();
  return `${left}|${right}`;
}

window.invalidateRoutingCache = invalidateRoutingCache;

function track_estimateBuild(fromId, toId, lanes=1){
  const a = state.nodes.get(fromId);
  const b = state.nodes.get(toId);
  if (!a || !b) return null;

  const base = calculateTrackCost(a, b, lanes);
  const structure = track_structureForSegment(fromId, toId);
  const profile = sampleTrackProfile(a, b, TRACK_PROFILE_SAMPLES);
  const stats = analyzeTrackProfile(profile);

  const laneFactor = Math.max(1, Number(lanes || 1));
  base.distanceKm = stats.distanceKm;
  base.constructionCost = stats.distanceKm * CONFIG.TRACK_COST_PER_KM * laneFactor;
  base.maintenanceCost = stats.distanceKm * CONFIG.TRACK_MAINTENANCE_PER_KM * laneFactor;

  const gradePenalty = 1 + Math.pow(Math.max(0, stats.maxGrade - MAX_GRADE_PERCENT) / MAX_GRADE_PERCENT, 2);
  const structureMult = Math.max(1, structure.mult || 1);
  const tunnelCost = stats.tunnelKm * CONFIG.TRACK_COST_PER_KM * 0.5;
  const buildCost = Math.round(base.constructionCost * gradePenalty * structureMult + tunnelCost);
  const maintenanceCost = Math.round(base.maintenanceCost * gradePenalty);
  const adjustedDistance = stats.distanceKm;
  const timeMult = 1 + (structure.mult - 1) * 0.6;
  const days = Math.max(2, Math.round(adjustedDistance * CONFIG.TRACK_BUILD_DAYS_PER_KM * (0.85 + 0.15 * laneFactor) * timeMult));

  const issueChance = Number(CONFIG.TRACK_BUILD_ISSUE_CHANCE || 0);
  const issueRoll = hash01(`${edgeKey(fromId, toId)}|issue`);
  let issue = null;
  if (issueRoll < issueChance) {
    const frac = CONFIG.TRACK_BUILD_ISSUE_COST_MIN +
      (CONFIG.TRACK_BUILD_ISSUE_COST_MAX - CONFIG.TRACK_BUILD_ISSUE_COST_MIN) * hash01(`${edgeKey(fromId, toId)}|issue_cost`);
    const triggerDay = Math.max(1, Math.round(days * (0.25 + 0.5 * hash01(`${edgeKey(fromId, toId)}|issue_day`))));
    const types = ["geology", "permit", "archeology", "supply"];
    const type = types[Math.floor(hash01(`${edgeKey(fromId, toId)}|issue_type`) * types.length)];
    issue = {
      type,
      cost: Math.round(buildCost * frac),
      triggerDay,
      resolved: false,
      active: false
    };
  }

  return {
    base,
    structure,
    costTotal: buildCost,
    days,
    issue,
    distanceKm: adjustedDistance,
    estimatedBuildCost: buildCost,
    estimatedMaintenanceCost: maintenanceCost,
    estimatedMaxSpeed: Math.max(40, 150 - Math.round(stats.maxGrade * 4)),
    tunnelKm: stats.tunnelKm,
    gradeStats: stats
  };
}

function track_statusStyle(status){
  const isMetro = state.mapTheme === "metro";
  if (status === "planned") return { color: isMetro ? "rgba(255,255,255,0.35)" : "#94a3b8", dashArray: "6,6", weight: 2.5, opacity: 0.7 };
  if (status === "building") return { color: isMetro ? "#f5d081" : "#f59e0b", dashArray: "3,6", weight: 3.0, opacity: 0.9 };
  if (status === "demolishing") return { color: isMetro ? "#f5a3a3" : "#ef4444", dashArray: "2,6", weight: 3.0, opacity: 0.9 };
  return { color: isMetro ? "#f8fafc" : "#000", dashArray: null, weight: 2.5, opacity: 0.95 };
}

function track_applyStyle(track){
  if (!track || !track._layer) return;
  const s = track_statusStyle(track.status);
  track._layer.setStyle({
    color: s.color,
    dashArray: s.dashArray,
    weight: s.weight + (Number(track.lanes || 1) * 0.4),
    opacity: s.opacity
  });
}

function track_makeVisual(track){
  const a = state.nodes.get(track.from);
  const b = state.nodes.get(track.to);
  if (!a || !b) return;

  const s = track_statusStyle(track.status);

  const line = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
    color: s.color,
    weight: s.weight + (Number(track.lanes || 1) * 0.4),
    opacity: s.opacity,
    lineCap: "round",
    dashArray: s.dashArray
  }).addTo(layers.tracks);

  const midLat = (a.lat + b.lat) / 2;
  const midLon = (a.lon + b.lon) / 2;

  const label = L.marker([midLat, midLon], {
    icon: L.divIcon({
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html: `<div class="track-lane-label">${track.lanes}</div>`
    }),
    interactive: false,
    keyboard: false
  }).addTo(layers.trackLabels);
  label.setOpacity(0);

  line.on("click", () => track_handleClick(track.id));
  line.on("mouseover", () => {
    if (state.activeTab === "tracks" && state.trackBuildMode) label.setOpacity(1);
  });
  line.on("mouseout", () => {
    label.setOpacity(0);
  });

  track._layer = line;
  track._label = label;
}

function spain_pointInRing(lat, lon, ring){
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function spain_containsLatLon(lat, lon){
  const geo = state.countryBorder || state.spainBorder;
  if (!geo || !Array.isArray(geo.features) || !geo.features.length) return true;
  const feat = geo.features[0];
  const geom = feat && feat.geometry;
  if (!geom) return true;
  const coords = geom.coordinates || [];
  if (geom.type === "Polygon") {
    if (!coords.length) return false;
    if (!spain_pointInRing(lat, lon, coords[0])) return false;
    for (let i = 1; i < coords.length; i++) {
      if (spain_pointInRing(lat, lon, coords[i])) return false;
    }
    return true;
  }
  if (geom.type === "MultiPolygon") {
    for (const poly of coords) {
      if (!poly || !poly.length) continue;
      if (!spain_pointInRing(lat, lon, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (spain_pointInRing(lat, lon, poly[i])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }
  return true;
}

function track_removeVisual(track){
  if (!track) return;
  try { if (track._layer) layers.tracks.removeLayer(track._layer); } catch(_) {}
  try { if (track._label) layers.trackLabels.removeLayer(track._label); } catch(_) {}
  track._layer = null;
  track._label = null;
  if (typeof markNetworkDirty === "function") markNetworkDirty();
}

function track_hideAllLabels(){
  if (!state.tracks || typeof state.tracks.values !== "function") return;
  for (const t of state.tracks.values()){
    if (t && t._label) t._label.setOpacity(0);
  }
}

function track_updateVisibility(){
  if (!map || !state.tracks) return;
  for (const t of state.tracks.values()){
    if (!t || !t._layer) continue;
    const isStationTrack = !!(state.stations?.has(t.from) && state.stations?.has(t.to));
    if (!isStationTrack) {
      t._layer.setStyle({ opacity: 0, weight: 0 });
      if (t._label) t._label.setOpacity(0);
    } else {
      track_applyStyle(t);
    }
  }
}

function addTrack(fromId, toId, lanes=1, {silent=false, status="built"} = {}){
  if (state.simNodeMode === "stations" && state.realInfra?.success) {
    if (!silent) showToast("Real infrastructure is read-only; cannot edit tracks", "warning");
    return null;
  }
  if (state.simNodeMode === "stations" && state.stations) {
    if (!state.stations.has(fromId) || !state.stations.has(toId)) {
      if (!silent) showToast("Tracks must connect stations", "warning");
      return null;
    }
  }
  const a = state.nodes.get(fromId);
  const b = state.nodes.get(toId);
  if (!a || !b) return null;
  const midLat = (Number(a.lat) + Number(b.lat)) / 2;
  const midLon = (Number(a.lon) + Number(b.lon)) / 2;
  if (!spain_containsLatLon(a.lat, a.lon) || !spain_containsLatLon(b.lat, b.lon) || !spain_containsLatLon(midLat, midLon)) {
    if (!silent) {
      const cn = (typeof getCountrySpec === "function")
        ? (getCountrySpec(state.countryId || "ES")?.name || "Spain")
        : "Spain";
      showToast(`Track must stay within ${cn}`, "warning");
    }
    return null;
  }

  const key = edgeKey(fromId, toId);
  const trackId = `TK-${key}`;

  const prevTrack = state.tracks.has(trackId)
    ? { from: fromId, to: toId, lanes: Number(state.tracks.get(trackId)?.lanes || 1) }
    : null;

  if (state.tracks.has(trackId)) {
    const old = state.tracks.get(trackId);
    track_removeVisual(old);
    state.tracks.delete(trackId);
  }

  const cost = calculateTrackCost(a, b, lanes);
  const track = {
    id: trackId,
    from: fromId,
    to: toId,
    lanes,
    cost,
    status,
    progress: status === "built" ? 1 : 0,
    _layer: null,
    _label: null
  };

  state.tracks.set(trackId, track);
  track_makeVisual(track);
  if (typeof markNetworkDirty === "function") markNetworkDirty();

  if (!silent) {
    undo_pushAction({
      type: "track_add",
      trackId,
      refund: cost.constructionCost || 0,
      prev: prevTrack
    });
  }
  if (!silent) {
    showToast(`Track set: ${a.name} -> ${b.name}`, "success");
    updateUI();
    renderLines();
  }
  return trackId;
}

function construction_findJobByTrack(trackId){
  const cons = state.construction || { queue: [], active: [] };
  for (const j of cons.active){ if (j.trackId === trackId) return j; }
  for (const j of cons.queue){ if (j.trackId === trackId) return j; }
  return null;
}

function track_hasAnyState(fromId, toId){
  const key = edgeKey(fromId, toId);
  const id = `TK-${key}`;
  return state.tracks.has(id);
}

function track_isUsedByLines(trackId){
  const t = state.tracks.get(trackId);
  if (!t || t.status !== "built") return false;

  const adj = renderGraph_buildTrackAdj();
  const targetKey = edgeKey(t.from, t.to);

  for (const line of state.lines.values()){
    if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;
    const pairs = [];
    for (let i=0;i<line.stops.length-1;i++) pairs.push([line.stops[i], line.stops[i+1]]);
    if (line.circular && line.stops.length >= 3) pairs.push([line.stops[line.stops.length-1], line.stops[0]]);

    for (const [a,b] of pairs){
      const path = renderGraph_shortestPath(adj, a, b);
      if (!path || path.length < 2) continue;
      for (let i=1;i<path.length;i++){
        const k = edgeKey(path[i-1], path[i]);
        if (k === targetKey) return true;
      }
    }
  }
  return false;
}

function construction_queueBuild(fromId, toId, lanes=1, {silent=false} = {}){
  if (state.simNodeMode === "stations" && state.realInfra?.success) {
    if (!silent) showToast("Real infrastructure is read-only; cannot plan builds", "warning");
    return;
  }
  if (state.simNodeMode === "stations" && state.stations) {
    if (!state.stations.has(fromId) || !state.stations.has(toId)) {
      if (!silent) showToast("Build tracks between stations only", "warning");
      return;
    }
  }
  const a = state.nodes.get(fromId);
  const b = state.nodes.get(toId);
  if (!a || !b) return;
  if (fromId === toId) { showToast("Pick a different node", "warning"); return; }

  const key = edgeKey(fromId, toId);
  const trackId = `TK-${key}`;

  const existing = state.tracks.get(trackId);
  if (existing) {
    showToast("Track already exists or is planned", "warning");
    return;
  }

  if (construction_findJobByTrack(trackId)) {
    showToast("Track already in the build queue", "info");
    return;
  }

  state.construction ||= { queue: [], active: [], history: [] };

  const est = track_estimateBuild(fromId, toId, lanes);
  if (!est) return;

  if (!existing) {
    addTrack(fromId, toId, lanes, { silent: true, status: "planned" });
  }

  const t = state.tracks.get(trackId);
  if (t) {
    t.structureType = est.structure.type;
    t.structureMult = est.structure.mult;
    t.buildCost = est.costTotal;
  }

  state.construction.queue.push({
    id: `JOB-${Date.now()}-${Math.floor(Math.random()*10000)}`,
    type: "build",
    trackId,
    from: fromId,
    to: toId,
    lanes,
    totalDays: est.days,
    remainingDays: est.days,
    costTotal: est.costTotal,
    costPaid: 0,
    salvage: 0,
    issue: est.issue,
    blocked: false,
    startedDay: null,
    status: "queued",
    structureType: est.structure.type
  });

  if (!silent) {
    showToast(`Track planned (${est.structure.type}, ${est.days} days)`, "success");
    updateUI();
  }
}

function construction_queueDemolish(trackId){
  if (state.simNodeMode === "stations" && state.realInfra?.success) {
    showToast("Real infrastructure is read-only; cannot demolish tracks", "warning");
    return;
  }
  state.construction ||= { queue: [], active: [], history: [] };
  const t = state.tracks.get(trackId);
  if (!t) return;
  if (t.status !== "built") { showToast("Only built tracks can be demolished", "warning"); return; }

  if (construction_findJobByTrack(trackId)) {
    showToast("Track already in the demolition queue", "info");
    return;
  }

  if (track_isUsedByLines(trackId)) {
    showToast("Remove all lines using this track first", "warning");
    return;
  }

  const baseCost = Number(t.cost?.constructionCost || 0);
  const distKm = Number(t.cost?.distanceKm || 0);
  const labor = baseCost * Number(CONFIG.TRACK_DEMO_LABOR_MULT || 0.2);
  const salvage = baseCost * Number(CONFIG.TRACK_DEMO_SALVAGE_MULT || 0.08);
  const costTotal = Math.max(0, labor - salvage);
  const days = Math.max(2, Math.round(distKm * CONFIG.TRACK_BUILD_DAYS_PER_KM * 0.55));

  t.status = "demolishing";
  track_applyStyle(t);

  state.construction.queue.push({
    id: `JOB-${Date.now()}-${Math.floor(Math.random()*10000)}`,
    type: "demolish",
    trackId,
    from: t.from,
    to: t.to,
    lanes: t.lanes,
    totalDays: days,
    remainingDays: days,
    costTotal,
    costPaid: 0,
    salvage,
    issue: null,
    blocked: false,
    startedDay: null,
    status: "queued",
    structureType: "demolish"
  });

  showToast(`Demolition scheduled (${days} days)`, "warning");
  updateUI();
}

function construction_cancelQueued(jobId){
  const cons = state.construction || { queue: [] };
  const idx = cons.queue.findIndex(j => j.id === jobId);
  if (idx < 0) return;
  const job = cons.queue[idx];
  cons.queue.splice(idx, 1);

  if (job.type === "build") {
    const t = state.tracks.get(job.trackId);
    if (t && t.status === "planned") {
      track_removeVisual(t);
      state.tracks.delete(job.trackId);
    }
  }
  if (job.type === "demolish") {
    const t = state.tracks.get(job.trackId);
    if (t && t.status === "demolishing") {
      t.status = "built";
      track_applyStyle(t);
    }
  }

  updateUI();
  renderLines();
  showToast("Construction plan cancelled", "info");
}

function construction_startJobs(){
  state.construction ||= { queue: [], active: [], history: [] };
  const max = Number(state.construction.crewCap || CONFIG.TRACK_BUILD_MAX_CREWS || 2);
  while (state.construction.active.length < max && state.construction.queue.length > 0){
    const job = state.construction.queue.shift();
    job.status = "active";
    job.startedDay = Number(state.service?.day || 0);
    state.construction.active.push(job);

    let t = state.tracks.get(job.trackId);
    if (!t && job.type === "build") {
      addTrack(job.from, job.to, job.lanes || 1, { silent: true, status: "building" });
      t = state.tracks.get(job.trackId);
    }
    if (t) {
      if (job.type === "build") t.status = "building";
      if (job.type === "demolish") t.status = "demolishing";
      track_applyStyle(t);
    }
  }
}

function construction_advanceDay(){
  state.construction ||= { queue: [], active: [], history: [] };
  construction_startJobs();

  let changed = false;
  const keep = [];

  for (const job of state.construction.active){
    const t = state.tracks.get(job.trackId);
    const elapsed = job.totalDays - job.remainingDays;

    if (job.issue && !job.issue.resolved && !job.issue.active && elapsed >= job.issue.triggerDay) {
      job.issue.active = true;
      job.blocked = true;
      showToast("Construction issue: extra cost to resolve", "warning");
      changed = true;
    }

    if (job.blocked) {
      keep.push(job);
      continue;
    }

    const dailyCost = job.totalDays > 0 ? (job.costTotal / job.totalDays) : 0;
    state.budget -= dailyCost;
    job.costPaid += dailyCost;
    job.remainingDays -= 1;

    if (t && job.type === "build") {
      t.progress = clamp(job.totalDays > 0 ? ((job.totalDays - job.remainingDays) / job.totalDays) : 1, 0, 1);
    }

    changed = true;

    if (job.remainingDays <= 0) {
      if (job.type === "build") {
        if (t) {
          t.status = "built";
          t.progress = 1;
          track_applyStyle(t);
        }
        showToast("Track construction complete", "success");
        changed = true;
      } else if (job.type === "demolish") {
        if (t) {
          track_removeVisual(t);
          state.tracks.delete(job.trackId);
        }
        if (job.salvage > 0) state.budget += job.salvage;
        showToast("Track demolished", "warning");
        changed = true;
      }
      state.construction.history.push({ ...job, status: "done" });
      continue;
    }

    keep.push(job);
  }

  state.construction.active = keep;

  if (changed) {
    renderLines();
    updateUI();
  }
}

function construction_resolveIssue(jobId){
  const cons = state.construction || { active: [] };
  const job = cons.active.find(j => j.id === jobId);
  if (!job || !job.issue || !job.issue.active || job.issue.resolved) return;

  const cost = Number(job.issue.cost || 0);
  if (state.budget < cost) {
    showToast("Not enough budget to resolve issue", "warning");
    return;
  }

  state.budget -= cost;
  job.issue.resolved = true;
  job.blocked = false;
  showToast("Issue resolved, construction resumes", "success");
  updateUI();
}

let trackPreviewEl = null;

function ensureTrackPreviewOverlay(){
  if (trackPreviewEl) return trackPreviewEl;
  trackPreviewEl = document.createElement("div");
  trackPreviewEl.id = "trackPreviewOverlay";
  Object.assign(trackPreviewEl.style, {
    position: "fixed",
    bottom: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(15,23,42,0.95)",
    color: "#fff",
    padding: "18px",
    borderRadius: "14px",
    boxShadow: "0 16px 40px rgba(15,23,42,0.65)",
    zIndex: "1400",
    width: "320px",
    fontFamily: "sans-serif",
    display: "none",
    lineHeight: "1.4",
    textAlign: "left"
  });
  document.body.appendChild(trackPreviewEl);
  return trackPreviewEl;
}

function hideTrackBuildPreview(){
  if (!trackPreviewEl) return;
  trackPreviewEl.style.display = "none";
}

function showTrackBuildPreview(summary = {}, onConfirm, onCancel){
  const el = ensureTrackPreviewOverlay();
  const lines = [
    `Distance: ${fmtNum(summary.distanceKm?.toFixed?.(1) ?? summary.distanceKm ?? 0)} km`,
    `Build cost: ${formatCurrency(summary.estimatedBuildCost ?? 0)}`,
    `Maintenance/year: ${formatCurrency(summary.estimatedMaintenanceCost ?? 0)}`,
    `Tunnel estimate: ${fmtNum(summary.tunnelKm ? Number(summary.tunnelKm).toFixed(1) : 0)} km`,
    `Max speed estimate: ${Math.max(0, Math.round(summary.estimatedMaxSpeed || 0))} km/h`
  ].map(line => `<div style="font-size:13px;margin-bottom:4px;">${line}</div>`).join("");
  el.innerHTML = `
    <div style="font-weight:900;font-size:15px;margin-bottom:6px;">Confirm track build</div>
    ${lines}
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">
      <button class="btn secondary" style="padding:6px 14px;font-size:13px;" data-action="cancel">Cancel</button>
      <button class="btn" style="padding:6px 14px;font-size:13px;" data-action="confirm">Confirm</button>
    </div>
  `;
  const confirmBtn = el.querySelector("[data-action=confirm]");
  const cancelBtn = el.querySelector("[data-action=cancel]");
  confirmBtn.onclick = () => {
    hideTrackBuildPreview();
    if (typeof onConfirm === "function") onConfirm();
  };
  cancelBtn.onclick = () => {
    hideTrackBuildPreview();
    if (typeof onCancel === "function") onCancel();
  };
  el.style.display = "block";
}

function track_handleClick(trackId){
  const t = state.tracks.get(trackId);
  if (!t) return;

  if (state.activeTab === "tracks" && state.trackBuildAction === "demolish") {
    construction_queueDemolish(trackId);
    return;
  }

  const status = t.status || "built";
  const progress = Number.isFinite(t.progress) ? Math.round(t.progress * 100) : 0;
  const struct = t.structureType ? ` (${t.structureType})` : "";
  showToast(`Track ${status}${struct} - ${progress}%`, "info");
}

// Track build mode now CHAIN-PLANS:
// click A, click B => plans A→B, keeps B as next start.
function handleTrackBuildClick(node){
  if (!state.pendingTrackNode) {
    state.pendingTrackNode = node;
    showToast(`Track plan: start = ${node.name}`, "info");
    updateUI();
    return;
  }

  const a = state.pendingTrackNode;
  const b = node;

  if (a.id === b.id) {
    showToast("Pick a different node", "warning");
    updateUI();
    return;
  }

  const estimate = track_estimateBuild(a.id, b.id, state.pendingTrackLanes || 1);
  if (!estimate) {
    showToast("Cannot estimate this track", "warning");
    return;
  }

  showTrackBuildPreview(estimate, () => {
    construction_queueBuild(a.id, b.id, state.pendingTrackLanes || 1, { silent: true });
    state.pendingTrackNode = b;
    showToast(`Track planned: ${a.name} → ${b.name}`, "success");
    updateUI();
  }, () => {
    showToast("Track build cancelled", "info");
    state.pendingTrackNode = a;
  });
}

// ======================
// Lines (smart ordering + auto-track creation)
// ======================

// ======================
// Line defaults (carriages + speed classes)
// ======================
const TRAIN_SPEED_CLASSES = {
small: 60,
medium: 90,
fast: 120,
high: 200,
bullet: 300,
};

// Average capacity per carriage (editable later)
const CARRIAGE_CAPACITY = {
passenger_pax: 80,
cargo_units: 250,
mixed_pax: 40,   // half-and-half: passenger carriage capacity
mixed_cargo: 125 // half-and-half: cargo carriage capacity
};

function lineDefaults(type){
const dwellSecByType = {
  passenger: 45,
  cargo: 90,
  mixed: 60,
};
if (type === "cargo")   return { frequencyPerDay: 0, carriages: 12, speedClass: "medium", dwellSec: dwellSecByType[type] ?? 60, color: "#ef4444", serviceStartMin: 330, // 05:30
serviceEndMin: 1410,  // 23:30
nightService: false,
nightHeadwayMin: 60,
};
if (type === "mixed")   return { frequencyPerDay: 0, carriages: 8,  speedClass: "fast", dwellSec: dwellSecByType[type] ?? 60,   color: "#6b7280", serviceStartMin: 330, // 05:30
serviceEndMin: 1410,  // 23:30
nightService: false,
nightHeadwayMin: 60,
};
return { frequencyPerDay: 0, carriages: 6, speedClass: "fast", dwellSec: dwellSecByType[type] ?? 60, color: "#2b6cff", serviceStartMin: 330, // 05:30
serviceEndMin: 1410,  // 23:30
nightService: false,
nightHeadwayMin: 60,
};
}

function addLine(name, type="passenger", circular=false, overrides=null){
const nextLineNumber = () => {
  let max = 0;
  for (const l of state.lines.values()) {
    const n = Number(l?.number);
    if (Number.isFinite(n) && n > max) max = n;
    const m = String(l?.name || "").match(/\b(\d+)\b/);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  return max + 1;
};
const id = `LN-${Date.now()}`;
const d = lineDefaults(type);

const ln = {
  id,
  name,
  number: Number.isFinite(overrides?.number) ? Math.round(overrides.number) : nextLineNumber(),
  type,
  color: d.color,
  stops: [],
  circular: !!circular,

  // Trips/day is no longer used (timetable drives service). Keep for compatibility.
  frequencyPerDay: 0,

  // Player chooses carriages; capacity is derived.
  carriages: d.carriages,
  speedClass: d.speedClass,
  speedKmh: TRAIN_SPEED_CLASSES[d.speedClass] || 120,

  // Derived (filled by line_recalcDerived)
  vehicleCapacity: 0,
  capacityPax: 0,
  capacityCargo: 0,

  // Timetable + service
  trains: 0,
  departures: [], // minutes since midnight (sorted)
};

// Apply safe overrides
if (overrides && typeof overrides === "object") {
  if (Number.isFinite(overrides.carriages)) ln.carriages = clamp(Math.round(overrides.carriages), 1, 50);
  if (typeof overrides.speedClass === "string" && TRAIN_SPEED_CLASSES[overrides.speedClass]) ln.speedClass = overrides.speedClass;
  // Allow custom speedKmh only if explicitly provided (advanced)
  if (Number.isFinite(overrides.speedKmh)) ln.speedKmh = Math.max(10, overrides.speedKmh);
}

line_recalcDerived(ln);

state.lines.set(id, ln);
state.activeLine = id;

renderLines();
updateUI();
showToast(`Created line: ${name}`, "success");
return id;
}

function line_recalcDerived(line){
if (!line) return;
// speed
const cls = line.speedClass;
if (TRAIN_SPEED_CLASSES[cls]) line.speedKmh = TRAIN_SPEED_CLASSES[cls];

const cars = clamp(Math.round(Number(line.carriages || 0)), 1, 50);
line.carriages = cars;

// capacity
let pax=0, cargo=0;
if (line.type === "cargo"){
  cargo = cars * CARRIAGE_CAPACITY.cargo_units;
} else if (line.type === "mixed"){
  const paxCars = Math.ceil(cars/2);
  const cargoCars = Math.floor(cars/2);
  pax = paxCars * CARRIAGE_CAPACITY.mixed_pax;
  cargo = cargoCars * CARRIAGE_CAPACITY.mixed_cargo;
} else {
  pax = cars * CARRIAGE_CAPACITY.passenger_pax;
}
line.capacityPax = pax;
line.capacityCargo = cargo;

// legacy single-number capacity for existing economy code
line.vehicleCapacity = (line.type === "cargo") ? cargo : pax;
}

function line_trainMaintenanceCostEURPerYear(line){
if (!line) return 0;
const trains = Math.max(0, Math.round(Number(line.trains || 0)));
const cars = Math.max(1, Math.round(Number(line.carriages || 1)));
const base = Number(CONFIG.TRAIN_MAINT_PER_CARRIAGE_PER_YEAR || 0);

const cls = String(line.speedClass || "medium");
const mult =
  cls === "small" ? Number(CONFIG.TRAIN_MAINT_MULT_SMALL) :
  cls === "medium" ? Number(CONFIG.TRAIN_MAINT_MULT_MEDIUM) :
  cls === "fast" ? Number(CONFIG.TRAIN_MAINT_MULT_FAST) :
  cls === "high" ? Number(CONFIG.TRAIN_MAINT_MULT_HIGH) :
  cls === "bullet" ? Number(CONFIG.TRAIN_MAINT_MULT_BULLET) :
  1.0;

return trains * cars * base * mult;
}



function pathLength(ids){
  let sum = 0;
  for (let i=0;i<ids.length-1;i++){
    const A = state.nodes.get(ids[i]);
    const B = state.nodes.get(ids[i+1]);
    if (!A || !B) continue;
    sum += map.distance([A.lat,A.lon],[B.lat,B.lon]);
  }
  return sum;
}

// 2-opt improvement to reduce criss-cross and shorten

// ======================
// Smart line geometry helpers (NO criss-cross, minimize detours)
// ======================

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

// Pressure model (v1):
// - Demand is based on population (cities) or sumPop (clusters).
// - Supply is based on sum of (frequencyPerDay * vehicleCapacity) for lines that stop there.
// - Platforms cap how much frequency can be “handled” at the station.
// - Amenities increase effective handling a bit (comfort/circulation).
function computeStationPressure(){
const DEMAND_PER_PERSON_PER_DAY = 0.04;   // tune later
const MAX_TRAINS_PER_PLATFORM_PER_DAY = 10; // tune later

// nodeId -> { demand, supply }
const agg = new Map();

// 1) Demand per node from population
for (const n of state.nodes.values()){
  if (!n) continue;
  const id = String(n.id);
  const pop = Math.max(0, Number(n.population ?? n.sumPop ?? 0));
  if (pop <= 0) continue;

  const demand = pop * DEMAND_PER_PERSON_PER_DAY;
  agg.set(id, { demand, supply: 0 });
}

// 2) Supply per node from lines that stop there
for (const line of state.lines.values()){
  if (!line || !Array.isArray(line.stops) || line.stops.length < 2) continue;

  const freq = Math.max(0, Number(line.frequencyPerDay || 0));
  const cap  = Math.max(0, Number(line.vehicleCapacity || 0));
  if (freq <= 0 || cap <= 0) continue;

  for (const rawId of line.stops){
    const id = String(rawId);

    // Ensure node exists in agg even if demand was 0
    if (!agg.has(id)) agg.set(id, { demand: 0, supply: 0 });

    const st = (typeof getStation === "function") ? getStation(id) : null;
    const platforms = Math.max(1, Number(st?.platforms || 1));
    const amenities = Math.max(0, Number(st?.amenities || 0));

    // Platforms cap usable frequency at the station (handled trains/day)
    const stationFreqCap = platforms * MAX_TRAINS_PER_PLATFORM_PER_DAY;
    const effectiveFreq = Math.min(freq, stationFreqCap);

    // Amenities increase effective handling slightly (comfort/circulation)
    const comfortMult = 1 + Math.min(0.6, amenities * 0.08);

    agg.get(id).supply += effectiveFreq * cap * comfortMult;
  }
}

// 3) Convert to pressure%
state.stationPressure.clear();

let worst = { id: null, pressurePct: 0 };
for (const [id, v] of agg.entries()){
  const demand = Math.max(0, Number(v.demand || 0));
  const supply = Math.max(0, Number(v.supply || 0));

  // If no demand, no pressure (but still store)
  let pressurePct = 0;
  if (demand > 0) {
    const shortfall = clamp01((demand - supply) / demand); // 0..1
    pressurePct = Math.round(shortfall * 100);
  }

  state.stationPressure.set(id, { demand, supply, pressurePct });

  if (pressurePct > worst.pressurePct) worst = { id, pressurePct };
}

return worst; // can be used for a toast/debug later
}

function segLen(aId, bId){
const A = state.nodes.get(aId), B = state.nodes.get(bId);
if (!A || !B) return 0;
return map.distance([A.lat, A.lon], [B.lat, B.lon]);
}

// Proper segment intersection test (in screen space for stability)
function segmentsIntersect(aId,bId,cId,dId){
const A = state.nodes.get(aId), B = state.nodes.get(bId);
const C = state.nodes.get(cId), D = state.nodes.get(dId);
if (!A||!B||!C||!D) return false;

const a = map.latLngToLayerPoint([A.lat,A.lon]);
const b = map.latLngToLayerPoint([B.lat,B.lon]);
const c = map.latLngToLayerPoint([C.lat,C.lon]);
const d = map.latLngToLayerPoint([D.lat,D.lon]);

function ccw(p1,p2,p3){
  return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
}

// share endpoints => ignore
const shared =
  (aId===cId)||(aId===dId)||(bId===cId)||(bId===dId);
if (shared) return false;

return (ccw(a,c,d) !== ccw(b,c,d)) && (ccw(a,b,c) !== ccw(a,b,d));
}

function countCrossings(stops){
let x = 0;
for (let i=0;i<stops.length-1;i++){
  for (let j=i+2;j<stops.length-1;j++){
    // skip adjacent and skip first-last adjacency
    if (i===0 && j===stops.length-2) continue;
    if (segmentsIntersect(stops[i],stops[i+1],stops[j],stops[j+1])) x++;
  }
}
return x;
}

// Score = total length + huge penalty for crossings
function lineScore(stops){
let len = 0;
for (let i=0;i<stops.length-1;i++) len += segLen(stops[i], stops[i+1]);
const crossings = countCrossings(stops);
return len + crossings * 1e12; // crossings are basically forbidden
}

// 2-opt improvement to remove crossings + shorten route
function improveLineOrder(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 4) return;

let improved = true;
let guard = 0;

while (improved && guard < 80){
  improved = false;
  guard++;

  for (let i=0;i<line.stops.length-3;i++){
    for (let k=i+2;k<line.stops.length-1;k++){
      // don't break adjacency
      if (i===0 && k===line.stops.length-2) continue;

      const A = line.stops[i],     B = line.stops[i+1];
      const C = line.stops[k],     D = line.stops[k+1];

      const before = segLen(A,B) + segLen(C,D);
      const after  = segLen(A,C) + segLen(B,D);

      // If swapping reduces length OR fixes an intersection, do it
      const hadX = segmentsIntersect(A,B,C,D);
      if (after + 1e-6 < before || hadX) {
        // reverse the segment between B..C
        const middle = line.stops.slice(i+1, k+1).reverse();
        line.stops.splice(i+1, k - i, ...middle);
        improved = true;
      }
    }
  }
}
}

// ======================
// FIXED: Smart add stop (prepend/append/insert + 2-opt cleanup)
// ======================
function addStopSmart(line, nodeId){
if (!line || !Array.isArray(line.stops)) return;
if (line.stops.includes(nodeId)) return;

// 0-1 stops: just append
if (line.stops.length < 2) {
  line.stops.push(nodeId);
  return;
}

let best = null;
let bestScore = Infinity;

// Candidate A: prepend
{
  const cand = [nodeId, ...line.stops];
  const s = lineScore(cand);
  if (s < bestScore) { bestScore = s; best = cand; }
}

// Candidate B: append
{
  const cand = [...line.stops, nodeId];
  const s = lineScore(cand);
  if (s < bestScore) { bestScore = s; best = cand; }
}

// Candidate C: insert between every pair
for (let i = 0; i < line.stops.length - 1; i++) {
  const cand = line.stops.slice();
  cand.splice(i + 1, 0, nodeId);

  const s = lineScore(cand);
  if (s < bestScore) { bestScore = s; best = cand; }
}

  line.stops = best || [...line.stops, nodeId];
  improveLineOrder(line);
  markDemandDirty();
}

function autoLanesForLineType(type){
  if (type === "cargo") return CONFIG.AUTO_TRACK_LANES_CARGO;
  if (type === "mixed") return CONFIG.AUTO_TRACK_LANES_MIXED;
  return CONFIG.AUTO_TRACK_LANES_PASSENGER;
}

// ======================
// Line rendering along built tracks (shortest path)
// ======================

function track_speed(lanes){
  const baseSpeed = 80; // km/h
  const laneBonus = 20; // km/h per lane
  return baseSpeed + (Number(lanes || 1) - 1) * laneBonus;
}

function renderGraph_buildTrackAdj(){
  if (!map || !state.tracks || !state.nodes) return new Map();
  if (adjacencyCache && !state?.dirty?.network) return adjacencyCache;
  const start = state.debug?.perf ? performance.now() : null;
  const adj = new Map();

for (const t of state.tracks.values()){
  if (!t) continue;
  if (t.status && t.status !== "built") continue;
  const aId = t.from, bId = t.to;
  const a = state.nodes.get(aId);
  const b = state.nodes.get(bId);
  if (!a || !b) continue;

  const distanceM = map.distance([Number(a.lat), Number(a.lon)], [Number(b.lat), Number(b.lon)]);
  const speedKmh = track_speed(t.lanes);
  const speedMPerS = (speedKmh * 1000) / 3600;
  const timeS = distanceM / speedMPerS;
  const w = timeS;
  if (!Number.isFinite(w) || w <= 0) continue;

  if (!adj.has(aId)) adj.set(aId, []);
  if (!adj.has(bId)) adj.set(bId, []);
  adj.get(aId).push({ to: bId, w });
  adj.get(bId).push({ to: aId, w });
}
  adjacencyCache = adj;
  if (state.dirty) state.dirty.network = false;
  routeCache.clear();
  if (start) perfLog("renderGraph_buildTrackAdj", start);
  return adj;
}


function line_isTrackReady(line){
if (!line || !Array.isArray(line.stops) || line.stops.length < 2) return false;
const adj = renderGraph_buildTrackAdj();

const pairs = [];
for (let i=0;i<line.stops.length-1;i++) pairs.push([line.stops[i], line.stops[i+1]]);
if (line.circular && line.stops.length >= 3) pairs.push([line.stops[line.stops.length-1], line.stops[0]]);

for (const [a,b] of pairs){
  const path = renderGraph_shortestPath(adj, a, b);
  if (!path || path.length < 2) return false;
}
return true;
}

function computePathStats(path, adj){
  let distanceKm = 0;
  let timeSeconds = 0;
  if (!Array.isArray(path) || path.length < 2) return { distanceKm: 0, timeSeconds: 0 };
  for (let i = 1; i < path.length; i++){
    const from = path[i-1];
    const to = path[i];
    const neighbors = adj.get(from) || [];
    const edge = neighbors.find(e => String(e.to) === String(to));
    if (!edge) continue;
    distanceKm += Number(edge.distanceKm || 0);
    timeSeconds += Number(edge.w || 0);
  }
  return { distanceKm, timeSeconds };
}

function renderGraph_shortestPath(adj, startId, goalId){
  const cacheKey = routeCacheKey(startId, goalId);
  if (cacheKey && !state?.dirty?.network && routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)?.nodes || null;
  }
  if (!startId || !goalId) return null;
  if (startId === goalId) return [startId];
  if (!adj || !adj.size) return null;
  const perfStart = state.debug?.perf ? performance.now() : null;

const dist = new Map();
const prev = new Map();
const visited = new Set();

dist.set(startId, 0);
const pq = [{ id: startId, d: 0 }]; // tiny graphs: simple array PQ is fine

while (pq.length) {
  pq.sort((a,b) => a.d - b.d);
  const cur = pq.shift();
  if (!cur) break;

  const u = cur.id;
  if (visited.has(u)) continue;
  visited.add(u);

  if (u === goalId) break;

  const nbrs = adj.get(u);
  if (!nbrs) continue;

  for (const e of nbrs) {
    const nd = cur.d + e.w;
    const best = dist.has(e.to) ? dist.get(e.to) : Infinity;
    if (nd < best) {
      dist.set(e.to, nd);
      prev.set(e.to, u);
      pq.push({ id: e.to, d: nd });
    }
  }
}

  if (!dist.has(goalId)) return null;

// Reconstruct
  const path = [];
  let cur = goalId;
  while (cur != null) {
    path.push(cur);
    if (cur === startId) break;
    cur = prev.get(cur);
  }
  path.reverse();
  const result = path[0] === startId ? path : null;
  if (cacheKey && result) {
    const stats = computePathStats(result, adj);
    routeCache.set(cacheKey, {
      nodes: result,
      distanceKm: Number(stats.distanceKm || 0),
      timeMin: (Number(stats.timeSeconds || 0) / 60)
    });
  }
  if (perfStart) perfLog("renderGraph_shortestPath", perfStart);
  return result;
}

function ensureLineTracks(line, adj){
  // Only auto-plan a direct segment if there is NO existing route on built tracks.
  if (!line || !Array.isArray(line.stops) || line.stops.length < 2) return;
  if (line.noAutoTracks) return;

const lanes = autoLanesForLineType(line.type);

const pairs = [];
for (let i=0;i<line.stops.length-1;i++) pairs.push([line.stops[i], line.stops[i+1]]);
if (line.circular && line.stops.length >= 3) pairs.push([line.stops[line.stops.length-1], line.stops[0]]);

for (const [a,b] of pairs){
  // If there's already a route along built tracks, DON'T create a shortcut.
  const route = renderGraph_shortestPath(adj, a, b);
  if (route && route.length >= 2) continue;

  // No route: plan a direct track segment (construction queue)
  if (!track_hasAnyState(a, b)) construction_queueBuild(a, b, lanes, { silent: true });
}
}

function renderLines(){
  layers.lines.clearLayers();

// Build adjacency from currently-built tracks
const adj = renderGraph_buildTrackAdj();

    for (const line of state.lines.values()){
    if (!Array.isArray(line.stops) || line.stops.length < 2) continue;
    const lineType = line.type || "passenger";
    if (state.primaryTab === "production" && lineType !== "cargo" && lineType !== "mixed") continue;

  // Ensure connectivity but don't create shortcuts if a route already exists
  ensureLineTracks(line, adj);

    // Build polyline points by routing along tracks between consecutive stops
    const latlngs = [];

    const pushPath = (pathIds) => {
      if (!Array.isArray(pathIds) || pathIds.length < 2) return false;
      const pts = [];
      for (const id of pathIds){
        const n = state.nodes.get(id);
        if (n) pts.push([Number(n.lat), Number(n.lon)]);
      }
      if (pts.length < 2) return false;

      // concat, avoiding duplicate point at joins
      if (!latlngs.length) latlngs.push(...pts);
      else latlngs.push(...pts.slice(1));
      return true;
    };

    let usedDirectPath = false;
    if (Array.isArray(line.pathNodes) && line.pathNodes.length >= 2) {
      let stopIdx = 0;
      let okPath = true;
      for (const stop of line.stops) {
        const stopStr = String(stop);
        let found = -1;
        for (let i = stopIdx; i < line.pathNodes.length; i++) {
          if (String(line.pathNodes[i]) === stopStr) { found = i; break; }
        }
        if (found < 0) { okPath = false; break; }
        stopIdx = found + 1;
      }
      for (let i = 1; i < line.pathNodes.length; i++) {
        const aRaw = line.pathNodes[i - 1];
        const bRaw = line.pathNodes[i];
        const bStr = String(bRaw);
        const nbrs = adj.get(aRaw) || adj.get(String(aRaw));
        if (!nbrs || !nbrs.some(e => String(e.to) === bStr)) { okPath = false; break; }
      }
      if (okPath && pushPath(line.pathNodes)) usedDirectPath = true;
    }

    if (!usedDirectPath) {
      for (let i=1; i<line.stops.length; i++){
        const a = line.stops[i-1];
        const b = line.stops[i];
        const path = renderGraph_shortestPath(adj, a, b);

        if (!pushPath(path)) {
          // No built track path available -> skip rendering this line segment
          latlngs.length = 0;
          break;
        }
      }

      if (latlngs.length && line.circular && line.stops.length >= 3) {
        const a = line.stops[line.stops.length - 1];
        const b = line.stops[0];
        const path = renderGraph_shortestPath(adj, a, b);
        if (!pushPath(path)) latlngs.length = 0;
      }
    }
trainVis_rebuildFromLines();


  if (latlngs.length < 2) continue;

  const ready = (typeof line_isTrackReady === "function") ? line_isTrackReady(line) : true;
  const retiring = !!line.retiring;
  const lineDash = retiring ? "2,6" : (ready ? (line.type === "cargo" ? "10,10" : null) : "4,8");
  const lineOpacity = retiring ? 0.25 : (ready ? (line.id === state.activeLine ? 0.90 : 0.62) : 0.35);

  L.polyline(latlngs, {
    color: line.color,
    weight: line.id === state.activeLine ? 5 : 3.5,
    opacity: lineOpacity,
    dashArray: lineDash
  }).addTo(layers.lines)
    .bindTooltip(`${line.name} (${line.type}) - cap ${line.vehicleCapacity}${line.type==="cargo"?"t":" pax"}${line.circular ? " (circular)" : ""}${ready ? "" : " - tracks not ready"}${retiring ? " - retiring" : ""}`);
 }
}

// ======================
// Train dots (visual only): move along LINES, inherit line color
// ======================
const trainVis = {
trains: [],
rafId: 0,
lastTs: 0,
timeScale: 120,  // speeds up movement so you can see it
dotRadius: 7,    // bigger dots
};

function trainVis_stop(){
if (trainVis.rafId) cancelAnimationFrame(trainVis.rafId);
trainVis.rafId = 0;
trainVis.lastTs = 0;
}

function trainVis_clear(){
try { layers.trains.clearLayers(); } catch(_) {}
trainVis.trains.length = 0;
}

function trainVis_latLngAt(t, km){
const cum = t.cumKm;
const pts = t.pts;
if (!cum || !pts || pts.length < 2) return null;

// clamp
if (km <= 0) return pts[0];
if (km >= t.lenKm) return pts[pts.length - 1];

// find segment (linear scan; routes are short)
let i = 0;
while (i < cum.length - 1 && cum[i + 1] < km) i++;

const a = pts[i];
const b = pts[i + 1];
const segLen = (cum[i + 1] - cum[i]) || 1e-9;
const f = (km - cum[i]) / segLen;

return L.latLng(
  a.lat + (b.lat - a.lat) * f,
  a.lng + (b.lng - a.lng) * f
);
}

function trainVis_tick(ts){
// dt for train motion smoothing (visual)
const dt = Math.min(0.08, Math.max(0.0, (ts - (trainVis.lastTs || ts)) / 1000));
trainVis.lastTs = ts;

// (Clock + scheduled runs are driven by clock_tick now.)

// move train dots
for (const t of trainVis.trains) {
  const speedKmh = Math.max(10, Number(t.speedKmh || 120));
  const kmPerSec = (speedKmh / 3600) * trainVis.timeScale;

  t.posKm += kmPerSec * dt * t.dir;

  if (t.circular) {
    const Lk = t.lenKm || 1;
    t.posKm = ((t.posKm % Lk) + Lk) % Lk;
  } else {
    if (t.posKm > t.lenKm) {
      t.posKm = t.lenKm - (t.posKm - t.lenKm);
      t.dir = -1;
    }
    if (t.posKm < 0) {
      t.posKm = -t.posKm;
      t.dir = 1;
    }
  }

  const ll = trainVis_latLngAt(t, t.posKm);
  if (ll) t.marker.setLatLng(ll);
}

// refresh the inline clock label (upper-right)
uiClock_updateInline();

// schedule next frame
trainVis.rafId = requestAnimationFrame(trainVis_tick);
}

function trainVis_start(){
return;
}

function trainVis_clearAll(){
if (!trainVis?.trains) return;
for (const t of trainVis.trains){
  try { t.marker?.remove(); } catch(e){}
}
trainVis.trains = [];
if (trainVis.rafId) cancelAnimationFrame(trainVis.rafId);
trainVis.rafId = 0;
}


function trainVis_rebuildFromLines(){
return;
}

// ======================
// Node selection logic
// ======================
function selectNode(nodeId){
  const node = state.nodes.get(nodeId);
  if (!node) return;

  state.selectedNode = node;
  state.selectedNodeId = node.id;

// Refresh cluster active styling if relevant
  if (map.getZoom() <= CONFIG.CLUSTER_VIEW_MAX_ZOOM) renderClusterMarkers();

  // Line build mode
if (state.activeLine && state.lines.has(state.activeLine) && state.lineBuildMode && !state.trackBuildMode) {
const line = state.lines.get(state.activeLine);
const beforeStops = Array.isArray(line.stops) ? line.stops.slice() : [];

const stationId = (typeof nodeToStationId === "function") ? nodeToStationId(nodeId) : null;
const stationEntry = stationId ? state.stations.get(stationId) : null;
if (!stationId) {
  showToast("Not a station — build or convert station first", "warning");
  return;
}
if (!stationEntry || !stationEntry.active) {
  showToast("Station inactive. Reactivate it via the City inspector before adding stops.", "warning");
  return;
}
if (!stationEntry.rail_node_id) {
  showToast("Station has no snapped rail node (unroutable)", "warning");
  return;
}
addStopSmart(line, stationId);

// Only push undo if something actually changed
if (Array.isArray(line.stops) && line.stops.length !== beforeStops.length) {
  undo_pushAction({
    type: "line_stops",
    lineId: line.id,
    beforeStops
  });
}

showToast(`Added stop: ${node.name}`, "success");
renderLines();
updateUI();
return;
}

// Track build mode (plan)
  if (state.activeTab === "tracks" && state.trackBuildMode && state.trackBuildAction === "build") {
    handleTrackBuildClick(node);
    return;
  }

  if (state.activeTab === "tracks" && state.trackBuildAction === "demolish") {
    showToast("Demolish mode: click a track segment", "info");
  }

  map.setView([node.lat, node.lon], Math.max(map.getZoom(), 8));
}
