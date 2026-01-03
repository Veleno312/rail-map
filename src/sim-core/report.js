export function makeReportHeader(meta) {
  return {
    meta,
    units: {
      cashEUR: "EUR",
      revenueEUR: "EUR",
      costEUR: "EUR",
      profitEUR: "EUR",
      paxMoved: "pax",
      tick: "ticks",
    },
  };
}

export function toCsv(rows) {
  // rows: array of plain objects with same keys
  if (!rows.length) return "";

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
