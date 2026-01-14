/* eslint-disable no-undef, no-unused-vars, no-empty */
// OSM rail import (Spain) -> connect existing city/cluster nodes via tracks.
// Uses public/data/osm_rail_spain.json generated from Overpass.

function osm_haversineKm(a, b) {
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

function osm_coordKey(lat, lon, precision = 6) {
  return `${Number(lat).toFixed(precision)},${Number(lon).toFixed(precision)}`;
}

function osm_isValidOsmJson(osm) {
  return !!(osm && Array.isArray(osm.elements) && osm.elements.length > 0);
}

function osm_buildRailGraph(osm, opts = {}) {
  const vertices = [];
  const adj = [];
  const idByCoord = new Map();
  const grid = new Map();
  const cellSize = 0.2; // degrees
  const allowNarrow = (opts.allowNarrow !== false);
  const coordPrecision = Number.isFinite(Number(opts.coordPrecision)) ? Number(opts.coordPrecision) : 6;

  const addToGrid = (id, lat, lon) => {
    const gx = Math.floor((lon + 180) / cellSize);
    const gy = Math.floor((lat + 90) / cellSize);
    const key = `${gx},${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(id);
  };

  const addVertex = (lat, lon) => {
    const key = osm_coordKey(lat, lon, coordPrecision);
    if (idByCoord.has(key)) return idByCoord.get(key);
    const id = vertices.length;
    vertices.push({ lat: Number(lat), lon: Number(lon) });
    adj.push([]);
    idByCoord.set(key, id);
    addToGrid(id, Number(lat), Number(lon));
    return id;
  };

  const elements = Array.isArray(osm?.elements) ? osm.elements : [];
  for (const el of elements) {
    if (!el || el.type !== "way" || !Array.isArray(el.geometry)) continue;
    const railway = (el.tags && el.tags.railway) ? String(el.tags.railway) : "";
    if (!allowNarrow && railway && railway !== "rail") continue;
    const geom = el.geometry;
    for (let i = 1; i < geom.length; i++) {
      const a = geom[i - 1];
      const b = geom[i];
      if (!a || !b) continue;
      const va = addVertex(a.lat, a.lon);
      const vb = addVertex(b.lat, b.lon);
      const km = osm_haversineKm(a, b);
      adj[va].push({ to: vb, km });
      adj[vb].push({ to: va, km });
    }
  }

  return { vertices, adj, grid, cellSize };
}

function osm_computeComponents(adj) {
  const comp = new Array(adj.length).fill(-1);
  let cid = 0;
  for (let i = 0; i < adj.length; i++) {
    if (comp[i] !== -1) continue;
    const q = [i];
    comp[i] = cid;
    while (q.length) {
      const cur = q.shift();
      for (const e of adj[cur]) {
        if (comp[e.to] === -1) {
          comp[e.to] = cid;
          q.push(e.to);
        }
      }
    }
    cid += 1;
  }
  return comp;
}

function osm_findNodeIdByName(name){
  if (!name) return null;
  const target = String(name).toLowerCase();
  for (const n of state.nodes.values()){
    const nname = String(n?.name || "").toLowerCase();
    if (nname === target) return n.id;
  }
  return null;
}

function osm_removeTrack(aId, bId){
  if (!aId || !bId) return false;
  const trackId = `TK-${edgeKey(aId, bId)}`;
  const t = state.tracks.get(trackId);
  if (!t) return false;
  try { track_removeVisual?.(t); } catch (_) {}
  state.tracks.delete(trackId);
  return true;
}


function osm_buildMstEdges(list) {
  if (!Array.isArray(list) || list.length < 2) return [];
  const inTree = new Set([list[0].id]);
  const edges = [];

  while (inTree.size < list.length) {
    let best = null;
    for (const a of list) {
      if (!inTree.has(a.id)) continue;
      for (const b of list) {
        if (inTree.has(b.id)) continue;
        const km = osm_haversineKm(a, b);
        if (!Number.isFinite(km)) continue;
        if (!best || km < best.km) best = { a: a.id, b: b.id, km };
      }
    }
    if (!best) break;
    inTree.add(best.b);
    edges.push(best);
  }
  return edges;
}

function osm_findNearestVertex(node, graph, maxKm) {
  const { vertices, grid, cellSize } = graph;
  const lat = Number(node.lat);
  const lon = Number(node.lon);
  const gx = Math.floor((lon + 180) / cellSize);
  const gy = Math.floor((lat + 90) / cellSize);
  const maxCells = Math.max(1, Math.ceil(maxKm / (cellSize * 111)));

  let bestId = null;
  let bestKm = Infinity;

  for (let dx = -maxCells; dx <= maxCells; dx++) {
    for (let dy = -maxCells; dy <= maxCells; dy++) {
      const key = `${gx + dx},${gy + dy}`;
      const list = grid.get(key);
      if (!list) continue;
      for (const vid of list) {
        const v = vertices[vid];
        const d = osm_haversineKm(node, v);
        if (d < bestKm) {
          bestKm = d;
          bestId = vid;
        }
      }
    }
  }

  if (bestKm <= maxKm) return { id: bestId, km: bestKm };
  return null;
}

class OsmMinHeap {
  constructor() { this.data = []; }
  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }
  pop() {
    if (!this.data.length) return null;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length) {
      this.data[0] = last;
      this._bubbleDown(0);
    }
    return top;
  }
  get size() { return this.data.length; }
  _bubbleUp(i) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.data[p].d <= this.data[i].d) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  _bubbleDown(i) {
    const n = this.data.length;
    while (true) {
      let m = i;
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      if (l < n && this.data[l].d < this.data[m].d) m = l;
      if (r < n && this.data[r].d < this.data[m].d) m = r;
      if (m === i) break;
      [this.data[m], this.data[i]] = [this.data[i], this.data[m]];
      i = m;
    }
  }
}

function osm_buildClusterAdjacency(graph, mapped, maxConnKm){
  const n = graph.vertices.length;
  const dist = new Float64Array(n);
  const owner = new Int32Array(n);
  for (let i = 0; i < n; i++) { dist[i] = Number.POSITIVE_INFINITY; owner[i] = -1; }

  const clusters = mapped.map(m => m.id);
  const heap = new OsmMinHeap();

  for (let i = 0; i < mapped.length; i++) {
    const m = mapped[i];
    const vid = m.railVid;
    if (vid == null) continue;
    dist[vid] = 0;
    owner[vid] = i;
    heap.push({ id: vid, d: 0 });
  }

  while (heap.size) {
    const cur = heap.pop();
    if (!cur) break;
    if (cur.d !== dist[cur.id]) continue;
    const nbrs = graph.adj[cur.id] || [];
    for (const e of nbrs){
      const nd = cur.d + Number(e.km || 0);
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        owner[e.to] = owner[cur.id];
        heap.push({ id: e.to, d: nd });
      }
    }
  }

  const pairDist = new Map();
  for (let u = 0; u < n; u++) {
    const oa = owner[u];
    if (oa < 0) continue;
    const nbrs = graph.adj[u] || [];
    for (const e of nbrs){
      const v = e.to;
      if (u >= v) continue;
      const ob = owner[v];
      if (ob < 0 || oa === ob) continue;
      const d = dist[u] + Number(e.km || 0) + dist[v];
      if (Number.isFinite(maxConnKm) && d > maxConnKm) continue;
      const a = Math.min(oa, ob);
      const b = Math.max(oa, ob);
      const key = `${a}|${b}`;
      const prev = pairDist.get(key);
      if (prev == null || d < prev) pairDist.set(key, d);
    }
  }

  const edges = [];
  for (const [key, km] of pairDist.entries()){
    const [a, b] = key.split("|").map(Number);
    edges.push({ a: clusters[a], b: clusters[b], km });
  }
  return edges;
}

async function importOsmRailTracksFromOverpass(opts = {}) {
  const endpointList = opts.endpoints || [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter"
  ];

  const nodes = Array.from(state.nodes.values());
  const bounds = nodes.reduce((acc, n) => {
    if (!n || n.lat == null || n.lon == null) return acc;
    const lat = Number(n.lat);
    const lon = Number(n.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return acc;
    acc.minLat = Math.min(acc.minLat, lat);
    acc.maxLat = Math.max(acc.maxLat, lat);
    acc.minLon = Math.min(acc.minLon, lon);
    acc.maxLon = Math.max(acc.maxLon, lon);
    return acc;
  }, { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 });

  if (!(bounds.minLat < bounds.maxLat && bounds.minLon < bounds.maxLon)) {
    throw new Error("No valid node bounds for OSM fetch");
  }

  const pad = Number(opts.padDeg || 0.3);
  const south = bounds.minLat - pad;
  const west = bounds.minLon - pad;
  const north = bounds.maxLat + pad;
  const east = bounds.maxLon + pad;

  const timeoutMs = Number(opts.timeoutMs || 60000);
  const makeQuery = (s, w, n, e) =>
    `[out:json][timeout:180];(way["railway"="rail"](${s},${w},${n},${e}););out geom;`;

  const fetchOne = async (s, w, n, e) => {
    const query = makeQuery(s, w, n, e);
    let lastErr = null;
    for (const url of endpointList) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: query,
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        const data = await res.json();
        if (!osm_isValidOsmJson(data)) throw new Error("Empty OSM response");
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Overpass fetch failed");
  };

  const spanLat = Math.abs(north - south);
  const spanLon = Math.abs(east - west);
  const grid = Number(opts.grid) || ((spanLat > 3 || spanLon > 3) ? 2 : 1);

  if (grid <= 1) {
    return await fetchOne(south, west, north, east);
  }

  const out = { elements: [] };
  const seen = new Set();
  const dLat = (north - south) / grid;
  const dLon = (east - west) / grid;
  let merged = 0;
  let lastErr = null;

  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const s = south + i * dLat;
      const n = (i === grid - 1) ? north : (south + (i + 1) * dLat);
      const w = west + j * dLon;
      const e = (j === grid - 1) ? east : (west + (j + 1) * dLon);
      try {
        const data = await fetchOne(s, w, n, e);
        for (const el of (data.elements || [])) {
          const key = `${el.type || "way"}:${el.id || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.elements.push(el);
          merged++;
        }
      } catch (e2) {
        lastErr = e2;
      }
    }
  }

  if (merged > 0) return out;
  throw lastErr || new Error("Overpass fetch failed");
}

async function importOsmRailTracks(opts = {}) {
  if (!state || !state.nodes || state.nodes.size === 0) {
    showToast("OSM import: no nodes available", "warning");
    return;
  }
  state.osmRailImportError = null;
  const force = !!opts.force;
  if (state.osmRailImporting) {
    showToast("OSM import already running", "info");
    return;
  }
  if (!force && state.osmRailImported) {
    showToast("OSM rail already imported", "info");
    return;
  }

  const url = opts.url || "./data/adif_rail_spain.json";
  const fallbackUrl = opts.fallbackUrl || "/data/adif_rail_spain.json";
  const osmFallback = opts.osmFallback || "./data/osm_rail_spain.json";
  const allowOverpass = (typeof opts.allowOverpass === "boolean") ? opts.allowOverpass : true;
  const maxAttachKm = Number(opts.maxAttachKm || 80);
  const maxConnKm = Number(opts.maxConnKm || 650);
  const linksPerNode = Math.max(1, Number(opts.linksPerNode || 4));
  const lanes = Number(opts.lanes || 2);
  const didRetry = !!opts._retry;
  const includeNarrow = (typeof opts.includeNarrow === "boolean") ? opts.includeNarrow : true;
  const coordPrecision = Number.isFinite(Number(opts.coordPrecision))
    ? Number(opts.coordPrecision)
    : (String(url).includes("adif") ? 5 : 6);

  state.osmRailImporting = true;
  showToast("OSM import started (this may take a minute)", "info");
  if (typeof setLoadingStatus === "function") setLoadingStatus("Importing OSM: loading rail geometry...");

  try {
    if (force && opts.resetTracks && state.tracks) {
      try {
        layers.tracks?.clearLayers?.();
        layers.trackLabels?.clearLayers?.();
        layers.lines?.clearLayers?.();
        layers.trains?.clearLayers?.();
      } catch (_) {}
      state.tracks.clear();
      state.osmRailImported = false;
      if (state.lines && typeof state.lines.clear === "function") state.lines.clear();
      state.activeLine = null;
      if (state.service) {
        state.service.runs = [];
        if (state.service.pending && typeof state.service.pending.clear === "function") {
          state.service.pending.clear();
        } else {
          state.service.pending = new Map();
        }
      }
      if (typeof trainVis_clearAll === "function") trainVis_clearAll();
    }
    let osm;
    let fileErr = null;
    try {
      osm = await loadJSON(url);
    } catch (e) {
      osm = null;
      fileErr = e;
    }
    if (!osm_isValidOsmJson(osm) && fallbackUrl && fallbackUrl !== url) {
      try {
        osm = await loadJSON(fallbackUrl);
      } catch (e) {
        if (!fileErr) fileErr = e;
        osm = null;
      }
    }
    if (!osm_isValidOsmJson(osm) && osmFallback && osmFallback !== url) {
      try {
        osm = await loadJSON(osmFallback);
      } catch (e) {
        if (!fileErr) fileErr = e;
        osm = null;
      }
    }

    if (!osm_isValidOsmJson(osm)) {
      if (!allowOverpass) {
        const ferr = fileErr ? String(fileErr && fileErr.message ? fileErr.message : fileErr) : "file not found";
        const hint = ferr.toLowerCase().includes("json") ? "Local OSM file looks truncated or invalid JSON" : `Local OSM file failed (${ferr})`;
        state.osmRailImportError = hint;
        showToast(hint, "warning");
        return;
      }
      try {
        osm = await importOsmRailTracksFromOverpass(opts);
      } catch (e) {
        console.warn(e);
        const msg = String(e && e.message ? e.message : e);
        let tip = "OSM import failed (no data)";
        if (msg.includes("Overpass")) tip = "Overpass timeout; try again later or use local OSM file";
        if (fileErr) {
          const ferr = String(fileErr && fileErr.message ? fileErr.message : fileErr);
          tip = `Local OSM file failed (${ferr}); ${tip}`;
        }
        state.osmRailImportError = tip;
        showToast(tip, "warning");
        return;
      }
    }

    if (typeof setLoadingStatus === "function") setLoadingStatus("Importing OSM: building rail graph...");
    const graph = osm_buildRailGraph(osm, { allowNarrow: includeNarrow, coordPrecision });
    if (!graph.vertices.length) {
      showToast("OSM import: no rail geometry found", "warning");
      return;
    }

    const comp = osm_computeComponents(graph.adj);

    const nodesForTracks = Array.from(state.stations.values()).filter(s => s && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (!nodesForTracks.length) {
      showToast("OSM import: no station nodes available", "warning");
      return;
    }
    if (typeof setLoadingStatus === "function") setLoadingStatus("Importing OSM: mapping nodes to rails...");
    const mapped = [];
    for (const n of nodesForTracks) {
      if (!n || n.lat == null || n.lon == null) continue;
      const nearest = osm_findNearestVertex(n, graph, maxAttachKm);
      if (!nearest) continue;
      const compId = comp[nearest.id];
      if (compId == null || compId < 0) continue;
      mapped.push({ id: n.id, lat: Number(n.lat), lon: Number(n.lon), compId, railVid: nearest.id, railKm: nearest.km });
    }

    if (mapped.length < Math.max(2, Math.floor(nodesForTracks.length * 0.6))) {
      if (maxAttachKm < 120) {
        const retry = [];
        const retryKm = 120;
        for (const n of nodesForTracks) {
          if (!n || n.lat == null || n.lon == null) continue;
          const nearest = osm_findNearestVertex(n, graph, retryKm);
          if (!nearest) continue;
          const compId = comp[nearest.id];
          if (compId == null || compId < 0) continue;
          retry.push({ id: n.id, lat: Number(n.lat), lon: Number(n.lon), compId });
        }
        mapped.length = 0;
        mapped.push(...retry);
      }
    }
    if (mapped.length < 2) {
      const msg = `OSM import: too few nodes near rail (${mapped.length})`;
      state.osmRailImportError = msg;
      showToast(msg, "warning");
      return;
    }

    const byComp = new Map();
    for (const m of mapped) {
      if (!byComp.has(m.compId)) byComp.set(m.compId, []);
      byComp.get(m.compId).push(m);
    }

    if (typeof setLoadingStatus === "function") setLoadingStatus("Importing OSM: creating tracks...");
    let added = 0;
    for (const list of byComp.values()) {
      const edges = osm_buildClusterAdjacency(graph, list, maxConnKm);
      for (const e of edges) {
        if (typeof track_hasAnyState === "function" && track_hasAnyState(e.a, e.b)) continue;
        if (typeof addTrack === "function") {
          addTrack(e.a, e.b, lanes, { silent: true, status: "built" });
          const trackId = `TK-${edgeKey(e.a, e.b)}`;
          const tr = state.tracks.get(trackId);
          if (tr) tr.scope = "backbone";
          added += 1;
        }
      }
    }

    // Ensure each component is connected with an MST spine
    for (const list of byComp.values()) {
      const mst = osm_buildMstEdges(list);
      for (const e of mst) {
        if (typeof track_hasAnyState === "function" && track_hasAnyState(e.a, e.b)) continue;
        if (typeof addTrack === "function") {
          addTrack(e.a, e.b, lanes, { silent: true, status: "built" });
          added += 1;
        }
      }
    }

    if (added > 0) state.osmRailImported = true;
    state.osmRailImportLast = {
      nodes: nodesForTracks.length,
      mapped: mapped.length,
      vertices: graph.vertices.length,
      added,
      source: url,
      scope: "stations"
    };
    console.info("OSM import summary:", state.osmRailImportLast);
    renderLines();
    updateUI();
    if (added > 0) {
      showToast(`OSM rail imported: ${added} segments`, "success");
      if (typeof saveGame === "function") saveGame({ silent: true });
    } else {
      const msg = `OSM import added 0 segments (mapped ${mapped.length}/${nodesForTracks.length}, verts ${graph.vertices.length})`;
      state.osmRailImportError = msg;
      showToast(msg, "warning");
      if (!didRetry && mapped.length >= 2) {
        return await importOsmRailTracks({
          ...opts,
          maxAttachKm: Math.max(maxAttachKm, 150),
          maxConnKm: Math.max(maxConnKm, 600),
          linksPerNode: Math.max(linksPerNode, 6),
          includeNarrow: true,
          _retry: true
        });
      }
    }
    return state.osmRailImportLast;
  } finally {
    state.osmRailImporting = false;
  }
}

window.importOsmRailTracks = importOsmRailTracks;
