/* global getCountryConfig */

let activeInfraStatus = {
  source: "FALLBACK",
  stationsLoaded: false,
  tracksLoaded: false,
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
  if (typeof getCountryConfig !== "function") {
    updateInfraStatus({ source: "FALLBACK", stationsLoaded: false, tracksLoaded: false });
    return { source: "FALLBACK" };
  }

  const config = getCountryConfig(countryCode);
  const stationsUrl = config?.stationsUrl || null;
  const nodesUrl = config?.railNodesUrl || null;
  const linksUrl = config?.railLinksUrl || null;

  if (!stationsUrl || !nodesUrl || !linksUrl) {
    updateInfraStatus({ source: "FALLBACK", stationsLoaded: false, tracksLoaded: false });
    return { source: "FALLBACK" };
  }

  try {
    const [stations, railNodes, railLinks] = await Promise.all([
      fetchJsonResource(stationsUrl),
      fetchJsonResource(nodesUrl),
      fetchJsonResource(linksUrl)
    ]);
    updateInfraStatus({
      source: "REAL",
      stationsLoaded: Array.isArray(stations),
      tracksLoaded: Array.isArray(railLinks),
      stationsUrl,
      edgesUrl: linksUrl
    });
    return {
      source: "REAL",
      stations,
      railNodes,
      railLinks,
      config
    };
  } catch (err) {
    console.warn("Real infrastructure load failed:", err);
    updateInfraStatus({ source: "FALLBACK", stationsLoaded: false, tracksLoaded: false });
    return { source: "FALLBACK" };
  }
}

window.loadRealInfrastructure = loadRealInfrastructure;
window.getRealInfraStatus = getRealInfraStatus;
