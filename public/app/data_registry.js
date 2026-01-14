const INFRA_BASE = "/data/es";

const COUNTRY_INFRA_CONFIG = {
  ES: {
    stationsUrl: `${INFRA_BASE}/stations_es.json`,
    railNodesUrl: `${INFRA_BASE}/rail_nodes_es.json`,
    railLinksUrl: `${INFRA_BASE}/rail_links_es.json`
  }
};

function getCountryConfig(countryCode){
  const code = String(countryCode || "ES").toUpperCase();
  return COUNTRY_INFRA_CONFIG[code] || {
    stationsUrl: null,
    railNodesUrl: null,
    railLinksUrl: null
  };
}

window.getCountryConfig = getCountryConfig;
