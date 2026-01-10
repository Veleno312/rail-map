// Version contract for deterministic runs.
export const datasetVersion = "0.0.1";
export const modelVersion = "0.0.1";
export const schemaVersion = "0.0.1";

export function makeRunMeta({ seed, scenarioId, dataset = datasetVersion, model = modelVersion, schema = schemaVersion }) {
  const runId = `${dataset}|${model}|${schema}|${seed}|${scenarioId}`;
  return {
    datasetVersion: dataset,
    modelVersion: model,
    schemaVersion: schema,
    seed,
    scenarioId,
    runId,
  };
}
