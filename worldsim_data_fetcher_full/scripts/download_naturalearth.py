from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List
import requests

from ._common import DatasetContext, http_get_stream, write_json, append_text, sha256_file, utc_now_iso, USER_AGENT, ensure_dir

def _resolve_zip_from_page(page_url: str) -> str:
    headers = {"User-Agent": USER_AGENT}
    html = requests.get(page_url, headers=headers, timeout=60).text
    zips = re.findall(r'href="([^"]+\.zip)"', html, flags=re.IGNORECASE)
    if not zips:
        raise RuntimeError(f"Could not find a .zip link on page: {page_url}")

    def absolutize(u: str) -> str:
        if u.startswith("http://") or u.startswith("https://"):
            return u
        if u.startswith("//"):
            return "https:" + u
        if u.startswith("/"):
            return "https://www.naturalearthdata.com" + u
        return page_url.rstrip("/") + "/" + u

    def normalize(u: str) -> str:
        return (
            u.replace("http//", "http://")
             .replace("https//", "https://")
             .replace("https://www.naturalearthdata.com/http://", "http://")
             .replace("https://www.naturalearthdata.com/https://", "https://")
        )

    zips_abs = [normalize(absolutize(u)) for u in zips]
    zips_abs.sort(key=lambda u: (("download" not in u.lower()), len(u)))
    return zips_abs[0]

def _s3_fallback(url: str) -> str | None:
    m = re.search(r"/download/(\d+m)/(cultural|physical)/([^/]+\.zip)", url)
    if not m:
        return None
    scale = m.group(1)
    kind = m.group(2)
    name = m.group(3)
    return f"https://naturalearth.s3.amazonaws.com/{scale}_{kind}/{name}"

def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "natural_earth"
    ensure_dir(out_dir)
    downloaded: List[Path] = []
    sources: Dict[str, Any] = {
        "dataset": "Natural Earth",
        "retrievedAtUtc": utc_now_iso(),
        "license": "Public domain (Natural Earth) — verify per layer",
        "items": [],
    }

    for item in cfg.get("items", []):
        name = item["name"]
        page_url = item["page_url"]
        zip_url = _resolve_zip_from_page(page_url)
        out_path = out_dir / f"{name}.zip"
        if out_path.exists():
            digest = sha256_file(out_path)
            append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
            downloaded.append(out_path)
            sources["items"].append({
                "name": name,
                "page_url": page_url,
                "zip_url": zip_url,
                "sha256": digest,
                "status": "cached"
            })
            continue
        try:
            http_get_stream(zip_url, out_path)
        except Exception:
            fallback = _s3_fallback(zip_url)
            if not fallback:
                raise
            http_get_stream(fallback, out_path)
            zip_url = fallback
        digest = sha256_file(out_path)
        append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
        downloaded.append(out_path)
        sources["items"].append({
            "name": name,
            "page_url": page_url,
            "zip_url": zip_url,
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
