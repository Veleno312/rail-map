import fs from "fs";
import path from "path";
import assert from "node:assert";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runGoldenScenario } from "../src/sim-core/tests/golden/run_golden.js";
import { computeFlows } from "../dynamics.js";
import { computeEconomy } from "../economy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.resolve(__dirname, "../src/sim-core/tests/golden");
const update = process.argv.includes("--update");

function listScenarios() {
  const files = fs.readdirSync(SCENARIO_DIR);
  return files
    .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function runScenario(fileName) {
  const scenarioFile = path.join(SCENARIO_DIR, fileName);
  const scenario = readJson(scenarioFile);
  const expectedFile = scenarioFile.replace(/\.json$/, ".expected.json");
  const report = runGoldenScenario(scenario, {
    computeFlows,
    computeEconomy,
  });

  if (update) {
    writeJson(expectedFile, report);
    console.log(`Updated expected report for ${fileName}`);
    return;
  }

  if (!fs.existsSync(expectedFile)) {
    throw new Error(`Missing expected report: ${path.basename(expectedFile)}`);
  }

  const expected = readJson(expectedFile);
  try {
    assert.deepStrictEqual(report, expected);
  } catch (err) {
    console.error(`Golden mismatch for ${fileName}`);
    console.error(err);
    console.error("Actual report:");
    console.error(JSON.stringify(report, null, 2));
    throw err;
  }
}

(async function main() {
  const scenarios = listScenarios();
  if (!scenarios.length) {
    throw new Error("No golden scenarios found");
  }

  for (const scenario of scenarios) {
    runScenario(scenario);
  }

  if (!update) {
    console.log(`Golden tests passed (${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"})`);
  }
})();
