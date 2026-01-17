/* global getCountryConfig */

let activeInfraStatus = {
  source: "FALLBACK",
  stationsLoaded: false,
  tracksLoaded: false,
  stationCount: 0,
  trackCount: 0,
  stationsUrl: null,
  edgesUrl: null
};

function updateInfraStatus(status = {}) {
  activeInfraStatus = { ...activeInfraStatus, ...status };
  if (window.state && typeof window.state.realInfra === "object") {
    window.state.realInfra = { ...window.state.realInfra, ...activeInfraStatus };
  }
}

function getRealInfraStatus(){
  return activeInfraStatus;
}

async function fetchJsonResource(url){
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
  return await response.json();
}

async function loadRealInfrastructure(countryCode){
  const fallbackPayload = { source: "FALLBACK", stationCount: 0, trackCount: 0, nodeCount: 0 };
  if (typeof getCountryConfig !== "function") {
    updateInfraStatus({ source: "FALLBACK", stationsLoaded: false, tracksLoaded: false, stationCount: 0, trackCount: 0 });
    return fallbackPayload;
  }

  const config = getCountryConfig(countryCode);
  const stationsUrl = config?.stationsUrl || null;
  const nodesUrl = config?.railNodesUrl || null;
  const linksUrl = config?.railLinksUrl || null;

  if (!stationsUrl || !nodesUrl || !linksUrl) {
    updateInfraStatus({ source: "FALLBACK", stationsLoaded: false, tracksLoaded: false, stationCount: 0, trackCount: 0 });
    return fallbackPayload;
  }

  try {
    const [stations, railNodes, railLinks] = await Promise.all([
      fetchJsonResource(stationsUrl),
      fetchJsonResource(nodesUrl),
      fetchJsonResource(linksUrl)
    ]);
    const stationCount = Array.isArray(stations) ? stations.length : 0;
    const linkCount = Array.isArray(railLinks) ? railLinks.length : 0;
    const nodeCount = Array.isArray(railNodes) ? railNodes.length : 0;
    updateInfraStatus({
      source: "REAL",
      stationsLoaded: stationCount > 0,
      tracksLoaded: linkCount > 0,
      stationCount,
      trackCount: linkCount,
      stationsUrl,
      edgesUrl: linksUrl
    });
    return {
      source: "REAL",
      stations,
      railNodes,
      railLinks,
      config,
      stationCount,
      trackCount: linkCount,
      nodeCount
    };
  } catch (err) {
    console.warn("Real infrastructure load failed:", err);
    updateInfraStatus({ source: "FALLBACK", stationsLoaded: false, tracksLoaded: false, stationCount: 0, trackCount: 0 });
    return fallbackPayload;
  }
}

window.loadRealInfrastructure = loadRealInfrastructure;
window.getRealInfraStatus = getRealInfraStatus;
