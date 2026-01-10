from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests

from ._common import DatasetContext, http_get_stream, write_json, append_text, sha256_file, utc_now_iso, USER_AGENT, ensure_dir

def _api_get(api_base: str, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = api_base.rstrip("/") + "/" + path.lstrip("/")
    headers = {"User-Agent": USER_AGENT}
    r = requests.get(url, params=params or {}, headers=headers, timeout=120)
    r.raise_for_status()
    return r.json()

def _find_candidate_layers(api_base: str, iso3: str, year: int, prefer_products: List[str]) -> List[Dict[str, Any]]:
    root = _api_get(api_base, "")
    pool = root if isinstance(root, list) else []
    candidates: List[Dict[str, Any]] = []
    for item in pool:
        if not isinstance(item, dict):
            continue
        blob = " ".join(str(item.get(k, "")) for k in ["alias", "name", "title", "desc", "description"]).lower()
        if iso3.lower() in blob and (str(year) in blob or "ppp" in blob or "population" in blob):
            candidates.append(item)
    return candidates

def _resolve_download_url(api_base: str, layer: Dict[str, Any]) -> Optional[str]:
    for key in ["download_url", "download", "url", "link", "path"]:
        val = layer.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val
    if "id" in layer:
        try:
            detail = _api_get(api_base, str(layer["id"]))
            if isinstance(detail, dict):
                for key in ["download_url", "download", "url", "link"]:
                    v = detail.get(key)
                    if isinstance(v, str) and v.startswith("http"):
                        return v
        except Exception:
            pass
    return None

def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "worldpop"
    ensure_dir(out_dir)
    downloaded: List[Path] = []

    api_base = cfg.get("api_base", "https://www.worldpop.org/rest/data")
    iso3s = cfg.get("countries_iso3", [])
    year = int(cfg.get("year", 2020))
    prefer_products = cfg.get("prefer_products", ["ppp", "Population Count", "Unconstrained"])

    sources = {
        "dataset": "WorldPop (via REST API)",
        "retrievedAtUtc": utc_now_iso(),
        "license": "WorldPop datasets are generally CC BY 4.0; verify per layer.",
        "items": [],
        "notes": "If no direct URL is found, candidates are recorded for manual selection.",
    }

    for iso3 in iso3s:
        candidates = _find_candidate_layers(api_base, iso3, year, prefer_products)
        chosen_url = None
        chosen_layer = None
        candidates_sorted = candidates[:]
        def score(layer):
            txt = (" ".join(str(layer.get(k, "")) for k in ["alias","name","title","desc","description"])).lower()
            s = 0
            if "ppp" in txt: s += 5
            if "population" in txt: s += 3
            if "count" in txt: s += 2
            if str(year) in txt: s += 2
            return s
        candidates_sorted.sort(key=score, reverse=True)

        for cand in candidates_sorted[:10]:
            url = _resolve_download_url(api_base, cand)
            if url:
                chosen_url = url
                chosen_layer = cand
                break

        if not chosen_url:
            sources["items"].append({
                "iso3": iso3,
                "year": year,
                "status": "not_downloaded_no_direct_url",
                "candidates": candidates_sorted[:25],
            })
            continue

        out_path = out_dir / iso3 / f"worldpop_{iso3}_{year}{Path(chosen_url.split('?')[0]).suffix or '.bin'}"
        if out_path.suffix.lower() not in [".tif", ".tiff", ".zip", ".gz", ".bin"]:
            out_path = out_dir / iso3 / f"worldpop_{iso3}_{year}.bin"

        http_get_stream(chosen_url, out_path, timeout=300)
        digest = sha256_file(out_path)
        append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
        downloaded.append(out_path)

        sources["items"].append({
            "iso3": iso3,
            "year": year,
            "status": "downloaded",
            "chosen_layer": chosen_layer,
            "download_url": chosen_url,
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
