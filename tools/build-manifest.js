#!/usr/bin/env node
/* global process */
import { promises as fs } from "fs";
import path from "path";

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "data", "offline");
const DEFAULT_OUTPUT_FILE = path.join(DEFAULT_OUTPUT_DIR, "manifest.json");

function usage() {
  console.log(`
Scenario manifest builder

Usage:
  node tools/build-manifest.js path/to/scenario-pack.json [--out path/to/manifest.json]
  node tools/build-manifest.js --help
`);
}

async function loadJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(resolved, "utf-8");
  return JSON.parse(raw);
}

function normalizeVersion(value, fallback) {
  if (!value) return fallback;
  return String(value).trim();
}

async function ensureOutputDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.warn("[manifest] Failed to create directory", dir, err.message);
  }
}

async function writeManifest(filePath, manifest) {
  await ensureOutputDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

function deriveTiles(pack) {
  if (Array.isArray(pack.manifest?.tiles) && pack.manifest.tiles.length) {
    return pack.manifest.tiles;
  }
  return [];
}

function deriveMetadata(pack) {
  const manifest = pack.manifest || {};
  const meta = pack.meta || {};
  return {
    datasetVersion: normalizeVersion(manifest.datasetVersion || meta.datasetVersion, "0.0.0-offline"),
    modelVersion: normalizeVersion(manifest.modelVersion || meta.modelVersion, "0.0.0"),
    schemaVersion: normalizeVersion(manifest.schemaVersion || meta.schemaVersion, "rail-luti-scenario-pack@0.1"),
    sourcePack: manifest.name || meta.title || "scenario-pack",
    generatedAt: new Date().toISOString(),
    tiles: deriveTiles(pack),
    nodes: Array.isArray(pack.nodes) ? pack.nodes.length : 0,
    tracks: Array.isArray(pack.edges) ? pack.edges.length : 0,
    license: manifest.license || meta.license || "unknown",
  };
}

function parseArgs(args) {
  const options = { pack: null, out: null, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--out") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        console.error("[manifest] --out requires a path");
        process.exit(1);
      }
      options.out = next;
      i += 1;
      continue;
    }
    if (!options.pack) {
      options.pack = arg;
      continue;
    }
    console.warn("[manifest] ignoring extra argument:", arg);
  }
  return options;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    usage();
    process.exit(args.includes("--help") ? 0 : 1);
  }
  const parsed = parseArgs(args);
  const packPath = parsed.pack;
  const outPath = parsed.out || DEFAULT_OUTPUT_FILE;

  if (!packPath) {
    console.error("[manifest] Missing scenario pack path.");
    usage();
    process.exit(1);
  }

  try {
    const pack = await loadJson(packPath);
    const manifest = deriveMetadata(pack);
    await writeManifest(outPath, manifest);
    console.log(`[manifest] Wrote ${outPath}`);
  } catch (err) {
    console.error("[manifest] Failed:", err.message);
    process.exit(2);
  }
}

main();
