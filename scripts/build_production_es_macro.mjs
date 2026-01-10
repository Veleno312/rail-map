import fs from "node:fs/promises";
import path from "node:path";

const ENDPOINT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

async function fetchDataset(name, params) {
  const qs = new URLSearchParams(params);
  const url = `${ENDPOINT}/${name}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed ${name} (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

function getLatestTime(dim) {
  const idx = dim?.time?.category?.index || {};
  const times = Object.keys(idx).sort();
  return times[times.length - 1];
}

function findLatestTimeWithValue(json, baseFilters) {
  const idx = json.dimension?.time?.category?.index || {};
  const times = Object.keys(idx).sort();
  for (let i = times.length - 1; i >= 0; i--) {
    const time = times[i];
    const val = getValue(json, { ...baseFilters, time });
    if (val !== null && val !== undefined) return time;
  }
  return times[times.length - 1];
}

function getValue(json, filters) {
  const dimIds = json.id;
  const dimSizes = json.size;
  const dims = json.dimension;
  let stride = 1;
  let index = 0;
  for (let i = dimIds.length - 1; i >= 0; i--) {
    const id = dimIds[i];
    const catIndex = dims[id]?.category?.index?.[filters[id]];
    if (catIndex === undefined) return null;
    index += catIndex * stride;
    stride *= dimSizes[i];
  }
  const key = String(index);
  return json.value?.[key] ?? null;
}

function sumValues(items) {
  return items.reduce((s, x) => s + (Number(x) || 0), 0);
}

const prod = await fetchDataset("nama_10_a10", {
  freq: "A",
  na_item: "B1G",
  unit: "CP_MEUR",
  geo: "ES"
});

const prodTimes = Object.keys(prod.dimension?.time?.category?.index || {}).sort();
const prodLatest = prodTimes[prodTimes.length - 1];
if (!prodLatest) throw new Error("No time dimension found for production dataset.");

const prodValue = (nace, time) =>
  Number(getValue(prod, {
    freq: "A",
    geo: "ES",
    unit: "CP_MEUR",
    na_item: "B1G",
    nace_r2: nace,
    time
  }) || 0);

const coicopCodes = [
  "CP01","CP02","CP03","CP04","CP05","CP06",
  "CP07","CP08","CP09","CP10","CP11","CP12"
];

const consTimeLatest = await (async () => {
  const sample = await fetchDataset("nama_10_co3_p3", {
    freq: "A",
    unit: "CP_MEUR",
    geo: "ES",
    coicop: "CP01"
  });
  return findLatestTimeWithValue(sample, {
    freq: "A",
    geo: "ES",
    unit: "CP_MEUR",
    coicop: "CP01"
  });
})();

const targetYear = prodTimes.filter(t => t <= consTimeLatest).pop() || prodLatest;

const productionByItem = {
  food: prodValue("A", targetYear),
  materials: prodValue("B-E", targetYear),
  manufactured: prodValue("C", targetYear),
  energy: 0,
  construction: prodValue("F", targetYear),
  services: sumValues([
    prodValue("G-I", targetYear),
    prodValue("J", targetYear),
    prodValue("K", targetYear),
    prodValue("L", targetYear),
    prodValue("M_N", targetYear),
    prodValue("O-Q", targetYear),
    prodValue("R-U", targetYear)
  ])
};

const consValuesByCode = {};
for (const code of coicopCodes) {
  const json = await fetchDataset("nama_10_co3_p3", {
    freq: "A",
    unit: "CP_MEUR",
    geo: "ES",
    coicop: code
  });
  let val = getValue(json, {
    freq: "A",
    geo: "ES",
    unit: "CP_MEUR",
    coicop: code,
    time: targetYear
  });
  if (val === null || val === undefined) {
    const fallbackTime = findLatestTimeWithValue(json, {
      freq: "A",
      geo: "ES",
      unit: "CP_MEUR",
      coicop: code
    });
    val = getValue(json, {
      freq: "A",
      geo: "ES",
      unit: "CP_MEUR",
      coicop: code,
      time: fallbackTime
    });
  }
  consValuesByCode[code] = Number(val || 0);
}

const totalConsumption = sumValues(coicopCodes.map(code => consValuesByCode[code]));

const totalProduction = sumValues(Object.values(productionByItem));
const consumptionByItem = {};
for (const [key, val] of Object.entries(productionByItem)) {
  const share = totalProduction > 0 ? (Number(val) / totalProduction) : 0;
  consumptionByItem[key] = totalConsumption * share;
}

const output = {
  schemaVersion: "1.0",
  datasetVersion: `Eurostat ${new Date().toISOString().slice(0, 10)}`,
  year: targetYear,
  source: "Eurostat nama_10_a10 (B1G, CP_MEUR, ES) + nama_10_co3_p3 (CP_MEUR, ES)",
  units: "per year",
  production_eur: productionByItem,
  consumption_eur: consumptionByItem,
  notes: {
    production_mapping: {
      food: "nace_r2 A",
      materials: "nace_r2 B-E (energy included in this aggregate)",
      manufactured: "nace_r2 C",
      energy: "not separated in A10; included in materials",
      construction: "nace_r2 F",
      services: "nace_r2 G-I, J, K, L, M_N, O-Q, R-U"
    },
    needs_allocation: "Household consumption total (P3_S14) allocated proportional to production shares."
  }
};

const outPath = path.join("public", "data", "production_es_macro.json");
await fs.writeFile(outPath, JSON.stringify(output, null, 2), "utf8");
console.log(`Wrote ${outPath}`);
