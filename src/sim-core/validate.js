function validateState(state) {
  const issues = [];

  // Basic checks
  if (!state) issues.push({ path: "", message: "state is missing" });

  // Money fields often appear in your state
  if (state?.cashEUR != null && !Number.isFinite(state.cashEUR)) {
    issues.push({ path: "cashEUR", message: "cashEUR is not finite" });
  }

  // Common containers in your project (Maps)
  if (state?.nodes && !(state.nodes instanceof Map)) {
    issues.push({ path: "nodes", message: "nodes should be a Map" });
  }
  if (state?.tracks && !(state.tracks instanceof Map)) {
    issues.push({ path: "tracks", message: "tracks should be a Map" });
  }
  if (state?.lines && !(state.lines instanceof Map)) {
    issues.push({ path: "lines", message: "lines should be a Map" });
  }

  return issues;
}

window.validateState = validateState;
