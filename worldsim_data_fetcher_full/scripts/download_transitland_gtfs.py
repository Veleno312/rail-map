from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests

from ._common import DatasetContext, http_get_stream, write_json, append_text, sha256_file, utc_now_iso, USER_AGENT, ensure_dir

TRANSITLAND_BASE = "https://transit.land"

def _get_api_key() -> Optional[str]:
    return os.environ.get("TRANSITLAND_API_KEY")

def _search_feeds_by_bbox(bbox: List[float], max_feeds: int) -> List[Dict[str, Any]]:
    api_key = _get_api_key()
    headers = {"User-Agent": USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    query = '''
    query Feeds($bbox: [Float!]!, $limit: Int!) {
      feeds(limit: $limit, where: {bbox: $bbox}) {
        id
        onestop_id
        name
        spec
        url
      }
    }
    '''
    payload = {"query": query, "variables": {"bbox": bbox, "limit": max_feeds}}
    r = requests.post(f"{TRANSITLAND_BASE}/api/v2/graphql", json=payload, headers=headers, timeout=60)
    r.raise_for_status()
    j = r.json()
    feeds = (j.get("data") or {}).get("feeds") or []
    return feeds

def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "transitland_gtfs"
    ensure_dir(out_dir)
    downloaded: List[Path] = []

    bbox = cfg.get("bbox")
    max_feeds = int(cfg.get("max_feeds", 50))

    sources = {
        "dataset": "Transitland GTFS feeds (discovery + download)",
        "retrievedAtUtc": utc_now_iso(),
        "license": "Varies per feed; you must record terms/attribution.",
        "items": [],
        "errors": [],
    }

    feeds: List[Dict[str, Any]] = []
    try:
        if bbox:
            feeds = _search_feeds_by_bbox(bbox, max_feeds)
    except Exception as e:
        sources["errors"].append({"stage": "search", "error": str(e)})

    for feed in feeds:
        url = feed.get("url")
        onestop = feed.get("onestop_id") or feed.get("id") or "unknown"
        if not url or not isinstance(url, str):
            continue
        out_path = out_dir / f"{onestop}.zip"
        try:
            http_get_stream(url, out_path, timeout=300)
            digest = sha256_file(out_path)
            append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
            downloaded.append(out_path)
            sources["items"].append({
                "onestop_id": onestop,
                "name": feed.get("name"),
                "spec": feed.get("spec"),
                "url": url,
                "sha256": digest,
            })
        except Exception as e:
            sources["errors"].append({"stage": "download", "onestop_id": onestop, "url": url, "error": str(e)})

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
