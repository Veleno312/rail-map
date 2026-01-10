# Golden Scenarios

Purpose:
- Deterministic regression tests for sim-core.
- Each scenario has a fixed seed and expected report rows.

How to extend:
- Add a scenario JSON file with `seed`, `scenarioId`, and minimal state.
- Record expected `tickRow` outputs for the first N ticks.

Notes:
- Keep files small and deterministic.
- All units must be explicit in the report metadata.
