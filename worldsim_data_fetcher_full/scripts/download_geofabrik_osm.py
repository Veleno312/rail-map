from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from ._common import DatasetContext, http_get_stream, write_json, append_text, sha256_file, utc_now_iso

def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "geofabrik_osm"
    downloaded: List[Path] = []

    sources = {
        "dataset": "OpenStreetMap extracts (Geofabrik)",
        "retrievedAtUtc": utc_now_iso(),
        "license": "ODbL 1.0 (OpenStreetMap) — attribution + share-alike obligations apply",
        "items": [],
    }

    for reg in cfg.get("regions", []):
        reg_id = reg["id"]
        url = reg["url"]
        out_path = out_dir / reg_id / "latest.osm.pbf"
        http_get_stream(url, out_path, timeout=300)
        digest = sha256_file(out_path)
        append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
        downloaded.append(out_path)

        sources["items"].append({
            "id": reg_id,
            "url": url,
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
