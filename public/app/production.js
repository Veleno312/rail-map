/* eslint-disable no-undef */
// ======================
// Production model (Spain macro -> per-node)
// ======================
// Loads a macro dataset (production + consumption by item) and allocates to nodes by population.

const PROD_PIXEL_MAPS = {
  food: [
    "..a.a...",
    "..a.a...",
    "..aaa...",
    "...a....",
    "..aaa...",
    "...a....",
    "..a.a...",
    "........"
  ],
  materials: [
    "aaaaaaaa",
    "ababaaba",
    "aaaaaaaa",
    "baababaa",
    "aaaaaaaa",
    "ababaaba",
    "aaaaaaaa",
    "........"
  ],
  manufactured: [
    "..bbb...",
    ".baab..b",
    "baaaab..",
    "baaabaa.",
    ".baaaab.",
    "..baab..",
    "...bbb..",
    "........"
  ],
  energy: [
    "...aa...",
    "..aaa...",
    ".aaaa...",
    "...aa...",
    "..aaa...",
    ".aaaa...",
    "...aa...",
    "........"
  ],
  construction: [
    "bbba....",
    "baba....",
    "bbba....",
    "..a.....",
    "..a.....",
    ".aaa....",
    ".a.a....",
    "........"
  ],
  services: [
    "..aaaa..",
    ".a....a.",
    ".aaaaaa.",
    ".a....a.",
    ".aaaaaa.",
    ".a....a.",
    ".aaaaaa.",
    "........"
  ]
};

const PROD_SUBITEM_MAPS = {
  grain: [
    "..a.....",
    "..aa....",
    "..aa....",
    "...a....",
    "..aa....",
    ".a..a...",
    "..aa....",
    "........"
  ],
  vegetables: [
    "...a....",
    "..aaa...",
    ".aaaaa..",
    "..aaa...",
    "...a....",
    "..a.a...",
    ".a...a..",
    "........"
  ],
  fruit: [
    "..aa....",
    ".aaaa...",
    "aaaaaa..",
    "aaaaaa..",
    ".aaaa...",
    "..aa....",
    "...a....",
    "........"
  ],
  meat: [
    "aa..aa..",
    "aaaaaa..",
    "aaaaaa..",
    "aaaaaa..",
    "aaaaaa..",
    ".aaaa...",
    "..aa....",
    "........"
  ],
  dairy: [
    "..aaa...",
    ".a...a..",
    "a.....a.",
    "a.....a.",
    "a.....a.",
    ".a...a..",
    "..aaa...",
    "........"
  ],
  metals: [
    "aaaaaaaa",
    "a......a",
    "a.aaaa.a",
    "a.aaaa.a",
    "a.aaaa.a",
    "a......a",
    "aaaaaaaa",
    "........"
  ],
  timber: [
    "..aa....",
    "..aa....",
    ".aaaa...",
    "aaaaaa..",
    "..aa....",
    "..aa....",
    "..aa....",
    "........"
  ],
  chemicals: [
    "...a....",
    "..a.a...",
    ".a...a..",
    ".a...a..",
    ".aaaaa..",
    "..aaa...",
    "..aaa...",
    "........"
  ],
  glass: [
    "..aaaa..",
    ".a....a.",
    ".a....a.",
    ".a....a.",
    ".a....a.",
    ".a....a.",
    "..aaaa..",
    "........"
  ],
  paper: [
    ".aaaa...",
    "a....a..",
    "a....a..",
    "a....a..",
    "a....a..",
    "a....a..",
    ".aaaa...",
    "........"
  ],
  machinery: [
    "..aaaa..",
    ".a..a.a.",
    "a..aaa.a",
    "a.aaaa.a",
    "a..aaa.a",
    ".a..a.a.",
    "..aaaa..",
    "........"
  ],
  vehicles: [
    "........",
    "..aaaa..",
    "aaaaaaaa",
    "aa....aa",
    "aa....aa",
    "a......a",
    "..a..a..",
    "........"
  ],
  textiles: [
    "a.a.a.a.",
    ".a.a.a.a",
    "a.a.a.a.",
    ".a.a.a.a",
    "a.a.a.a.",
    ".a.a.a.a",
    "a.a.a.a.",
    "........"
  ],
  electronics: [
    "..aaaa..",
    ".a....a.",
    ".a.aa.a.",
    ".a.aa.a.",
    ".a.aa.a.",
    ".a....a.",
    "..aaaa..",
    "........"
  ],
  consumer: [
    "..aaaa..",
    ".a....a.",
    ".a....a.",
    ".a....a.",
    ".a....a.",
    ".a....a.",
    "..aaaa..",
    "........"
  ],
  electricity: [
    "...aa...",
    "..aaa...",
    ".aaaa...",
    "...aa...",
    "..aaa...",
    ".aaaa...",
    "...aa...",
    "........"
  ],
  fuels: [
    "..aaa...",
    ".aaaaa..",
    "aaaaaaa.",
    "aaaaaaa.",
    ".aaaaa..",
    "..aaa...",
    "...a....",
    "........"
  ],
  gas: [
    "..aaa...",
    ".a...a..",
    "a.....a.",
    "a.....a.",
    "a.....a.",
    ".a...a..",
    "..aaa...",
    "........"
  ],
  renewables: [
    "...a....",
    ".a.a.a..",
    "..aaa...",
    "a.aaa.a.",
    "..aaa...",
    ".a.a.a..",
    "...a....",
    "........"
  ],
  cement: [
    "aaaaaaaa",
    "a......a",
    "a......a",
    "a......a",
    "a......a",
    "a......a",
    "aaaaaaaa",
    "........"
  ],
  steel: [
    "a......a",
    "aa....aa",
    ".aa..aa.",
    "..aaaa..",
    "..aaaa..",
    ".aa..aa.",
    "aa....aa",
    "........"
  ],
  aggregates: [
    "..aa....",
    ".aaaa...",
    "aaaaaa..",
    "aaaaaa..",
    "aaaaaa..",
    ".aaaa...",
    "..aa....",
    "........"
  ],
  equipment: [
    "..aa....",
    "..aa....",
    ".aaaa...",
    "aaaaaa..",
    "..aa....",
    "..aa....",
    ".a..a...",
    "........"
  ],
  logistics: [
    "........",
    "..aaaa..",
    "aaaaaaaa",
    "aa....aa",
    "aa....aa",
    "a......a",
    "..a..a..",
    "........"
  ],
  finance: [
    "..aaaa..",
    ".a....a.",
    "a..aa..a",
    "a.aaaa.a",
    "a..aa..a",
    ".a....a.",
    "..aaaa..",
    "........"
  ],
  public: [
    "..aa....",
    ".aaaa...",
    "aaaaaa..",
    "aa..aa..",
    "aa..aa..",
    "aa..aa..",
    "aaaaaaaa",
    "........"
  ],
  tourism: [
    "...a....",
    "..aaa...",
    ".aaaaa..",
    "..aaa...",
    "...a....",
    "...a....",
    "..aaa...",
    "........"
  ]
};

function production_makePixelIcon(pixels, palette, scale = 2){
  if (!Array.isArray(pixels) || pixels.length === 0) return "";
  const h = pixels.length;
  const w = pixels[0].length;
  let rects = "";
  for (let y = 0; y < h; y++){
    const row = pixels[y];
    for (let x = 0; x < w; x++){
      const c = row[x];
      if (!c || c === ".") continue;
      const fill = palette[c] || c;
      rects += `<rect x="${x * scale}" y="${y * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w * scale} ${h * scale}">${rects}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const PROD_ITEMS = [
  {
    id: "food",
    name: "Food",
    color: "#16a34a",
    details: ["Grain", "Vegetables", "Fruit", "Meat", "Dairy"],
    icon: "F",
    iconSvg: production_makePixelIcon(PROD_PIXEL_MAPS.food, { a: "#16a34a", b: "#0f172a" }, 2),
    subitems: [
      { id: "grain", name: "Grain", color: "#4ade80", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.grain, { a: "#4ade80" }, 2) },
      { id: "vegetables", name: "Vegetables", color: "#22c55e", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.vegetables, { a: "#22c55e" }, 2) },
      { id: "fruit", name: "Fruit", color: "#f97316", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.fruit, { a: "#f97316" }, 2) },
      { id: "meat", name: "Meat", color: "#ef4444", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.meat, { a: "#ef4444" }, 2) },
      { id: "dairy", name: "Dairy", color: "#e2e8f0", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.dairy, { a: "#e2e8f0" }, 2) }
    ]
  },
  {
    id: "materials",
    name: "Materials",
    color: "#f59e0b",
    details: ["Metals", "Timber", "Chemicals", "Glass", "Paper"],
    icon: "M",
    iconSvg: production_makePixelIcon(PROD_PIXEL_MAPS.materials, { a: "#f59e0b", b: "#0f172a" }, 2),
    subitems: [
      { id: "metals", name: "Metals", color: "#94a3b8", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.metals, { a: "#94a3b8" }, 2) },
      { id: "timber", name: "Timber", color: "#16a34a", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.timber, { a: "#16a34a" }, 2) },
      { id: "chemicals", name: "Chemicals", color: "#8b5cf6", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.chemicals, { a: "#8b5cf6" }, 2) },
      { id: "glass", name: "Glass", color: "#38bdf8", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.glass, { a: "#38bdf8" }, 2) },
      { id: "paper", name: "Paper", color: "#e2e8f0", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.paper, { a: "#e2e8f0" }, 2) }
    ]
  },
  {
    id: "manufactured",
    name: "Manufactured",
    color: "#2563eb",
    details: ["Machinery", "Vehicles", "Textiles", "Electronics", "Consumer goods"],
    icon: "I",
    iconSvg: production_makePixelIcon(PROD_PIXEL_MAPS.manufactured, { a: "#2563eb", b: "#0f172a" }, 2),
    subitems: [
      { id: "machinery", name: "Machinery", color: "#60a5fa", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.machinery, { a: "#60a5fa" }, 2) },
      { id: "vehicles", name: "Vehicles", color: "#22d3ee", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.vehicles, { a: "#22d3ee" }, 2) },
      { id: "textiles", name: "Textiles", color: "#f472b6", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.textiles, { a: "#f472b6" }, 2) },
      { id: "electronics", name: "Electronics", color: "#a78bfa", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.electronics, { a: "#a78bfa" }, 2) },
      { id: "consumer", name: "Consumer goods", color: "#f59e0b", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.consumer, { a: "#f59e0b" }, 2) }
    ]
  },
  {
    id: "energy",
    name: "Energy",
    color: "#ef4444",
    details: ["Electricity", "Refined fuels", "Gas supply", "Renewables"],
    icon: "E",
    iconSvg: production_makePixelIcon(PROD_PIXEL_MAPS.energy, { a: "#ef4444", b: "#0f172a" }, 2),
    subitems: [
      { id: "electricity", name: "Electricity", color: "#facc15", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.electricity, { a: "#facc15" }, 2) },
      { id: "fuels", name: "Refined fuels", color: "#f97316", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.fuels, { a: "#f97316" }, 2) },
      { id: "gas", name: "Gas supply", color: "#38bdf8", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.gas, { a: "#38bdf8" }, 2) },
      { id: "renewables", name: "Renewables", color: "#22c55e", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.renewables, { a: "#22c55e" }, 2) }
    ]
  },
  {
    id: "construction",
    name: "Construction",
    color: "#8b5cf6",
    details: ["Cement", "Steel", "Aggregates", "Equipment"],
    icon: "C",
    iconSvg: production_makePixelIcon(PROD_PIXEL_MAPS.construction, { a: "#8b5cf6", b: "#0f172a" }, 2),
    subitems: [
      { id: "cement", name: "Cement", color: "#cbd5f5", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.cement, { a: "#cbd5f5" }, 2) },
      { id: "steel", name: "Steel", color: "#64748b", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.steel, { a: "#64748b" }, 2) },
      { id: "aggregates", name: "Aggregates", color: "#a16207", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.aggregates, { a: "#a16207" }, 2) },
      { id: "equipment", name: "Equipment", color: "#f97316", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.equipment, { a: "#f97316" }, 2) }
    ]
  },
  {
    id: "services",
    name: "Services",
    color: "#0f172a",
    details: ["Logistics", "Finance", "Public sector", "Tourism"],
    icon: "S",
    iconSvg: production_makePixelIcon(PROD_PIXEL_MAPS.services, { a: "#0f172a", b: "#94a3b8" }, 2),
    subitems: [
      { id: "logistics", name: "Logistics", color: "#22d3ee", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.logistics, { a: "#22d3ee" }, 2) },
      { id: "finance", name: "Finance", color: "#facc15", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.finance, { a: "#facc15" }, 2) },
      { id: "public", name: "Public sector", color: "#94a3b8", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.public, { a: "#94a3b8" }, 2) },
      { id: "tourism", name: "Tourism", color: "#f472b6", iconSvg: production_makePixelIcon(PROD_SUBITEM_MAPS.tourism, { a: "#f472b6" }, 2) }
    ]
  }
];

function production_primaryItem(nodeId){
  const n = production_getNode(nodeId);
  if (!n || !n.prod) return null;
  let best = null;
  let bestVal = -1;
  for (const item of PROD_ITEMS){
    const detail = n.prodDetail?.[item.id];
    if (detail && Array.isArray(item.subitems)) {
      for (const sub of item.subitems){
        const val = Number(detail[sub.id] || 0);
        if (val > bestVal) {
          bestVal = val;
          best = { ...sub, parentId: item.id, parentName: item.name };
        }
      }
      continue;
    }
    const val = Number(n.prod?.[item.id] || 0);
    if (val > bestVal) {
      bestVal = val;
      best = item;
    }
  }
  return best;
}

function production_topSubitems(nodeId, limit = 6){
  const n = production_getNode(nodeId);
  if (!n) return [];
  const list = [];
  for (const item of PROD_ITEMS){
    const detail = n.prodDetail?.[item.id];
    if (!detail || !Array.isArray(item.subitems)) continue;
    for (const sub of item.subitems){
      const val = Number(detail[sub.id] || 0);
      if (val > 0) list.push({ ...sub, parentId: item.id, parentName: item.name, val });
    }
  }
  list.sort((a,b)=> (b.val || 0) - (a.val || 0));
  return list.slice(0, limit);
}

function production_itemById(id){
  return PROD_ITEMS.find(x => x.id === id);
}

function production_allocByPopulation(total, pop, popTotal){
  if (!Number.isFinite(total) || total <= 0 || popTotal <= 0) return 0;
  return total * (pop / popTotal);
}

function production_modalSplit(nodeId){
  // Simple rail access proxy: has tracks + line service.
  const hasTracks = getNodeTrackStats(nodeId).edges > 0;
  const hasLine = getNodeLineCount(nodeId) > 0;
  const railIndex = (hasTracks ? 0.6 : 0.0) + (hasLine ? 0.4 : 0.0);
  const railShare = clamp(0.15 + 0.65 * railIndex, 0.05, 0.8);
  return { railShare, otherShare: 1 - railShare };
}

async function production_init(opts = {}){
  if (!state.production) state.production = {};
  const url = String(opts.url || state.production.url || "./data/production_es_macro.json");
  const force = !!opts.force;
  if (state.production.loaded && !force && state.production.url === url) return;
  try {
    const data = opts.data || await loadJSON(url);
    state.production.macro = data;
    state.production.loaded = true;
    state.production.url = url;
    production_buildNodeStats();
  } catch (e) {
    console.warn("Production data load failed:", e);
    state.production.loaded = false;
    state.production.url = url;
  }
}

function production_buildNodeStats(){
  if (!state.production?.macro) return;
  const macro = state.production.macro;
  const byNode = new Map();

  const nodes = Array.from(state.nodes.values());
  const popTotal = nodes.reduce((s, n) => s + Math.max(0, Number(n.population || 0)), 0);
  const totalsProd = macro.production_eur || {};
  const totalsNeed = macro.consumption_eur || {};

  for (const n of nodes) {
    const pop = Math.max(0, Number(n.population || 0));
    const prod = {};
    const need = {};
    const prodDetail = {};
    const needDetail = {};
    let prodSum = 0;
    let needSum = 0;

    for (const item of PROD_ITEMS) {
      const p = production_allocByPopulation(Number(totalsProd[item.id] || 0), pop, popTotal);
      const d = production_allocByPopulation(Number(totalsNeed[item.id] || 0), pop, popTotal);
      prod[item.id] = p;
      need[item.id] = d;
      prodSum += p;
      needSum += d;

      if (Array.isArray(item.subitems) && item.subitems.length) {
        const weights = item.subitems.map(sub => 0.25 + hash01(`${n.id}|${item.id}|${sub.id}`));
        const wsum = weights.reduce((s, x) => s + x, 0) || 1;
        const prodSub = {};
        const needSub = {};
        item.subitems.forEach((sub, idx) => {
          const share = weights[idx] / wsum;
          prodSub[sub.id] = p * share;
          needSub[sub.id] = d * share;
        });
        prodDetail[item.id] = prodSub;
        needDetail[item.id] = needSub;
      }
    }

    const split = production_modalSplit(n.id);
    byNode.set(n.id, {
      nodeId: n.id,
      pop,
      prod,
      need,
      prodDetail,
      needDetail,
      prodSum,
      needSum,
      railShare: split.railShare,
      otherShare: split.otherShare,
      industries: Math.max(1, Math.round(pop / 1800))
    });

    // Keep node-level totals in sync for dynamics/economy.
    n.productionBase = prodSum;
    n.needsBase = needSum;
    n.production = prodSum;
    n.needs = needSum;
  }

  state.production.byNode = byNode;
}

function production_getNode(nodeId){
  return state.production?.byNode?.get?.(nodeId) || null;
}

Object.assign(window, {
  production_init,
  production_buildNodeStats,
  production_getNode,
  production_itemById,
  production_modalSplit,
  production_primaryItem,
  production_topSubitems,
  PROD_ITEMS
});
