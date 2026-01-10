from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List
import requests

from ._common import DatasetContext, write_json, append_text, sha256_file, utc_now_iso, USER_AGENT, ensure_dir

def _download_json(indicator: str, countries: str, start_year: int, end_year: int) -> List[Dict[str, Any]]:
    base = f"https://api.worldbank.org/v2/country/{countries}/indicator/{indicator}"
    params = {"format": "json", "per_page": 20000, "date": f"{start_year}:{end_year}"}
    headers = {"User-Agent": USER_AGENT}
    r = requests.get(base, params=params, headers=headers, timeout=120)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list) or len(data) < 2:
        raise RuntimeError(f"Unexpected response for {indicator}: {data}")
    return data[1]

def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "world_bank_wdi"
    ensure_dir(out_dir)
    downloaded: List[Path] = []

    indicators = cfg.get("indicators", [])
    countries = cfg.get("countries", "all")
    start_year = int(cfg.get("start_year", 1990))
    end_year = int(cfg.get("end_year", 2024))
    fmt = cfg.get("format", "json")
    if fmt != "json":
        raise ValueError("This repo version supports only format=json for WDI")

    sources = {
        "dataset": "World Bank - World Development Indicators (via V2 API)",
        "retrievedAtUtc": utc_now_iso(),
        "license": "See World Bank data terms; verify per indicator.",
        "items": [],
    }

    for ind in indicators:
        out_path = out_dir / f"{ind}_{countries}_{start_year}-{end_year}.json"
        if out_path.exists():
            digest = sha256_file(out_path)
            append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
            downloaded.append(out_path)
            sources["items"].append({
                "indicator": ind,
                "countries": countries,
                "start_year": start_year,
                "end_year": end_year,
                "format": fmt,
                "sha256": digest,
                "status": "cached",
            })
            continue

        rows = _download_json(ind, countries, start_year, end_year)
        out_path.write_text(json.dumps(rows, ensure_ascii=False) + "\n", encoding="utf-8")

        digest = sha256_file(out_path)
        append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
        downloaded.append(out_path)
        sources["items"].append({
            "indicator": ind,
            "countries": countries,
            "start_year": start_year,
            "end_year": end_year,
            "format": fmt,
            "sha256": digest,
        })

    existing = []
    if ctx.sources_path.exists():
        existing = json.loads(ctx.sources_path.read_text(encoding="utf-8"))
        if not isinstance(existing, list):
            existing = [existing]
    else:
        existing = []
    existing.append(sources)
    write_json(ctx.sources_path, existing)
    return downloaded
