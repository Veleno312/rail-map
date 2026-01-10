#!/usr/bin/env node
/* global process */
import { promises as fs } from "fs";
import path from "path";

const SCHEMA_PREFIX = "rail-luti-scenario-pack@";

function showHelp() {
  console.log(`Scenario pack validator

Usage:
  node tools/validate-pack.js /path/to/pack.json

Checks:
  • schemaVersion starts with ${SCHEMA_PREFIX}
  • nodes exist, have unique IDs, and valid coordinates
  • edges provide from/to references
  • manifest includes dataset/model/schema versions
`);
}

function normalizeId(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function noteError(errors, message) {
  errors.push(`ERROR: ${message}`);
}

async function loadPack(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const content = await fs.readFile(resolved, "utf-8");
  return JSON.parse(content);
}

function validateManifest(manifest, errors) {
  if (!manifest || typeof manifest !== "object") {
    noteError(errors, "manifest must be an object with dataset/model/schema info");
    return;
  }
  const requiredFields = ["datasetVersion", "modelVersion", "schemaVersion"];
  for (const key of requiredFields) {
    if (!manifest[key]) {
      noteError(errors, `manifest.${key} is missing`);
    }
  }
}

function validateNodes(nodes, errors) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    noteError(errors, "nodes array must exist and contain at least one entry");
    return;
  }
  const seen = new Set();
  nodes.forEach((node, idx) => {
    const id = normalizeId(node.id ?? node.nodeId ?? node.zoneId ?? `node-${idx}`);
    if (!id) {
      noteError(errors, `node[${idx}] has an empty id`);
    }
    if (seen.has(id)) {
      noteError(errors, `duplicate node id '${id}'`);
    } else {
      seen.add(id);
    }
    const lat = Number(node.lat ?? node.latitude ?? node.y);
    const lon = Number(node.lon ?? node.longitude ?? node.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      noteError(errors, `node '${id}' has invalid coordinates (lat=${lat}, lon=${lon})`);
    }
  });
}

function validateEdges(edges, nodeIds, errors) {
  if (!Array.isArray(edges) || edges.length === 0) {
    noteError(errors, "edges array must exist and contain at least one entry");
    return;
  }
  edges.forEach((edge, idx) => {
    const from = normalizeId(edge.from ?? edge.fromId ?? edge.a);
    const to = normalizeId(edge.to ?? edge.toId ?? edge.b);
    if (!from) {
      noteError(errors, `edge[${idx}] is missing a 'from' reference`);
    }
    if (!to) {
      noteError(errors, `edge[${idx}] is missing a 'to' reference`);
    }
    if (from && to && from === to) {
      noteError(errors, `edge[${idx}] has identical from/to '${from}'`);
    }
    if (from && nodeIds && !nodeIds.has(from)) {
      noteError(errors, `edge[${idx}] references unknown node '${from}'`);
    }
    if (to && nodeIds && !nodeIds.has(to)) {
      noteError(errors, `edge[${idx}] references unknown node '${to}'`);
    }
    const lanes = Number(edge.lanes ?? edge.numLanes ?? 1);
    if (!Number.isFinite(lanes) || lanes < 1) {
      noteError(errors, `edge[${idx}] has invalid lanes value (${edge.lanes})`);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    showHelp();
    process.exit(0);
  }
  const filePath = args[0];
  try {
    const pack = await loadPack(filePath);
    const errors = [];
    if (!pack.schemaVersion) {
      noteError(errors, "schemaVersion is missing");
    } else if (!String(pack.schemaVersion).startsWith(SCHEMA_PREFIX)) {
      noteError(errors, `schemaVersion must start with ${SCHEMA_PREFIX}`);
    }
    validateManifest(pack.manifest, errors);
    const nodes = Array.isArray(pack.nodes) ? pack.nodes : [];
    validateNodes(nodes, errors);
    const nodeIds = new Set(nodes.map((n, idx) => normalizeId(n.id ?? n.nodeId ?? n.zoneId ?? `node-${idx}`)));
    validateEdges(pack.edges, nodeIds, errors);

    if (errors.length) {
      console.error(`\nScenario pack validation failed (${errors.length} issues):`);
      errors.forEach((e) => console.error(`  ${e}`));
      process.exit(1);
    }

    console.log("Scenario pack looks healthy ✓");
  } catch (err) {
    console.error("Failed to validate scenario pack:", err.message);
    process.exit(2);
  }
}

main();
