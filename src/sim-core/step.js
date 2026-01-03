import { makeRng } from "./rng.js";
import { makeRunMeta } from "./versions.js";
import { validateState } from "./validate.js";

// Import your existing model logic (these already exist in your repo)
import { computeFlows } from "../../dynamics.js";
import { computeEconomy } from "../../economy.js";

/**
 * Pure deterministic step:
 * - does NOT touch DOM
 * - does NOT read time
 * - does NOT depend on rendering
 *
 * @param {object} prevState - your current global state object
 * @param {object} input - { seed, scenarioId, tickLabel? }
 * @returns {{ state: object, tickRow: object, issues: Array }}
 */
export function simCoreStep(prevState, input) {
  const seed = (input?.seed ?? 1) >>> 0;
  const scenarioId = input?.scenarioId ?? "default";
  const tickLabel = input?.tickLabel ?? "";

  // Clone so we don't mutate the caller's state
  const state = safeClone(prevState);

  // Attach meta once (or keep existing)
  state.meta = state.meta ?? makeRunMeta({ seed, scenarioId });
  state.tTick = Number.isInteger(state.tTick) ? state.tTick : 0;

  // Deterministic rng stream for this tick (available for later models)
  const rng = makeRng(seed).fork(`tick:${state.tTick}`);
  state.rng = { seed: rng.seed }; // store minimal info (avoid storing function closures)

  // ---- Call your existing simulation components ----
  // IMPORTANT: these functions may mutate `state`. That's okay because `state` is our clone.

  // 1) dynamics / flows
  // If computeFlows expects different signature in your codebase, adjust here only.
  computeFlows(state);

  // 2) economy update
  computeEconomy(state);

  // advance tick
  state.tTick += 1;

  // Create one “row” for exports
  const tickRow = {
    tTick: state.tTick,
    tickLabel,
    cashEUR: numOrNull(state.cashEUR),
    revenueEUR: numOrNull(state.revenueEUR ?? state.revenue), // compatible with older naming
    costEUR: numOrNull(state.costEUR ?? state.cost),
    profitEUR: numOrNull(state.profitEUR ?? state.profit),
    paxMoved: numOrNull(state.paxMoved),
    runId: state.meta.runId,
  };

  const issues = validateState(state);

  return { state, tickRow, issues };
}

function safeClone(x) {
  // structuredClone exists in modern browsers; fallback for older environments
  if (typeof structuredClone === "function") return structuredClone(x);
  return JSON.parse(JSON.stringify(x));
}

function numOrNull(x) {
  return Number.isFinite(x) ? x : null;
}
