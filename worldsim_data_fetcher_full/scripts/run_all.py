from __future__ import annotations

import argparse
import json
import traceback
from pathlib import Path
from typing import Any, Dict, List

from ._common import DatasetContext, load_yaml, save_manifest, ensure_dir, write_json

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="Path to YAML config")
    ap.add_argument("--dataset-version", required=True, help="Dataset version string (e.g. 2026-01-06-demo)")
    args = ap.parse_args()

    cfg = load_yaml(Path(args.config))
    out_root = Path(cfg.get("output_root", "data/raw")) / args.dataset_version
    ensure_dir(out_root)

    ctx = DatasetContext(dataset_version=args.dataset_version, out_root=out_root)
    all_files: List[Path] = []
    errors: List[Dict[str, Any]] = []

    downloads = cfg.get("downloads", {})
    generators = cfg.get("generators", {})

    def run_module(key: str, module_name: str):
        mod_cfg = downloads.get(key, {})
        if not mod_cfg.get("enabled", False):
            print(f"[skip] {key}")
            return
        print(f"[run]  {key}")
        try:
            mod = __import__(f"scripts.{module_name}", fromlist=["run"])
            files = mod.run(ctx, mod_cfg)  # type: ignore
            all_files.extend(files)
        except Exception as exc:
            errors.append({
                "module": key,
                "error": str(exc),
                "trace": traceback.format_exc()
            })
            print(f"[warn] {key} failed: {exc}")

    run_module("natural_earth", "download_naturalearth")
    if downloads.get("natural_earth", {}).get("convert_geojson", False):
        try:
            mod = __import__("scripts.convert_naturalearth_geojson", fromlist=["run"])
            files = mod.run(ctx, downloads.get("natural_earth", {}))  # type: ignore
            all_files.extend(files)
        except Exception as exc:
            errors.append({
                "module": "natural_earth_geojson",
                "error": str(exc),
                "trace": traceback.format_exc()
            })
            print(f"[warn] natural_earth_geojson failed: {exc}")
    run_module("geofabrik_osm", "download_geofabrik_osm")
    run_module("worldpop", "download_worldpop")
    run_module("world_bank_wdi", "download_worldbank_wdi")
    run_module("faostat", "download_faostat")
    run_module("un_comtrade", "download_un_comtrade")
    run_module("transitland_gtfs", "download_transitland_gtfs")

    # Generators
    if generators.get("synthetic_competitors", {}).get("enabled", False):
        from .generate_synthetic_competitors import run as gen_comp
        seed = int(generators["synthetic_competitors"].get("seed", 12345))
        out_path = gen_comp(seed, ctx.out_root / "synthetic")
        all_files.append(out_path)

    # Ensure sources + checksums exist even if nothing downloaded
    ctx.sources_path.parent.mkdir(parents=True, exist_ok=True)
    if not ctx.sources_path.exists():
        ctx.sources_path.write_text("[]\n", encoding="utf-8")
    if not ctx.checksums_path.exists():
        ctx.checksums_path.write_text("", encoding="utf-8")

    if errors:
        errors_path = ctx.out_root / "errors.json"
        write_json(errors_path, errors)
        all_files.append(errors_path)

    save_manifest(ctx, all_files + [ctx.sources_path, ctx.checksums_path])
    print("\nDone.")
    print(f"Output: {out_root}")

if __name__ == "__main__":
    main()
