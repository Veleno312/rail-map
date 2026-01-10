from __future__ import annotations

import json
import time
import requests
from pathlib import Path
from typing import Any, Dict, List

from ._common import DatasetContext, append_text, write_json, sha256_file, utc_now_iso, USER_AGENT, ensure_dir

API = "https://comtradeapi.worldbank.org/v1/get/HS"

def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "un_comtrade"
    ensure_dir(out_dir)
    downloaded: List[Path] = []

    year = int(cfg.get("year", 2022))

    params = {
        "reporterCode": "all",
        "year": year,
        "cmdCode": "TOTAL",
        "flowCode": "X,M",
        "format": "JSON",
    }

    sources = {
        "dataset": "UN Comtrade (World Bank Comtrade API mirror)",
        "retrievedAtUtc": utc_now_iso(),
        "license": "UN Comtrade Terms of Use apply; treat as calibration data.",
        "items": [],
    }

    max_retries = int(cfg.get("max_retries", 3))
    prepared_url = requests.Request("GET", API, params=params).prepare().url
    out = out_dir / f"trade_total_{year}.json"
    if out.exists():
        digest = sha256_file(out)
        append_text(ctx.checksums_path, f"{digest}  {out.relative_to(ctx.out_root)}\n")
        downloaded.append(out)
        sources["items"].append({
            "url": prepared_url,
            "sha256": digest,
            "status": "cached"
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
    last_error: Exception | None = None
    success = False
    for attempt in range(1, max_retries + 1):
        try:
            r = requests.get(API, params=params, headers={"User-Agent": USER_AGENT}, timeout=300)
            r.raise_for_status()
            out.write_text(r.text, encoding="utf-8")
            success = True
            break
        except requests.RequestException as exc:
            last_error = exc
            if attempt < max_retries:
                time.sleep(min(5 * attempt, 20))
    if not success:
        if out.exists():
            digest = sha256_file(out)
            append_text(ctx.checksums_path, f"{digest}  {out.relative_to(ctx.out_root)}\n")
            downloaded.append(out)
            sources["items"].append({
                "url": prepared_url,
                "sha256": digest,
                "status": "cached",
                "error": str(last_error),
            })
        else:
            sources["items"].append({
                "url": prepared_url,
                "status": "failed",
                "error": str(last_error),
            })
    else:
        digest = sha256_file(out)
        append_text(ctx.checksums_path, f"{digest}  {out.relative_to(ctx.out_root)}\n")
        downloaded.append(out)
        sources["items"].append({"url": str(prepared_url), "sha256": digest})

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
