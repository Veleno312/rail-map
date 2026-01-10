from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict, List

from ._common import DatasetContext, ensure_dir, append_text, sha256_file, utc_now_iso, write_json


def _load_pyshp():
    try:
        import shapefile  # type: ignore
    except Exception as exc:  # pragma: no cover - best effort import
        raise RuntimeError(
            "pyshp is required to convert Natural Earth shapefiles. "
            "Install with: pip install pyshp"
        ) from exc
    return shapefile


def _extract_zip(zip_path: Path, tmp_dir: Path) -> Path:
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(tmp_dir)
    shps = list(tmp_dir.rglob("*.shp"))
    if not shps:
        raise RuntimeError(f"No .shp found in {zip_path}")
    return shps[0]


def _shp_to_geojson(shp_path: Path, out_path: Path) -> None:
    shapefile = _load_pyshp()
    reader = shapefile.Reader(str(shp_path))
    fields = [f[0] for f in reader.fields[1:]]
    features = []
    for sr in reader.shapeRecords():
        props = {fields[i]: sr.record[i] for i in range(len(fields))}
        geom = sr.shape.__geo_interface__
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": geom
        })
    out_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )


def run(ctx: DatasetContext, cfg: Dict[str, Any]) -> List[Path]:
    out_dir = ctx.out_root / "natural_earth"
    ensure_dir(out_dir)

    items = cfg.get("items", [])
    if not items:
        return []

    sources = {
        "dataset": "Natural Earth (GeoJSON conversion)",
        "retrievedAtUtc": utc_now_iso(),
        "license": "Public domain (Natural Earth)",
        "items": [],
    }
    downloaded: List[Path] = []

    for item in items:
        name = item["name"]
        zip_path = out_dir / f"{name}.zip"
        if not zip_path.exists():
            sources["items"].append({"name": name, "status": "missing_zip"})
            continue

        out_path = out_dir / f"{name}.geojson"
        if out_path.exists():
            digest = sha256_file(out_path)
            append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
            downloaded.append(out_path)
            sources["items"].append({
                "name": name,
                "sha256": digest,
                "status": "cached"
            })
            continue

        tmp_dir = out_dir / f"_tmp_{name}"
        shp_path = _extract_zip(zip_path, tmp_dir)
        _shp_to_geojson(shp_path, out_path)
        shutil.rmtree(tmp_dir, ignore_errors=True)

        digest = sha256_file(out_path)
        append_text(ctx.checksums_path, f"{digest}  {out_path.relative_to(ctx.out_root)}\n")
        downloaded.append(out_path)
        sources["items"].append({
            "name": name,
            "zip": str(zip_path),
            "sha256": digest
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
