export function requireString(x, name) {
  if (typeof x !== "string" || x.length === 0) throw new Error(`${name} must be a non-empty string`);
  return x;
}

export function requireFinite(x, name) {
  if (!Number.isFinite(x)) throw new Error(`${name} must be finite`);
  return x;
}
