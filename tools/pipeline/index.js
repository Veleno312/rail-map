#!/usr/bin/env node
/* global process */
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { latLonToTile, formatTileId, tileNeighbors } from "../tile_scheme.js";

const exec = promisify(execCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OFFLINE_DIR = path.join(PROJECT_ROOT, "data", "offline");
const STAGING_DIR = path.join(OFFLINE_DIR, "staging");
const TILE_DIR = path.join(OFFLINE_DIR, "tiles");
const PACK_DIR = path.join(OFFLINE_DIR, "packs");
const MANIFEST_FILE = path.join(OFFLINE_DIR, "manifest.json");

const STEP_DESCRIPTIONS = [
  {
    id: "gather-data",
    title: "Gather source files",
    description:
      "Copy official datasets (cities, production) into /data/offline/staging for downstream steps."
  },
  {
    id: "generate-tiles",
    title: "Bake tiles metadata",
    description:
      "Convert a representative lat/lon into the `tile-z-x-y` id, enumerate its neighbors, and write tiles.json."
  },
  {
    id: "build-scenario-pack",
    title: "Build scenario pack",
    description:
      "Merge dataset info, nodes, edges, and manifest metadata into a `rail-luti-scenario-pack@0.1` bundle."
  },
  {
    id: "validate-pack",
    title: "Validate pack",
    description:
      "Run `node tools/validate-pack.js` to enforce schemaVersion, nodes, edges, and manifest fields."
  },
  {
    id: "export-manifest",
    title: "Export manifest",
    description:
      "Run the manifest builder to emit `data/offline/manifest.json` describing dataset/model/schema and tiles."
  }
];

const STEP_HANDLERS = {
  "gather-data": gatherDataStep,
  "generate-tiles": generateTilesStep,
  "build-scenario-pack": buildScenarioPackStep,
  "validate-pack": validatePackStep,
  "export-manifest": exportManifestStep
};

function describeSteps() {
  return STEP_DESCRIPTIONS.map(
    (step) => `  ${step.id} - ${step.title}\n      ${step.description}`
  ).join("\n");
}

function parseArgs(argv) {
  const flags = new Set();
  const steps = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      flags.add(arg);
      continue;
    }
    steps.push(arg);
  }
  return { steps, flags };
}

function normalizeSteps(requested) {
  if (!requested.length) {
    return STEP_DESCRIPTIONS.map((step) => step.id);
  }
  return requested;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  if (!filePath || !(await fileExists(filePath))) return null;
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function runCommand(cmd) {
  console.log(`[pipeline] exec: ${cmd}`);
  const { stdout, stderr } = await exec(cmd, { cwd: PROJECT_ROOT });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

async function gatherDataStep(ctx) {
  await ensureDir(STAGING_DIR);
  const productionSource = path.join(PROJECT_ROOT, "public", "data", "production_es_macro.json");
  const production = (await readJson(productionSource)) || {};
  const datasetInfo = {
    datasetVersion: production.datasetVersion || "offline-0.0.0",
    modelVersion: production.modelVersion || "offline-0.0.0"
  };
  await writeJson(path.join(STAGING_DIR, "dataset.json"), datasetInfo);
  const citiesSource = path.join(PROJECT_ROOT, "cities_es.json");
  const citiesDest = path.join(STAGING_DIR, "cities.json");
  if (await fileExists(citiesSource)) {
    await fs.copyFile(citiesSource, citiesDest);
  }
  ctx.datasetInfo = datasetInfo;
  ctx.citiesPath = (await fileExists(citiesDest)) ? citiesDest : null;
  console.log(`[pipeline] dataset info: ${datasetInfo.datasetVersion} / ${datasetInfo.modelVersion}`);
}

async function generateTilesStep(ctx) {
  await ensureDir(TILE_DIR);
  const sampleTile = latLonToTile(40.418, -3.704, 6);
  const neighbors = tileNeighbors(sampleTile).map((n) => n.id);
  const tiles = [
    {
      id: formatTileId(sampleTile),
      zoom: sampleTile.z,
      x: sampleTile.x,
      y: sampleTile.y,
      bbox: [-10, 35, 5, 45],
      neighbors
    }
  ];
  const tilesPath = path.join(TILE_DIR, "tiles.json");
  await writeJson(tilesPath, { tiles });
  ctx.tiles = tiles;
  ctx.tilesPath = tilesPath;
  console.log(`[pipeline] wrote tiles.json with ${tiles.length} entry`);
}

async function buildScenarioPackStep(ctx) {
  await ensureDir(PACK_DIR);
  const datasetInfo = ctx.datasetInfo || (await readJson(path.join(STAGING_DIR, "dataset.json"))) || {
    datasetVersion: "offline-0.0.0",
    modelVersion: "offline-0.0.0"
  };
  const cities = (await readJson(ctx.citiesPath)) || [];
  const nodes = cities.slice(0, 5).map((city, idx) => ({
    id: `node-${idx + 1}`,
    name: city.name || city.city || `node-${idx + 1}`,
    lat: Number(city.lat ?? city.latitude ?? city.y ?? 0),
    lon: Number(city.lon ?? city.longitude ?? city.x ?? 0),
    population: Number(city.population ?? city.pop ?? 0),
    jobs: Number(city.jobs ?? 0),
    housing: Number(city.housing ?? city.homes ?? 0),
    rentIndex: Number(city.rentIndex ?? 1),
    incomeIndex: Number(city.incomeIndex ?? 1)
  }));

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `edge-${i + 1}`,
      from: nodes[i].id,
      to: nodes[i + 1].id,
      lanes: 2,
      status: "built",
      progress: 1,
      cost: { constructionCost: 0 }
    });
  }

  const tileIds = (ctx.tiles || []).map((tile) => tile.id);
  const pack = {
    schemaVersion: "rail-luti-scenario-pack@0.1",
    manifest: {
      schemaVersion: "rail-luti-scenario-pack@0.1",
      datasetVersion: datasetInfo.datasetVersion,
      modelVersion: datasetInfo.modelVersion,
      name: "offline-sample-pack",
      updatedAt: new Date().toISOString(),
      tiles: tileIds,
      license: "CC-BY-4.0"
    },
    meta: {
      title: "Offline stub scenario pack",
      datasetVersion: datasetInfo.datasetVersion,
      modelVersion: datasetInfo.modelVersion,
      createdAt: new Date().toISOString()
    },
    studyArea: {
      crs: "EPSG:4326",
      bbox: [-10, 35, 5, 45],
      country: "ES",
      name: "Spain sample"
    },
    calendar: {
      baseDate: "2025-01-01",
      daysPerMonth: 30,
      timeStep: { opsSeconds: 1, landUseDays: 30 }
    },
    parameters: {
      generalizedCost: { transferPenaltyMin: 8, waitTimeFactor: 0.5, inVehicleTimeFactor: 1 },
      accessibility: { decayBetaPerMin: 0.045 }
    },
    zones: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      centroid: [node.lon, node.lat],
      population: node.population,
      jobs: node.jobs,
      housing: node.housing,
      rentIndex: node.rentIndex,
      incomeIndex: node.incomeIndex
    })),
    networks: {
      rail: {
        lines: []
      }
    },
    nodes,
    edges
  };

  const packPath = path.join(PACK_DIR, "scenario-pack.json");
  await writeJson(packPath, pack);
  ctx.packPath = packPath;
  console.log(`[pipeline] Built scenario pack with ${nodes.length} nodes and ${edges.length} edges`);
}

async function validatePackStep(ctx) {
  if (!ctx.packPath) {
    throw new Error("Scenario pack missing - run build-scenario-pack first");
  }
  await runCommand(`node tools/validate-pack.js ${ctx.packPath}`);
}

async function exportManifestStep(ctx) {
  if (!ctx.packPath) {
    throw new Error("Scenario pack missing for manifest export");
  }
  await ensureDir(OFFLINE_DIR);
  await runCommand(`node tools/build-manifest.js ${ctx.packPath} --out ${MANIFEST_FILE}`);
  console.log(`[pipeline] Manifest written to ${MANIFEST_FILE}`);
}

async function run(stepsToRun, options) {
  const ctx = {};
  await ensureDir(OFFLINE_DIR);
  for (const id of stepsToRun) {
    const step = STEP_DESCRIPTIONS.find((entry) => entry.id === id);
    if (!step) {
      console.warn(`[pipeline] Unknown step '${id}', skipping.`);
      continue;
    }
    console.log(`\n[pipeline] Starting ${step.id} — ${step.title}`);
    const handler = STEP_HANDLERS[id];
    if (!handler) {
      console.warn(`[pipeline] Step ${id} has no handler`);
      continue;
    }
    await handler(ctx);
    console.log(`[pipeline] Completed ${step.id}`);
    if (options?.dryRun) {
      console.log("[pipeline] Dry run enabled; halting after first step.");
      break;
    }
  }
}

function printHelp() {
  console.log(`
Offline build pipeline

Usage: node tools/pipeline/index.js [step ...] [--dry-run] [--list] [--help]

Available steps:
${describeSteps()}

Flags:
  --list     Show the available steps without running anything.
  --dry-run  Run only the first requested step and stop before mutating outputs.
  --help     Show this help text.
`);
}

async function main() {
  const { steps, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("--help")) {
    printHelp();
    return;
  }
  if (flags.has("--list")) {
    console.log("Available steps:");
    console.log(describeSteps());
    return;
  }
  const toRun = normalizeSteps(steps);
  await run(toRun, { dryRun: flags.has("--dry-run") });
  console.log("\n[pipeline] Pipeline run complete.");
}

main().catch((err) => {
  console.error("[pipeline] Fatal error:", err);
  process.exit(1);
});
