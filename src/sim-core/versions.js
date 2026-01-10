window.datasetVersion = "0.0.1"; // your data pack version
window.modelVersion   = "0.0.1"; // sim logic version
window.schemaVersion  = "0.0.1"; // save/state schema version

function makeRunMeta({ seed, scenarioId }) {
  const runId = `${window.datasetVersion}|${window.modelVersion}|${window.schemaVersion}|${seed}|${scenarioId}`;
  return {
    datasetVersion: window.datasetVersion,
    modelVersion: window.modelVersion,
    schemaVersion: window.schemaVersion,
    seed,
    scenarioId,
    runId,
  };
}

window.makeRunMeta = makeRunMeta;
