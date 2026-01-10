import { schemaVersion as CURRENT_SCHEMA_VERSION } from "./versions.js";

// Pure migration hook. Keep deterministic and side-effect free.
export function migrateState(prevState, fromVersion) {
  const state = prevState == null ? {} : prevState;
  const from = fromVersion || state.schemaVersion || "0.0.0";
  const to = CURRENT_SCHEMA_VERSION;
  const notes = [];

  if (from === to) {
    return { state, from, to, notes };
  }

  // Placeholder: add versioned transforms here.
  // Example:
  // if (from === "0.0.1") { ...; notes.push("migrated 0.0.1 -> 0.0.2"); }

  state.schemaVersion = to;
  notes.push(`migrated ${from} -> ${to}`);

  return { state, from, to, notes };
}
