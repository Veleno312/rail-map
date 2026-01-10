from __future__ import annotations

import json
import time
import requests
from pathlib import Path
from typing import Any, Dict, List

from ._common import DatasetContext, append_text, write_json, sha256_file, utc_now_iso, USER_AGENT, ensure_dir

FAO_API = "https://fenixservices.fao.org/faostat/api/v1/en/FAOSTAT"

def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "faostat"
    ensure_dir(out_dir)
    downloaded: List[Path] = []

    domains = cfg.get("domains", ["QCL"])
    years = cfg.get("years", [2020])

    sources = {
        "dataset": "FAOSTAT",
        "retrievedAtUtc": utc_now_iso(),
        "license": "FAO Open Data policy (often CC BY 4.0); verify per dataset.",
        "items": [],
    }

    max_retries = int(cfg.get("max_retries", 3))

    for domain in domains:
        params = {"area": "all", "year": ",".join(map(str, years))}
        url = f"{FAO_API}/{domain}"
        prepared_url = requests.Request("GET", url, params=params).prepare().url
        out = out_dir / f"{domain}.json"
        if out.exists():
            digest = sha256_file(out)
            append_text(ctx.checksums_path, f"{digest}  {out.relative_to(ctx.out_root)}\n")
            downloaded.append(out)
            sources["items"].append({
                "domain": domain,
                "url": prepared_url,
                "sha256": digest,
                "status": "cached"
            })
            continue
        last_error: Exception | None = None
        success = False
        for attempt in range(1, max_retries + 1):
            try:
                r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=300)
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
                    "domain": domain,
                    "url": prepared_url,
                    "sha256": digest,
                    "status": "cached",
                    "error": str(last_error),
                })
            else:
                sources["items"].append({
                    "domain": domain,
                    "url": prepared_url,
                    "status": "failed",
                    "error": str(last_error),
                })
            continue
        digest = sha256_file(out)
        append_text(ctx.checksums_path, f"{digest}  {out.relative_to(ctx.out_root)}\n")
        downloaded.append(out)
        sources["items"].append({"domain": domain, "url": str(prepared_url), "sha256": digest})

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
