export const datasetVersion = "0.0.1"; // your data pack version
export const modelVersion   = "0.0.1"; // sim logic version
export const schemaVersion  = "0.0.1"; // save/state schema version

export function makeRunMeta({ seed, scenarioId }) {
  const runId = `${datasetVersion}|${modelVersion}|${schemaVersion}|${seed}|${scenarioId}`;
  return {
    datasetVersion,
    modelVersion,
    schemaVersion,
    seed,
    scenarioId,
    runId,
  };
}
