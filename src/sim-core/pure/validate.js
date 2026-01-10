// Pure state validator (no DOM, no globals).
export function validateState(state) {
  const issues = [];

  if (!state) {
    issues.push({ path: "", message: "state is missing" });
    return issues;
  }

  if (state.cashEUR != null && !Number.isFinite(state.cashEUR)) {
    issues.push({ path: "cashEUR", message: "cashEUR is not finite" });
  }

  if (state.nodes && !(state.nodes instanceof Map)) {
    issues.push({ path: "nodes", message: "nodes should be a Map" });
  }
  if (state.tracks && !(state.tracks instanceof Map)) {
    issues.push({ path: "tracks", message: "tracks should be a Map" });
  }
  if (state.lines && !(state.lines instanceof Map)) {
    issues.push({ path: "lines", message: "lines should be a Map" });
  }

  return issues;
}
