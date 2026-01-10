// Deterministic report helpers (pure).
export function makeReportHeader(meta) {
  return {
    meta,
    units: {
      cashEUR: "EUR",
      revenueEUR: "EUR",
      costEUR: "EUR",
      profitEUR: "EUR",
      paxMoved: "pax",
      goodsMoved: "goods_units",
      tick: "ticks",
    },
  };
}

export function makeReport(meta, rows) {
  return {
    ...makeReportHeader(meta),
    rows: Array.isArray(rows) ? rows.slice() : [],
  };
}

export function toCsv(rows) {
  if (!rows || !rows.length) return "";

  const cols = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };

  const lines = [];
  lines.push(cols.join(","));
  for (const r of rows) lines.push(cols.map(c => escape(r[c])).join(","));
  return lines.join("\n");
}
