import { makeRng } from "./rng.js";
import { makeRunMeta } from "./versions.js";
import { validateState } from "./validate.js";

function safeClone(value, seen = new WeakSet()) {
  // Handle primitives
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  
  // Skip functions
  if (typeof value === 'function') return undefined;
  
  // Skip DOM elements and nodes
  if (value instanceof HTMLElement || value instanceof Node || value instanceof Window) return undefined;
  
  // Handle Maps and Sets - pass by reference to maintain functionality
  if (value instanceof Map || value instanceof Set) {
    // Don't clone Maps/Sets - return original reference
    return value;
  }
  
  // Handle objects that look like Maps (have Map methods but aren't actual Maps)
  if (value && typeof value === 'object') {
    const hasMapMethods = typeof value.get === 'function' && 
                         typeof value.set === 'function' && 
                         typeof value.has === 'function' &&
                         typeof value.delete === 'function' &&
                         typeof value.clear === 'function' &&
                         typeof value.entries === 'function' &&
                         typeof value.keys === 'function' &&
                         typeof value.values === 'function';
    
    if (hasMapMethods) {
      // This looks like a Map-like object, preserve it as-is
      return value;
    }
  }
  
  // Handle Arrays - clone contents but skip unserializable items
  if (Array.isArray(value)) {
    return value.map(item => {
      const cloned = safeClone(item, seen);
      return cloned === undefined ? null : cloned; // Replace undefined with null
    });
  }
  
  // Handle plain objects - clone contents but skip unserializable items
  if (value && typeof value === 'object') {
    // Check for circular references
    if (seen.has(value)) {
      return undefined; // Skip circular references
    }
    seen.add(value);

    // If this object contains Maps/Sets (or Map-like objects), do a manual clone
    // so nested Maps (e.g. state.luti.accessJobs) don't get stringified into {}.
    let hasSpecialChildren = false;
    for (const v of Object.values(value)) {
      if (v instanceof Map || v instanceof Set) {
        hasSpecialChildren = true;
        break;
      }
      if (v && typeof v === 'object') {
        const childHasMapMethods =
          typeof v.get === 'function' &&
          typeof v.set === 'function' &&
          typeof v.has === 'function' &&
          typeof v.delete === 'function' &&
          typeof v.clear === 'function' &&
          typeof v.entries === 'function' &&
          typeof v.keys === 'function' &&
          typeof v.values === 'function';
        if (childHasMapMethods) {
          hasSpecialChildren = true;
          break;
        }
      }
    }

    if (hasSpecialChildren) {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const cloned = safeClone(v, seen);
        if (cloned !== undefined) out[k] = cloned;
      }
      return out;
    }

    // Otherwise, prefer the JSON fast-path
    try {
      const json = JSON.stringify(value);
      return JSON.parse(json);
    } catch (e) {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const cloned = safeClone(v, seen);
        if (cloned !== undefined) {
          out[k] = cloned;
        }
      }
      return out;
    }
  }
  
  return value;
}

function numOrNull(x) {
  return Number.isFinite(x) ? x : null;
}

/**
 * Pure deterministic sim step.
 * - No DOM
 * - No Date/Time access
 * - Deterministic given { seed, scenarioId, state }
 *
 * @param {object} prevState
 * @param {object} input
 * @param {object} input.models - { computeFlows?, computeEconomy? }
 * @returns {{ state: object, tickRow: object, issues: Array }}
 */
export function simCoreStep(prevState, input) {
  const seed = (input?.seed ?? 1) >>> 0;
  const scenarioId = input?.scenarioId ?? "default";
  const tickLabel = input?.tickLabel ?? "";
  const models = input?.models || {};

  // Store all Maps and Map-like objects before cloning
  const originalMaps = {};
  for (const [key, value] of Object.entries(prevState)) {
    if (value instanceof Map || value instanceof Set) {
      originalMaps[key] = value;
    } else if (value && typeof value === 'object') {
      // Check for Map-like objects (have Map methods but aren't actual Maps)
      const hasMapMethods = typeof value.get === 'function' && 
                           typeof value.set === 'function' && 
                           typeof value.has === 'function' &&
                           typeof value.delete === 'function' &&
                           typeof value.clear === 'function' &&
                           typeof value.entries === 'function' &&
                           typeof value.keys === 'function' &&
                           typeof value.values === 'function';
      
      if (hasMapMethods) {
        originalMaps[key] = value;
      }
    }
  }

  const state = safeClone(prevState);

  // Restore all Maps after cloning
  for (const [key, map] of Object.entries(originalMaps)) {
    state[key] = map;
  }

  state.meta = state.meta ?? makeRunMeta({ seed, scenarioId });
  state.tTick = Number.isInteger(state.tTick) ? state.tTick : 0;

  const rng = makeRng(seed).fork(`tick:${state.tTick}`);
  state.rng = { seed: rng.seed };

  if (typeof models.computeFlows === "function") {
    const flows = models.computeFlows(state);
    // Apply flows back to state (if flows object is returned)
    if (flows && typeof flows === "object") {
      Object.assign(state, flows);
    }
  }

  if (typeof models.computeEconomy === "function") {
    const economy = models.computeEconomy(state);
    // Apply economy back to state (if economy object is returned)
    if (economy && typeof economy === "object") {
      Object.assign(state, economy);
    }
  }

  // advance tick
  state.tTick += 1;

  // Create one "row" for exports
  const tickRow = {
    tTick: state.tTick,
    tickLabel,
    cashEUR: numOrNull(state.cashEUR),
    revenueEUR: numOrNull(state.revenueEUR ?? state.revenue),
    costEUR: numOrNull(state.costEUR ?? state.cost),
    profitEUR: numOrNull(state.profitEUR ?? state.profit),
    paxMoved: numOrNull(state.paxMoved),
    runId: state.meta.runId,
  };

  const issues = validateState(state);

  return { state, tickRow, issues };
}
