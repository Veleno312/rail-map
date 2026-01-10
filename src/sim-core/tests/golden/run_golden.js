import { simCoreStep } from "../step.js";
import { makeRunMeta } from "../pure/versions.js";
import { makeReport } from "../report.js";
import { migrateState } from "../pure/migrate.js";

// Placeholder harness. Wire into your test runner later.
export function runGoldenScenario(scenario, models) {
  const seed = (scenario?.seed ?? 1) >>> 0;
  const scenarioId = scenario?.scenarioId ?? "golden";
  const prevState = scenario?.state ?? {};

  const meta = makeRunMeta({ seed, scenarioId });
  const { state: migrated } = migrateState(prevState, prevState.schemaVersion);
  const rows = [];

  let state = migrated;
  for (let i = 0; i < 3; i++) {
    const out = simCoreStep(state, { seed, scenarioId, tickLabel: `t${i}`, models });
    rows.push(out.tickRow);
    state = out.state;
  }

  return makeReport(meta, rows);
}
