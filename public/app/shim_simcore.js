// Expose pure sim-core helpers to classic scripts.
import { simCoreStep } from "../../src/sim-core/step.js";
import { makeRunMeta, datasetVersion, modelVersion, schemaVersion } from "../../src/sim-core/pure/versions.js";
import { migrateState } from "../../src/sim-core/pure/migrate.js";
import { makeReport, makeReportHeader, toCsv } from "../../src/sim-core/report.js";

window.simCoreStepPure = function simCoreStepPure(prevState, input) {
  const models = {
    computeFlows: (window.__bulkSim && window.__bulkSim.running) ? undefined : window.computeFlows,
  };
  return simCoreStep(prevState, { ...input, models });
};

window.simCoreMakeRunMeta = makeRunMeta;
window.simCoreVersions = { datasetVersion, modelVersion, schemaVersion };
window.simCoreMigrate = migrateState;
window.simCoreMakeReport = makeReport;
window.simCoreMakeReportHeader = makeReportHeader;
window.simCoreToCsv = toCsv;
